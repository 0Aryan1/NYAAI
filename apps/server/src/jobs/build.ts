import { UnrecoverableError, type Job } from 'bullmq';
import type pg from 'pg';
import type { Logger } from '../logger.ts';
import { BuildError, buildLecture, markFailed, type BuildDeps } from '../services/build/index.ts';
import { GatewayError } from '../services/llm-gateway/index.ts';
import { BUILD_TIMEOUT_MS, type BuildJobData } from './queues.ts';

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
    const logId = (
      await deps.logPool.query<{ id: string }>(
        `insert into jobs_log (owner_id, queue, job_id, kind, state, attempts, started_at) values ($1, 'build', $2, $3, 'active', $4, now()) returning id`,
        [data.ownerId, String(job.id), job.name, job.attemptsMade + 1],
      )
    ).rows[0]!.id;
    let timer: NodeJS.Timeout | undefined;
    try {
      const counts = await Promise.race([
        buildLecture(data, deps),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the build took longer than 8 minutes')), BUILD_TIMEOUT_MS);
        }),
      ]);
      await deps.logPool.query("update jobs_log set state = 'completed', finished_at = now() where id = $1", [logId]);
      deps.logger.info({ lectureId: data.lectureId, counts }, 'lecture built');
      return counts;
    } catch (err) {
      const code = errorCode(err);
      await deps.logPool.query(
        "update jobs_log set state = 'failed', error_code = $2, finished_at = now() where id = $1",
        [logId, code],
      );
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
