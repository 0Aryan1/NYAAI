import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, TOKENS, contrastRatio, type Theme } from './tokens.ts';

describe('design tokens', () => {
  for (const theme of Object.keys(TOKENS) as Theme[]) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      it(`${theme}: ${fg} on ${bg} reaches 4.5:1`, () => {
        expect(contrastRatio(TOKENS[theme][fg], TOKENS[theme][bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
