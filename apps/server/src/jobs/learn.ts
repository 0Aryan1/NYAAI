import type { Job } from 'bullmq';
import type pg from 'pg';
import { withTenant } from '@nyaai/db';
import type { Logger } from '../logger.ts';
import { summariseTaught } from '../services/course/index.ts';
import { withSignal, type Gateway } from '../services/llm-gateway/index.ts';
import { usageSink } from '../services/usage.ts';
import type { LearnJobData } from './queues.ts';
import { withDeadline } from './deadline.ts';
import { startJobLog } from './log.ts';
import { errorCode } from './build.ts';

/** The `learn` queue: course memory when a lecture is marked taught (learn.summary). Acts as the teacher (RLS). */
export function learnProcessor(deps: { worker: pg.Pool; gateway: Gateway; logger: Logger; timeoutMs: number }) {
  return async (job: Job<LearnJobData>) => {
    if (job.name !== 'learn.summary') throw new Error(`unknown learn job ${job.name}`);
    const d = job.data;
    const who = { userId: d.ownerId, collegeId: d.collegeId, role: 'teacher' as const };
    const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
    const log = await startJobLog(deps.worker, 'learn', job, d.ownerId);
    try {
      const memory = await withDeadline(deps.timeoutMs, 'LEARN_TIMEOUT', (signal) =>
        summariseTaught(d, {
          tenant,
          gateway: withSignal(deps.gateway, signal),
          usage: (row) =>
            tenant((c) =>
              usageSink(c, { collegeId: d.collegeId, ownerId: d.ownerId })({ ...row, lectureId: d.lectureId }),
            ),
        }),
      );
      await log.completed();
      deps.logger.info(
        {
          lectureId: d.lectureId,
          saved: !!memory,
          terms: memory?.terms?.length ?? 0,
          cases: memory?.cases?.length ?? 0,
        },
        'course memory updated',
      );
      return { saved: !!memory };
    } catch (err) {
      await log.failed(errorCode(err).replace('BUILD_FAILED', 'LEARN_FAILED'));
      throw err;
    }
  };
}
