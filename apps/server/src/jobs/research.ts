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
import { withDeadline } from './deadline.ts';
import { withSignal } from '../services/llm-gateway/index.ts';
import { startJobLog } from './log.ts';

/** The `research` queue: one quick run per job, resumable (sub-questions kept), logged to jobs_log. */
export function researchProcessor(deps: ResearchDeps & { logger: Logger; logPool: pg.Pool; timeoutMs: number }) {
  return async (job: Job<ResearchJob>) => {
    if (job.name !== 'research.run') throw new Error(`unknown research job ${job.name}`);
    const data = job.data;
    const log = await startJobLog(deps.logPool, 'research', job, data.ownerId);
    try {
      const r = await withDeadline(deps.timeoutMs, 'RESEARCH_TIMEOUT', (signal) =>
        runResearch(data, { ...deps, gateway: withSignal(deps.gateway, signal), signal }),
      );
      await log.completed();
      deps.logger.info({ runId: data.runId, ...r }, 'research ready');
      return r;
    } catch (err) {
      const code = err instanceof ResearchError ? err.code : errorCode(err);
      await log.failed(code);
      const final = err instanceof ResearchError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) await markResearchFailed(data, deps.worker, code);
      if (err instanceof ResearchError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };
}
