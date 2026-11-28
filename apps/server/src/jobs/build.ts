import { UnrecoverableError, type Job } from 'bullmq';
import type pg from 'pg';
import type { Logger } from '../logger.ts';
import { BuildError, buildLecture, markFailed, type BuildDeps } from '../services/build/index.ts';
import { GatewayError } from '../services/llm-gateway/index.ts';
import { BUILD_TIMEOUT_MS, type BuildJobData } from './queues.ts';
import { startJobLog } from './log.ts';

/** Plain error codes the Build screen turns into words (no AI terms, LLD §12.8). */
export function errorCode(err: unknown): string {
  if (err instanceof BuildError) return err.code;
  if (err instanceof GatewayError && err.kind === 'unavailable') return 'SERVICE_UNAVAILABLE';
  // The AI provider refusing every call (account out of credit) is an outage for her, not a broken lecture.
  if (err instanceof GatewayError && /credit balance|billing/i.test(err.message)) return 'SERVICE_UNAVAILABLE';
  if (err instanceof Error && /longer than 8 minutes/.test(err.message)) return 'BUILD_TIMEOUT';
  return 'BUILD_FAILED';
}

/** The `build` queue: one lecture per job, resumable, logged to jobs_log. */
export function buildProcessor(deps: BuildDeps & { logger: Logger; logPool: pg.Pool }) {
  return async (job: Job<BuildJobData>) => {
    if (job.name !== 'build.lecture') throw new Error(`unknown build job ${job.name}`);
    const data = job.data;
    const log = await startJobLog(deps.logPool, 'build', job, data.ownerId);
    let timer: NodeJS.Timeout | undefined;
    try {
      const counts = await Promise.race([
        buildLecture(data, deps),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the build took longer than 8 minutes')), BUILD_TIMEOUT_MS);
        }),
      ]);
      await log.completed();
      deps.logger.info({ lectureId: data.lectureId, counts }, 'lecture built');
      return counts;
    } catch (err) {
      const code = errorCode(err);
      await log.failed(code);
      // Budget and missing lectures never get better with a retry; anything else retries, then fails for good.
      const final = err instanceof BuildError || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) await markFailed(data, deps, code);
      if (err instanceof BuildError) throw new UnrecoverableError(err.message);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
