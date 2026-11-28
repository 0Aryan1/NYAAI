import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, todayIst } from './format';

describe('dates in India time', () => {
  it('writes the day as India sees it, not the browser zone or UTC', () => {
    // 20:00 UTC on 22 Nov is 01:30 on 23 Nov in India.
    expect(formatDate('2026-11-22T20:00:00Z')).toBe('23 Nov 2026');
    expect(todayIst(new Date('2026-11-22T20:00:00Z'))).toBe('2026-11-23');
    expect(formatDateTime('2026-11-22T20:00:00Z')).toMatch(/^23 Nov, 01:30 am$/i);
  });

  it('shows text that is not a date as it came, and nothing as nothing', () => {
    expect(formatDate('updated last week')).toBe('updated last week');
    expect(formatDate(null)).toBe('');
  });
});
