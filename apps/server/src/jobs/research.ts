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
import { startJobLog } from './log.ts';

/** The `research` queue: one quick run per job, resumable (sub-questions kept), logged to jobs_log. */
export function researchProcessor(deps: ResearchDeps & { logger: Logger; logPool: pg.Pool }) {
  return async (job: Job<ResearchJob>) => {
    if (job.name !== 'research.run') throw new Error(`unknown research job ${job.name}`);
    const data = job.data;
    const log = await startJobLog(deps.logPool, 'research', job, data.ownerId);
    let timer: NodeJS.Timeout | undefined;
    try {
      const r = await Promise.race([
        runResearch(data, deps),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the research took longer than 4 minutes')), RESEARCH_TIMEOUT_MS);
        }),
      ]);
      await log.completed();
      deps.logger.info({ runId: data.runId, ...r }, 'research ready');
      return r;
    } catch (err) {
      const code =
        err instanceof ResearchError
          ? err.code
          : /longer than 4 minutes/.test(String(err))
            ? 'RESEARCH_TIMEOUT'
            : errorCode(err);
      await log.failed(code);
      const final = err instanceof ResearchError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) await markResearchFailed(data, deps.worker, code);
      if (err instanceof ResearchError) throw new UnrecoverableError(err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
