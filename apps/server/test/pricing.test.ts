import { describe, expect, it, vi } from 'vitest';
import { anthropicPrice, voyagePrice } from '../src/services/pricing/index.ts';
import { costMicroUsd } from '../src/services/llm-gateway/index.ts';

describe('prices', () => {
  it('known models use their list price', () => {
    expect(anthropicPrice('claude-haiku-5-5')).toEqual({ in: 0.1, out: 0.5 });
    expect(voyagePrice('voyage-law-2')).toBe(0.12);
    // 1,000 input + 1,000 output tokens on Sonnet: 1000 × 2 + 1000 × 10 micro-dollars.
    expect(costMicroUsd('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 1000 })).toBe(12_000);
  });

  it('an unknown model is counted at the highest price (never under-counted) and named once in a warning', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      expect(anthropicPrice('claude-new-model')).toEqual({ in: 4, out: 20 });
      anthropicPrice('claude-new-model');
      expect(voyagePrice('voyage-new')).toBe(0.12);
      expect(warn).toHaveBeenCalledTimes(2); // once per unknown model
      expect(String(warn.mock.calls[0]![0])).toContain('claude-new-model');
    } finally {
      warn.mockRestore();
    }
  });
});
