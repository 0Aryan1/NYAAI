import { describe, expect, it } from 'vitest';
import { standing, standingOf, type SourceFacts } from './standing.ts';

const judgment = (over: Partial<SourceFacts> = {}): SourceFacts => ({
  sourceType: 'judgment', courtLevel: 'supreme_court', benchSize: 2, origin: 'indian_kanoon', provisional: false, caseStatus: 'not_verified', paraRole: 'discussion', kind: 'para', ...over,
});

describe('source standing: relevance first, then authority', () => {
  it('a Supreme Court constitution bench outranks a High Court of slightly better relevance', () => {
    const sc = standing(judgment({ benchSize: 5, origin: 'court_site' }), 0.72);
    const hc = standing(judgment({ courtLevel: 'high_court', benchSize: 1 }), 0.76);
    expect(sc.score).toBeGreaterThan(hc.score);
  });

  it('authority never rescues an off-topic source: a much more relevant one still wins', () => {
    const strongButOffTopic = standing(judgment({ benchSize: 5, origin: 'court_site', caseStatus: 'good_law', paraRole: 'holding' }), 0.52);
    const onTopic = standing(judgment({ courtLevel: 'high_court', benchSize: 1 }), 0.8);
    expect(onTopic.score).toBeGreaterThan(strongButOffTopic.score);
  });

  it("the court's own reasoning beats a lawyer's argument from the same judgment", () => {
    expect(standing(judgment({ paraRole: 'discussion' }), 0.7).score).toBeGreaterThan(standing(judgment({ paraRole: 'arguments' }), 0.72).score);
  });

  it('a doubted or overruled case drops; a confirmed one rises a little', () => {
    const base = standing(judgment(), 0.7).score;
    expect(standing(judgment({ caseStatus: 'good_law' }), 0.7).score).toBeGreaterThan(base);
    expect(standing(judgment({ caseStatus: 'doubted' }), 0.7).score).toBeLessThan(base);
    expect(standing(judgment({ caseStatus: 'overruled' }), 0.7).score).toBeLessThan(standing(judgment({ caseStatus: 'doubted' }), 0.7).score);
  });

  it('gives plain reasons for the teacher, without the case status (the Studio shows that live)', () => {
    expect(standingOf(judgment({ benchSize: 3, origin: 'court_site', caseStatus: 'good_law' })).reasons).toEqual(['Supreme Court', '3-judge bench', "the court's own reasoning", 'official copy']);
    expect(standingOf({ sourceType: 'act', courtLevel: null, benchSize: null, origin: 'india_code', provisional: false, caseStatus: null, paraRole: null, kind: 'section' }).reasons).toEqual(['the Act itself', 'official copy (India Code)']);
    expect(standingOf(judgment({ kind: 'headnote', provisional: true })).reasons).toEqual(['Supreme Court', '2-judge bench', "a headnote (the reporter's summary)", 'Indian Kanoon copy', 'copy not yet approved by the library team']);
  });

  it('without a reranker score it ranks on authority around the middle', () => {
    const s = standing(judgment(), null);
    expect(s.relevance).toBeNull();
    expect(s.score).toBeCloseTo(0.5 + 0.05 + 0.02, 5);
  });
});
