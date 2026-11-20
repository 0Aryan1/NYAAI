/** Library editor review of judgments (migration 0006): relabel a paragraph, mark labels checked, approve. */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select exists (select 1 from pg_policies where policyname = 'chunks_editor_review') ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();

describe.skipIf(!up)('library editor review (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, redis: Redis;
  const college = randomUUID();
  const tag = college.slice(0, 8);
  const source = randomUUID();
  const paras: string[] = [];

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Review College', $2)", [college, `rv-${college}`]);
    for (const [email, role] of [[`ed-${tag}@rv.test`, 'library_editor'], [`t-${tag}@rv.test`, 'teacher']] as const) {
      const id = randomUUID();
      await owner.query('insert into users (id, college_id, email, name, role) values ($1, $2, $3, $4, $5)', [id, college, email, email, role]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query('insert into invite_allowlist (college_id, email, role) values ($1, $2, $3)', [college, email, role]);
    }
    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, court, decided_on, url, content_hash, status)
       values ($1, $2, 'shared', 'judgment', 'indian_kanoon', $3, 'Supreme Court of India', '1999-01-01', 'https://indiankanoon.org/doc/1/', $4, 'provisional')`,
      [source, g, `Review Test v. Library ${tag}`, `rv-${tag}`],
    );
    for (const [i, role] of ['arguments', 'unknown'].entries()) {
      paras.push(
        (
          await owner.query<{ id: string }>(
            `insert into chunks (college_id, visibility, source_id, seq, kind, para_no, opinion, para_role, source_type, text, content_hash, status)
             values ($1, 'shared', $2, $3, 'paragraph', $4, 'majority', $5, 'judgment', $6, $7, 'provisional') returning id`,
            [g, source, i + 1, String(i + 1), role, `Paragraph ${i + 1} of the review test.`, `rvc-${tag}-${i}`],
          )
        ).rows[0]!.id,
      );
    }
    for (const kind of ['role_sample', 'provisional_source']) await owner.query('insert into review_queue (college_id, kind, ref_id) values ($1, $2, $3)', [g, kind, source]);
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from review_queue where ref_id = $1', [source]);
    await owner.query('delete from sources where id = $1', [source]);
    for (const t of ['teacher_profiles', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), redis.quit()]);
  });

  it('lets the editor relabel, mark labels checked and approve; teachers cannot', async () => {
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'rv.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
    });
    const http = createApp({ config, logger: pino({ level: 'silent' }), pool: app, redis });
    const signIn = async (email: string, ip: string) => {
      const agent = request.agent(http);
      const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', ip).send({ email }).expect(204);
      return { agent, csrf: decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11)) };
    };

    const t = await signIn(`t-${tag}@rv.test`, `10.66.${tag.charCodeAt(0)}.1`);
    await t.agent.get('/api/v1/library/judgments').expect(403);
    await t.agent.patch(`/api/v1/library/paragraphs/${paras[0]}`).set('x-csrf-token', t.csrf).send({ role: 'holding' }).expect(403);

    const ed = await signIn(`ed-${tag}@rv.test`, `10.67.${tag.charCodeAt(0)}.1`);
    const list = (await ed.agent.get('/api/v1/library/judgments').expect(200)).body.judgments;
    expect(list.find((j: { id: string }) => j.id === source)).toMatchObject({ rolesChecked: false, status: 'provisional', paragraphs: 2 });

    await ed.agent.patch(`/api/v1/library/paragraphs/${paras[1]}`).set('x-csrf-token', ed.csrf).send({ role: 'holding' }).expect(204);
    await ed.agent.post(`/api/v1/library/judgments/${source}/roles-checked`).set('x-csrf-token', ed.csrf).expect(204);
    await ed.agent.post(`/api/v1/library/judgments/${source}/approve`).set('x-csrf-token', ed.csrf).expect(204);

    const j = (await ed.agent.get(`/api/v1/library/judgments/${source}`).expect(200)).body;
    expect(j).toMatchObject({ rolesChecked: true, status: 'live' });
    expect(j.paragraphs.map((p: { role: string }) => p.role)).toEqual(['arguments', 'holding']);
    const db = await owner.query('select kind, state from review_queue where ref_id = $1 order by kind', [source]);
    expect(db.rows).toEqual([{ kind: 'provisional_source', state: 'resolved' }, { kind: 'role_sample', state: 'resolved' }]);
    expect((await owner.query("select count(*)::int n from chunks where source_id = $1 and status = 'live'", [source])).rows[0].n).toBe(2);

    // The editor can change labels only: not the words of the judgment.
    await expect(
      (async () => {
        const c = await app.connect();
        try {
          await c.query('begin');
          await c.query("select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', 'library_editor', true)", [randomUUID(), college]);
          await c.query("update chunks set text = 'tampered' where id = $1", [paras[0]]);
        } finally {
          await c.query('rollback');
          c.release();
        }
      })(),
    ).rejects.toThrow(/permission denied/);
  });
});
