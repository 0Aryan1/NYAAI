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

/** Progress stages shown on an upload or library chip (LLD §4.4 ingest.progress). */
export const IngestStage = z.enum(['queued', 'reading', 'cleaning', 'indexing', 'live', 'needs_review', 'failed']);
export type IngestStage = z.infer<typeof IngestStage>;
