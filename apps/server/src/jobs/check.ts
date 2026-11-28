import type { Job } from 'bullmq';
import type pg from 'pg';
import { withTenant } from '@nyaai/db';
import type { Logger } from '../logger.ts';
import { CHANGED, checkEditedLines, refreshCounts } from '../services/edit/index.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import { usageSink } from '../services/usage.ts';
import type { CheckJobData } from './queues.ts';

/** The `check` queue: C9/C10 on lines she changed (LLD §8.6). Acts as the teacher (RLS); costs tagged to the lecture. */
export function checkProcessor(deps: { worker: pg.Pool; gateway: Gateway; logger: Logger }) {
  return async (job: Job<CheckJobData>) => {
    if (job.name !== 'check.lines') throw new Error(`unknown check job ${job.name}`);
    const d = job.data;
    const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) =>
      withTenant(deps.worker, { userId: d.ownerId, collegeId: d.collegeId, role: 'teacher' }, fn);
    const usage = (row: Parameters<ReturnType<typeof usageSink>>[0]) =>
      tenant((c) => usageSink(c, { collegeId: d.collegeId, ownerId: d.ownerId })({ ...row, lectureId: d.lectureId }));
    try {
      const done = await checkEditedLines(tenant, d.citationIds, { gateway: deps.gateway, usage });
      await tenant((c) => refreshCounts(c, d.lectureId));
      deps.logger.info({ lectureId: d.lectureId, checked: done }, 'edited lines checked');
      return { checked: done };
    } catch (err) {
      // Last attempt: the line stays yellow, and says so plainly instead of "being checked" for ever.
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await tenant((c) =>
          c.query(
            "update citations set flag_reason = 'Changed by you: please verify' where id = any($1::uuid[]) and check_status = 'open' and flag_reason = $2",
            [d.citationIds, CHANGED],
          ),
        );
      }
      throw err;
    }
  };
}
