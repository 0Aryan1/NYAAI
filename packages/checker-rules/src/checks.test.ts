/**
 * C1–C8, risk and the decision table, including planted errors (LLD §16.2): each wrong claim below must be
 * flagged by code before any AI check runs.
 */
import { describe, expect, it } from 'vitest';
import { codeChecks, decide, looksLegal, riskOf, spanContext, type CheckSource, type ClaimInput, type MappingRow } from './checks.ts';
import { coverageScore, matchCoverage, openGroups } from './coverage.ts';

const s56: CheckSource = {
  tag: 'S1',
  sourceId: 'src-ica',
  sourceType: 'act',
  title: 'The Indian Contract Act, 1872',
  header: 'Indian Contract Act, 1872 › Chapter IV › s. 56 Agreement to do impossible act',
  text:
    '56. Agreement to do impossible act.—An agreement to do an act impossible in itself is void.\n' +
    'Contract to do an act afterwards becoming impossible or unlawful.—A contract to do an act which, after the contract is made, ' +
    'becomes impossible, or, by reason of some event which the promisor could not prevent, unlawful, becomes void when the act becomes impossible or unlawful.',
  pieces: [{ chunkId: 'ch-56', text: '', paraNo: null, opinion: null, paraRole: null, kind: 'section' }],
  court: null,
  decidedOn: null,
  section: '56',
  article: null,
  caseStatus: null,
  rolesSampled: false,
  holdingNote: null,
};
s56.pieces[0]!.text = s56.text;

const paras = [
  { chunkId: 'p11', paraNo: '11', opinion: 'majority', paraRole: 'arguments', kind: 'paragraph', text: 'It was contended by counsel that the requisition order put an end to the contract altogether.' },
  { chunkId: 'p12', paraNo: '12', opinion: 'majority', paraRole: 'discussion', kind: 'paragraph', text: 'The word "impossible" has not been used here in the sense of physical or literal impossibility.' },
  { chunkId: 'p13', paraNo: '13', opinion: 'majority', paraRole: 'holding', kind: 'paragraph', text: 'We hold that the contract was not frustrated by the requisition of the land.' },
];
const ghose: CheckSource = {
  tag: 'S2',
  sourceId: 'src-ghose',
  sourceType: 'judgment',
  title: 'Satyabrata Ghose v. Mugneeram Bangur & Co.',
  header: 'Satyabrata Ghose v. Mugneeram Bangur & Co. (1953) › para 12',
  text: paras.map((p) => `[para ${p.paraNo}] ${p.text}`).join('\n\n'),
  pieces: paras,
  court: 'Supreme Court of India',
  decidedOn: '1953-11-16',
  section: null,
  article: null,
  caseStatus: 'not_verified',
  rolesSampled: true,
  holdingNote: null,
};
const sources = new Map([
  ['S1', s56],
  ['S2', ghose],
]);
const claim = (c: Partial<ClaimInput>): ClaimInput => ({ text: 'x', type: 'rule', tag: 'S1', span: 'An agreement to do an act impossible in itself is void.', ...c });
const fails = (c: ClaimInput, m: MappingRow[] = []) => codeChecks(c, sources, m).results.filter((r) => r.result === 'fail').map((r) => `${r.name}: ${r.detail}`);

describe('supported claims pass every code check', () => {
  it('a rule with an exact span (curly quotes and dashes aside)', () => {
    const out = codeChecks(claim({ text: 'Under s. 56, an agreement to do an impossible act is void.' }), sources);
    expect(out.results.filter((r) => r.result === 'fail')).toEqual([]);
    expect(out.chunkId).toBe('ch-56');
    expect(decide(out.results)).toEqual({ status: 'supported', flag: null, reason: null });
  });

  it('a holding from a majority holding paragraph: supported, but grey while the case status is unconfirmed', () => {
    const out = codeChecks(claim({ tag: 'S2', type: 'holding', text: 'In Satyabrata Ghose v. Mugneeram Bangur (1953), the Supreme Court held the contract was not frustrated.', span: 'We hold that the contract was not frustrated by the requisition of the land.' }), sources);
    expect(out.results.filter((r) => r.result === 'fail')).toEqual([]);
    expect(out.chunkId).toBe('p13');
    expect(out.risk).toBe('high');
    expect(decide(out.results)).toEqual({ status: 'supported', flag: 'grey', reason: 'Status not verified' });
  });
});

describe('planted errors are flagged by code', () => {
  it('C1: a tag that was not supplied', () => {
    expect(fails(claim({ tag: 'S7' }))).toEqual(['C1: Source not supplied']);
  });
  it('C2: words not in the source, or an ellipsis', () => {
    expect(fails(claim({ span: 'An agreement to do an act impossible in itself is voidable.' }))).toEqual(['C2: These words are not in the source']);
    expect(fails(claim({ span: 'An agreement to do … is void.' }))).toEqual(['C2: These words are not in the source']);
  });
  it('C3: wrong year, wrong section, wrong case, wrong court', () => {
    expect(fails(claim({ tag: 'S2', type: 'holding', text: 'In 1954 the Supreme Court held the contract was not frustrated.', span: 'We hold that the contract was not frustrated by the requisition of the land.' }))).toEqual([
      'C3: Year differs: source says 1953',
    ]);
    expect(fails(claim({ text: 'Under s. 65, an agreement to do an impossible act is void.' }))).toEqual(['C3: Section differs: source is s. 56']);
    expect(fails(claim({ tag: 'S2', type: 'holding', text: 'In Taylor v. Caldwell the court held the contract was not frustrated.', span: 'We hold that the contract was not frustrated by the requisition of the land.' }))[0]).toMatch(/^C3: Case name differs/);
    expect(fails(claim({ tag: 'S2', type: 'holding', text: 'The Calcutta High Court held the contract was not frustrated.', span: 'We hold that the contract was not frustrated by the requisition of the land.' }))).toEqual([
      'C3: Court differs: source is Supreme Court of India',
    ]);
  });
  it('C4: a quotation that is not word for word', () => {
    expect(fails(claim({ tag: 'S2', type: 'quote', text: 'The Court said "impossible" is not used "in the sense of physical impossibility".', span: 'The word "impossible" has not been used here in the sense of physical or literal impossibility.' }))).toEqual([
      'C4: Quote differs from the source',
    ]);
  });
  it('C5: an old/new criminal law link with no signed mapping, or called equivalent when it changed', () => {
    const c = claim({ type: 'mapping', text: 'Section 420 IPC is equivalent to section 318 BNS.' });
    expect(codeChecks(c, sources, []).results.find((r) => r.name === 'C5')).toMatchObject({ result: 'fail', detail: 'Mapping not confirmed' });
    const changed: MappingRow = { oldAct: 'IPC', newAct: 'BNS', relation: 'substantively_changed', oldSections: ['420'], newSections: ['318'], signed: true };
    expect(codeChecks(c, sources, [changed]).results.find((r) => r.name === 'C5')).toMatchObject({ result: 'fail', detail: 'Not an equivalent: substantively changed' });
  });
  it('C6: news cannot support law', () => {
    const news = new Map([['S1', { ...s56, sourceType: 'news' }]]);
    expect(codeChecks(claim({}), news).results.find((r) => r.name === 'C6')).toMatchObject({ result: 'fail', detail: 'News cannot support a statement of law' });
  });
  it("C7: 'held' resting on counsel's argument, a statute, a dissent, or unsampled labels", () => {
    const argued = claim({ tag: 'S2', type: 'holding', text: 'The Court held that the requisition ended the contract.', span: 'It was contended by counsel that the requisition order put an end to the contract altogether.' });
    expect(fails(argued)).toEqual(["C7: Not the court's majority reasoning"]);
    expect(fails(claim({ text: 'The court held an agreement to do an impossible act is void.' }))).toEqual(["C7: Not the court's majority reasoning"]);
    const dissent = new Map([['S2', { ...ghose, pieces: ghose.pieces.map((p) => ({ ...p, opinion: 'dissent' })) }]]);
    const held = claim({ tag: 'S2', type: 'holding', text: 'The Court held the contract was not frustrated.', span: 'We hold that the contract was not frustrated by the requisition of the land.' });
    expect(codeChecks(held, dissent).results.find((r) => r.name === 'C7')?.detail).toBe('This is a dissent, not what the court held');
    const unsampled = new Map([['S2', { ...ghose, rolesSampled: false }]]);
    expect(codeChecks(held, unsampled).results.find((r) => r.name === 'C7')?.detail).toBe('Labels not yet checked by an expert');
  });
  it('C8: an overruled case is yellow unless the line says so', () => {
    const over = new Map([['S2', { ...ghose, caseStatus: 'overruled' }]]);
    const c = claim({ tag: 'S2', type: 'fact', text: 'The land was requisitioned.', span: 'We hold that the contract was not frustrated by the requisition of the land.' });
    expect(decide(codeChecks(c, over).results)).toMatchObject({ status: 'open', flag: 'yellow', reason: 'This case was overruled' });
    expect(decide(codeChecks({ ...c, text: 'This case was later overruled.' }, over).results).flag).toBeNull();
  });
});

describe('risk level (LLD §8.2)', () => {
  it('is high for risky types or numbers, dates and punishments in the text, whatever the writer said', () => {
    expect(riskOf({ type: 'rule', text: 'A notice must be given within 30 days.' })).toBe('high');
    expect(riskOf({ type: 'rule', text: 'The offence is punishable with imprisonment.' })).toBe('high');
    expect(riskOf({ type: 'fact', text: 'The Act came into force in 1872.' })).toBe('high');
    expect(riskOf({ type: 'holding', text: 'The contract was frustrated.' })).toBe('high');
    expect(riskOf({ type: 'rule', text: 'An agreement to do an impossible act is void.' })).toBe('normal');
  });
});

describe('lines without claims', () => {
  it('flags a teaching line that states law', () => {
    expect(looksLegal('Section 56 makes such agreements void.')).toBe(true);
    expect(looksLegal('The Supreme Court held that the contract was frustrated.')).toBe(true);
    expect(looksLegal('Such an agreement is void.')).toBe(true);
    expect(looksLegal('Think about what happens when performance becomes impossible.')).toBe(false);
    expect(looksLegal('Why might the law excuse a promisor?')).toBe(false);
  });

  it('does not flag a section or case named in passing (false flags from the first real lecture)', () => {
    expect(looksLegal('Next: what does s. 56 say, and how far does it reach?')).toBe(false);
    expect(looksLegal('Today: what s. 56 says, and how it relates to the English doctrine of frustration.')).toBe(false);
    expect(looksLegal('We now turn to Satyabrata Ghose v. Mugneeram Bangur.')).toBe(false);
    expect(looksLegal('Under the Indian Contract Act, 1872, we start with the text.')).toBe(false);
    expect(looksLegal('Did the court hold the contract frustrated?')).toBe(false);
    expect(looksLegal('Did the court decide it? The Court held it was not.')).toBe(true);
    expect(looksLegal('Section 65 requires the party to restore the benefit.')).toBe(true);
    expect(looksLegal('Notice must be given within 30 days.')).toBe(true);
  });
});

describe('span context for C9', () => {
  it('gives the sentences either side', () => {
    const ctx = spanContext('The word "impossible" has not been used', ghose.text);
    expect(ctx.after).toContain('We hold that');
  });
});

describe('coverage matching', () => {
  const items = [
    { key: 'a', sectionKey: 'ICA:s56', kind: 'clause' as const, label: 's. 56: Contract …', text: s56.text.split('\n')[1]!, ref: 'ch-56' },
    { key: 'b', sectionKey: 'ICA:s56', kind: 'clause' as const, label: 's. 56: Compensation …', text: 'Where one person has promised to do something which he knew…', ref: 'ch-56' },
    { key: 'c', sectionKey: 'concept', kind: 'leading_case' as const, label: 'Satyabrata Ghose', text: null, ref: 'src-ghose' },
  ];
  it('covers an item when a span lies inside it, and a leading case when it is cited', () => {
    const m = matchCoverage(items, [
      { citationId: 'c1', sourceId: 'src-ica', chunkId: 'ch-56', span: 'becomes void when the act becomes impossible or unlawful.' },
      { citationId: 'c2', sourceId: 'src-ghose', chunkId: 'p13', span: 'We hold that the contract was not frustrated' },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: 'c1', b: null, c: 'c2' });
  });
  it('scores and groups', () => {
    expect(coverageScore(['covered', 'missing', 'left_out_by_teacher'])).toBe(0.5);
    expect(coverageScore([])).toBeNull();
    expect(openGroups([{ sectionKey: 'x', state: 'missing' }, { sectionKey: 'x', state: 'missing' }, { sectionKey: 'y', state: 'covered' }])).toBe(1);
  });
});
