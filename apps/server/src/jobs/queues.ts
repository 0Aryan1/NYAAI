import type { JobsOptions } from 'bullmq';

/** Queue names from LLD §5. Job payloads carry ids only, never private text (HLD D4). */
export const QUEUES = ['ingest', 'build', 'check', 'export', 'research', 'nightly', 'status', 'learn', 'ops'] as const;
export type QueueName = (typeof QUEUES)[number];

export const TIMEZONE = 'Asia/Kolkata';

/**
 * ingest.source: one shared-library source (by id); ingest.kanoon: one Indian Kanoon judgment (by tid);
 * ingest.lookup: the trusted-source lookup for one library gap (by id; the question stays in Postgres).
 */
export interface IngestJobData {
  sourceId?: string;
  tid?: number;
  gapId?: string;
  /** ingest.lookup: run even if a lookup ran within the cooldown (the editor asked). */
  force?: boolean;
  /** Who asked (for progress events); an id, never content. */
  requestedBy?: string;
  /** ingest.judgment: storage key of the uploaded PDF (a content hash, never content). */
  uploadKey?: string;
  /** ingest.judgment: the upload replaces the text of judgment `sourceId` (only if it is the same judgment). */
  replace?: boolean;
  /** ingest.judgment: the editor says the copy is from an official court website. */
  official?: boolean;
}

/** build.lecture: ids only; the teacher's identity is set with SET LOCAL from these (LLD §5.1). */
export interface BuildJobData {
  lectureId: string;
  ownerId: string;
  collegeId: string;
}

/** LLD §5: 2 retries; a retry resumes after the plan and finished parts. 8 minutes per lecture. */
export const BUILD_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 20_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};
export const BUILD_TIMEOUT_MS = 8 * 60 * 1000;

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
