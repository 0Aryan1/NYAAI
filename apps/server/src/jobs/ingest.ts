import type { Job } from 'bullmq';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import type { Logger } from '../logger.ts';
import type { Storage } from '../services/storage/index.ts';
import type { Voyage } from '../services/voyage/index.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import type { Kanoon } from '../services/kanoon/index.ts';
import type { UsageSink } from '../services/usage.ts';
import { publishEvent } from '../services/events.ts';
import { ingestSource } from '../services/ingest/source.ts';
import { finishSource } from '../services/ingest/finish.ts';
import { ingestKanoonJudgment } from '../services/ingest/kanoon.ts';
import { loadJudgmentPdf } from '../services/ingest/judgment-pdf.ts';
import type { IndiaCode } from '../services/india-code/index.ts';
import type { WebSearch } from '../services/web-search/index.ts';
import { createGapLookup } from '../services/lookup/index.ts';
import { INGEST_TIMEOUT_MS, type IngestJobData } from './queues.ts';

export interface IngestProcessorDeps {
  library: pg.Pool;
  storage: Storage;
  publisher: Redis;
  logger: Logger;
  voyage: Voyage;
  gateway: Gateway | null;
  kanoon: Kanoon | null;
  indiaCode: IndiaCode | null;
  web: WebSearch | null;
  usage: UsageSink;
  embedModel: string;
  cacheDays: number;
}

const JOBS = new Set(['ingest.source', 'ingest.kanoon', 'ingest.lookup', 'ingest.judgment']);

/** The `ingest` queue: stages 1–7, logged to jobs_log, progress as ingest.progress events, 10-minute limit. */
export function ingestProcessor(deps: IngestProcessorDeps) {
  const { library, logger } = deps;
  return async (job: Job<IngestJobData>) => {
    if (!JOBS.has(job.name)) throw new Error(`unknown ingest job ${job.name}`);
    const { sourceId, tid, gapId, force, requestedBy, uploadKey, replace, official } = job.data;
    const logId = (
      await library.query<{ id: string }>(
        `insert into jobs_log (owner_id, queue, job_id, kind, state, attempts, started_at)
         values ($1, 'ingest', $2, $3, 'active', $4, now()) returning id`,
        [requestedBy ?? null, String(job.id), job.name, job.attemptsMade + 1],
      )
    ).rows[0]!.id;
    const progress = async (stage: string) => {
      if (requestedBy) await publishEvent(deps.publisher, requestedBy, { type: 'ingest.progress', sourceId, stage });
    };
    const finishDeps = { library, voyage: deps.voyage, gateway: deps.gateway, usage: deps.usage, embedModel: deps.embedModel, progress };

    const work = async () => {
      if (job.name === 'ingest.lookup') {
        if (!gapId) throw new Error('ingest.lookup needs a gap id');
        const lookup = createGapLookup({ ...finishDeps, storage: deps.storage, kanoon: deps.kanoon, indiaCode: deps.indiaCode, web: deps.web, cacheDays: deps.cacheDays, budgetMs: INGEST_TIMEOUT_MS - 60_000 });
        return lookup.run(gapId, { force });
      }
      if (job.name === 'ingest.judgment') {
        if (!sourceId || !uploadKey) throw new Error('ingest.judgment needs a source id and the uploaded file');
        const src = (
          await library.query<{ title: string; court: string | null; decided_on: string | null; url: string | null }>(
            "select title, court, to_char(decided_on, 'YYYY-MM-DD') as decided_on, url from sources where id = $1",
            [sourceId],
          )
        ).rows[0];
        if (!src) throw new Error(`source ${sourceId} not found`);
        const bytes = await deps.storage.get(uploadKey);
        try {
          return await loadJudgmentPdf(
            {
              bytes,
              url: replace ? null : src.url,
              origin: official ? 'court_site' : 'upload',
              citation: null,
              hint: { caseName: src.title, decidedOn: src.decided_on, court: src.court },
            },
            { ...finishDeps, storage: deps.storage },
            replace ? { replace: sourceId } : { sourceId },
          );
        } catch (err) {
          // A new upload that could not be read leaves nothing behind; a replacement leaves the judgment as it was.
          if (!replace) await library.query("delete from sources where id = $1 and status = 'processing'", [sourceId]);
          await progress('failed');
          throw err;
        }
      }
      if (job.name === 'ingest.kanoon') {
        if (!deps.kanoon || !tid) throw new Error('Indian Kanoon is not configured, or the job has no document id');
        return ingestKanoonJudgment(tid, { ...finishDeps, kanoon: deps.kanoon, storage: deps.storage, cacheDays: deps.cacheDays });
      }
      if (!sourceId) throw new Error('ingest.source needs a source id');
      const split = await ingestSource(sourceId, { library, storage: deps.storage, progress });
      if (split.kind === 'duplicate') return split;
      return { ...split, ...(await finishSource(sourceId, finishDeps)) };
    };

    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ingestion took longer than 10 minutes')), INGEST_TIMEOUT_MS);
        }),
      ]);
      await library.query("update jobs_log set state = 'completed', finished_at = now() where id = $1", [logId]);
      logger.info({ job: job.name, sourceId, tid, result }, 'ingestion finished');
      return result;
    } catch (err) {
      await library.query("update jobs_log set state = 'failed', error_code = $2, finished_at = now() where id = $1", [logId, (err as Error).name]);
      await progress('failed');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
