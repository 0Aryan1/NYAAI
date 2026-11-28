import type { Job } from 'bullmq';
import type pg from 'pg';
import { withTenant } from '@nyaai/db';
import type { Logger } from '../logger.ts';
import { summariseTaught } from '../services/course/index.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import { usageSink } from '../services/usage.ts';
import { LEARN_TIMEOUT_MS, type LearnJobData } from './queues.ts';

/** The `learn` queue: course memory when a lecture is marked taught (learn.summary). Acts as the teacher (RLS). */
export function learnProcessor(deps: { worker: pg.Pool; gateway: Gateway; logger: Logger }) {
  return async (job: Job<LearnJobData>) => {
    if (job.name !== 'learn.summary') throw new Error(`unknown learn job ${job.name}`);
    const d = job.data;
    const who = { userId: d.ownerId, collegeId: d.collegeId, role: 'teacher' as const };
    const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
    let timer: NodeJS.Timeout | undefined;
    try {
      const memory = await Promise.race([
        summariseTaught(d, {
          tenant,
          gateway: deps.gateway,
          usage: (row) =>
            tenant((c) =>
              usageSink(c, { collegeId: d.collegeId, ownerId: d.ownerId })({ ...row, lectureId: d.lectureId }),
            ),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('course memory took longer than 3 minutes')), LEARN_TIMEOUT_MS);
        }),
      ]);
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
    } finally {
      clearTimeout(timer);
    }
  };
}
