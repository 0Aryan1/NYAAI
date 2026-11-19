import { describe, expect, it } from 'vitest';
import { normaliseForSpan, spanAppearsIn } from './normalise.ts';

const S56 = 'An agreement to do an act impossible in itself is void.\n\nContract to do act afterwards impossible or unlawful.—A contract to do an act which, after the contract is made, becomes impossible ... becomes void when the act becomes impossible or unlawful.';

describe('span check normalisation (C2)', () => {
  it('ignores spacing, line breaks and dash style', () => {
    expect(spanAppearsIn('impossible or unlawful.-A contract', S56)).toBe(true);
    expect(spanAppearsIn('An agreement to do an act   impossible in itself is void.', S56)).toBe(true);
  });
  it('treats curly and straight quotes alike', () => {
    expect(normaliseForSpan('“void”')).toBe('"void"');
  });
  it('keeps case, so a changed capital fails', () => {
    expect(spanAppearsIn('an Agreement to do', S56)).toBe(false);
  });
  it('fails when one word differs', () => {
    expect(spanAppearsIn('An agreement to do an act possible in itself is void.', S56)).toBe(false);
  });
  it('fails on an empty span', () => {
    expect(spanAppearsIn('   ', S56)).toBe(false);
  });
});
