/**
 * Voyage AI (HLD D6, D16): `voyage-law-2` embeddings (1024 dims) and `rerank-2.5` cross-encoder reranking.
 * Plain REST. Batches stay inside Voyage's per-request limits; 429 and 5xx are retried with backoff.
 * Every call is costed in `usage` (prices per million tokens, from config).
 */
import type { UsageSink } from '../usage/index.ts';
import { ExternalServiceError } from '../../errors.ts';

export const EMBED_DIMS = 1024;
/** Per-request limits for voyage-law-2: 1,000 inputs and 120K tokens. We stay well under both. */
const MAX_BATCH_TEXTS = 128;
const DEFAULT_BATCH_TOKENS = 60_000;
/** A 429 waits long enough for a per-minute window to roll over. */
const RATE_LIMIT_WAIT_MS = 21_000;
const MAX_ATTEMPTS = 8;

export interface VoyageConfig {
  apiKey: string;
  embedModel: string;
  rerankModel: string;
  /** US$ per million tokens. */
  embedPricePerM: number;
  rerankPricePerM: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Largest embedding request, in tokens (≈ chars/4). Lower it for accounts on reduced rate limits. */
  maxBatchTokens?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class VoyageError extends ExternalServiceError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super('The search service', message);
    this.name = 'VoyageError';
  }
}

export interface RerankHit {
  index: number;
  score: number;
}

export interface Voyage {
  embed(texts: string[], inputType: 'document' | 'query', purpose: string): Promise<number[][]>;
  rerank(query: string, documents: string[], purpose: string, topK?: number): Promise<RerankHit[]>;
}

export function createVoyage(cfg: VoyageConfig, usage: UsageSink): Voyage {
  const base = cfg.baseUrl ?? 'https://api.voyageai.com/v1';
  const doFetch = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxBatchChars = (cfg.maxBatchTokens ?? DEFAULT_BATCH_TOKENS) * 4;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let lastError: VoyageError | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as T;
      const text = await res.text().catch(() => '');
      lastError = new VoyageError(`Voyage ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
      if (res.status !== 429 && res.status < 500) break;
      await sleep(res.status === 429 ? RATE_LIMIT_WAIT_MS : 1000 * 2 ** attempt);
    }
    throw lastError ?? new VoyageError(`Voyage ${path} failed`, 0);
  }

  function batches(texts: string[]): string[][] {
    const out: string[][] = [];
    let cur: string[] = [];
    let chars = 0;
    for (const t of texts) {
      if (cur.length && (cur.length >= MAX_BATCH_TEXTS || chars + t.length > maxBatchChars)) {
        out.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(t);
      chars += t.length;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  return {
    async embed(texts, inputType, purpose) {
      const vectors: number[][] = [];
      for (const batch of batches(texts)) {
        const r = await post<{ data: { embedding: number[]; index: number }[]; usage: { total_tokens: number } }>(
          '/embeddings',
          {
            input: batch,
            model: cfg.embedModel,
            input_type: inputType,
          },
        );
        const ordered = [...r.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
        if (ordered.some((v) => v.length !== EMBED_DIMS))
          throw new VoyageError(`expected ${EMBED_DIMS}-dim vectors`, 0);
        vectors.push(...ordered);
        await usage({
          provider: 'voyage',
          model: cfg.embedModel,
          purpose,
          inputTokens: r.usage.total_tokens,
          units: batch.length,
          costMicroUsd: r.usage.total_tokens * cfg.embedPricePerM,
        });
      }
      return vectors;
    },

    async rerank(query, documents, purpose, topK) {
      if (documents.length === 0) return [];
      const r = await post<{ data: { index: number; relevance_score: number }[]; usage: { total_tokens: number } }>(
        '/rerank',
        {
          query,
          documents,
          model: cfg.rerankModel,
          ...(topK ? { top_k: topK } : {}),
          truncation: true,
        },
      );
      await usage({
        provider: 'voyage',
        model: cfg.rerankModel,
        purpose,
        inputTokens: r.usage.total_tokens,
        units: documents.length,
        costMicroUsd: r.usage.total_tokens * cfg.rerankPricePerM,
      });
      return r.data.map((d) => ({ index: d.index, score: d.relevance_score })).sort((a, b) => b.score - a.score);
    },
  };
}

/** pgvector literal for a query parameter: '[0.1,0.2,…]'. */
export const toVector = (v: number[]) => `[${v.join(',')}]`;
