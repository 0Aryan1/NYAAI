import { z } from 'zod';

/**
 * Small response shapes shared by several endpoints (LLD §4): every response the API sends is parsed against a
 * shared schema, so the web app and the server can never disagree on its shape.
 */

/** 201: a new resource was made; its id. */
export const Created = z.object({ id: z.uuid() });
export type Created = z.infer<typeof Created>;

/** 202: the work was queued; the job's id (to follow its progress). */
export const JobAccepted = z.object({ jobId: z.string() });
export type JobAccepted = z.infer<typeof JobAccepted>;

/** Lists that grow are paged (`?cursor=&limit=`): the next page's cursor, or null on the last page. */
export const NextCursor = z.string().nullable().default(null);
