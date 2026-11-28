import { UnrecoverableError, type Job } from 'bullmq';
import type pg from 'pg';
import type { Logger } from '../logger.ts';
import {
  markResearchFailed,
  ResearchError,
  runResearch,
  type ResearchDeps,
  type ResearchJob,
} from '../services/research/index.ts';
import { errorCode } from './build.ts';
import { RESEARCH_TIMEOUT_MS } from './queues.ts';

/** The `research` queue: one quick run per job, resumable (sub-questions kept), logged to jobs_log. */
export function researchProcessor(deps: ResearchDeps & { logger: Logger; logPool: pg.Pool }) {
  return async (job: Job<ResearchJob>) => {
    if (job.name !== 'research.run') throw new Error(`unknown research job ${job.name}`);
    const data = job.data;
    const logId = (
      await deps.logPool.query<{ id: string }>(
        `insert into jobs_log (owner_id, queue, job_id, kind, state, attempts, started_at) values ($1, 'research', $2, $3, 'active', $4, now()) returning id`,
        [data.ownerId, String(job.id), job.name, job.attemptsMade + 1],
      )
    ).rows[0]!.id;
    let timer: NodeJS.Timeout | undefined;
    try {
      const r = await Promise.race([
        runResearch(data, deps),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the research took longer than 4 minutes')), RESEARCH_TIMEOUT_MS);
        }),
      ]);
      await deps.logPool.query("update jobs_log set state = 'completed', finished_at = now() where id = $1", [logId]);
      deps.logger.info({ runId: data.runId, ...r }, 'research ready');
      return r;
    } catch (err) {
      const code =
        err instanceof ResearchError
          ? err.code
          : /longer than 4 minutes/.test(String(err))
            ? 'RESEARCH_TIMEOUT'
            : errorCode(err);
      await deps.logPool.query(
        "update jobs_log set state = 'failed', error_code = $2, finished_at = now() where id = $1",
        [logId, code],
      );
      const final = err instanceof ResearchError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) await markResearchFailed(data, deps.worker, code);
      if (err instanceof ResearchError) throw new UnrecoverableError(err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
