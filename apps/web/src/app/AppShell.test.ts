import { describe, expect, it } from 'vitest';
import { FULL_BLEED } from './AppShell';

describe('which screens scroll by themselves', () => {
  it('the Studio and the judgment review manage their own scrolling', () => {
    expect(FULL_BLEED.test('/lectures/80b88adc-6d16-4420-b8b0-cebaca420ecb')).toBe(true);
    expect(FULL_BLEED.test('/library')).toBe(true);
    expect(FULL_BLEED.test('/library/')).toBe(true);
  });
  it('every other library screen is an ordinary page that scrolls', () => {
    for (const p of ['/library/topics', '/library/gaps', '/library/reports', '/courses', '/explore/x', '/build/x']) expect(FULL_BLEED.test(p)).toBe(false);
  });
});
