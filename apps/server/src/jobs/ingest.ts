import type { Job } from 'bullmq';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Logger } from '../logger.ts';
import type { Storage } from '../services/storage/index.ts';
import { ingestSource, type IngestResult } from '../services/ingest/source.ts';
import { INGEST_TIMEOUT_MS, type IngestJobData } from './queues.ts';

export interface IngestProcessorDeps {
  library: pg.Pool;
  storage: Storage;
  publisher: Redis;
  logger: Logger;
}

/** The `ingest` queue processor: logs to jobs_log, publishes ingest.progress, enforces the 10-minute limit. */
export function ingestProcessor({ library, storage, publisher, logger }: IngestProcessorDeps) {
  return async (job: Job<IngestJobData, IngestResult>) => {
    if (job.name !== 'ingest.source') throw new Error(`unknown ingest job ${job.name}`);
    const { sourceId, requestedBy } = job.data;
    const logId = (
      await library.query<{ id: string }>(
        `insert into jobs_log (owner_id, queue, job_id, kind, state, attempts, started_at)
         values ($1, 'ingest', $2, $3, 'active', $4, now()) returning id`,
        [requestedBy ?? null, String(job.id), job.name, job.attemptsMade + 1],
      )
    ).rows[0]!.id;

    const publish = async (stage: string) => {
      if (requestedBy) await publisher.publish(`events:${requestedBy}`, JSON.stringify({ type: 'ingest.progress', sourceId, stage }));
    };

    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        ingestSource(sourceId, { library, storage, progress: publish }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ingestion took longer than 10 minutes')), INGEST_TIMEOUT_MS);
        }),
      ]);
      await library.query("update jobs_log set state = 'completed', finished_at = now() where id = $1", [logId]);
      logger.info({ job: job.name, sourceId, result }, 'source ingested');
      return result;
    } catch (err) {
      await library.query("update jobs_log set state = 'failed', error_code = $2, finished_at = now() where id = $1", [
        logId,
        (err as Error).name,
      ]);
      await publish('failed');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
