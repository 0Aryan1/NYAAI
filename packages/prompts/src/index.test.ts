import { describe, expect, it } from 'vitest';
import { PROMPT_IDS, promptKey } from './index.ts';

describe('prompt registry', () => {
  it('lists the 15 model prompts from LLD §9 without duplicates', () => {
    expect(new Set(PROMPT_IDS).size).toBe(15);
  });
  it('builds a versioned key', () => {
    expect(promptKey({ id: 'writer.part', version: '1' })).toBe('writer.part@1');
  });
});
