/**
 * Prices of the outside services, in one place (US$ per million tokens, list prices). Used to record what each call
 * cost (the `usage` table), which the monthly budget is checked against.
 *
 * A model missing from a table is priced at the most expensive model of its kind, so a budget is never under-counted,
 * and a warning names it once, so the table gets updated.
 */

/** Claude: input and output per million tokens. Cache write = 1.25× input, cache read = 0.1× input (gateway). */
const ANTHROPIC_PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
};
const ANTHROPIC_FALLBACK = 'claude-opus-5-5';

/** Voyage: embeddings and reranking, per million tokens. */
const VOYAGE_PRICES: Record<string, number> = {
  'voyage-law-2': 0.12,
  'rerank-2.5': 0.05,
  'rerank-2.5-lite': 0.02,
};

const warned = new Set<string>();
function unknown(kind: string, model: string, fallback: string) {
  if (warned.has(`${kind}:${model}`)) return;
  warned.add(`${kind}:${model}`);
  process.emitWarning(
    `No ${kind} price for model "${model}"; costs are counted at the ${fallback} price. Add it to services/pricing.`,
    {
      code: 'NYAAI_UNKNOWN_MODEL_PRICE',
    },
  );
}

export function anthropicPrice(model: string): { in: number; out: number } {
  const p = ANTHROPIC_PRICES[model];
  if (p) return p;
  unknown('Claude', model, ANTHROPIC_FALLBACK);
  return ANTHROPIC_PRICES[ANTHROPIC_FALLBACK]!;
}

export function voyagePrice(model: string): number {
  const p = VOYAGE_PRICES[model];
  if (p !== undefined) return p;
  const highest = Math.max(...Object.values(VOYAGE_PRICES));
  unknown('Voyage', model, `highest Voyage (${highest})`);
  return highest;
}
