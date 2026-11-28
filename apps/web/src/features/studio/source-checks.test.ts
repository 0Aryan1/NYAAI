import { describe, expect, it } from 'vitest';
import type { CitationSource } from '@nyaai/shared';
import { shownChecks } from './source-checks';

type Check = CitationSource['checks'][number];
const checks = [
  { name: 'C2', result: 'pass', detail: null },
  { name: 'C5', result: 'skipped', detail: null },
  { name: 'C8', result: 'flag', detail: 'Status not verified' },
] as unknown as Check[];

describe('source drawer checks', () => {
  it('hides skipped checks and keeps the built status while no expert has looked', () => {
    expect(shownChecks(checks, 'not_verified').map((c) => [c.name, c.result])).toEqual([
      ['C2', 'pass'],
      ['C8', 'flag'],
    ]);
  });

  it("reads the case status live: an expert's finding replaces the one the line was built with", () => {
    expect(shownChecks(checks, 'good_law')[1]).toMatchObject({ result: 'pass', detail: 'Still good law' });
    expect(shownChecks(checks, 'overruled')[1]).toMatchObject({ result: 'fail', detail: 'Overruled' });
  });
});
