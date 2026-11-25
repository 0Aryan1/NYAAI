import { z } from 'zod';
import { CaseStatus } from './library.ts';
import { Claim } from './lecture.ts';

/* ---------------------------------------------------------------------------------------------------------------
 * Explore (BRD EXP-1, EXP-2, EXP-6; HLD F4; LLD §4 /explore). Library only; answers checked like lecture lines.
 * ------------------------------------------------------------------------------------------------------------- */

/** GET /explore/concepts?q= : the expert-curated concept list, by subject. */
export const ConceptSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: z.string(),
  aliases: z.array(z.string()),
  keySections: z.number().int(),
  leadingCases: z.number().int(),
});
export const ConceptList = z.object({ concepts: z.array(ConceptSummary) });
export type ConceptList = z.infer<typeof ConceptList>;

/** GET /explore/topic/:conceptId : the topic map (EXP-1). */
export const TopicMap = z.object({
  concept: z.object({ id: z.uuid(), name: z.string(), subject: z.string(), aliases: z.array(z.string()) }),
  keySections: z.array(z.object({ chunkId: z.uuid(), sourceId: z.uuid(), act: z.string().nullable(), number: z.string().nullable(), heading: z.string(), excerpt: z.string() })),
  /** Leading cases; `confirmed` once a law expert confirmed the link (unconfirmed show a grey chip). */
  leadingCases: z.array(z.object({ sourceId: z.uuid(), title: z.string(), court: z.string().nullable(), year: z.number().int().nullable(), confirmed: z.boolean(), caseStatus: CaseStatus })),
  /** Questions her lectures on this topic could not answer from the library. */
  openQuestions: z.array(z.string()),
  /** Where the topic sits in her courses. */
  inCourses: z.array(z.object({ courseId: z.uuid(), courseName: z.string(), unitId: z.uuid(), position: z.number().int(), title: z.string(), lectureId: z.uuid().nullable() })),
});
export type TopicMap = z.infer<typeof TopicMap>;

/** POST /explore/ask (EXP-2): a follow-up question, answered from the library and checked. */
export const ExploreAsk = z.object({ question: z.string().trim().min(5).max(400), conceptId: z.uuid().optional() });
export type ExploreAsk = z.infer<typeof ExploreAsk>;

/** explore.answer: the model's reply (validated like the writer's). */
export const ExploreReply = z.object({
  lines: z.array(z.object({ text: z.string().min(1).max(400), kind: z.enum(['claim', 'teaching', 'question']), claims: z.array(Claim).max(4) })).max(10),
  notFound: z.array(z.string().max(300)).max(5),
});

export const ExploreAnswer = z.object({
  outcome: z.enum(['ok', 'thin', 'not_found']),
  lines: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['claim', 'teaching', 'question']),
      status: z.enum(['supported', 'open']),
      flag: z.enum(['yellow', 'grey']).nullable(),
      reason: z.string().nullable(),
      sources: z.array(z.object({ tag: z.string(), label: z.string() })),
    }),
  ),
  /** The sources the answer rests on, with the exact words each line uses (shown like the Studio's source panel). */
  sources: z.array(
    z.object({
      tag: z.string(),
      label: z.string(),
      header: z.string(),
      text: z.string(),
      spans: z.array(z.string()),
      provisional: z.boolean(),
      caseStatus: CaseStatus.nullable(),
    }),
  ),
  notFound: z.array(z.string()),
  /** The library could not answer well: the library team has the question. */
  libraryTold: z.boolean(),
});
export type ExploreAnswer = z.infer<typeof ExploreAnswer>;
