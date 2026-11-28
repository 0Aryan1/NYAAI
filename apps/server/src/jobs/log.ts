/**
 * The jobs_log row every background job writes: one row per attempt, "active" when it starts, then "completed" or
 * "failed" with a plain error code. Lets an admin see what ran, for whom, how often and why it failed.
 */
import type { Job } from 'bullmq';
import type pg from 'pg';

export interface JobLog {
  completed(): Promise<void>;
  failed(errorCode: string): Promise<void>;
}

export async function startJobLog(pool: pg.Pool, queue: string, job: Job, ownerId: string | null): Promise<JobLog> {
  const id = (
    await pool.query<{ id: string }>(
      `insert into jobs_log (owner_id, queue, job_id, kind, state, attempts, started_at)
       values ($1, $2, $3, $4, 'active', $5, now()) returning id`,
      [ownerId, queue, String(job.id), job.name, job.attemptsMade + 1],
    )
  ).rows[0]!.id;
  return {
    completed: async () => {
      await pool.query("update jobs_log set state = 'completed', finished_at = now() where id = $1", [id]);
    },
    failed: async (errorCode) => {
      await pool.query("update jobs_log set state = 'failed', error_code = $2, finished_at = now() where id = $1", [
        id,
        errorCode,
      ]);
    },
  };
}
