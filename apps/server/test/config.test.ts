import { describe, expect, it } from 'vitest';
import { ConfigError, missingProviderKeys, parseConfig } from '../src/config.ts';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://nyaai_app:x@localhost:54329/nyaai',
  REDIS_URL: 'redis://localhost:63799',
  S3_BUCKET: 'nyaai-dev',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  SESSION_SECRET: 'a'.repeat(32),
  CSRF_SECRET: 'b'.repeat(32),
};

describe('config', () => {
  it('parses a minimal development environment with defaults', () => {
    const c = parseConfig(base);
    expect(c.API_PORT).toBe(4000);
    expect(c.MODEL_CHECKER).toBe('claude-haiku-5-5');
    expect(c.DEFAULT_MONTHLY_BUDGET_MICRO_USD).toBe(12_000_000);
    expect(missingProviderKeys(c)).toEqual(['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'INDIAN_KANOON_TOKEN']);
  });

  it('names the missing variable', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    try {
      parseConfig(rest);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).problems.join()).toContain('DATABASE_URL');
    }
  });

  it('rejects short secrets', () => {
    expect(() => parseConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('allows DEV_LOGIN only in development', () => {
    expect(parseConfig({ ...base, DEV_LOGIN: 'true' }).DEV_LOGIN).toBe(true);
    expect(() => parseConfig({ ...base, NODE_ENV: 'production', DEV_LOGIN: 'true' })).toThrow(/DEV_LOGIN/);
  });

  it('requires provider keys and Google sign-in in production', () => {
    expect(() => parseConfig({ ...base, NODE_ENV: 'production' })).toThrow(/ANTHROPIC_API_KEY[\s\S]*GOOGLE_CLIENT_ID/);
  });

  it('splits comma lists', () => {
    expect(parseConfig({ ...base, FEATURE_FLAGS: 'coach, web_search' }).FEATURE_FLAGS).toEqual(['coach', 'web_search']);
  });
});
