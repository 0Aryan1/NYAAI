import { describe, expect, it } from 'vitest';
import type { RetrievedSource } from '../src/services/search/index.ts';
import { MAX_EVIDENCE, inYears, pickEvidence, statusLabel } from '../src/services/research/index.ts';

let n = 0;
const src = (
  over: Partial<RetrievedSource['meta']> & { id?: string } = {},
  status: RetrievedSource['status'] = {},
): RetrievedSource => {
  const id = over.id ?? `c${++n}`;
  return {
    tag: 'S1',
    chunkId: id,
    sourceId: `src-${id}`,
    header: `Header ${id}`,
    text: `Text ${id}`,
    coveredChunkIds: [id],
    meta: { rolesSampled: false, sourceType: 'judgment', origin: 'court_site', ...over },
    status,
    provisional: false,
    rerankScore: 0.8,
    standing: { score: 0.8, relevance: 0.8, reasons: [] },
  };
};

describe('the evidence table of a quick run', () => {
  it("takes each sub-question's best row first, then the next best, without duplicates, up to eight", () => {
    const shared = src({ id: 'shared' });
    const a = [src(), shared, src(), src()];
    const b = [shared, src(), src()];
    const c = [src(), src(), src(), src(), src()];
    const picked = pickEvidence([a, b, c], {});
    expect(picked).toHaveLength(MAX_EVIDENCE);
    expect(picked.slice(0, 3).map((p) => p.subQuestion)).toEqual([1, 2, 3]); // the best of each first
    expect(picked.filter((p) => p.source.chunkId === 'shared')).toHaveLength(1);
    expect(picked.map((p) => p.source.tag)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
  });

  it('judgments outside the years she chose are left out; Acts always count', () => {
    const old = src({ decidedOn: '1990-01-01' });
    const recent = src({ decidedOn: '2021-05-01' });
    const act = src({ sourceType: 'act' });
    expect([old, recent, act].filter((s) => inYears(s, { fromYear: 2015 }))).toEqual([recent, act]);
    expect(pickEvidence([[old, recent, act]], { fromYear: 2015, toYear: 2020 }).map((p) => p.source.chunkId)).toEqual([
      act.chunkId,
    ]);
  });

  it('the status column says no more than an expert confirmed', () => {
    expect(statusLabel(src({}, { case: 'not_verified' }))).toBe('Status not verified');
    expect(statusLabel(src({}, { case: 'overruled' }))).toBe('Overruled (confirmed)');
    expect(statusLabel(src({ sourceType: 'act' }, { law: 'repealed' }))).toBe('Repealed');
    expect(statusLabel(src({ sourceType: 'act' }))).toBe('In force');
  });
});
