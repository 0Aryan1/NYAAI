import type { JobsOptions } from 'bullmq';

/** Queue names from LLD §5. Job payloads carry ids only, never private text (HLD D4). */
export const QUEUES = ['ingest', 'build', 'check', 'export', 'research', 'nightly', 'status', 'learn', 'ops'] as const;
export type QueueName = (typeof QUEUES)[number];

export const TIMEZONE = 'Asia/Kolkata';

/** ingest.source: one shared-library source to fetch, extract, clean and split. */
export interface IngestJobData {
  sourceId: string;
  /** Who asked (for progress events); an id, never content. */
  requestedBy?: string;
}

/** LLD §5: 3 retries with backoff 30 s → 2 min → 8 min; 10-minute timeout is enforced in the processor. */
export const INGEST_BACKOFF_MS = [30_000, 120_000, 480_000] as const;
export const INGEST_JOB_OPTIONS: JobsOptions = {
  attempts: 1 + INGEST_BACKOFF_MS.length,
  backoff: { type: 'custom' },
  removeOnComplete: 500,
  removeOnFail: 500,
};
export const ingestBackoff = (attemptsMade: number) => INGEST_BACKOFF_MS[Math.min(attemptsMade, INGEST_BACKOFF_MS.length) - 1] ?? 480_000;
export const INGEST_TIMEOUT_MS = 10 * 60 * 1000;
