/**
 * Configuration (LLD §2, §15.4): every setting comes from the environment, parsed once at start-up.
 * A missing or malformed value stops the process with a message naming the variable.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));
const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const csv = z
  .string()
  .optional()
  .transform((v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean));

/** Provider keys: required in production, warned about in development, ignored in tests. */
export const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'INDIAN_KANOON_TOKEN'] as const;

const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ROLE: z.enum(['api', 'worker']).default('api'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.url(),
    DATABASE_URL_WORKER: optional,
    DATABASE_URL_LIBRARY: optional,
    REDIS_URL: z.url(),

    S3_ENDPOINT: optional,
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    ALLOWED_EMAIL_DOMAINS: csv,
    DEV_LOGIN: bool,
    /** Development only: accept Google accounts without a Workspace `hd` claim (e.g. Gmail) for local testing. */
    GOOGLE_SKIP_HD_CHECK: bool,

    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CSRF_SECRET: z.string().min(32, 'must be at least 32 characters'),

    ANTHROPIC_API_KEY: optional,
    MODEL_WRITER: z.string().default('claude-sonnet-5-5'),
    MODEL_CHECKER: z.string().default('claude-haiku-5-5'),
    MODEL_SECOND_CHECK: z.string().default('claude-sonnet-5-5'),
    VOYAGE_API_KEY: optional,
    VOYAGE_EMBED_MODEL: z.string().default('voyage-law-2'),
    VOYAGE_RERANK_MODEL: z.string().default('rerank-2.5'),
    RERANK_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
    /** Largest Voyage embedding request in tokens; set ~8000 while the account is on reduced (no-card) limits. */
    VOYAGE_MAX_BATCH_TOKENS: z.coerce.number().int().positive().default(60_000),
    COHERE_API_KEY: optional,
    INDIAN_KANOON_TOKEN: optional,
    KANOON_CACHE_DAYS: z.coerce.number().int().positive().default(30),
    PERPLEXITY_API_KEY: optional,
    WEB_ALLOWLIST: csv,

    LANGFUSE_HOST: optional,
    LANGFUSE_PUBLIC_KEY: optional,
    LANGFUSE_SECRET_KEY: optional,
    SENTRY_DSN: optional,

    FEATURE_FLAGS: csv,
    DEFAULT_MONTHLY_BUDGET_MICRO_USD: z.coerce.number().int().nonnegative().default(12_000_000),
  })
  .superRefine((env, ctx) => {
    if (env.DEV_LOGIN && env.NODE_ENV !== 'development') {
      ctx.addIssue({ code: 'custom', path: ['DEV_LOGIN'], message: 'is allowed only when NODE_ENV=development' });
    }
    if (env.GOOGLE_SKIP_HD_CHECK && env.NODE_ENV !== 'development') {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_SKIP_HD_CHECK'], message: 'is allowed only when NODE_ENV=development' });
    }
    if (env.NODE_ENV === 'production') {
      for (const key of PROVIDER_KEYS) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
      }
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_ID'], message: 'Google sign-in is required in production' });
      }
      if (env.ALLOWED_EMAIL_DOMAINS.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['ALLOWED_EMAIL_DOMAINS'], message: 'is required in production' });
      }
    }
  });

export type Config = z.infer<typeof Schema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses an env record. Pure, so it is testable without touching process.env. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = Schema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`));
  }
  return result.data;
}

/** Provider keys that are missing (for the development start-up warning). */
export function missingProviderKeys(config: Config): string[] {
  return PROVIDER_KEYS.filter((k) => !config[k]);
}

export function isFeatureOn(config: Config, flag: string): boolean {
  return config.FEATURE_FLAGS.includes(flag);
}

/** Loads the repo-root .env (if present) and parses process.env, exiting with a clear message on failure. */
export function loadConfig(): Config {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    /* no .env file: rely on the real environment */
  }
  try {
    return parseConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
