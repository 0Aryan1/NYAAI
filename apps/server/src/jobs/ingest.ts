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
import { ingestUpload } from '../services/ingest/note.ts';
import { findCourseSources } from '../services/course/sources.ts';
import type { IngestJobData } from './queues.ts';
import { JobTimeoutError, withDeadline } from './deadline.ts';
import { withSignal } from '../services/llm-gateway/index.ts';
import { withTenant } from '@nyaai/db';
import { startJobLog } from './log.ts';

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
  /** Jobs acting for a teacher (her own notes) run as nyaai_worker with her identity. */
  worker?: pg.Pool;
  voyageFor?: (usage: UsageSink) => Voyage;
  /** Relevance floor for searches made for a teacher (the syllabus source check). */
  minScore?: number;
  /** The job's time limit (ms); lookups inside it stop a little earlier, so their results are saved in time. */
  timeoutMs: number;
}

/** A plain code for jobs_log: the time limit, an error that names its own code, or the error's kind. */
export function ingestErrorCode(err: unknown): string {
  if (err instanceof JobTimeoutError) return err.code;
  const code = (err as { code?: unknown })?.code;
  if (typeof code === 'string' && /^[A-Z_]{3,40}$/.test(code)) return code;
  const name = (err as Error)?.name;
  return name && name !== 'Error' ? name : 'INGEST_FAILED';
}

const JOBS = new Set([
  'ingest.source',
  'ingest.kanoon',
  'ingest.lookup',
  'ingest.judgment',
  'ingest.upload',
  'ingest.syllabus',
]);

/** The `ingest` queue: stages 1–7, logged to jobs_log, progress as ingest.progress events, 10-minute limit. */
export function ingestProcessor(deps: IngestProcessorDeps) {
  const { library, logger } = deps;
  return async (job: Job<IngestJobData>) => {
    if (!JOBS.has(job.name)) throw new Error(`unknown ingest job ${job.name}`);
    const {
      sourceId,
      tid,
      gapId,
      force,
      requestedBy,
      uploadKey,
      replace,
      official,
      uploadId,
      ownerId,
      collegeId,
      courseId,
    } = job.data;
    const log = await startJobLog(library, 'ingest', job, requestedBy ?? null);
    const progress = async (stage: string) => {
      if (requestedBy) await publishEvent(deps.publisher, requestedBy, { type: 'ingest.progress', sourceId, stage });
    };
    const INGEST_TIMEOUT_MS = deps.timeoutMs;
    const work = async (signal: AbortSignal) => {
      const finishDeps = {
        library,
        voyage: deps.voyage,
        gateway: deps.gateway ? withSignal(deps.gateway, signal) : null,
        usage: deps.usage,
        embedModel: deps.embedModel,
        progress,
      };
      if (job.name === 'ingest.upload') {
        if (!uploadId || !ownerId || !collegeId || !deps.worker || !deps.voyageFor)
          throw new Error('ingest.upload needs the upload, its owner and the worker pool');
        return ingestUpload(
          uploadId,
          { userId: ownerId, collegeId, role: 'teacher' },
          { worker: deps.worker, storage: deps.storage, voyageFor: deps.voyageFor, embedModel: deps.embedModel },
        );
      }
      if (job.name === 'ingest.syllabus') {
        if (!courseId || !ownerId || !collegeId || !deps.worker || !deps.voyageFor)
          throw new Error('ingest.syllabus needs the course, its owner and the worker pool');
        // No AI model: the lookup gets none (names as Kanoon prints them; paragraphs labelled by rule or left for the editor).
        const lookup = createGapLookup({
          ...finishDeps,
          gateway: null,
          storage: deps.storage,
          kanoon: deps.kanoon,
          indiaCode: deps.indiaCode,
          web: deps.web,
          cacheDays: deps.cacheDays,
          budgetMs: 60_000,
        });
        return findCourseSources(
          courseId,
          { userId: ownerId, collegeId, role: 'teacher' },
          {
            worker: deps.worker,
            voyageFor: deps.voyageFor,
            lookup,
            minScore: deps.minScore ?? 0.5,
            budgetMs: INGEST_TIMEOUT_MS - 120_000,
          },
        );
      }
      if (job.name === 'ingest.lookup') {
        if (!gapId) throw new Error('ingest.lookup needs a gap id');
        const lookup = createGapLookup({
          ...finishDeps,
          storage: deps.storage,
          kanoon: deps.kanoon,
          indiaCode: deps.indiaCode,
          web: deps.web,
          cacheDays: deps.cacheDays,
          budgetMs: INGEST_TIMEOUT_MS - 60_000,
        });
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
          throw err; // the job's own failure handling tells her (once)
        }
      }
      if (job.name === 'ingest.kanoon') {
        if (!deps.kanoon || !tid) throw new Error('Indian Kanoon is not configured, or the job has no document id');
        return ingestKanoonJudgment(tid, {
          ...finishDeps,
          kanoon: deps.kanoon,
          storage: deps.storage,
          cacheDays: deps.cacheDays,
        });
      }
      if (!sourceId) throw new Error('ingest.source needs a source id');
      const split = await ingestSource(sourceId, { library, storage: deps.storage, progress });
      if (split.kind === 'duplicate') return split;
      return { ...split, ...(await finishSource(sourceId, finishDeps)) };
    };

    try {
      const result = await withDeadline(deps.timeoutMs, 'INGEST_TIMEOUT', work);
      await log.completed();
      logger.info({ job: job.name, sourceId, tid, result }, 'ingestion finished');
      return result;
    } catch (err) {
      await log.failed(ingestErrorCode(err));
      await progress('failed');
      // A syllabus check that will not run again: its lectures say "not checked" instead of "waiting" for ever
      // (they are checked when she prepares each one).
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final && job.name === 'ingest.syllabus' && courseId && ownerId && collegeId && deps.worker) {
        await withTenant(deps.worker, { userId: ownerId, collegeId, role: 'teacher' }, (c) =>
          c.query(
            `update course_units set sources = jsonb_set(sources, '{state}', '"not_checked"')
              where course_id = $1 and sources->>'state' = 'waiting'`,
            [courseId],
          ),
        ).catch((e: unknown) => logger.error({ err: e, courseId }, 'could not mark the syllabus lectures not checked'));
      }
      throw err;
    }
  };
}
