import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { courtNumbering, ruleRole, splitJudgment, type JudgmentInput } from './judgment.ts';
import { kanoonToJudgment, parseKanoonTitle } from './kanoon.ts';

const load = (name: string): JudgmentInput =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/judgments/${name}`, import.meta.url), 'utf8')) as JudgmentInput;

describe('Satyabrata Ghose v. Mugneeram Bangur (1953): single opinion, old report, no court numbering', () => {
  const r = splitJudgment(load('satyabrata-ghose-1953.json'));
  const paras = r.chunks.filter((c) => c.kind !== 'headnote');

  it('is one majority opinion, numbered by us, with report pages', () => {
    expect(r.opinions.map((o) => o.type)).toEqual(['majority']);
    expect(r.paraNoSource).toBe('nyaai');
    expect(paras.every((c) => c.opinion === 'majority' && c.paraNoSource === 'nyaai')).toBe(true);
    expect(paras.some((c) => c.pageNo === 318)).toBe(true);
  });

  it('keeps the reporter headnote apart, marked so it can never support "held"', () => {
    const hn = r.chunks.filter((c) => c.kind === 'headnote');
    expect(hn).toHaveLength(1);
    expect(hn[0]).toMatchObject({ role: 'headnote', opinion: null });
    expect(hn[0]!.header).toMatch(/Headnote \(reporter's summary\)$/);
  });

  it('rejoins a paragraph that the printed report broke across a page', () => {
    const joined = paras.find((c) =>
      c.text.includes('It must be borne in mind, however, that section 56 lays down a rule of positive law'),
    );
    expect(joined).toBeTruthy();
    expect(joined!.text.indexOf('in its practical and not literal sense')).toBeGreaterThan(0);
    expect(paras.some((c) => /^[a-z]/.test(c.text))).toBe(false);
  });

  it('drops the caption and appearances, and starts with the judgment itself', () => {
    expect(paras[0]!.text).toMatch(/^The facts giving rise to this appeal/);
    expect(paras.some((c) => /CIVIL APPELLATE JURISDICTION|for the appellant\./.test(c.text))).toBe(false);
  });

  it('labels "We hold" as holding, and a paragraph that answers counsel and then decides as holding too', () => {
    const held = paras.find((c) => c.text.startsWith('We hold, therefore, that the doctrine of frustration'));
    expect(held?.role).toBe('holding');
    // Opens with Mr. Gupta's argument, ends "In our opinion … not been frustrated at all. The result is that the appeal is allowed".
    expect(paras.find((c) => /^Mr\. Gupta, who appeared for the respondent/.test(c.text))?.role).toBe('holding');
    expect(paras.find((c) => /^The facts giving rise to this appeal/.test(c.text))?.role).not.toBe('holding');
  });
});

describe('Kharak Singh v. State of U.P. (1962): majority, dissent and the Court’s order', () => {
  const r = splitJudgment(load('kharak-singh-1962.json'));

  it('finds the majority from "the judgment of … was delivered by", the dissent, and the order', () => {
    expect(r.opinions.map((o) => o.type)).toEqual(['majority', 'dissent', 'majority']);
    expect(r.opinions[0]!.judge).toMatch(/AYYANGAR/i);
    expect(r.opinions[1]!.judge).toBe('Subba Rao');
  });

  it('labels dissent paragraphs and keeps quotations inside their paragraph', () => {
    const dissent = r.chunks.filter((c) => c.opinion === 'dissent');
    expect(dissent[0]!.text).toMatch(/^We have had the advantage/);
    expect(dissent[0]!.header).toMatch(/› dissent \(Subba Rao\) › para \d+ \(p\. 351\)$/);
    expect(dissent.length).toBeGreaterThan(5);
    const order = r.chunks.at(-1)!;
    expect(order).toMatchObject({ opinion: 'majority', role: 'holding' });
    expect(order.text).toMatch(/In accordance with the opinion of the majority/);
  });
});

describe('Energy Watchdog v. CERC (2017): court numbering', () => {
  const r = splitJudgment(load('energy-watchdog-2017.json'));

  it('uses the court’s numbers 1–55 and folds quoted extracts into their paragraph (cut only past 8,000 characters)', () => {
    expect(r.paraNoSource).toBe('court');
    const court = r.chunks.filter((c) => c.paraNoSource === 'court');
    expect(court.map((c) => c.paraNo)).toEqual(Array.from({ length: 55 }, (_, i) => String(i + 1)));
    // Paras 17 and 46 quote long guidelines: their later part is its own chunk, labelled as a continuation.
    expect(r.chunks.filter((c) => c.paraNoSource !== 'court').map((c) => c.paraNo)).toEqual([
      '17 (cont.)',
      '46 (cont.)',
    ]);
    expect(r.chunks.every((c) => c.kind === 'paragraph' && c.text.length < 20_000)).toBe(true);
  });

  it('leaves out the judges’ signature lines', () => {
    expect(r.chunks.at(-1)!.text).toBe('55. All the appeals are disposed of accordingly.');
    expect(r.chunks.at(-1)!.role).toBe('holding');
  });
});

describe('rules', () => {
  it('does not call a narrative "accordingly" a holding', () => {
    expect(
      ruleRole('Accordingly, it provided for licensees who could supply electricity in a specified area.'),
    ).toBeNull();
    expect(ruleRole('The appeal is accordingly dismissed with costs.')).toBe('holding');
    expect(ruleRole('Learned counsel for the appellant submitted that the contract stood frustrated.')).toBe(
      'arguments',
    );
    expect(
      ruleRole(
        'Mr. X contended that the rise in price frustrated the contract. We are of the view that neither clause applies.',
      ),
    ).toBe('holding');
    expect(
      ruleRole(
        'That is the law both in India and in England, and there is, in our opinion, no general rule as contended by Mr. Chatterjee.',
      ),
    ).toBe('holding');
    expect(ruleRole('The High Court held that the contract was not frustrated.')).toBe('lower_court_summary');
  });

  it('needs numbers rising one by one through most of the text to trust court numbering', () => {
    const b = (text: string) => ({ text, page: null, quoted: false });
    expect(courtNumbering([b('1. A'), b('2. B'), b('3. C'), b('4. D')])).toBe(true);
    expect(courtNumbering([b('Intro'), b('1. A'), b('7. B')])).toBe(false);
  });
});

describe('Kanoon adapter', () => {
  it('parses the title into a case name and date', () => {
    expect(parseKanoonTitle('Satyabrata Ghose vs Mugneeram Bangur & Co., And Another on 16 November, 1953')).toEqual({
      caseName: 'Satyabrata Ghose v. Mugneeram Bangur & Co.',
      decidedOn: '1953-11-16',
    });
  });

  it('reads metadata, headnote, paragraphs and page markers from Kanoon’s markup', () => {
    const doc = {
      tid: 1,
      title: 'A vs B on 2 January, 1960',
      docsource: 'Supreme Court of India',
      doc: [
        '<h2 class="doc_title">A vs B on 2 January, 1960</h2>',
        '<h3 class="doc_citations">Equivalent citations: 1960 AIR 1, 1960 SCR 5</h3>',
        '<h3 class="doc_author">Author: <a href="#">X. Judge</a></h3>',
        '<h3 class="doc_bench">Bench: <a>X. Judge</a>, <a>Y. Judge</a>, <a>Z. Judge</a></h3>',
        '<pre id="pre_1">ACT:\n Contract Act, s. 56.\nHEADNOTE:\nThe doctrine applies.\n\nJUDGMENT:</pre>',
        '<p data-structure="Facts" id="p_1">The facts &amp; the law.</p>',
        '<p id="p_2">Second <span class="hidden_text" id="span_1">7</span> paragraph.</p>',
        '<blockquote>"A quoted line."</blockquote>',
        '<p id="p_3">Third paragraph.</p>',
      ].join('\n'),
    };
    const j = kanoonToJudgment(doc);
    expect(j).toMatchObject({
      caseName: 'A v. B',
      decidedOn: '1960-01-02',
      court: 'Supreme Court of India',
      author: 'X. Judge',
    });
    expect(j.bench).toHaveLength(3);
    expect(j.citations).toEqual(['1960 AIR 1', '1960 SCR 5']);
    expect(j.headnote).toBe('ACT: Contract Act, s. 56.\nThe doctrine applies.');
    expect(j.blocks).toEqual([
      { text: 'The facts & the law.', page: null, quoted: false },
      { text: 'Second paragraph.', page: null, quoted: false },
      { text: '"A quoted line."', page: 7, quoted: true },
      { text: 'Third paragraph.', page: 7, quoted: false },
    ]);
  });
});

describe('court list', () => {
  it('recognises the Supreme Court and High Courts, and rejects unknown names', async () => {
    const { identifyCourt } = await import('./courts.ts');
    expect(identifyCourt('Supreme Court of India')).toEqual({
      court: 'Supreme Court of India',
      level: 'supreme_court',
    });
    expect(identifyCourt('Patna High Court')).toEqual({ court: 'Patna High Court', level: 'high_court' });
    expect(identifyCourt('Madras High Court - Madurai Bench')?.level).toBe('high_court');
    expect(identifyCourt('Court of Nowhere')).toBeNull();
  });
});

describe('PASL Wind Solutions (2021): quoted statute sections carry their own numbers', () => {
  const block = (text: string) => ({ text, page: null, quoted: false });
  const input: JudgmentInput = {
    caseName: 'PASL Wind Solutions Private Limited v. GE Power Conversion India Private Limited',
    decidedOn: '2021-04-20',
    court: 'Supreme Court of India',
    citations: [],
    author: 'R.F. Nariman',
    bench: ['R.F. Nariman', 'B.R. Gavai'],
    headnote: null,
    blocks: [
      block('1. Leave granted.'),
      block(
        '2. The present appeal raises an interesting question as to whether two companies incorporated in India can choose a foreign forum.',
      ),
      block('3. The Foreign Awards Act, 1961 provided as follows:'),
      block('4. Effect of foreign awards.—A foreign award shall be treated as binding for all purposes.'),
      block('5. Filing of foreign awards in court.—Any person interested in a foreign award may apply to any court.'),
      block(
        '6. Enforcement of foreign awards.—Where the court is satisfied that the foreign award is enforceable, it shall order.',
      ),
      block('4. The award was made in Zurich. The respondent resisted enforcement in the High Court.'),
      block('5. The learned Single Judge held that the award was enforceable.'),
      block('6. Shri Rao argued that two Indian parties cannot derogate from Indian law.'),
      block('7. We hold that nothing stands in the way of two Indian parties choosing a foreign seat.'),
    ],
  };
  it('keeps the quoted provisions inside para 3 and follows the court’s own numbers', () => {
    const r = splitJudgment(input);
    const paras = r.chunks.filter((c) => c.kind !== 'headnote');
    expect(r.paraNoSource).toBe('court');
    expect(paras.map((c) => c.paraNo)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(paras[2]!.text).toContain('Enforcement of foreign awards.—');
    expect(paras[3]!.text).toMatch(/^4\. The award was made in Zurich/);
  });
});

describe('court numbering that skips a number or restarts for the next opinion', () => {
  const block = (text: string) => ({ text, page: null, quoted: false });
  const base = {
    caseName: 'A v. B',
    decidedOn: '2012-09-06',
    court: 'Supreme Court of India',
    citations: [],
    author: null,
    bench: ['X', 'Y'],
    headnote: null,
  };
  const paras = (texts: string[]) =>
    splitJudgment({ ...base, blocks: texts.map(block) })
      .chunks.filter((c) => c.kind !== 'headnote')
      .map((c) => c.paraNo);
  const run = (from: number, to: number) =>
    Array.from(
      { length: to - from + 1 },
      (_, i) => `${from + i}. Paragraph ${from + i} of the judgment, stated in full.`,
    );

  it('follows a skipped number when the next one confirms it (BALCO: 187 → 189)', () => {
    expect(paras([...run(1, 6), '8. The judgment continues after a skipped number.', ...run(9, 10)])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '8',
      '9',
      '10',
    ]);
  });
  it('does not follow a quoted list of numbers', () => {
    expect(paras([...run(1, 6), '9. A quoted extract numbered nine.', 'and its text', ...run(7, 8)])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });
  it('starts again at 1 for a second opinion (S.B.P. & Co., 2005)', () => {
    expect(paras([...run(1, 7), ...run(1, 3)])).toEqual(['1', '2', '3', '4', '5', '6', '7', '1', '2', '3']);
  });
});

describe('kanoonToJudgment: a judgment delivered as one preformatted block', () => {
  it('reads the paragraphs from the <pre> text', () => {
    const para = (n: number) =>
      `      ${n}.    Paragraph ${n} of the judgment discusses the arbitration agreement\n      between the parties at some length, and it continues on this line.`;
    const pre = [
      '                        IN THE SUPREME COURT OF INDIA',
      '                              J U D G M E N  T',
      ...Array.from({ length: 40 }, (_, i) => para(i + 1)),
      '      12',
    ].join('\n\n');
    const r = kanoonToJudgment({
      tid: 92712826,
      title: 'Chloro Controls(I) P.Ltd vs Severn Trent Water Purification Inc ... on 28 September, 2012',
      doc: `<h2 class="doc_title">x</h2><pre id="pre_1">${pre}</pre><p id="p_1">Upon pronouncement of the judgment counsel mentioned a matter.</p>`,
      docsource: 'Supreme Court of India',
    });
    expect(r.blocks.filter((b) => /^\d+\. Paragraph/.test(b.text))).toHaveLength(40);
    expect(r.blocks.some((b) => b.text === '12')).toBe(false);
    expect(r.blocks.at(-1)!.text).toMatch(/^Upon pronouncement/);
  });
});

describe('sub-paragraph numbering (e-SCR, PASL Wind 2021)', () => {
  const b = (text: string, quoted = false) => ({ text, page: 1, quoted });
  const input = (blocks: ReturnType<typeof b>[]) => ({
    caseName: 'PASL v. GE',
    decidedOn: '2021-04-20',
    court: 'Supreme Court of India',
    citations: [],
    author: null,
    bench: [],
    headnote: null,
    blocks,
  });

  it('numbers "3.1.", "3.2." as the court’s, and a quoted clause "6.1" inside them as part of the paragraph', () => {
    const split = splitJudgment(
      input([
        b('1. Leave granted.'),
        b('2. The present appeal raises an interesting question.'),
        b('3.1. The appellant is a company incorporated in India.'),
        b('6.1 Any dispute shall be resolved by the Parties in an amicable way.', true),
        b('3.2. In 2010, the appellant issued three purchase orders.'),
        b('4. Having heard learned counsel, we now set out the law.'),
        b('5. The award is a foreign award.'),
        b('6. The appeal is dismissed.'),
      ]),
    );
    expect(split.paraNoSource).toBe('court');
    expect(split.chunks.map((c) => c.paraNo)).toEqual(['1', '2', '3.1', '3.2', '4', '5', '6']);
    expect(split.chunks.find((c) => c.paraNo === '3.1')!.text).toContain('6.1 Any dispute');
  });

  it('reads "NAME, CJI" as the start of an opinion', () => {
    const split = splitJudgment(
      input([
        b('DR. DHANANJAYA Y CHANDRACHUD, CJI'),
        b('1. The reference is answered.'),
        b('2. Ordered accordingly.'),
        b('3. No costs.'),
        b('4. Disposed of.'),
      ]),
    );
    expect(split.opinions[0]!.judge).toBe('DR. DHANANJAYA Y CHANDRACHUD');
  });
});
