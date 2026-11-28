import { z } from 'zod';

/* ---------------------------------------------------------------------------------------------------------------
 * Courses and the series (BRD COURSE-1 to COURSE-7, HLD F8, LLD §4: /courses).
 * ------------------------------------------------------------------------------------------------------------- */

/** learn.summary (Haiku): course memory from a taught lecture's slides. Cases are taken from its citations, not here. */
export const LearnSummary = z.object({
  /** What the class was taught, in 2–4 plain sentences. */
  summary: z.string().min(1).max(700),
  /** Terms the lecture taught or defined, as written on the slides. */
  terms: z.array(z.string().min(2).max(80)).max(15),
  /** The example the teacher kept coming back to, or null. */
  runningExample: z.string().max(300).nullable(),
  /** Things the slides say will come in a later class. */
  openThreads: z.array(z.string().min(3).max(200)).max(5),
});
export type LearnSummary = z.infer<typeof LearnSummary>;

const Title = z.string().trim().min(2).max(200);

/** POST /courses (COURSE-1, COURSE-2: a pasted list of topics, or empty). */
export const CreateCourse = z.object({
  name: z.string().trim().min(2).max(120),
  semester: z.string().trim().max(40).optional(),
  classCount: z.number().int().min(1).max(80).optional(),
  topics: z.array(Title).max(80).default([]),
  /** DATA-3: find sources for every lecture in the background (a course planned from her syllabus). */
  findSources: z.boolean().default(false),
});
export type CreateCourse = z.infer<typeof CreateCourse>;

/** POST /courses/syllabus (COURSE-2): her syllabus read into units and topics. Nothing is saved; she edits, then creates. */
export const SyllabusPreview = z.object({
  courseName: z.string().nullable(),
  units: z.array(z.object({ title: z.string(), topics: z.array(z.string()) })),
  /** The two ways to plan it, and the likelier one. */
  perUnit: z.array(z.string()),
  perTopic: z.array(z.string()),
  suggested: z.enum(['unit', 'topic']),
});
export type SyllabusPreview = z.infer<typeof SyllabusPreview>;

/** What the background check found for one planned lecture (DATA-3). */
export const UnitSources = z.object({
  state: z.enum(['waiting', 'ok', 'thin', 'not_found', 'not_checked']),
  found: z.number().int().nullable(),
  loaded: z.number().int().nullable(),
  checkedAt: z.string().nullable(),
});
export type UnitSources = z.infer<typeof UnitSources>;

/** PATCH /courses/:id */
export const UpdateCourse = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  semester: z.string().trim().max(40).nullable().optional(),
  classCount: z.number().int().min(1).max(80).nullable().optional(),
});
export type UpdateCourse = z.infer<typeof UpdateCourse>;

/**
 * PATCH /courses/:id/units (COURSE-3): add, rename, delete, reorder, prerequisites, skip. Applied in one transaction,
 * in that order. A taught lecture cannot be deleted (its memory feeds later lectures); it can be moved.
 */
export const UpdateUnits = z.object({
  add: z
    .array(z.object({ title: Title }))
    .max(40)
    .optional(),
  rename: z
    .array(z.object({ id: z.uuid(), title: Title }))
    .max(80)
    .optional(),
  remove: z.array(z.uuid()).max(80).optional(),
  /** Every remaining unit id, in the new order (added units go last unless listed by the next call). */
  order: z.array(z.uuid()).max(120).optional(),
  prerequisites: z
    .array(z.object({ id: z.uuid(), prerequisites: z.array(z.uuid()).max(20) }))
    .max(80)
    .optional(),
  status: z
    .array(z.object({ id: z.uuid(), status: z.enum(['planned', 'skipped']) }))
    .max(80)
    .optional(),
});
export type UpdateUnits = z.infer<typeof UpdateUnits>;

export const SeriesCheck = z.object({
  kind: z.enum(['repeated_case', 'untaught_prerequisite', 'out_of_order', 'too_many_lectures']),
  unitId: z.uuid().nullable(),
  message: z.string(),
});
export type SeriesCheck = z.infer<typeof SeriesCheck>;
/** GET /courses/:id/series-checks (COURSE-6): suggestions only. */
export const SeriesChecks = z.object({ checks: z.array(SeriesCheck) });

export const CourseUnitView = z.object({
  id: z.uuid(),
  position: z.number().int(),
  title: z.string(),
  status: z.enum(['planned', 'taught', 'skipped']),
  taughtOn: z.string().nullable(),
  prerequisites: z.array(z.uuid()),
  /** The unit's latest lecture. */
  lecture: z
    .object({ id: z.uuid(), status: z.string(), topic: z.string(), mayNeedUpdate: z.boolean().default(false) })
    .nullable(),
  /** Sources found for it in the background (DATA-3); null when never checked. */
  sources: UnitSources.nullable(),
  /** What the class learnt, once taught (COURSE-4). */
  memory: z
    .object({
      summary: z.string().nullable(),
      terms: z.array(z.string()),
      cases: z.array(z.string()),
      runningExample: z.string().nullable(),
      openThreads: z.array(z.string()),
    })
    .nullable(),
});
export type CourseUnitView = z.infer<typeof CourseUnitView>;

/** GET /courses/:id */
export const CourseDetail = z.object({
  id: z.uuid(),
  name: z.string(),
  semester: z.string().nullable(),
  classCount: z.number().int().nullable(),
  units: z.array(CourseUnitView),
  checks: z.array(SeriesCheck),
});
export type CourseDetail = z.infer<typeof CourseDetail>;

/** GET /courses */
export const CourseList = z.object({
  courses: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      semester: z.string().nullable(),
      classCount: z.number().int().nullable(),
      lectures: z.number().int(),
      taught: z.number().int(),
    }),
  ),
});
export type CourseList = z.infer<typeof CourseList>;

/** POST /lectures/:id/taught (COURSE-7). */
export const MarkTaught = z.object({ taughtOn: z.iso.date() });
export const MarkTaughtResponse = z.object({ unitId: z.uuid().nullable(), memoryJob: z.string().nullable() });

/** A lecture's number as the course plan shows it: L01, L12. */
export const lectureNo = (position: number): string => `L${String(position).padStart(2, '0')}`;
