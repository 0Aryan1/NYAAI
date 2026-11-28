/**
 * The library editor's work on the shared library (LIB-1, F2): adding a source to load, judgment PDF uploads, and the
 * gaps (questions the library could not answer). Loading itself runs in the worker as nyaai_library; these functions
 * record what to load and keep the review queue in step. Runs as the editor (RLS).
 */
import type pg from 'pg';
import {
  LibraryGap,
  type CreateSourceRequest,
  type LibraryGapList,
  type LibraryGapQuery,
  type SourceStatus,
  type UpdateGapRequest,
  type ParsedUploadJudgmentQuery,
} from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { reopenQueueItem, resolveQueueItem } from '../review/index.ts';
import { pageOf, pageSql, type Page } from '../../lib/page.ts';

interface GapRow {
  id: string;
  question: string;
  kind: LibraryGap['kind'];
  act_name: string | null;
  act_year: number | null;
  case_name: string | null;
  asks: number;
  teachers: number;
  state: LibraryGap['state'];
  attempts: LibraryGap['attempts'];
  leads: LibraryGap['leads'];
  loaded_source_ids: string[];
  note: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_lookup_at: Date | null;
}

const GAP_COLUMNS = `id, question, kind, act_name, act_year, case_name, asks, teachers, state, attempts, leads, loaded_source_ids, note,
  first_seen_at, last_seen_at, last_lookup_at`;

const toGap = (r: GapRow): LibraryGap =>
  LibraryGap.parse({
    id: r.id,
    question: r.question,
    kind: r.kind,
    actName: r.act_name,
    actYear: r.act_year,
    caseName: r.case_name,
    asks: r.asks,
    teachers: r.teachers,
    state: r.state,
    attempts: r.attempts,
    leads: r.leads,
    loadedSourceIds: r.loaded_source_ids,
    note: r.note,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    lastLookupAt: r.last_lookup_at?.toISOString() ?? null,
  });

/** A statute or source to load: saved as pending; the worker fetches and reads it (ingest.source). */
export async function createSource(c: pg.PoolClient, body: CreateSourceRequest): Promise<string> {
  return (
    await c.query<{ id: string }>(
      `insert into sources (college_id, visibility, type, origin, title, act_name, act_year, url, content_hash)
       values (global_college(), 'shared', $1, $2, $3, $4, $5, $6, 'pending:' || gen_random_uuid())
       returning id`,
      [body.type, body.origin, body.title, body.actName, body.actYear ?? null, body.url],
    )
  ).rows[0]!.id;
}

/** Undoes createSource when its job could not be queued. */
export async function deletePendingSource(c: pg.PoolClient, id: string): Promise<void> {
  await c.query("delete from sources where id = $1 and content_hash like 'pending:%'", [id]);
}

export async function sourceStatus(c: pg.PoolClient, id: string): Promise<SourceStatus | null> {
  const row = (
    await c.query<{
      id: string;
      title: string;
      status: SourceStatus['status'];
      fetched_at: Date | null;
      chunk_count: number;
    }>(
      `select s.id, s.title, s.status, s.fetched_at, (select count(*)::int from chunks k where k.source_id = s.id) as chunk_count
         from sources s where s.id = $1`,
      [id],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    chunkCount: row.chunk_count,
    fetchedAt: row.fetched_at?.toISOString() ?? null,
  };
}

/** Most teachers first, then most asked, then most recent. Row security limits rows to her college and GLOBAL. */
export async function listGaps(c: pg.PoolClient, state: LibraryGapQuery['state'], page: Page): Promise<LibraryGapList> {
  const tail = pageSql(page, 2);
  const states = state === 'waiting' ? ['open', 'looking', 'loaded'] : state === 'all' ? null : [state];
  const rows = (
    await c.query<GapRow>(
      `select ${GAP_COLUMNS} from library_gaps where ($1::gap_state[] is null or state = any($1))
        order by teachers desc, asks desc, last_seen_at desc, id${tail.sql}`,
      [states, ...tail.params],
    )
  ).rows;
  const { rows: shown, nextCursor } = pageOf(rows, page);
  return { gaps: shown.map(toGap), nextCursor };
}

/** Close (loaded by hand / not something we hold) or reopen a gap, keeping the review queue in step. */
export async function updateGap(c: pg.PoolClient, id: string, body: UpdateGapRequest): Promise<LibraryGap> {
  const closing = body.state !== 'open';
  const updated = (
    await c.query<GapRow>(
      `update library_gaps
          set state = $2, note = coalesce($3, note),
              resolved_by = case when $4 then app_user() end, resolved_at = case when $4 then now() end
        where id = $1 returning ${GAP_COLUMNS}`,
      [id, body.state, body.note ?? null, closing],
    )
  ).rows[0];
  if (!updated) throw new AppError('NOT_FOUND', 'We could not find that gap.');
  // For an admin (who does not work the queue) these change no rows.
  if (closing) await resolveQueueItem(c, id, 'library_gap', { gapState: body.state, note: body.note ?? null }, false);
  else await reopenQueueItem(c, id, 'library_gap');
  return toGap(updated);
}

/** A lookup may run on a gap that exists and is not closed. */
export async function assertGapOpen(c: pg.PoolClient, id: string): Promise<void> {
  const state = (await c.query<{ state: string }>('select state from library_gaps where id = $1', [id])).rows[0]?.state;
  if (!state) throw new AppError('NOT_FOUND', 'We could not find that gap.');
  if (state === 'resolved' || state === 'wont_fill')
    throw new AppError('GAP_CLOSED', 'This gap is closed. Reopen it first.');
}

/**
 * A judgment PDF she uploads: the same file twice is refused; a "replaces" upload targets the judgment it improves
 * (the worker checks it is the same judgment); otherwise a new judgment is saved as "processing". Returns its id.
 */
export async function registerJudgmentUpload(
  c: pg.PoolClient,
  q: ParsedUploadJudgmentQuery,
  file: { hash: string; key: string; origin: 'court_site' | 'upload' },
): Promise<string> {
  const same = (
    await c.query<{ id: string; title: string }>(
      "select id, title from sources where content_hash = $1 and type = 'judgment' and status <> 'retired'",
      [file.hash],
    )
  ).rows[0];
  if (same)
    throw new AppError(
      'ALREADY_IN_LIBRARY',
      `This file is already in the library as ${same.title.replace(/\.$/, '')}.`,
      {
        sourceId: same.id,
      },
    );
  if (q.replaces) {
    const target = (
      await c.query<{ id: string }>(
        "select id from sources where id = $1 and type = 'judgment' and visibility = 'shared' and status <> 'retired'",
        [q.replaces],
      )
    ).rows[0];
    if (!target) throw new AppError('NOT_FOUND', 'We could not find the judgment this file should replace.');
    return target.id;
  }
  return (
    await c.query<{ id: string }>(
      `insert into sources (college_id, visibility, type, origin, title, court, decided_on, url, storage_key, content_hash, status)
       values (global_college(), 'shared', 'judgment', $1, $2, $3, $4, $5, $6, $7, 'processing') returning id`,
      [file.origin, q.caseName, q.court, q.decidedOn ?? null, q.sourceUrl ?? null, file.key, file.hash],
    )
  ).rows[0]!.id;
}

/** Undoes a new judgment upload whose reading could not be started. */
export async function deleteProcessingSource(c: pg.PoolClient, id: string): Promise<void> {
  await c.query("delete from sources where id = $1 and status = 'processing'", [id]);
}
