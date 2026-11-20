import { Queue, Worker } from 'bullmq';
import { createPool } from '@nyaai/db';
import { loadConfig, missingProviderKeys } from './config.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis.ts';
import { TIMEZONE, ingestBackoff } from './jobs/queues.ts';
import { opsProcessor } from './jobs/ops.ts';
import { ingestProcessor } from './jobs/ingest.ts';
import { gatewayFrom, kanoonFrom, storageFrom, voyageFrom } from './services/factory.ts';
import { usageSink } from './services/usage.ts';

const config = { ...loadConfig(), APP_ROLE: 'worker' as const };
const logger = createLogger(config);
const connection = createRedis(config.REDIS_URL);

const missing = missingProviderKeys(config);
if (missing.length) logger.warn({ missing }, 'provider keys not set; jobs that need them will fail until added to .env');
if (!config.DATABASE_URL_LIBRARY) {
  logger.fatal('DATABASE_URL_LIBRARY is required by the worker (shared library ingestion).');
  process.exit(1);
}

const library = createPool(config.DATABASE_URL_LIBRARY, 4);
const storage = storageFrom(config);
const libraryUsage = usageSink(library, { collegeId: 'global', ownerId: null });
if (!config.VOYAGE_API_KEY) {
  logger.fatal('VOYAGE_API_KEY is required by the worker (search indexing).');
  process.exit(1);
}

const opsQueue = new Queue('ops', { connection });
const workers = [
  new Worker('ops', opsProcessor(logger), { connection: createRedis(config.REDIS_URL), concurrency: 1 }),
  new Worker(
    'ingest',
    ingestProcessor({
      library,
      storage,
      publisher: connection,
      logger,
      voyage: voyageFrom(config, libraryUsage),
      gateway: gatewayFrom(config),
      kanoon: config.INDIAN_KANOON_TOKEN ? kanoonFrom(config, libraryUsage) : null,
      usage: libraryUsage,
      embedModel: config.VOYAGE_EMBED_MODEL,
      cacheDays: config.KANOON_CACHE_DAYS,
    }),
    {
    connection: createRedis(config.REDIS_URL),
    concurrency: 4,
    settings: { backoffStrategy: (attemptsMade: number) => ingestBackoff(attemptsMade) },
    },
  ),
];
for (const w of workers) {
  w.on('completed', (job) => logger.info({ job: job.name, id: job.id }, 'job completed'));
  w.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err }, 'job failed'));
}

// Scheduler (HLD §3): repeatable jobs live in the worker. Nightly checks (02:00 IST) arrive in week 2.
await opsQueue.upsertJobScheduler('ops.usage_rollup', { pattern: '0 * * * *', tz: TIMEZONE }, { name: 'ops.usage_rollup' });

await opsQueue.add('ops.ping', { requestedAt: new Date().toISOString() }, { removeOnComplete: 100, removeOnFail: 100 });
logger.info('worker started; ops.ping queued');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  await opsQueue.close();
  await Promise.allSettled([library.end(), connection.quit()]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
