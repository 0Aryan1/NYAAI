/**
 * A teacher's own notes (migration 0013, BRD DATA-5). Every row is hers alone (row security on uploads, sources and
 * chunks). The file is kept in her private storage space; the worker reads it as her (`ingest.upload`). A lecture
 * uses only the notes she attaches to it. Runs in her transaction (RLS).
 */
import type pg from 'pg';
import type { TeacherNote, TeacherNoteList } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { pageOf, pageSql, type Page } from '../../lib/page.ts';

interface Row {
  id: string;
  title: string | null;
  file_name: string;
  status: TeacherNote['status'];
  sections: number | null;
  error: string | null;
  created_at: Date;
  replaces_id: string | null;
  replaces_title: string | null;
}

const SELECT = `select u.id, u.title, u.file_name, u.status, u.sections, u.error, u.created_at,
                       o.id as replaces_id, coalesce(o.title, o.file_name) as replaces_title
                  from uploads u left join uploads o on o.id = u.replaces`;

const toNote = (x: Row): TeacherNote => ({
  id: x.id,
  title: x.title ?? x.file_name,
  fileName: x.file_name,
  status: x.status,
  sections: x.sections,
  error: x.error,
  uploadedAt: x.created_at.toISOString(),
  replaces: x.replaces_id ? { id: x.replaces_id, title: x.replaces_title! } : null,
});

/** Her documents, newest first (not deleted, not replaced). */
export async function listNotes(c: pg.PoolClient, page: Page): Promise<TeacherNoteList> {
  const tail = pageSql(page, 1);
  const rows = (
    await c.query<Row>(
      `${SELECT} where u.status not in ('deleted', 'replaced') order by u.created_at desc, u.id${tail.sql}`,
      tail.params,
    )
  ).rows;
  const { rows: shown, nextCursor } = pageOf(rows, page);
  return { notes: shown.map(toNote), nextCursor };
}

/** Her private space: the storage key names her college and her, never shared with the library. */
export const noteStorageKey = (who: { collegeId: string; userId: string }, id: string, kind: string): string =>
  `private/${who.collegeId}/${who.userId}/${id}.${kind}`;

/** Records an uploaded file (already stored at `key`) as "queued" for the worker. A replacement must name a live note. */
export async function recordNote(
  c: pg.PoolClient,
  who: { collegeId: string; userId: string },
  note: {
    id: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
    key: string;
    title: string;
    replaces?: string;
  },
): Promise<TeacherNote> {
  if (note.replaces) {
    const old = (
      await c.query("select 1 from uploads where id = $1 and status not in ('deleted', 'replaced')", [note.replaces])
    ).rowCount;
    if (!old) throw new AppError('NOT_FOUND', 'We could not find the document this one should replace.');
  }
  await c.query(
    `insert into uploads (id, college_id, owner_id, file_name, mime, size_bytes, storage_key, title, replaces, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')`,
    [
      note.id,
      who.collegeId,
      who.userId,
      note.fileName,
      note.mime,
      note.sizeBytes,
      note.key,
      note.title,
      note.replaces ?? null,
    ],
  );
  return toNote((await c.query<Row>(`${SELECT} where u.id = $1`, [note.id])).rows[0]!);
}

/** Taken out of every later build at once; the worker then takes its text out of search. */
export async function removeNote(c: pg.PoolClient, id: string): Promise<void> {
  const r = await c.query("update uploads set status = 'deleted' where id = $1 and status <> 'deleted' returning id", [
    id,
  ]);
  if (!r.rowCount) throw new AppError('NOT_FOUND', 'We could not find that document.');
}
