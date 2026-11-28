/**
 * Cursor pagination for lists that grow (judgments, gaps, reports, research runs, notes): `?cursor=&limit=` in, and a
 * `nextCursor` out (null on the last page). The cursor is opaque to callers; today it carries an offset, so the
 * order of each list must be stable (each list sorts by a fixed key and its id).
 */
import { z } from 'zod';
import { AppError } from '../errors.ts';

export interface Page {
  limit: number;
  offset: number;
}

const encode = (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString('base64url');

function decode(cursor: string): number {
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown }).o;
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    /* fall through to the error below */
  }
  throw new AppError('VALIDATION_FAILED', 'That page link is not valid. Reload the list.');
}

/** Reads `cursor` and `limit` from a query string. */
export function pageFrom(query: unknown, limits: { default: number; max: number }): Page {
  const q = z
    .object({
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().int().min(1).max(limits.max).optional(),
    })
    .catch({})
    .parse(query);
  return { limit: q.limit ?? limits.default, offset: q.cursor ? decode(q.cursor) : 0 };
}

/**
 * The SQL tail for one page: one row more than asked, to know whether a next page exists. `n` is the first free
 * parameter number; use the rows with `pageOf`.
 */
export function pageSql(page: Page, n: number): { sql: string; params: number[] } {
  return { sql: ` limit $${n} offset $${n + 1}`, params: [page.limit + 1, page.offset] };
}

/** The rows of this page, and the cursor of the next one (null when this is the last). */
export function pageOf<T>(rows: T[], page: Page): { rows: T[]; nextCursor: string | null } {
  return {
    rows: rows.slice(0, page.limit),
    nextCursor: rows.length > page.limit ? encode(page.offset + page.limit) : null,
  };
}
