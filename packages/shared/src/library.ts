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
export const LibraryGapQuery = z.object({
  state: z.union([GapState, z.literal('waiting'), z.literal('all')]).default('waiting'),
});
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

/**
 * A case's current status as the app shows it (HLD 5.2 a, LIB-2): the latest treatment a law expert confirmed, else
 * not verified. The app never decides "good law" itself.
 */
export const CaseStatus = z.enum([
  'not_verified',
  'good_law',
  'followed',
  'distinguished',
  'doubted',
  'overruled',
  'reversed',
]);
export type CaseStatus = z.infer<typeof CaseStatus>;

/** POST /library/judgments/:id/status: the expert's finding, with what it rests on. */
export const SetCaseStatus = z
  .object({
    status: z.enum(['good_law', 'doubted', 'overruled', 'reversed']),
    /** What she checked: "Citator to Nov 2026; followed in X (2019), no adverse treatment." */
    note: z.string().trim().min(10, 'Say briefly what you checked.').max(1000),
    /** The later judgment, for doubted, overruled or reversed. */
    byCase: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.status === 'good_law' || (v.byCase?.length ?? 0) >= 5, {
    message: 'Name the later judgment.',
    path: ['byCase'],
  });
export type SetCaseStatus = z.infer<typeof SetCaseStatus>;

export const CaseStatusEntry = z.object({
  status: CaseStatus,
  note: z.string().nullable(),
  byCase: z.string().nullable(),
  confirmedBy: z.string().nullable(),
  confirmedAt: z.string(),
});

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
      /** Where the text in use came from: official report or court site, an upload, or Indian Kanoon. */
      origin: z.string(),
      scanned: z.boolean(),
      caseStatus: CaseStatus,
      /** It may be the same case as another judgment in the library: the editor is asked. */
      maybeSame: z.boolean(),
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
  origin: z.string(),
  citation: z.string().nullable(),
  scanned: z.boolean(),
  expiresAt: z.string().nullable(),
  /** Every copy held: the official report's, uploads, and how far each agrees with the text in use. */
  copies: z.array(
    z.object({
      origin: z.string(),
      url: z.string().nullable(),
      citation: z.string().nullable(),
      scanned: z.boolean(),
      agreement: z.number().nullable(),
      inUse: z.boolean(),
    }),
  ),
  caseStatus: CaseStatus,
  /** Every confirmed status, newest first. */
  statusHistory: z.array(CaseStatusEntry),
  /** A judgment already in the library this may be the same case as (same parties; the date or court differs, or is unknown). */
  maybeSameAs: z
    .object({ id: z.uuid(), title: z.string(), court: z.string().nullable(), decidedOn: z.string().nullable() })
    .nullable(),
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

/** POST /library/judgments/:id/same-case: the editor's answer to "is this the same case as …?". */
export const SameCaseAnswer = z.object({ same: z.boolean() });
export type SameCaseAnswer = z.infer<typeof SameCaseAnswer>;

/**
 * POST /library/uploads/judgment?… with the PDF as the body (application/pdf, up to 50 MB). The editor names the
 * case; `official` says the copy came from an official court website (live once read; otherwise "not yet
 * reviewed"); `replaces` swaps the text of a judgment already in the library (only if it is the same judgment).
 */
export const UploadJudgmentQuery = z
  .object({
    caseName: z.string().trim().min(5).max(300),
    court: z.string().trim().min(3).max(120),
    decidedOn: z.iso.date().optional(),
    official: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    sourceUrl: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .optional(),
    replaces: z.uuid().optional(),
  })
  .refine((q) => q.replaces || q.decidedOn, { message: 'Give the date of the judgment.', path: ['decidedOn'] });
export type UploadJudgmentQuery = z.input<typeof UploadJudgmentQuery>;
export const UploadJudgmentResponse = z.object({ jobId: z.string(), sourceId: z.uuid() });
export type UploadJudgmentResponse = z.infer<typeof UploadJudgmentResponse>;

/** GET /library/uploads/:jobId: how reading an uploaded judgment went. */
export const UploadJudgmentStatus = z.object({
  state: z.enum(['waiting', 'reading', 'done', 'failed']),
  outcome: z
    .object({
      kind: z.enum(['loaded', 'kept_existing', 'mismatch', 'duplicate']),
      sourceId: z.uuid(),
      paragraphs: z.number().int().nullable(),
      scanned: z.boolean().nullable(),
      agreement: z.number().nullable(),
      status: z.string().nullable(),
    })
    .nullable(),
  message: z.string().nullable(),
});
export type UploadJudgmentStatus = z.infer<typeof UploadJudgmentStatus>;

/** PATCH /library/paragraphs/:chunkId */
export const SetParagraphLabel = z.object({
  role: ParaRole,
  opinion: z.enum(['majority', 'concurring', 'dissent', 'separate_no_majority', 'unknown']).optional(),
});

/* ---------------------------------------------------------------------------------------------------------------
 * Wrong-fact reports (BRD ADM-2, LIB-1; HLD F12).
 * ------------------------------------------------------------------------------------------------------------- */

export const ReportOutcome = z.enum(['fixed_chunk', 'fixed_label', 'fixed_mapping', 'was_correct']);
export type ReportOutcome = z.infer<typeof ReportOutcome>;

/** POST /lectures/:id/reports: the line she thinks is wrong, and why (optional). */
export const ReportLine = z.object({
  slideId: z.uuid(),
  lineKey: z.string().min(1).max(40),
  note: z.string().trim().max(500).optional(),
});
export type ReportLine = z.infer<typeof ReportLine>;

/** GET /lectures/:id/reports: her reports on this lecture, with the library's answer. */
export const LineReport = z.object({
  id: z.uuid(),
  slideId: z.uuid().nullable(),
  lineKey: z.string().nullable(),
  status: z.enum(['open', 'in_progress', 'resolved', 'rejected']),
  outcome: ReportOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
});
export type LineReport = z.infer<typeof LineReport>;
export const LectureReports = z.object({ reports: z.array(LineReport) });

/** GET /library/reports: the editor's queue of wrong-fact reports (copies only; never the teacher's lecture). */
export const QueueReport = z.object({
  id: z.uuid(),
  lineCopy: z.string(),
  spanCopy: z.string(),
  sourceLabel: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  sourceHeader: z.string().nullable(),
  /** The judgment, when the line rests on one: the editor opens it in the review screen. */
  judgmentId: z.uuid().nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'in_progress', 'resolved', 'rejected']),
  outcome: ReportOutcome.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  dueAt: z.string().nullable(),
});
export type QueueReport = z.infer<typeof QueueReport>;
export const ReportQueue = z.object({ reports: z.array(QueueReport), open: z.number().int() });
export type ReportQueue = z.infer<typeof ReportQueue>;

/** POST /library/reports/:id/resolve */
export const ResolveReport = z.object({ outcome: ReportOutcome, note: z.string().trim().max(1000).optional() });
export type ResolveReport = z.infer<typeof ResolveReport>;
export const ResolveReportResponse = z.object({ linesFlagged: z.number().int() });

/* ---------------------------------------------------------------------------------------------------------------
 * Leading cases of each topic (concept_links, kind leading_case): the law expert confirms each link (HLD D28).
 * Only confirmed links make a case must-cover in a lecture; Explore shows unconfirmed ones with a grey chip.
 * ------------------------------------------------------------------------------------------------------------- */

export const TopicCases = z.object({
  topics: z.array(
    z.object({
      conceptId: z.uuid(),
      name: z.string(),
      subject: z.string(),
      cases: z.array(
        z.object({
          sourceId: z.uuid(),
          title: z.string(),
          court: z.string().nullable(),
          year: z.number().int().nullable(),
          confirmedAt: z.string().nullable(),
          confirmedBy: z.string().nullable(),
        }),
      ),
    }),
  ),
  /** Links not yet confirmed, across all topics. */
  unconfirmed: z.number().int(),
});
export type TopicCases = z.infer<typeof TopicCases>;

/* ---------------------------------------------------------------------------------------------------------------
 * Old ↔ new criminal law mapping (DATA-6, HLD 5.2 g, LIB-1). Many-to-many; each row has a relation, a note and its
 * official source, and is used by the checker (C5) only once a named criminal-law expert has signed it. Changing a
 * signed row removes the signature, so every row in use is one an expert saw as it is.
 * ------------------------------------------------------------------------------------------------------------- */

export const MAPPING_PAIRS = [
  { old: 'Indian Penal Code, 1860', new: 'Bharatiya Nyaya Sanhita, 2023', label: 'IPC → BNS' },
  { old: 'Code of Criminal Procedure, 1973', new: 'Bharatiya Nagarik Suraksha Sanhita, 2023', label: 'CrPC → BNSS' },
  { old: 'Indian Evidence Act, 1872', new: 'Bharatiya Sakshya Adhiniyam, 2023', label: 'Evidence Act → BSA' },
] as const;

export const MappingRelation = z.enum([
  'same',
  'renumbered',
  'merged',
  'split',
  'substantively_changed',
  'no_direct_equivalent',
]);
export type MappingRelation = z.infer<typeof MappingRelation>;

/** "s. 420", "420", "Section 53A" → "420", "53A". */
const SectionNo = z
  .string()
  .trim()
  .transform((s) => s.replace(/^(?:s|sec|section)\.?\s*/i, '').toUpperCase())
  .pipe(z.string().regex(/^\d{1,4}[A-Z]{0,3}(?:\(\d{1,3}[A-Z]?\))?$/, 'A section number, like 420 or 53A'));

export const SaveLawMapping = z
  .object({
    pair: z.enum(['IPC → BNS', 'CrPC → BNSS', 'Evidence Act → BSA']),
    relation: MappingRelation,
    oldSections: z.array(SectionNo).min(1).max(20),
    newSections: z.array(SectionNo).max(20),
    note: z.string().trim().min(3).max(1000),
    /** The official comparison table or gazette it comes from. */
    sourceUrl: z.url().max(500),
  })
  .superRefine((m, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['newSections'] });
    if (m.relation === 'no_direct_equivalent') {
      if (m.newSections.length) bad('"No direct equivalent" has no new section.');
    } else if (!m.newSections.length) bad('Add the new section, or choose "No direct equivalent".');
    if (m.relation === 'merged' && m.oldSections.length < 2)
      ctx.addIssue({ code: 'custom', message: '"Merged" needs two or more old sections.', path: ['oldSections'] });
    if (m.relation === 'split' && m.newSections.length < 2) bad('"Split" needs two or more new sections.');
    if (
      (m.relation === 'same' || m.relation === 'renumbered') &&
      (m.oldSections.length > 1 || m.newSections.length > 1)
    )
      bad('"Same" and "Renumbered" link one section to one section; use Merged or Split.');
  });
export type SaveLawMapping = z.infer<typeof SaveLawMapping>;

export const LawMapping = z.object({
  id: z.uuid(),
  pair: z.string(),
  oldAct: z.string(),
  newAct: z.string(),
  relation: MappingRelation,
  oldSections: z.array(z.string()),
  newSections: z.array(z.string()),
  note: z.string(),
  sourceUrl: z.string(),
  signedBy: z.string().nullable(),
  signedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type LawMapping = z.infer<typeof LawMapping>;
export const LawMappingList = z.object({ mappings: z.array(LawMapping), unsigned: z.number().int() });
export type LawMappingList = z.infer<typeof LawMappingList>;
