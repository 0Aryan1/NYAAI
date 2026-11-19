import { Queue, Worker } from 'bullmq';
import { loadConfig, missingProviderKeys } from './config.ts';
import { createLogger } from './logger.ts';
import { createRedis } from './redis.ts';
import { TIMEZONE } from './jobs/queues.ts';
import { opsProcessor } from './jobs/ops.ts';

const config = { ...loadConfig(), APP_ROLE: 'worker' as const };
const logger = createLogger(config);
const connection = createRedis(config.REDIS_URL);

const missing = missingProviderKeys(config);
if (missing.length) logger.warn({ missing }, 'provider keys not set; jobs that need them will fail until added to .env');

const opsQueue = new Queue('ops', { connection });
const opsWorker = new Worker('ops', opsProcessor(logger), { connection: createRedis(config.REDIS_URL), concurrency: 1 });

opsWorker.on('completed', (job) => logger.info({ job: job.name, id: job.id }, 'job completed'));
opsWorker.on('failed', (job, err) => logger.error({ job: job?.name, id: job?.id, err }, 'job failed'));

// Scheduler (HLD §3): repeatable jobs live in the worker. Nightly checks (02:00 IST) arrive in week 2.
await opsQueue.upsertJobScheduler('ops.usage_rollup', { pattern: '0 * * * *', tz: TIMEZONE }, { name: 'ops.usage_rollup' });

await opsQueue.add('ops.ping', { requestedAt: new Date().toISOString() }, { removeOnComplete: 100, removeOnFail: 100 });
logger.info('worker started; ops.ping queued');

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  await opsWorker.close();
  await opsQueue.close();
  await connection.quit();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
