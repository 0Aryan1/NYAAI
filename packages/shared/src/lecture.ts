import { z } from 'zod';
import { LENGTH_CHOICES } from './home.ts';

/* ---------------------------------------------------------------------------------------------------------------
 * AI outputs (LLD §8.1, §9). Forced as JSON schema by the gateway and validated again here.
 * ------------------------------------------------------------------------------------------------------------- */

export const ClaimType = z.enum([
  'rule',
  'holding',
  'date',
  'punishment',
  'time_limit',
  'mapping',
  'quote',
  'fact',
  'example',
  'news_report',
]);
export type ClaimType = z.infer<typeof ClaimType>;

export const Claim = z.object({
  /** The claim as it reads on the slide. */
  text: z.string().min(1).max(600),
  type: ClaimType,
  /** Which supplied source. */
  tag: z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']),
  /** Words copied exactly from that source, no ellipsis. */
  span: z.string().min(8).max(600),
});
export type Claim = z.infer<typeof Claim>;

export const LineKind = z.enum(['claim', 'teaching', 'example', 'question', 'transition']);
export const SlideLayout = z.enum([
  'title',
  'bullets',
  'two_column',
  'case_box',
  'quote',
  'question',
  'example',
  'recap',
  'bridge',
]);

export const WrittenLine = z.object({
  lineKey: z.string().max(40),
  // The writer is asked for <= 220 characters (a slide line); a longer line is kept, not failed.
  text: z.string().min(1).max(400),
  kind: LineKind,
  /** Empty only for teaching, question and transition lines. */
  claims: z.array(Claim).max(4),
});
export type WrittenLine = z.infer<typeof WrittenLine>;

export const WrittenPart = z.object({
  partIndex: z.number().int(),
  slides: z
    .array(
      z.object({
        layout: SlideLayout,
        title: z.string().min(1).max(90),
        lines: z.array(WrittenLine).max(7),
        notes: z.array(z.object({ text: z.string().min(1).max(1200), claims: z.array(Claim).max(4) })).max(6),
      }),
    )
    .min(1)
    .max(8),
  /** Questions the sources could not answer. */
  notFound: z.array(z.string().max(300)).max(10),
  /** Shown to the teacher, never cleared automatically. */
  leftOut: z.array(z.object({ item: z.string().max(300), reason: z.string().max(300) })).max(10),
});
export type WrittenPart = z.infer<typeof WrittenPart>;

export const PlanPart = z.object({
  title: z.string().min(1).max(90),
  minutes: z.number().int().min(2).max(60),
  kind: z.enum(['recap', 'content', 'example', 'bridge']),
  /** 2–4 questions this part must answer, in plain words, with no answers. */
  questions: z.array(z.string().min(3).max(240)).min(1).max(4),
  /** This part carries the teacher's must-include example. */
  mustInclude: z.boolean(),
});
export const LecturePlan = z.object({
  parts: z.array(PlanPart).min(1).max(8),
  leftOut: z.array(z.object({ item: z.string().max(300), reason: z.string().max(300) })).max(10),
});
export type LecturePlan = z.infer<typeof LecturePlan>;

export const SupportVerdict = z.enum(['yes', 'partly', 'no']);
export const SupportVerdicts = z.object({
  // reason before verdict: the reply is written in schema order, so the verdict follows the reasoning.
  verdicts: z.array(z.object({ id: z.string(), reason: z.string().max(400), verdict: SupportVerdict })),
});
export const SecondVerdicts = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      reason: z.string().max(400),
      verdict: SupportVerdict,
      correctedClaim: z.string().max(400).nullable(),
    }),
  ),
});
/**
 * research.gaps: what the research for a lecture still misses, as library search questions (at most 5; empty when
 * the research is enough). The reason comes first so the question follows from it.
 */
export const GapQuestions = z.object({
  questions: z
    .array(
      z.object({
        why: z.string().max(300),
        part: z.number().int().min(1).max(8),
        question: z.string().min(5).max(300),
      }),
    )
    .max(5),
});
export type GapQuestions = z.infer<typeof GapQuestions>;
/** checker.unsourced: does a line with no source state law? */
export const UnsourcedVerdicts = z.object({
  verdicts: z.array(z.object({ id: z.string(), reason: z.string().max(400), statesLaw: z.boolean() })),
});
export const Repairs = z.object({
  repairs: z.array(
    z.object({
      id: z.string(),
      action: z.enum(['replace', 'drop']),
      /** The new line text and its claims, when replaced. */
      lineText: z.string().max(400).nullable(),
      claims: z.array(Claim).max(4),
    }),
  ),
});

/* ---------------------------------------------------------------------------------------------------------------
 * API (LLD §4.3)
 * ------------------------------------------------------------------------------------------------------------- */

/** POST /lectures — Prepare (HOME-6: every field required; the course may be a one-off). */
export const PrepareLecture = z.object({
  topic: z.string().trim().min(3).max(200),
  course: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('course'), courseId: z.uuid(), unitId: z.uuid().optional() }),
    z.object({ kind: z.literal('one_off') }),
  ]),
  lengthMin: z.literal(LENGTH_CHOICES),
  level: z.enum(['intro', 'standard', 'advanced']),
  styleKey: z.enum(['usual', 'exam', 'discussion']),
  mustInclude: z.object({ text: z.string().trim().max(1000).optional(), exampleId: z.uuid().optional() }).optional(),
  anythingSpecial: z.string().trim().max(500).optional(),
  filters: z
    .object({
      jurisdiction: z.string().default('IN'),
      asOn: z.iso.date().optional(),
      comparative: z.boolean().default(false),
    })
    .default({ jurisdiction: 'IN', comparative: false }),
  ambiguityChoice: z.uuid().optional(),
  /** HOME-10: she saw that earlier lectures this one builds on are not taught yet, and goes ahead. */
  prereqAck: z.boolean().optional(),
  /** Her own notes for this lecture (upload ids). Only these are used; her other notes are not (decision 2026-11-25). */
  notes: z.array(z.uuid()).max(5).default([]),
});
export type PrepareLecture = z.infer<typeof PrepareLecture>;
export const PrepareResponse = z.object({ lectureId: z.uuid(), jobId: z.string() });

export const LectureStatus = z.enum(['draft', 'building', 'ready', 'taught', 'failed']);

/** GET /lectures/:id */
export const LectureSummary = z.object({
  id: z.uuid(),
  topic: z.string(),
  status: LectureStatus,
  lengthMin: z.number().int(),
  level: z.string(),
  plan: LecturePlan.nullable(),
  counts: z.object({ yellow: z.number().int(), grey: z.number().int(), coverage: z.number().int() }),
  coverageScore: z.number().nullable(),
  /** "X of Y covered": items covered, and items counted (all but those she left out on purpose). Null before coverage runs. */
  coverageCounts: z.object({ covered: z.number().int(), counted: z.number().int() }).nullable(),
  partsDone: z.array(z.number().int()),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  taughtOn: z.string().nullable(),
  /** HLD F8.6: an earlier taught lecture of the course was changed after this one was prepared. */
  mayNeedUpdate: z
    .object({ since: z.string(), from: z.array(z.object({ lectureId: z.uuid(), label: z.string() })) })
    .nullable(),
  /** The course and the lecture's place in its plan (null for a one-off). */
  course: z
    .object({ id: z.uuid(), name: z.string(), unitId: z.uuid().nullable(), position: z.number().int().nullable() })
    .nullable(),
});
export type LectureSummary = z.infer<typeof LectureSummary>;

export const LineStatus = z.enum(['supported', 'your_example', 'verified_by_you', 'open', 'removed']);

/** One slide line as the Studio receives it (LLD §4.3). */
export const SlideLine = z.object({
  lineKey: z.string(),
  text: z.string(),
  kind: LineKind,
  status: LineStatus,
  flag: z.enum(['yellow', 'grey', 'coverage']).nullable(),
  flagReason: z.string().nullable(),
  /** e.g. { tag: 'S3', label: 's. 56 ICA' } */
  sources: z.array(
    z.object({
      tag: z.string(),
      citationId: z.uuid(),
      label: z.string(),
      provisional: z.boolean(),
      caseStatus: z.string().nullable(),
    }),
  ),
  risk: z.enum(['normal', 'high']),
  /** She changed or added this line in the Studio ("edited by you"). */
  edited: z.boolean().default(false),
});
export type SlideLine = z.infer<typeof SlideLine>;

export const StudioSlide = z.object({
  id: z.uuid(),
  position: z.number().int(),
  partIndex: z.number().int(),
  layout: z.string(),
  title: z.string(),
  /** For If-Match on saves (LLD §4: a stale version gets 409 with the newer copy). */
  version: z.number().int().default(1),
  lines: z.array(SlideLine),
  notes: z.array(SlideLine),
});
export type StudioSlide = z.infer<typeof StudioSlide>;

/** GET /lectures/:id/slides */
export const StudioSlides = z.object({ slides: z.array(StudioSlide) });

/** GET /citations/:id/source — the stored span, plus the paragraph when it is still held (Kanoon text may expire). */
export const CitationSource = z.object({
  citationId: z.uuid(),
  claim: z.string(),
  span: z.string(),
  label: z.string(),
  title: z.string().nullable(),
  header: z.string().nullable(),
  /** The paragraph or section text, or null when it has expired. */
  text: z.string().nullable(),
  url: z.string().nullable(),
  provisional: z.boolean(),
  caseStatus: z.string().nullable(),
  checks: z.array(
    z.object({ name: z.string(), result: z.enum(['pass', 'fail', 'grey', 'skipped']), detail: z.string().nullable() }),
  ),
  /** Why this source was chosen: its relevance to the question (0–1) and the plain-words authority reasons. */
  whyChosen: z.object({ relevance: z.number().nullable(), reasons: z.array(z.string()) }).nullable(),
});
export type CitationSource = z.infer<typeof CitationSource>;

/** GET /lectures/:id/coverage */
export const CoverageItem = z.object({
  id: z.uuid(),
  sectionKey: z.string(),
  kind: z.enum(['proviso', 'exception', 'explanation', 'illustration', 'clause', 'leading_case', 'left_out']),
  label: z.string(),
  state: z.enum(['covered', 'missing', 'left_out_by_teacher']),
  reason: z.string().nullable(),
  /** The Act's own words for a missing proviso, exception, explanation or clause, so she sees exactly what is left out. */
  text: z.string().nullable(),
  /** "Add this for me" can put its words on a slide (a missing statute part with its own words; not a leading case). */
  canAdd: z.boolean().default(false),
});
export const CoverageResponse = z.object({
  score: z.number().nullable(),
  /** Items covered, and items counted (left-out-by-her excluded), so the panel says "3 of 5 covered", not a bare %. */
  covered: z.number().int(),
  counted: z.number().int(),
  groups: z.array(
    z.object({
      sectionKey: z.string(),
      title: z.string(),
      missing: z.number().int(),
      total: z.number().int(),
      items: z.array(CoverageItem),
    }),
  ),
  leftOut: z.array(CoverageItem),
  notFound: z.array(z.object({ partIndex: z.number().int(), question: z.string() })),
});
export type CoverageResponse = z.infer<typeof CoverageResponse>;

/** POST /coverage/:id/add: the Act's own words for a missing item, put on the slide that teaches its section. */
export const CoverageAdded = z.object({ slideId: z.uuid(), lineKey: z.string() });
export type CoverageAdded = z.infer<typeof CoverageAdded>;

/** `details.items` of a 409 COVERAGE_CHANGED: items that removing the unverified lines left uncovered. */
export const CoverageChangedItem = z.object({
  id: z.uuid(),
  label: z.string(),
  sectionKey: z.string(),
  canAdd: z.boolean(),
});
export type CoverageChangedItem = z.infer<typeof CoverageChangedItem>;

/**
 * One reply format for writer.part and writer.repair. The output schema is part of the cached prefix, so the two
 * calls must send the same one for a repair to read the part's sources from the cache (LLD §17.1). Each call fills
 * its own half; the refinements (not part of the JSON schema) make the gateway retry a reply that filled the wrong one.
 */
export const WriterReply = z.object({ written: WrittenPart.nullable(), repairs: Repairs.shape.repairs.nullable() });
export const WriterReplyWrite = WriterReply.refine((r) => r.written !== null, 'written is required');
export const WriterReplyRepair = WriterReply.refine((r) => r.repairs !== null, 'repairs is required');

/* ---------------------------------------------------------------------------------------------------------------
 * Studio editing (F7; STUDIO-2, -4, -6, -7; LLD §8.6). Saves send the slide's version (If-Match).
 * ------------------------------------------------------------------------------------------------------------- */

export const EditLine = z.object({
  /** null for a line she added. */
  lineKey: z.string().max(40).nullable(),
  text: z.string().trim().min(1).max(600),
  kind: LineKind,
  yourExample: z.boolean().optional(),
});
export type EditLine = z.infer<typeof EditLine>;

/** PATCH /slides/:id: the slide as she left it, lines in order. */
export const EditSlide = z.object({
  version: z.number().int(),
  title: z.string().trim().min(1).max(120),
  lines: z.array(EditLine).max(12),
  notes: z.array(EditLine).max(10),
});
export type EditSlide = z.infer<typeof EditSlide>;

/** Every write to a slide answers with the slide as the Studio shows it, and how many lines are being checked. */
export const SlideWriteResponse = z.object({ slide: StudioSlide, checking: z.number().int() });
export type SlideWriteResponse = z.infer<typeof SlideWriteResponse>;

/** POST /slides/:id/verify: she has checked this line herself (STUDIO-4). */
export const VerifyLine = z.object({ lineKey: z.string().max(40) });

/** POST /slides/:id/examples: her own example on this slide (STUDIO-6); optionally kept in her example bank. */
export const AddExample = z.object({ text: z.string().trim().min(3).max(600), save: z.boolean().default(false) });

/** POST /slides/:id/restore (STUDIO-7). */
export const RestoreSlide = z.object({ version: z.number().int().min(1) });

/** GET /slides/:id/versions */
export const SlideVersions = z.object({
  versions: z.array(z.object({ version: z.number().int(), reason: z.string(), createdAt: z.string() })),
});

/**
 * POST /lectures/:id/download (PPT-1 to PPT-4). With open points she must say she has seen them; or she removes every
 * unverified line first (saved as a new version of each slide).
 */
export const DownloadRequest = z.object({
  mode: z.enum(['with_flags', 'remove_unverified']),
  acknowledgeOpen: z.boolean().default(false),
});
export type DownloadRequest = z.infer<typeof DownloadRequest>;
