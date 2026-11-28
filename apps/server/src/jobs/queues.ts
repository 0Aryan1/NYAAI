import type { MappingRelation } from '@nyaai/shared';
import type { JobsOptions } from 'bullmq';

/**
 * Job payloads and options for the queues the worker runs (ingest, build, research, learn, check, ops; LLD §5).
 * Payloads carry ids only, never private text (HLD D4).
 */

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
  /** ingest.upload: a teacher's own document (read as her: `ownerId`, `collegeId`). */
  uploadId?: string;
  /** ingest.syllabus: find sources for every planned lecture of this course (as her). */
  courseId?: string;
  ownerId?: string;
  collegeId?: string;
}

/**
 * ops.delete_user_data: the teacher who asked (she is the only one it may act for).
 * ops.mapping_changed: the library editor who changed a signed law-mapping row (`userId`, `collegeId`), and the row
 * as it was when lines relied on it: section numbers and relation only, never a teacher's words.
 */
export interface OpsJobData {
  userId?: string;
  collegeId?: string;
  requestedAt?: string;
  mapping?: {
    oldSections: string[];
    newSections: string[];
    relation: MappingRelation;
    change: 'changed' | 'unsigned' | 'removed';
  };
}

/** ops.mapping_changed: retried, so a line never keeps a green it no longer has. */
export const MAPPING_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

/** build.lecture: ids only; the teacher's identity is set with SET LOCAL from these (LLD §5.1). */
export interface BuildJobData {
  lectureId: string;
  ownerId: string;
  collegeId: string;
}

/** check.lines: the background check of lines she changed (ids only: the words stay in Postgres). */
export interface CheckJobData {
  lectureId: string;
  ownerId: string;
  collegeId: string;
  citationIds: string[];
}
/** LLD §5: check queue, 3 retries, 2 minutes. A check that cannot run leaves the line yellow. */
export const CHECK_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** learn.summary: course memory for one taught lecture (ids only). */
export type LearnJobData = BuildJobData;

/** LLD §5: learn queue, 2 retries, 3 minutes. */
export const LEARN_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** LLD §5: 2 retries; a retry resumes after the plan and finished parts. 8 minutes per lecture. */
export const BUILD_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 20_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** research.run: one quick Research run (ids only). LLD §5: 4 minutes quick; 2 attempts; resumes after the plan. */
export interface ResearchJobData {
  runId: string;
  ownerId: string;
  collegeId: string;
}
export const RESEARCH_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 20_000 },
  removeOnComplete: 500,
  removeOnFail: 500,
};

/** LLD §5: 3 retries with backoff 30 s → 2 min → 8 min; 10-minute timeout is enforced in the processor. */
const INGEST_BACKOFF_MS = [30_000, 120_000, 480_000] as const;
export const INGEST_JOB_OPTIONS: JobsOptions = {
  attempts: 1 + INGEST_BACKOFF_MS.length,
  backoff: { type: 'custom' },
  removeOnComplete: 500,
  removeOnFail: 500,
};
export const ingestBackoff = (attemptsMade: number) =>
  INGEST_BACKOFF_MS[Math.min(attemptsMade, INGEST_BACKOFF_MS.length) - 1] ?? 480_000;
