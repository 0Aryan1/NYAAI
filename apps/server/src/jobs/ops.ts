import type { Job } from 'bullmq';
import type pg from 'pg';
import type { Logger } from '../logger.ts';
import { forgetTeacher, type ForgetResult } from '../services/account/index.ts';
import type { Storage } from '../services/storage/index.ts';
import type { OpsJobData } from './queues.ts';

export type OpsJobName = 'ops.ping' | 'ops.usage_rollup' | 'ops.delete_user_data';

export interface OpsDeps {
  logger: Logger;
  /** Jobs acting for a teacher ("delete my data") run as nyaai_worker with her identity. */
  worker?: pg.Pool;
  storage?: Storage | null;
}

/** The `ops` queue processor: liveness ping, hourly roll-up stub, and "delete my data" (BRD NFR-8). */
export function opsProcessor(deps: OpsDeps) {
  const { logger } = deps;
  return async (job: Job<OpsJobData, { ok: true; at: string } | ForgetResult, OpsJobName>) => {
    switch (job.name) {
      case 'ops.ping':
        return { ok: true as const, at: new Date().toISOString() };
      case 'ops.usage_rollup':
        logger.debug('usage roll-up: nothing to do yet');
        return { ok: true as const, at: new Date().toISOString() };
      case 'ops.delete_user_data': {
        const { userId, collegeId } = job.data;
        if (!userId || !collegeId || !deps.worker) throw new Error('ops.delete_user_data needs the teacher and the worker pool');
        const r = await forgetTeacher({ userId, collegeId, role: 'teacher' }, { worker: deps.worker, storage: deps.storage ?? null });
        logger.info({ logId: r.logId, files: r.files }, 'teacher data deleted');
        return r;
      }
      default:
        throw new Error(`unknown ops job ${String(job.name)}`);
    }
  };
}
