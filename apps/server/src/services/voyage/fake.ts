/**
 * A stand-in for Voyage, for the browser journeys only (`E2E_FAKE_AI`): no network, no cost. Embeddings are a
 * bag of words hashed into 1024 numbers; the reranker scores a passage by the share of the question's words it
 * holds, lifted above the relevance floor when it holds any. With the library's real embeddings the vector search is
 * close to random, so the word search carries the results, which is enough to walk a journey end to end.
 */
import { createHash } from 'node:crypto';
import { EMBED_DIMS, type Voyage } from './index.ts';

export const words = (t: string) => t.toLowerCase().match(/[a-z]{3,}/g) ?? [];

/** A bag of words hashed into the embedding's dimensions: texts sharing words point the same way. */
export function bagOfWordsVector(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  for (const w of words(text)) v[createHash('md5').update(w).digest().readUInt16BE(0) % EMBED_DIMS]! += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export function createFakeVoyage(): Voyage {
  return {
    embed: async (texts) => texts.map(bagOfWordsVector),
    rerank: async (query, docs) => {
      const q = new Set(words(query.split('Question:').pop() ?? query));
      return docs
        .map((d, index) => {
          const share = q.size ? [...q].filter((x) => new Set(words(d)).has(x)).length / q.size : 0;
          return { index, score: share > 0 ? 0.5 + share / 2 : 0.1 };
        })
        .sort((a, b) => b.score - a.score);
    },
  };
}
