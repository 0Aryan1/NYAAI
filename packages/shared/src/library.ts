import { z } from 'zod';

/** POST /library/sources (library editor or admin): load an official statute into the shared library. */
export const CreateSourceRequest = z.object({
  url: z.url({ protocol: /^https$/ }),
  type: z.enum(['act', 'constitution']),
  origin: z.enum(['india_code', 'egazette', 'admin']),
  title: z.string().trim().min(3).max(300),
  actName: z.string().trim().min(3).max(200),
  actYear: z.number().int().min(1800).max(2100).optional(),
});
export type CreateSourceRequest = z.infer<typeof CreateSourceRequest>;

export const CreateSourceResponse = z.object({ sourceId: z.uuid(), jobId: z.string() });

/** GET /library/sources/:id */
export const SourceStatus = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(['processing', 'provisional', 'live', 'needs_review', 'retired']),
  chunkCount: z.number().int(),
  fetchedAt: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof SourceStatus>;

/** Library gaps: questions the library could not answer well, for the library editor (migration 0004). */
export const GapState = z.enum(['open', 'looking', 'loaded', 'answered', 'resolved', 'wont_fill']);
export type GapState = z.infer<typeof GapState>;

export const GapAttempt = z.object({
  at: z.string(),
  provider: z.enum(['india_code', 'indian_kanoon', 'web']),
  outcome: z.enum(['loaded', 'nothing', 'ambiguous', 'repealed', 'skipped', 'failed']),
  detail: z.string(),
  sourceIds: z.array(z.uuid()).optional(),
});

export const GapLead = z.object({
  provider: z.enum(['india_code', 'indian_kanoon', 'web']),
  title: z.string(),
  url: z.url(),
  lastUpdated: z.string().nullable(),
  checked: z.boolean(),
});

export const LibraryGap = z.object({
  id: z.uuid(),
  question: z.string(),
  kind: z.enum(['act', 'case', 'topic']),
  actName: z.string().nullable(),
  actYear: z.number().int().nullable(),
  caseName: z.string().nullable(),
  asks: z.number().int(),
  teachers: z.number().int(),
  state: GapState,
  attempts: z.array(GapAttempt),
  leads: z.array(GapLead),
  loadedSourceIds: z.array(z.uuid()),
  note: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  lastLookupAt: z.string().nullable(),
});
export type LibraryGap = z.infer<typeof LibraryGap>;

/** GET /library/gaps?state=… (default: everything still waiting: open, looking, loaded). */
export const LibraryGapQuery = z.object({ state: z.union([GapState, z.literal('waiting'), z.literal('all')]).default('waiting') });
export const LibraryGapList = z.object({ gaps: z.array(LibraryGap) });

/** PATCH /library/gaps/:id: the editor closes a gap (source loaded by hand, or not something we will hold) or reopens it. */
export const UpdateGapRequest = z.object({
  state: z.enum(['open', 'resolved', 'wont_fill']),
  note: z.string().trim().max(1000).optional(),
});

/** POST /library/gaps/:id/lookup: run the trusted-source lookup again now. */
export const GapLookupResponse = z.object({ jobId: z.string() });

/** Progress stages shown on an upload or library chip (LLD §4.4 ingest.progress). */
export const IngestStage = z.enum(['queued', 'reading', 'cleaning', 'indexing', 'live', 'needs_review', 'failed']);
export type IngestStage = z.infer<typeof IngestStage>;

/* Library editor review of judgments (HLD 5.2 b, f). */
export const ParaRole = z.enum(['facts', 'arguments', 'lower_court_summary', 'discussion', 'holding', 'unknown']);
export type ParaRole = z.infer<typeof ParaRole>;

/** GET /library/judgments */
export const ReviewJudgmentList = z.object({
  judgments: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      court: z.string().nullable(),
      decidedOn: z.string().nullable(),
      status: z.enum(['processing', 'provisional', 'live', 'needs_review', 'retired']),
      rolesChecked: z.boolean(),
      paragraphs: z.number().int(),
    }),
  ),
});
export type ReviewJudgmentList = z.infer<typeof ReviewJudgmentList>;

/** GET /library/judgments/:id */
export const ReviewJudgment = z.object({
  id: z.uuid(),
  title: z.string(),
  court: z.string().nullable(),
  decidedOn: z.string().nullable(),
  url: z.string().nullable(),
  status: z.enum(['processing', 'provisional', 'live', 'needs_review', 'retired']),
  rolesChecked: z.boolean(),
  paragraphs: z.array(
    z.object({
      chunkId: z.uuid(),
      paraNo: z.string().nullable(),
      kind: z.string(),
      opinion: z.string().nullable(),
      judge: z.string().nullable(),
      role: z.string().nullable(),
      text: z.string(),
    }),
  ),
});
export type ReviewJudgment = z.infer<typeof ReviewJudgment>;

/** PATCH /library/paragraphs/:chunkId */
export const SetParagraphLabel = z.object({ role: ParaRole, opinion: z.enum(['majority', 'concurring', 'dissent', 'separate_no_majority', 'unknown']).optional() });
