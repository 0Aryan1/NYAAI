import { describe, expect, it } from 'vitest';
import { topicsFrom } from './plan';
import { todayIst } from '@/shared/lib/format';

describe('a pasted syllabus', () => {
  it('becomes one lecture per line, without numbers or bullets', () => {
    expect(
      topicsFrom(
        '1. Arbitration agreement\n2) Composition of the tribunal\n\n- Interim measures\nUnit 4: Setting aside an award\nL05 Enforcement\n• x',
      ),
    ).toEqual([
      'Arbitration agreement',
      'Composition of the tribunal',
      'Interim measures',
      'Setting aside an award',
      'Enforcement',
    ]);
  });
});

describe('taught dates', () => {
  it('uses the date in India, not the browser’s zone', () => {
    expect(todayIst(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23');
  });
});
