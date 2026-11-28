import { Router } from 'express';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { HealthResponse } from '@nyaai/shared';

const VERSION = process.env.npm_package_version ?? '0.0.0';

async function settle<T>(p: Promise<T>, ms = 2000): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms)));
  try {
    return await Promise.race([p, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function healthRouter(deps: { pool: pg.Pool; redis: Redis }): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.all([
      settle(
        deps.pool.query<{ v: string | null }>(
          "select (select extversion from pg_extension where extname = 'vector') as v",
        ),
      ),
      settle(deps.redis.ping()),
    ]);
    const body: HealthResponse = {
      status: db && redis === 'PONG' ? 'ok' : 'degraded',
      db: db ? 'ok' : 'down',
      redis: redis === 'PONG' ? 'ok' : 'down',
      pgvector: db?.rows[0]?.v ?? null,
      version: VERSION,
    };
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });
  return router;
}
