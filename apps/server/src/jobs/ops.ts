import type { Job } from 'bullmq';
import type { Logger } from '../logger.ts';

export type OpsJobName = 'ops.ping' | 'ops.usage_rollup';

/** The `ops` queue processor. Day 0: a liveness ping and an hourly roll-up stub. */
export function opsProcessor(logger: Logger) {
  return async (job: Job<{ requestedAt?: string }, { ok: true; at: string }, OpsJobName>) => {
    switch (job.name) {
      case 'ops.ping':
        return { ok: true as const, at: new Date().toISOString() };
      case 'ops.usage_rollup':
        logger.debug('usage roll-up: nothing to do yet');
        return { ok: true as const, at: new Date().toISOString() };
      default:
        throw new Error(`unknown ops job ${String(job.name)}`);
    }
  };
}
