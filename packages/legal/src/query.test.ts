import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, understandQuery } from './query.ts';

describe('understandQuery (LLD §7.2)', () => {
  it('finds sections with their act, in the usual ways teachers write them', () => {
    expect(understandQuery('Explain s. 56 ICA').refs).toEqual([
      { kind: 'section', number: '56', act: 'Indian Contract Act' },
    ]);
    expect(understandQuery('section 56 of the Contract Act and frustration').refs[0]).toMatchObject({
      number: '56',
      act: 'Indian Contract Act',
    });
    expect(understandQuery('Sec. 65 when agreement is void').refs).toEqual([
      { kind: 'section', number: '65', act: null },
    ]);
  });

  it('finds Articles of the Constitution', () => {
    expect(understandQuery('Art. 19(1)(g) and reasonable restrictions').refs).toEqual([
      { kind: 'article', number: '19', act: 'Constitution of India' },
    ]);
    expect(understandQuery('Article 21A right to education').refs[0]).toMatchObject({ number: '21A' });
  });

  it('finds case names', () => {
    expect(understandQuery('What did Satyabrata Ghose v. Mugneeram Bangur hold?').caseNames).toEqual([
      'Satyabrata Ghose v. Mugneeram Bangur',
    ]);
    expect(understandQuery('Energy Watchdog vs CERC on force majeure').caseNames).toEqual(['Energy Watchdog v. CERC']);
  });

  it('does not invent references from ordinary words', () => {
    expect(understandQuery('when does a contract become impossible to perform?')).toEqual({
      refs: [],
      acts: [],
      caseNames: [],
    });
  });
});

describe('reciprocal rank fusion', () => {
  it('rewards documents found by both lists and keeps pinned references first', () => {
    const fused = reciprocalRankFusion(
      [
        ['a', 'b', 'c'],
        ['c', 'a', 'd'],
      ],
      ['z'],
    );
    expect(fused.map((f) => f.id)).toEqual(['z', 'a', 'c', 'b', 'd']);
    expect(fused[1]!.score).toBeCloseTo(1 / 61 + 1 / 62);
  });
});
