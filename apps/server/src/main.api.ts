import { Queue } from 'bullmq';
import { createPool } from '@nyaai/db';
import { loadConfig, missingProviderKeys } from './config.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis.ts';
import { createApp } from './app.ts';
import type { BuildJobData, IngestJobData } from './jobs/queues.ts';
import { gatewayFrom, voyageFrom } from './services/factory.ts';

const config = { ...loadConfig(), APP_ROLE: 'api' as const };
const logger = createLogger(config);
const pool = createPool(config.DATABASE_URL);
const redis = createRedis(config.REDIS_URL);
const ingest = new Queue<IngestJobData>('ingest', { connection: createRedis(config.REDIS_URL) });
const build = new Queue<BuildJobData>('build', { connection: createRedis(config.REDIS_URL) });

const missing = missingProviderKeys(config);
if (missing.length) logger.warn({ missing }, 'provider keys not set; AI and lookup features will be unavailable');
if (config.DEV_LOGIN) logger.warn('DEV_LOGIN is on (development only)');

const server = createApp({
  config,
  logger,
  pool,
  redis,
  queues: { ingest, build },
  search: {
    voyage: config.VOYAGE_API_KEY ? (usage) => voyageFrom(config, usage) : null,
    gateway: gatewayFrom(config),
    minScore: config.RERANK_MIN_SCORE,
  },
}).listen(config.API_PORT, () => {
  logger.info(`API listening on http://localhost:${config.API_PORT}/api/v1`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await Promise.allSettled([pool.end(), redis.quit(), ingest.close(), build.close()]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
