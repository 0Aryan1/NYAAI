import { z } from 'zod';
import { LENGTH_CHOICES } from './home.ts';

/* ---------------------------------------------------------------------------------------------------------------
 * AI outputs (LLD §8.1, §9). Forced as JSON schema by the gateway and validated again here.
 * ------------------------------------------------------------------------------------------------------------- */

export const ClaimType = z.enum(['rule', 'holding', 'date', 'punishment', 'time_limit', 'mapping', 'quote', 'fact', 'example', 'news_report']);
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
export const SlideLayout = z.enum(['title', 'bullets', 'two_column', 'case_box', 'quote', 'question', 'example', 'recap', 'bridge']);

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
  verdicts: z.array(z.object({ id: z.string(), reason: z.string().max(400), verdict: SupportVerdict, correctedClaim: z.string().max(400).nullable() })),
});
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
  filters: z.object({ jurisdiction: z.string().default('IN'), asOn: z.iso.date().optional(), comparative: z.boolean().default(false) }).default({ jurisdiction: 'IN', comparative: false }),
  ambiguityChoice: z.uuid().optional(),
  /** HOME-10: she saw that earlier lectures this one builds on are not taught yet, and goes ahead. */
  prereqAck: z.boolean().optional(),
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
  partsDone: z.array(z.number().int()),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  readyAt: z.string().nullable(),
  taughtOn: z.string().nullable(),
  /** The course and the lecture's place in its plan (null for a one-off). */
  course: z.object({ id: z.uuid(), name: z.string(), unitId: z.uuid().nullable(), position: z.number().int().nullable() }).nullable(),
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
  sources: z.array(z.object({ tag: z.string(), citationId: z.uuid(), label: z.string(), provisional: z.boolean(), caseStatus: z.string().nullable() })),
  risk: z.enum(['normal', 'high']),
});
export type SlideLine = z.infer<typeof SlideLine>;

export const StudioSlide = z.object({
  id: z.uuid(),
  position: z.number().int(),
  partIndex: z.number().int(),
  layout: z.string(),
  title: z.string(),
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
  checks: z.array(z.object({ name: z.string(), result: z.enum(['pass', 'fail', 'grey', 'skipped']), detail: z.string().nullable() })),
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
});
export const CoverageResponse = z.object({
  score: z.number().nullable(),
  groups: z.array(z.object({ sectionKey: z.string(), title: z.string(), missing: z.number().int(), total: z.number().int(), items: z.array(CoverageItem) })),
  leftOut: z.array(CoverageItem),
  notFound: z.array(z.object({ partIndex: z.number().int(), question: z.string() })),
});
export type CoverageResponse = z.infer<typeof CoverageResponse>;

/**
 * One reply format for writer.part and writer.repair. The output schema is part of the cached prefix, so the two
 * calls must send the same one for a repair to read the part's sources from the cache (LLD §17.1). Each call fills
 * its own half; the refinements (not part of the JSON schema) make the gateway retry a reply that filled the wrong one.
 */
export const WriterReply = z.object({ written: WrittenPart.nullable(), repairs: Repairs.shape.repairs.nullable() });
export const WriterReplyWrite = WriterReply.refine((r) => r.written !== null, 'written is required');
export const WriterReplyRepair = WriterReply.refine((r) => r.repairs !== null, 'repairs is required');
