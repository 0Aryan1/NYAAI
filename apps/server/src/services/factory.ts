/** Builds the outside-service clients from config, so the API, worker and CLIs wire them the same way. */
import type { Config } from '../config.ts';
import { createGateway, type Gateway } from './llm-gateway/index.ts';
import { createKanoon, type Kanoon } from './kanoon/index.ts';
import { createIndiaCode, type IndiaCode } from './india-code/index.ts';
import { createWebSearch, type WebSearch } from './web-search/index.ts';
import { createStorage, type Storage } from './storage/index.ts';
import type { UsageSink } from './usage.ts';
import { createVoyage, type Voyage } from './voyage/index.ts';

/** Voyage list prices, US$ per million tokens. */
const VOYAGE_PRICES: Record<string, number> = { 'voyage-law-2': 0.12, 'rerank-2.5': 0.05, 'rerank-2.5-lite': 0.02 };

export function storageFrom(config: Config): Storage {
  return createStorage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
  });
}

export function voyageFrom(config: Config, usage: UsageSink): Voyage {
  if (!config.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is not set; search indexing needs it.');
  return createVoyage(
    {
      apiKey: config.VOYAGE_API_KEY,
      embedModel: config.VOYAGE_EMBED_MODEL,
      rerankModel: config.VOYAGE_RERANK_MODEL,
      embedPricePerM: VOYAGE_PRICES[config.VOYAGE_EMBED_MODEL] ?? 0.12,
      rerankPricePerM: VOYAGE_PRICES[config.VOYAGE_RERANK_MODEL] ?? 0.05,
      maxBatchTokens: config.VOYAGE_MAX_BATCH_TOKENS,
    },
    usage,
  );
}

/** Null when no Anthropic key is set: callers degrade honestly (e.g. labels stay 'unknown'). */
export function gatewayFrom(config: Config): Gateway | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return createGateway({ apiKey: config.ANTHROPIC_API_KEY, lightModel: config.MODEL_CHECKER, heavyModel: config.MODEL_WRITER });
}

/** India Code needs no key; it can be switched off for tests by passing nothing. */
export function indiaCodeFrom(): IndiaCode {
  return createIndiaCode();
}

/** Null without a Perplexity key: gap lookups then skip web links honestly. */
export function webSearchFrom(config: Config, usage: UsageSink): WebSearch | null {
  if (!config.PERPLEXITY_API_KEY) return null;
  return createWebSearch({ apiKey: config.PERPLEXITY_API_KEY, allowlist: config.WEB_ALLOWLIST.length ? config.WEB_ALLOWLIST : DEFAULT_WEB_ALLOWLIST }, usage);
}

/** Official Indian government and court domains (HLD 5.2: gov.in, nic.in, court websites). */
export const DEFAULT_WEB_ALLOWLIST = ['gov.in', 'nic.in'];

export function kanoonFrom(config: Config, usage: UsageSink): Kanoon {
  if (!config.INDIAN_KANOON_TOKEN) throw new Error('INDIAN_KANOON_TOKEN is not set; live judgment lookup needs it.');
  return createKanoon({ token: config.INDIAN_KANOON_TOKEN }, usage);
}
