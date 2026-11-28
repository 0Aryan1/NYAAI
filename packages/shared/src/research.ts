import { z } from 'zod';
import { CaseStatus } from './library.ts';
import { Claim } from './lecture.ts';

/* ---------------------------------------------------------------------------------------------------------------
 * Research mode, quick runs (BRD RES-1, RES-3, RES-4, RES-6; HLD F6; LLD §4 /research).
 * A question becomes sub-questions, the library (and the gap lookup) gathers evidence for each, the brief is written
 * only from that evidence, and every line of it passes the same ten checks as a lecture line.
 * ------------------------------------------------------------------------------------------------------------- */

export const ResearchScope = z.object({
  /** India only (the pilot library), or comparative (foreign courts allowed as evidence). */
  comparative: z.boolean().default(false),
  /** Judgments decided in these years only (Acts always count). */
  fromYear: z.number().int().min(1800).max(2100).optional(),
  toYear: z.number().int().min(1800).max(2100).optional(),
});
export type ResearchScope = z.infer<typeof ResearchScope>;

/** POST /research */
export const StartResearch = z.object({
  question: z.string().trim().min(10).max(400),
  scope: ResearchScope.default({ comparative: false }),
});
export type StartResearch = z.infer<typeof StartResearch>;

export const ResearchStatus = z.enum([
  'planning',
  'awaiting_edit',
  'gathering',
  'writing',
  'checking',
  'ready',
  'failed',
]);

/** research.plan: 3–5 sub-questions for a quick run, each answerable from law sources. */
export const ResearchPlanReply = z.object({ subQuestions: z.array(z.string().min(5).max(300)).min(2).max(8) });

const BriefLineIn = z.object({
  text: z.string().min(1).max(500),
  kind: z.enum(['claim', 'teaching']),
  claims: z.array(Claim).max(4),
});

/** research.write: the brief, from the evidence rows (S1…S8) only, and how each row relates to the question. */
export const ResearchWriteReply = z.object({
  shortAnswer: z.array(BriefLineIn).max(3),
  keyPoints: z.array(BriefLineIn).max(8),
  conflicts: z.array(BriefLineIn).max(4),
  openQuestions: z.array(z.string().min(5).max(300)).max(5),
  notFound: z.array(z.string().min(5).max(300)).max(6),
  relations: z.array(z.object({ tag: z.string(), relation: z.enum(['supports', 'limits', 'conflicts']) })).max(8),
});

export const BriefLine = z.object({
  text: z.string(),
  kind: z.enum(['claim', 'teaching']),
  status: z.enum(['supported', 'open']),
  flag: z.enum(['yellow', 'grey']).nullable(),
  reason: z.string().nullable(),
  sources: z.array(z.object({ tag: z.string(), label: z.string() })),
});
export type BriefLine = z.infer<typeof BriefLine>;

/** One row of the evidence table (RES-3). */
export const EvidenceRow = z.object({
  tag: z.string(),
  label: z.string(),
  header: z.string(),
  /** The paragraph or section, and the exact words the brief quotes from it. */
  text: z.string(),
  spans: z.array(z.string()),
  relation: z.enum(['supports', 'limits', 'conflicts']),
  /** Law status for an Act; the expert-confirmed treatment for a case; otherwise "Status not verified". */
  statusLabel: z.string(),
  caseStatus: CaseStatus.nullable(),
  court: z.string().nullable(),
  decidedOn: z.string().nullable(),
  /** Which sub-question found it (1-based). */
  subQuestion: z.number().int(),
  provisional: z.boolean(),
});
export type EvidenceRow = z.infer<typeof EvidenceRow>;

/** The saved brief (research_runs.brief). */
export const ResearchBrief = z.object({
  shortAnswer: z.array(BriefLine),
  keyPoints: z.array(BriefLine),
  conflicts: z.array(BriefLine),
  openQuestions: z.array(z.string()),
  notFound: z.array(z.string()),
  evidence: z.array(EvidenceRow),
});
export type ResearchBrief = z.infer<typeof ResearchBrief>;

/** GET /research/:id */
export const ResearchRunView = z.object({
  id: z.uuid(),
  question: z.string(),
  scope: ResearchScope,
  status: ResearchStatus,
  subQuestions: z.array(z.object({ position: z.number().int(), text: z.string(), status: z.string() })),
  brief: ResearchBrief.nullable(),
  counts: z.object({ yellow: z.number().int(), grey: z.number().int() }),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ResearchRunView = z.infer<typeof ResearchRunView>;

/** GET /research: "My research". */
export const ResearchList = z.object({
  runs: z.array(
    z.object({
      id: z.uuid(),
      question: z.string(),
      status: ResearchStatus,
      createdAt: z.string(),
      yellow: z.number().int(),
    }),
  ),
});
export type ResearchList = z.infer<typeof ResearchList>;

/** POST /research/:id/export (RES-5). */
export const ExportBrief = z.object({ format: z.enum(['docx', 'pdf']) });
export type ExportBrief = z.infer<typeof ExportBrief>;
