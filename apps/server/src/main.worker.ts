import { Queue, Worker } from 'bullmq';
import { createPool } from '@nyaai/db';
import { loadConfig, missingProviderKeys } from './config.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis.ts';
import { TIMEZONE, ingestBackoff } from './jobs/queues.ts';
import { opsProcessor } from './jobs/ops.ts';
import { ingestProcessor } from './jobs/ingest.ts';
import { gatewayFrom, indiaCodeFrom, kanoonFrom, storageFrom, voyageFrom, webSearchFrom } from './services/factory.ts';
import { usageSink } from './services/usage.ts';
import { buildProcessor } from './jobs/build.ts';
import { learnProcessor } from './jobs/learn.ts';
import { checkProcessor } from './jobs/check.ts';
import { createGapLookup } from './services/lookup/index.ts';

const config = { ...loadConfig(), APP_ROLE: 'worker' as const };
const logger = createLogger(config);
const connection = createRedis(config.REDIS_URL);

const missing = missingProviderKeys(config);
if (missing.length) logger.warn({ missing }, 'provider keys not set; jobs that need them will fail until added to .env');
if (!config.ANTHROPIC_API_KEY) logger.warn('ANTHROPIC_API_KEY is not set: lecture builds are off');
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

if (!config.DATABASE_URL_WORKER) {
  logger.fatal('DATABASE_URL_WORKER is required by the worker (jobs acting for a teacher).');
  process.exit(1);
}
const worker = createPool(config.DATABASE_URL_WORKER, 8);
const gateway = gatewayFrom(config);
const lookup = createGapLookup({
  library,
  storage,
  voyage: voyageFrom(config, libraryUsage),
  gateway,
  usage: libraryUsage,
  embedModel: config.VOYAGE_EMBED_MODEL,
  kanoon: config.INDIAN_KANOON_TOKEN ? kanoonFrom(config, libraryUsage) : null,
  indiaCode: indiaCodeFrom(),
  web: webSearchFrom(config, libraryUsage),
  cacheDays: config.KANOON_CACHE_DAYS,
  budgetMs: 120_000, // inside a lecture build: at most 2 minutes of lookups per part
});

const opsQueue = new Queue('ops', { connection });
const workers = [
  ...(gateway
    ? [
        new Worker(
          'build',
          buildProcessor({ worker, logPool: worker, gateway, voyageFor: (u) => voyageFrom(config, u), lookup, publisher: connection, minScore: config.RERANK_MIN_SCORE, logger }),
          { connection: createRedis(config.REDIS_URL), concurrency: 3, lockDuration: 120_000 },
        ),
        new Worker('learn', learnProcessor({ worker, gateway, logger }), { connection: createRedis(config.REDIS_URL), concurrency: 2 }),
        new Worker('check', checkProcessor({ worker, gateway, logger }), { connection: createRedis(config.REDIS_URL), concurrency: 8 }),
      ]
    : []),
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
      indiaCode: indiaCodeFrom(),
      web: webSearchFrom(config, libraryUsage),
      usage: libraryUsage,
      embedModel: config.VOYAGE_EMBED_MODEL,
      cacheDays: config.KANOON_CACHE_DAYS,
      worker,
      voyageFor: (u) => voyageFrom(config, u),
      minScore: config.RERANK_MIN_SCORE,
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
  await Promise.allSettled([library.end(), worker.end(), connection.quit()]);
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
