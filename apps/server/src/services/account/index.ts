/**
 * Her data, hers to take and to delete (BRD NFR-8, HLD §8, DPDP Act, 2023; decision 2026-11-25).
 *
 * Export (GET /me/export-data): one zip, made on request from her own rows (read as her, so row security decides):
 * `my-data.json` (profile, consents, courses and what each class learnt, lectures with every slide line and the words
 * each rests on, her notes' text, examples, edits, feedback, reports, AI usage) and `notes/` (the files she uploaded).
 *
 * Delete (POST /me/delete-data → `ops.delete_user_data`): logged in deletion_log, then `forget_teacher` removes
 * every row about her in one transaction (migration 0015), then her files leave storage. Backups clear within 7 days.
 */
import type pg from 'pg';
import JSZip from 'jszip';
import { withTenant, type TenantIdentity } from '@nyaai/db';
import type { Storage } from '../storage/index.ts';

/** Her own rows in each table, as stored (the teacher-owned tables of the schema). */
const HER_TABLES = [
  'teacher_profiles',
  'consents',
  'courses',
  'course_units',
  'lectures',
  'lecture_inputs',
  'slides',
  'slide_versions',
  'citations',
  'coverage_items',
  'research_runs',
  'research_questions',
  'evidence_items',
  'reading_list_items',
  'uploads',
  'examples',
  'edit_events',
  'style_changes',
  'coach_suggestions',
  'feedback',
  'notifications',
  'reports',
  'templates',
  'usage',
] as const;

const safeName = (s: string) =>
  s
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'file';

const README = `Your data from NYAAI
====================

my-data.json   Everything NYAAI holds about you, table by table:
               - your profile, teaching style and consents;
               - your courses, the lectures planned in them and what each class learnt;
               - your lectures, every slide, and for every line the exact words of the source it rests on;
               - the text of your own notes (as split by heading), your examples, edits, feedback and reports;
               - the AI use made for you (what for, when, and what it cost; never the content).
notes/         The documents you uploaded as your notes, as you uploaded them.

Your slides can also be downloaded as PowerPoint from each lecture in NYAAI.
`;

export async function exportTeacherData(
  c: pg.PoolClient,
  who: TenantIdentity,
  storage: Storage | undefined,
): Promise<Uint8Array> {
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString() };
  data.account =
    (
      await c.query(
        'select u.name, u.email, u.role, u.created_at, c.name as college from users u join colleges c on c.id = u.college_id where u.id = $1',
        [who.userId],
      )
    ).rows[0] ?? null;
  for (const t of HER_TABLES) {
    data[t] = (await c.query(`select * from ${t} where owner_id = $1`, [who.userId])).rows;
  }
  // Her notes as text, without the search vectors (numbers that mean nothing outside NYAAI).
  data.note_sections = (
    await c.query(
      `select s.title as document, k.seq, k.header, k.text from chunks k join sources s on s.id = k.source_id
        where k.owner_id = $1 and k.visibility = 'private' order by s.title, k.seq`,
      [who.userId],
    )
  ).rows;

  const zip = new JSZip();
  zip.file('README.txt', README);
  zip.file('my-data.json', JSON.stringify(data, null, 2));
  if (storage) {
    const uploads = (
      await c.query<{ id: string; file_name: string; storage_key: string; status: string }>(
        "select id, file_name, storage_key, status from uploads where owner_id = $1 and status <> 'deleted'",
        [who.userId],
      )
    ).rows;
    for (const [i, u] of uploads.entries()) {
      try {
        zip.file(`notes/${i + 1}-${safeName(u.file_name)}`, await storage.get(u.storage_key));
      } catch {
        // A file missing from storage is still listed in my-data.json.
      }
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export interface ForgetResult {
  logId: string;
  counts: Record<string, number>;
  files: number;
}

/** The `ops.delete_user_data` job: log, delete every row (one transaction), then her files. */
export async function forgetTeacher(
  who: TenantIdentity,
  deps: { worker: pg.Pool; storage: Storage | null },
): Promise<ForgetResult> {
  const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
  const { logId, keys } = await tenant(async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `insert into deletion_log (college_id, subject_user_id, requested_by, scope) values ($1, $2, $2, $3) returning id`,
        [who.collegeId, who.userId, { what: 'everything', by: 'the teacher herself' }],
      )
    ).rows[0]!.id;
    const keys = (
      await c.query<{ storage_key: string }>('select storage_key from uploads where owner_id = $1', [who.userId])
    ).rows.map((r) => r.storage_key);
    return { logId: id, keys };
  });
  const counts = await tenant(
    async (c) =>
      (await c.query<{ counts: Record<string, number> }>('select forget_teacher($1) as counts', [who.userId])).rows[0]!
        .counts,
  );

  // Files: every upload she made, and anything else under her private folder.
  let files = 0;
  if (deps.storage) {
    const all = new Set([...keys, ...(await deps.storage.list(`private/${who.collegeId}/${who.userId}/`))]);
    for (const key of all) {
      await deps.storage.delete(key);
      files++;
    }
  }
  await tenant((c) =>
    c.query('update deletion_log set counts = $2, finished_at = now() where id = $1', [logId, { ...counts, files }]),
  );
  return { logId, counts, files };
}
