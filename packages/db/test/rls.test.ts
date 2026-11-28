/**
 * Row-level security under connection pooling (LLD §3.7, §16.1). Runs against the real database
 * (`pnpm db:up && pnpm db:migrate`). Each run creates its own colleges and users and removes them after.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, type TenantIdentity } from '../src/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../.env'));
} catch {
  /* CI passes env directly */
}

const urls = {
  owner: process.env.DATABASE_URL_MIGRATE,
  app: process.env.DATABASE_URL,
  worker: process.env.DATABASE_URL_WORKER,
  library: process.env.DATABASE_URL_LIBRARY,
};

async function reachable(): Promise<boolean> {
  if (!urls.owner || !urls.app || !urls.worker || !urls.library) return false;
  const c = new pg.Client({ connectionString: urls.owner, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query("select to_regclass('public.lectures') is not null as ok");
    return r.rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

const dbReady = await reachable();
if (!dbReady)
  console.warn('RLS tests skipped: database not reachable or not migrated (run pnpm db:up && pnpm db:migrate).');

describe.skipIf(!dbReady)('row-level security', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, library: pg.Pool;
  const id = () => randomUUID();
  const X = id(),
    Y = id(); // two colleges
  const A = id(),
    B = id(),
    E = id(),
    C = id(); // teachers A, B and editor E in X; teacher C in Y
  const lecA = id(),
    lecB = id();
  let globalId = '';
  const srcShared = id(),
    srcSharedY = id(),
    srcPrivA = id();
  const chunkShared = id(),
    chunkSharedY = id(),
    chunkPrivA = id();
  const as = (userId: string, collegeId: string, role: TenantIdentity['role'] = 'teacher'): TenantIdentity => ({
    userId,
    collegeId,
    role,
  });

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: urls.owner, max: 2 });
    app = new pg.Pool({ connectionString: urls.app, max: 1 }); // max 1: every query reuses the same connection
    worker = new pg.Pool({ connectionString: urls.worker, max: 1 });
    library = new pg.Pool({ connectionString: urls.library, max: 1 });

    await owner.query(
      "insert into colleges (name, slug, is_global) values ('Shared library', 'global', true) on conflict do nothing",
    );
    globalId = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query('insert into colleges (id, name, slug) values ($1, $2, $2), ($3, $4, $4)', [
      X,
      `rls-x-${X}`,
      Y,
      `rls-y-${Y}`,
    ]);
    await owner.query(
      `insert into users (id, college_id, email, name, role) values
        ($1::uuid, $5, $1::text || '@x.test', 'A', 'teacher'), ($2::uuid, $5, $2::text || '@x.test', 'B', 'teacher'),
        ($3::uuid, $5, $3::text || '@x.test', 'E', 'library_editor'), ($4::uuid, $6, $4::text || '@y.test', 'C', 'teacher')`,
      [A, B, E, C, X, Y],
    );
    await owner.query(
      `insert into lectures (id, college_id, owner_id, topic, length_min, level, style_key) values
        ($1, $3, $4, 'Frustration', 50, 'standard', 'default'), ($2, $3, $5, 'Consideration', 50, 'standard', 'default')`,
      [lecA, lecB, X, A, B],
    );
    await owner.query("insert into review_queue (college_id, kind, ref_id) values ($1, 'wrong_fact', $2)", [X, lecA]);
    await owner.query(
      `insert into sources (id, college_id, owner_id, visibility, type, origin, title, content_hash) values
        ($1::uuid, $4, null, 'shared',  'act', 'india_code', 'Shared Act', $1::text),
        ($2::uuid, $5, null, 'shared',  'act', 'admin',      'College Y Act', $2::text),
        ($3::uuid, $6, $7,   'private', 'teacher_note', 'upload', 'A notes', $3::text)`,
      [srcShared, srcSharedY, srcPrivA, globalId, Y, X, A],
    );
    await owner.query(
      `insert into chunks (id, college_id, owner_id, visibility, source_id, seq, kind, source_type, text, content_hash) values
        ($1::uuid, $4, null, 'shared',  $5, 1, 'section',   'act', 'shared text', $1::text),
        ($2::uuid, $6, null, 'shared',  $7, 1, 'section',   'act', 'college Y text', $2::text),
        ($3::uuid, $8, $9,   'private', $10, 1, 'paragraph', 'teacher_note', 'private text of A', $3::text)`,
      [chunkShared, chunkSharedY, chunkPrivA, globalId, srcShared, Y, srcSharedY, X, A, srcPrivA],
    );
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from sources where id = any($1)', [[srcShared, srcSharedY, srcPrivA]]);
    await owner.query('delete from review_queue where college_id = any($1)', [[X, Y]]);
    await owner.query('delete from lectures where college_id = any($1)', [[X, Y]]);
    await owner.query('delete from teacher_profiles where college_id = any($1)', [[X, Y]]);
    await owner.query('delete from users where college_id = any($1)', [[X, Y]]);
    await owner.query('delete from colleges where id = any($1)', [[X, Y]]);
    await Promise.all([owner.end(), app.end(), worker.end(), library.end()]);
  });

  it('a query without SET LOCAL sees no teacher rows', async () => {
    expect((await app.query('select count(*)::int n from lectures')).rows[0].n).toBe(0);
    expect((await app.query('select count(*)::int n from users')).rows[0].n).toBe(0);
    expect((await worker.query('select count(*)::int n from lectures')).rows[0].n).toBe(0);
  });

  it('teacher A reads her own lecture and never B’s', async () => {
    const rows = await withTenant(app, as(A, X), async (c) => (await c.query('select id from lectures')).rows);
    expect(rows.map((r) => r.id)).toEqual([lecA]);
    const updated = await withTenant(app, as(A, X), (c) =>
      c.query("update lectures set topic = 'hijack' where id = $1", [lecB]),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('a pooled connection carries no identity after A’s transaction', async () => {
    await withTenant(app, as(A, X), (c) => c.query('select 1'));
    const r = await app.query(
      "select current_setting('app.user_id', true) as uid, (select count(*)::int from lectures) as n",
    );
    expect(r.rows[0].uid ?? '').toBe('');
    expect(r.rows[0].n).toBe(0);
  });

  it('a worker job acting for A cannot write B’s rows', async () => {
    await expect(
      withTenant(worker, as(A, X), (c) =>
        c.query(
          "insert into lectures (college_id, owner_id, topic, length_min, level, style_key) values ($1, $2, 't', 50, 'standard', 'd')",
          [X, B],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const del = await withTenant(worker, as(A, X), (c) => c.query('delete from lectures where id = $1', [lecB]));
    expect(del.rowCount).toBe(0);
  });

  it('the library editor sees her college’s and the shared library’s review items, but not lectures', async () => {
    const [own, other, lectures] = await withTenant(app, as(E, X, 'library_editor'), async (c) => [
      (await c.query('select count(*)::int n from review_queue where college_id = $1', [X])).rows[0].n,
      (
        await c.query(
          'select count(*)::int n from review_queue where college_id <> $1 and college_id <> global_college()',
          [X],
        )
      ).rows[0].n,
      (await c.query('select count(*)::int n from lectures')).rows[0].n,
    ]);
    expect(own).toBe(1);
    expect(other).toBe(0); // never another college's queue
    expect(lectures).toBe(0);
    await owner.query(
      "insert into review_queue (college_id, kind, ref_id) values (global_college(), 'provisional_source', $1)",
      [srcShared],
    );
    const shared = await withTenant(
      app,
      as(E, X, 'library_editor'),
      async (c) => (await c.query('select count(*)::int n from review_queue where ref_id = $1', [srcShared])).rows[0].n,
    );
    expect(shared).toBe(1);
    await owner.query('delete from review_queue where ref_id = $1', [srcShared]);
    const teacherQueue = await withTenant(
      app,
      as(A, X),
      async (c) => (await c.query('select count(*)::int n from review_queue')).rows[0].n,
    );
    expect(teacherQueue).toBe(0);
  });

  it('shared chunks are visible to both teachers; A’s private chunk only to A; other colleges’ shared rows hidden', async () => {
    const seen = (who: TenantIdentity) =>
      withTenant(app, who, async (c) =>
        (await c.query('select id from chunks where id = any($1)', [[chunkShared, chunkSharedY, chunkPrivA]])).rows
          .map((r) => r.id)
          .sort(),
      );
    expect(await seen(as(A, X))).toEqual([chunkShared, chunkPrivA].sort());
    expect(await seen(as(B, X))).toEqual([chunkShared]);
    expect(await seen(as(C, Y))).toEqual([chunkShared, chunkSharedY].sort());
  });

  it('only nyaai_library writes shared chunks', async () => {
    await expect(
      withTenant(worker, as(A, X), (c) =>
        c.query("update chunks set text = 'x' where id = $1 returning id", [chunkShared]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    const lib = await library.query("update chunks set status = 'processing' where id = $1", [chunkShared]);
    expect(lib.rowCount).toBe(1);
    expect((await library.query('select count(*)::int n from chunks where id = $1', [chunkPrivA])).rows[0].n).toBe(0);
  });

  it('a teacher cannot change her own role or budget', async () => {
    await expect(
      withTenant(app, as(A, X), (c) => c.query("update users set role = 'admin' where id = $1", [A])),
    ).rejects.toThrow(/only an admin/);
    await expect(
      withTenant(app, as(A, X), (c) =>
        c.query('update teacher_profiles set monthly_budget_micro_usd = 1 where owner_id = $1', [A]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('sign-in lookup works before identity is set, and only through the helper', async () => {
    const r = await app.query('select id, role from auth_find_user($1)', [`${A}@x.test`]);
    expect(r.rows).toEqual([{ id: A, role: 'teacher' }]);
    await expect(worker.query('select * from auth_find_user($1)', [`${A}@x.test`])).rejects.toThrow(
      /permission denied/,
    );
  });
});
