import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanPages, type Line } from './clean.ts';
import { OrphanAttachmentError, splitStatute, type StatuteChunk, missingSections } from './statute.ts';

function fixture(name: string): Line[] {
  const raw = readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');
  return cleanPages(raw.split('\f').map((text, i) => ({ pageNo: i + 1, text })));
}
const byKey = (chunks: StatuteChunk[], key: string) => {
  const c = chunks.find((x) => x.key === key);
  if (!c) throw new Error(`no chunk ${key}; have ${chunks.map((x) => x.key).join(', ')}`);
  return c;
};

const ICA = { actName: 'Indian Contract Act', actYear: 1872, kind: 'act' } as const;
const CONST = { actName: 'Constitution of India', kind: 'constitution' } as const;

describe('splitStatute: Indian Contract Act, 1872', () => {
  const chunks = splitStatute(fixture('ica-1872-ss25-32-56.txt'), ICA);

  it('makes one chunk per section, with no running headers or page numbers', () => {
    expect(chunks.map((c) => c.key)).toEqual(['s25', 's32', 's56']);
    for (const c of chunks) {
      expect(c.text).not.toMatch(/THE INDIAN CONTRACT ACT/);
      expect(c.text).not.toMatch(/\n\d+$/);
    }
  });

  it('builds the header from act, chapter and section title', () => {
    expect(byKey(chunks, 's56').header).toBe(
      'Indian Contract Act, 1872 › Chapter IV: Of the performance of contracts › s. 56 Agreement to do impossible act',
    );
    expect(byKey(chunks, 's32').chapter).toBe('Chapter III: Of contingent contracts');
  });

  it('keeps s. 56 whole: all three paragraphs and illustrations (a)–(e)', () => {
    const s56 = byKey(chunks, 's56');
    expect(s56.kind).toBe('section');
    expect(s56.text).toContain('An agreement to do an act impossible in itself is void.');
    expect(s56.text).toContain('becomes void when the act becomes impossible or unlawful.');
    expect(s56.text).toContain('(e) A contracts to act at a theatre for six months');
    expect(s56.attachments).toEqual(['illustration']);
    expect(s56.pageNo).toBe(3);
  });

  it('keeps both explanations and all illustrations of s. 25 with the section', () => {
    const s25 = byKey(chunks, 's25');
    expect(s25.attachments.sort()).toEqual(['explanation', 'illustration']);
    expect(s25.text).toContain('Explanation 2.—An agreement to which the consent');
    expect(s25.text).toContain("(g) A agrees to sell a horse worth Rs. 1,000 for Rs. 10. A denies");
  });

  it('splits a long section only at sub-section boundaries, carrying intro and whole-section attachments', () => {
    const split = splitStatute(fixture('ica-1872-ss25-32-56.txt'), { ...ICA, maxTokens: 150 });
    const children = split.filter((c) => c.parentKey === 's25');
    expect(children.map((c) => c.key)).toEqual(['s25(1)', 's25(2)', 's25(3)']);
    for (const child of children) {
      expect(child.text.startsWith('25. Agreement without consideration')).toBe(true); // intro repeated
      expect(child.text).toContain('Explanation 1.—Nothing in this section'); // whole-section explanation in every child
      expect(child.text).toContain('(a) A promises, for no consideration');
      expect(child.header).toMatch(/› s\. 25 .* › sub-s\. \(\d\)$/);
    }
    expect(byKey(split, 's25(1)').text).not.toContain('(2) it is a promise to compensate');
    expect(byKey(split, 's25(3)').text).toContain('In any of these cases, such an agreement is a contract.');
    // short sections are never split, whatever the limit
    expect(split.filter((c) => c.parentKey === 's32')).toHaveLength(0);
  });
});

describe('splitStatute: Constitution, Art. 19', () => {
  const chunks = splitStatute(fixture('constitution-arts18-20.txt'), CONST);
  const a19 = () => byKey(chunks, 'a19');

  it('finds Articles 18, 19 and 20 under Part III', () => {
    expect(chunks.map((c) => c.key)).toEqual(['a18', 'a19', 'a20']);
    expect(a19().kind).toBe('article');
    expect(a19().header).toBe(
      'Constitution of India › Part III: Fundamental rights › Art. 19 Protection of certain rights regarding freedom of speech, etc',
    );
  });

  it('treats the "Right to Freedom" heading as context, not as text of Art. 18', () => {
    expect(byKey(chunks, 'a18').text).not.toContain('Right to Freedom');
    expect(a19().text).not.toContain('Right to Freedom');
  });

  it('keeps Art. 19 together across a page break, with footnotes removed from the text', () => {
    const t = a19().text;
    expect(t).toContain('(a) to freedom of speech and expression;');
    expect(t).toContain('(ii) the carrying on by the State');
    expect(t).not.toMatch(/Ins\. by the Constitution/);
    expect(t).toContain('unions [or co-operative societies];'); // marker number dropped, brackets kept
    expect(t).toContain('* * * * *');
    expect(t).not.toContain('20. Protection in respect of conviction');
  });

  it('turns amendment footnotes into metadata on the Article that carries the marker', () => {
    const notes = a19().amendments;
    expect(notes.length).toBe(8); // 5 footnotes on page 1, 3 on page 2
    expect(notes[0]).toMatchObject({ marker: '1', amendingAct: 'Constitution (Ninety-seventh Amendment) Act, 2011', wef: '2012-02-08' });
    expect(notes.find((n) => n.note.startsWith('Sub-clause (f) omitted'))?.amendingAct).toBe(
      'Constitution (Forty-fourth Amendment) Act, 1978',
    );
    expect(a19().validFrom).toBe('2012-02-08');
    expect(byKey(chunks, 'a20').amendments).toEqual([]);
  });

  it('stays one chunk at the default size, and splits into clauses (1)–(6) when long', () => {
    expect(chunks.filter((c) => c.parentKey === 'a19')).toHaveLength(0);
    const split = splitStatute(fixture('constitution-arts18-20.txt'), { ...CONST, maxTokens: 200 });
    const kids = split.filter((c) => c.parentKey === 'a19');
    expect(kids.map((c) => c.subNumber)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(byKey(split, 'a19(1)').text).toContain('(g) to practise any profession');
    expect(byKey(split, 'a19(2)').text.startsWith('[(2) Nothing in sub-clause (a)')).toBe(true);
    expect(byKey(split, 'a19(6)').text).toContain('(i) the professional or technical qualifications');
    expect(byKey(split, 'a19(6)').header).toMatch(/› cl\. \(6\)$/);
  });
});

describe('splitStatute: attachment rules', () => {
  const text = [
    '5. Test rule.—(1) A person may do the act.',
    'Provided that he first gives notice.',
    '(2) The act may be done twice.',
    'Explanation.—In this sub-section, "twice" means on two days.',
    '(3) The act is lawful.',
    'Explanation.—For the purposes of this section, "act" includes an omission.',
  ].join('\n');

  it('keeps a proviso with its sub-section and a sub-section explanation with its own child only', () => {
    const chunks = splitStatute(text, { actName: 'Synthetic Act', actYear: 2026, kind: 'act', maxTokens: 10 });
    const one = byKey(chunks, 's5(1)'), two = byKey(chunks, 's5(2)'), three = byKey(chunks, 's5(3)');
    expect(one.text).toContain('Provided that he first gives notice.');
    expect(two.text).not.toContain('Provided that');
    expect(two.text).toContain('"twice" means on two days');
    expect(three.text).not.toContain('"twice" means');
    for (const c of [one, two, three]) expect(c.text).toContain('"act" includes an omission');
    expect(one.attachments.sort()).toEqual(['explanation', 'proviso']);
  });

  it('fails the source when a proviso or explanation comes before any section', () => {
    expect(() => splitStatute('Provided that nothing here applies.\n1. Title.—Text.', { actName: 'X', kind: 'act' })).toThrow(
      OrphanAttachmentError,
    );
    expect(() => splitStatute('Explanation.—Stray.\n1. Title.—Text.', { actName: 'X', kind: 'act' })).toThrow(/explanation appears before any section/);
  });

  it('marks an omitted section as repealed', () => {
    const [c] = splitStatute('31. [Compulsory acquisition of property.].—Omitted by the Constitution (Forty-fourth Amendment) Act, 1978, s. 6 (w.e.f. 20-6-1979).', CONST);
    expect(c?.lawStatus).toBe('repealed');
  });
});

describe('splitStatute: the official India Code PDF of the Indian Contract Act, 1872', () => {
  // Lines as extracted and cleaned by ingestion from indiacode.gov.in (bitstream a1872-9.pdf), page<TAB>text.
  const lines: Line[] = readFileSync(new URL('../test/fixtures/ica-1872-indiacode-lines.tsv', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => {
      const [p, ...t] = l.split('\t');
      return { pageNo: Number(p), text: t.join('\t') };
    });
  const chunks = splitStatute(lines, ICA);
  const units = chunks.filter((c) => c.parentKey === null);

  it('finds every section 1–266 once, plus 19A and 178A, skipping the arrangement of sections', () => {
    const numbers = units.map((u) => u.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (let n = 1; n <= 266; n++) expect(numbers).toContain(String(n));
    expect(numbers).toEqual(expect.arrayContaining(['19A', '178A']));
    expect(units).toHaveLength(268);
  });

  it('marks the sections repealed by the Sale of Goods Act and the Partnership Act', () => {
    for (const n of ['76', '79', '97', '123', '239', '266']) expect(byKey(chunks, `s${n}`).lawStatus).toBe('repealed');
    expect(byKey(chunks, 's79').chapter).toBe('Chapter VII: Sales of goods (repealed)');
    expect(byKey(chunks, 's124').chapter).toBe('Chapter VIII: Of indemnity and guarantee');
  });

  it('keeps s. 56 with its illustrations, with no footnote numbers or footnote text inside', () => {
    const s56 = byKey(chunks, 's56');
    expect(s56.text).toContain('becomes void when the act becomes impossible or unlawful.\n');
    expect(s56.text).toContain('non-performance');
    expect(s56.attachments).toEqual(['illustration']);
    for (const u of units) expect(u.text).not.toMatch(/^\d{1,2}\. (Subs|Ins)\. by/m);
  });

  it('turns s. 16’s footnote into an amendment note and joins a heading that wraps', () => {
    expect(byKey(chunks, 's16').amendments[0]).toMatchObject({ amendingAct: 'Act 6 of 1899', note: 'Subs. by Act 6 of 1899, s. 2, for the original s. 16.' });
    expect(byKey(chunks, 's25').title).toMatch(/^Agreement without consideration, void, .* barred by limitation law$/);
  });
});

describe('splitStatute: the official Constitution of India (Legislative Department, as on 10 September 2026)', () => {
  const lines: Line[] = readFileSync(new URL('../test/fixtures/constitution-2026-09-10-lines.tsv', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => {
      const [p, ...t] = l.split('\t');
      return { pageNo: Number(p), text: t.join('\t') };
    });
  const chunks = splitStatute(lines, CONST);
  const units = chunks.filter((c) => c.parentKey === null);

  it('finds Articles 1–395 (Art. 238 is printed only as an omitted Part) and stops before the Schedules', () => {
    const numbers = new Set(units.map((u) => parseInt(u.number, 10)));
    for (let n = 1; n <= 395; n++) if (n !== 238) expect(numbers.has(n), `Art. ${n}`).toBe(true);
    expect(units[0]?.number).toBe('1');
    expect(units.at(-1)?.number).toBe('395');
    expect(units.map((u) => u.number)).toEqual(expect.arrayContaining(['21A', '31A', '243ZT', '371J']));
  });

  it('labels Parts and Chapters, without markers or brackets', () => {
    expect(byKey(chunks, 'a1').chapter).toBe('Part I: The union and its territory');
    expect(byKey(chunks, 'a52').chapter).toBe('Part V: The union › Chapter I: The executive');
    expect(byKey(chunks, 'a243ZT').chapter).toBe('Part IXB: The co-operative societies');
    expect(byKey(chunks, 'a368').title).toBe('Power of Parliament to amend the Constitution and procedure therefor');
  });

  it('keeps Art. 19 current (97th Amendment) and free of running headers', () => {
    const a19 = byKey(chunks, 'a19');
    expect(a19.text).toContain('(c) to form associations or unions [or co-operative societies];');
    expect(a19.text).not.toContain('(Part III.');
    expect(a19.amendments.find((a) => a.amendingAct === 'Constitution (Ninety-seventh Amendment) Act, 2011')?.wef).toBe('2012-02-08');
    expect(byKey(chunks, 'a31').lawStatus).toBe('repealed');
  });
});

describe('splitStatute: whole India Code Acts (rules learned from the ADR and Property Law Acts)', () => {
  const split = (lines: [number, string][]) =>
    splitStatute(lines.map(([pageNo, text]) => ({ pageNo, text })), { actName: 'X', actYear: 1882, kind: 'act', wholeDocument: true });
  const top = (lines: [number, string][]) => split(lines).filter((c) => c.parentKey === null);

  it('skips a letter-spaced contents list and never starts an Act at a section other than 1', () => {
    const units = top([
      [1, 'A R R A N G E M E N T O F S E C T IO N S'],
      [1, '1. Short title .'],
      [1, '108. Rights and liabilities of lessor and lessee.'],
      [1, 'A.—Rights and liabilities of the lessor.'],
      [2, '1. Short title.—This Act may be called the X Act, 1882.'],
      [2, '2. Repeal of Acts.—Nothing herein contained shall be deemed to affect any rule.'],
    ]);
    expect(units.map((u) => u.number)).toEqual(['1', '2']);
    expect(
      top([
        [1, '108. Rights and liabilities of lessor and lessee.'],
        [1, 'A.—Rights and liabilities of the lessor.'],
      ]),
    ).toEqual([]);
  });

  it('keeps footnotes out of the law text: by marker on the page, by wording, and a commencement note', () => {
    const units = top([
      [1, '1. Short title, extent and commencement.—(1) This Act may be called the X Act.'],
      [1, '(3) It shall come into force on such date2 as the Central Government may appoint.'],
      [1, '1. The words “except the State of Jammu and Kashmir” Omitted by the Order, 2020.'],
      [1, '2. This Act shall come into force in—'],
      [1, '(i) Union territory of Andaman and Nicobar Islands on 19th November, 1986.'],
      [2, '2. Definitions.—In this Act, unless the context otherwise requires,—'],
      [2, '(a) “Court” means a Family Court;'],
      [2, '1. See s. 138, infra.'],
    ]);
    expect(units.map((u) => u.number)).toEqual(['1', '2']);
    expect(units[0]!.text).toContain('on such date as the Central Government');
    expect(units[0]!.text).not.toMatch(/Andaman|Jammu/);
    expect(units[1]!.text).not.toMatch(/infra/);
  });

  it('joins a heading that wraps onto a line starting with a year, but never a footnote', () => {
    const units = top([
      [1, '1. Short title.—This Act may be called the X Act.'],
      [1, '2. Definitions.—In this Part, unless the context otherwise requires,—'],
      [1, '3. Ins. by s. 2, ibid. (w.e. f. 23-10-2015).'],
      [2, '(7) An arbitral award made under this Part shall be considered as a domestic award.'],
      [2, '(8) Where this Part—'],
      [3, '3. Effect of arbitral and related court proceedings commenced prior to 23rd October,'],
      [3, '2015.—Unless the parties otherwise agree, the amendments shall not apply.'],
    ]);
    expect(units.map((u) => u.number)).toEqual(['1', '2', '3']);
    expect(units[1]!.text).toContain('(7) An arbitral award');
    expect(units[2]!.title).toBe('Effect of arbitral and related court proceedings commenced prior to 23rd October, 2015');
  });

  it('leaves out State amendments and stops at the Statement of Objects and Reasons', () => {
    const units = top([
      [1, '1. Short title.—This Act may be called the X Act.'],
      [1, '2. Jurisdiction.—The Courts shall try all suits of a civil nature.'],
      [1, 'STATE AMENDMENTS'],
      [1, 'Maharashtra.—'],
      [1, 'Section 2 of the Code, in its application to the State of Maharashtra, shall be deleted.'],
      [2, 'CHAPTER II'],
      [2, 'AMENDMENTS TO THE PROVISIONS OF THE CODE OF CIVIL PROCEDURE, 1908'],
      [2, '3. Rules.—The State Government may make rules.'],
      [3, 'STATEMENT OF OBJECTS AND REASONS'],
      [3, '2. The Bill inter alia, seeks to:—'],
    ]);
    expect(units.map((u) => u.number)).toEqual(['1', '2', '3']);
    expect(units[1]!.text).not.toMatch(/Maharashtra|deleted/);
    expect(units[2]!.chapter).toBe('Chapter II: Amendments to the provisions of the code of civil procedure, 1908');
    expect(units[2]!.text).not.toMatch(/Bill/);
  });

  it('reports section numbers missing between 1 and the last', () => {
    expect(missingSections([{ number: '1', parentKey: null }, { number: '2', parentKey: null }, { number: '4A', parentKey: null }])).toEqual([3]);
  });
});
