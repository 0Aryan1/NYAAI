import { z } from 'zod';

/** GET /suggest?q= (HOME-2): library-only suggestions, never AI. */
export const Suggestion = z.object({
  kind: z.enum(['concept', 'section', 'case', 'unit']),
  label: z.string(),
  detail: z.string().nullable(),
  /** What to put in the topic box when chosen. */
  value: z.string(),
});
export type Suggestion = z.infer<typeof Suggestion>;
export const SuggestResponse = z.object({ suggestions: z.array(Suggestion) });

/** POST /topics/resolve (HOME-9): an unclear topic gets one tap question before anything is built. */
export const ResolveRequest = z.object({ topic: z.string().trim().min(2).max(200), choice: z.uuid().optional() });
export const ResolveChoice = z.object({ conceptId: z.uuid(), name: z.string(), subject: z.string() });
export type ResolveChoice = z.infer<typeof ResolveChoice>;
export const ResolveResponse = z.object({ conceptId: z.uuid().nullable() });

/** POST /library/search (library editor, admin): check retrieval by hand. */
export const LibrarySearchRequest = z.object({
  query: z.string().trim().min(2).max(500),
  asOn: z.iso.date().optional(),
  noRerank: z.boolean().optional(),
});

/** Live events (LLD §4.4), one stream per tab. */
export const LiveEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build.step'), lectureId: z.uuid(), step: z.enum(['sources', 'planning', 'writing', 'checking', 'saving']), part: z.number().int().optional(), partsTotal: z.number().int().optional() }),
  z.object({ type: z.literal('build.outline'), lectureId: z.uuid() }),
  z.object({ type: z.literal('build.part_ready'), lectureId: z.uuid(), partIndex: z.number().int() }),
  z.object({ type: z.literal('build.done'), lectureId: z.uuid() }),
  z.object({ type: z.literal('build.failed'), lectureId: z.uuid(), errorCode: z.string() }),
  z.object({ type: z.literal('ingest.progress'), sourceId: z.uuid().optional(), uploadId: z.uuid().optional(), stage: z.string() }),
  z.object({ type: z.literal('notify'), kind: z.string(), title: z.string() }),
]);
export type LiveEvent = z.infer<typeof LiveEvent>;
