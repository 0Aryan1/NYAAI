import { describe, expect, it } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { ApiError, HealthResponse } from '@nyaai/shared';
import { createApp } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';

const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:1/x',
  REDIS_URL: 'redis://localhost:1',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  SESSION_SECRET: 'a'.repeat(32),
  CSRF_SECRET: 'b'.repeat(32),
});

function app(dbUp: boolean, redisUp: boolean) {
  const pool = { query: async () => (dbUp ? { rows: [{ v: '0.8.1' }] } : Promise.reject(new Error('down'))) } as unknown as pg.Pool;
  const redis = { ping: async () => (redisUp ? 'PONG' : Promise.reject(new Error('down'))) } as unknown as Redis;
  return createApp({ config, logger: pino({ level: 'silent' }), pool, redis });
}

describe('API skeleton', () => {
  it('reports healthy dependencies', async () => {
    const res = await request(app(true, true)).get('/api/v1/health').expect(200);
    const body = HealthResponse.parse(res.body);
    expect(body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok', pgvector: '0.8.1' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('reports a down dependency with 503', async () => {
    const res = await request(app(true, false)).get('/api/v1/health').expect(503);
    expect(res.body).toMatchObject({ status: 'degraded', redis: 'down' });
  });

  it('returns unknown routes in the standard error shape with the request id as traceId', async () => {
    const res = await request(app(true, true)).get('/api/v1/nope').set('x-request-id', 'trace-12345678').expect(404);
    const body = ApiError.parse(res.body);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', traceId: 'trace-12345678' });
  });

  it('sets security headers', async () => {
    const res = await request(app(true, true)).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
