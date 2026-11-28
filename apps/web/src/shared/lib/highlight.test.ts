import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

describe('Source drawer highlight', () => {
  it('finds the supporting words despite line breaks and curly quotes', () => {
    const parts = highlight(
      'A contract to do an act\nwhich, after the contract is made, becomes “impossible”.',
      'which, after the contract is made, becomes "impossible"',
    );
    expect(parts?.[1]).toBe('which, after the contract is made, becomes "impossible"');
    expect(highlight('abc', 'xyz')).toBeNull();
  });
});
