/** Builds the outside-service clients from config, so the API, worker and CLIs wire them the same way. */
import { createFakeGateway } from './llm-gateway/fake.ts';
import { createFakeVoyage } from './voyage/fake.ts';
import type { Config } from '../config.ts';
import { createGateway, type Gateway } from './llm-gateway/index.ts';
import { createKanoon, type Kanoon } from './kanoon/index.ts';
import { createIndiaCode, type IndiaCode } from './india-code/index.ts';
import { createEscr, type Escr } from './escr/index.ts';
import { createWebSearch, type WebSearch } from './web-search/index.ts';
import { createStorage, type Storage } from './storage/index.ts';
import type { UsageSink } from './usage.ts';
import { createVoyage, type Voyage } from './voyage/index.ts';
import { voyagePrice } from './pricing/index.ts';

export function storageFrom(config: Config): Storage {
  return createStorage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    timeoutMs: config.S3_TIMEOUT_MS,
  });
}

export function voyageFrom(config: Config, usage: UsageSink): Voyage {
  if (config.E2E_FAKE_AI) return createFakeVoyage();
  if (!config.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is not set; search indexing needs it.');
  return createVoyage(
    {
      apiKey: config.VOYAGE_API_KEY,
      embedModel: config.VOYAGE_EMBED_MODEL,
      rerankModel: config.VOYAGE_RERANK_MODEL,
      embedPricePerM: voyagePrice(config.VOYAGE_EMBED_MODEL),
      rerankPricePerM: voyagePrice(config.VOYAGE_RERANK_MODEL),
      maxBatchTokens: config.VOYAGE_MAX_BATCH_TOKENS,
      baseUrl: config.VOYAGE_BASE_URL,
    },
    usage,
  );
}

/** Supreme Court Reports (official, free, no key); its catalogue is cached in our storage. */
export function escrFrom(storage: Storage, config?: Pick<Config, 'ESCR_BASE_URL'>): Escr {
  return createEscr({ storage, baseUrl: config?.ESCR_BASE_URL });
}

/** Null when no Anthropic key is set: callers degrade honestly (e.g. labels stay 'unknown'). */
export function gatewayFrom(config: Config): Gateway | null {
  if (config.E2E_FAKE_AI) return createFakeGateway();
  if (!config.ANTHROPIC_API_KEY) return null;
  return createGateway({
    apiKey: config.ANTHROPIC_API_KEY,
    lightModel: config.MODEL_CHECKER,
    heavyModel: config.MODEL_WRITER,
    timeoutMs: config.ANTHROPIC_TIMEOUT_MS,
  });
}

/** India Code needs no key; it can be switched off for tests by passing nothing. */
export function indiaCodeFrom(config?: Pick<Config, 'INDIA_CODE_BASE_URL'>): IndiaCode {
  return createIndiaCode({ baseUrl: config?.INDIA_CODE_BASE_URL });
}

/** Null without a Perplexity key: gap lookups then skip web links honestly. */
export function webSearchFrom(config: Config, usage: UsageSink): WebSearch | null {
  if (!config.PERPLEXITY_API_KEY) return null;
  return createWebSearch(
    {
      apiKey: config.PERPLEXITY_API_KEY,
      allowlist: config.WEB_ALLOWLIST.length ? config.WEB_ALLOWLIST : DEFAULT_WEB_ALLOWLIST,
      baseUrl: config.PERPLEXITY_BASE_URL,
    },
    usage,
  );
}

/** Official Indian government and court domains (HLD 5.2: gov.in, nic.in, court websites). */
export const DEFAULT_WEB_ALLOWLIST = ['gov.in', 'nic.in'];

export function kanoonFrom(config: Config, usage: UsageSink): Kanoon {
  if (!config.INDIAN_KANOON_TOKEN) throw new Error('INDIAN_KANOON_TOKEN is not set; live judgment lookup needs it.');
  return createKanoon({ token: config.INDIAN_KANOON_TOKEN, baseUrl: config.KANOON_BASE_URL }, usage);
}
