/**
 * Library editor review of judgments (migrations 0006, 0008): relabel a paragraph, mark labels checked, approve, and
 * confirm a case's status, which every lecture then reads live.
 */
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
    return (
      (await c.query("select exists (select 1 from pg_policies where policyname = 'chunks_editor_review') ok")).rows[0]
        ?.ok === true
    );
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
  const users: Record<string, string> = {};

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Review College', $2)", [
      college,
      `rv-${college}`,
    ]);
    for (const [email, role] of [
      [`ed-${tag}@rv.test`, 'library_editor'],
      [`t-${tag}@rv.test`, 'teacher'],
    ] as const) {
      const id = randomUUID();
      users[role] = id;
      await owner.query('insert into users (id, college_id, email, name, role) values ($1, $2, $3, $4, $5)', [
        id,
        college,
        email,
        email,
        role,
      ]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query('insert into invite_allowlist (college_id, email, role) values ($1, $2, $3)', [
        college,
        email,
        role,
      ]);
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
    for (const kind of ['role_sample', 'provisional_source'])
      await owner.query('insert into review_queue (college_id, kind, ref_id) values ($1, $2, $3)', [g, kind, source]);
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from review_queue where ref_id = $1', [source]);
    await owner.query('delete from lectures where college_id = $1', [college]);
    await owner.query('delete from case_treatments where cited_source_id = $1', [source]);
    await owner.query('delete from sources where id = $1', [source]);
    for (const t of ['teacher_profiles', 'invite_allowlist', 'users'])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), redis.quit()]);
  });

  const signIn = async (email: string, ip: string) => {
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32),
      CSRF_SECRET: 'b'.repeat(32),
      ALLOWED_EMAIL_DOMAINS: 'rv.test',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
      DEV_LOGIN: 'true',
    });
    const agent = request.agent(createApp({ config, logger: pino({ level: 'silent' }), pool: app, redis }));
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', ip).send({ email }).expect(204);
    return {
      agent,
      csrf: decodeURIComponent(
        ([] as string[])
          .concat(login.headers['set-cookie'] ?? [])
          .find((c) => c.startsWith('nyaai_csrf='))!
          .split(';')[0]!
          .slice(11),
      ),
    };
  };

  it('lets the editor relabel, mark labels checked and approve; teachers cannot', async () => {
    const t = await signIn(`t-${tag}@rv.test`, `10.66.${tag.charCodeAt(0)}.1`);
    await t.agent.get('/api/v1/library/judgments').expect(403);
    await t.agent
      .patch(`/api/v1/library/paragraphs/${paras[0]}`)
      .set('x-csrf-token', t.csrf)
      .send({ role: 'holding' })
      .expect(403);

    const ed = await signIn(`ed-${tag}@rv.test`, `10.67.${tag.charCodeAt(0)}.1`);
    const list = (await ed.agent.get('/api/v1/library/judgments').expect(200)).body.judgments;
    expect(list.find((j: { id: string }) => j.id === source)).toMatchObject({
      rolesChecked: false,
      status: 'provisional',
      paragraphs: 2,
    });

    await ed.agent
      .patch(`/api/v1/library/paragraphs/${paras[1]}`)
      .set('x-csrf-token', ed.csrf)
      .send({ role: 'holding' })
      .expect(204);
    await ed.agent.post(`/api/v1/library/judgments/${source}/roles-checked`).set('x-csrf-token', ed.csrf).expect(204);
    await ed.agent.post(`/api/v1/library/judgments/${source}/approve`).set('x-csrf-token', ed.csrf).expect(204);

    const j = (await ed.agent.get(`/api/v1/library/judgments/${source}`).expect(200)).body;
    expect(j).toMatchObject({ rolesChecked: true, status: 'live' });
    expect(j.paragraphs.map((p: { role: string }) => p.role)).toEqual(['arguments', 'holding']);
    const db = await owner.query('select kind, state from review_queue where ref_id = $1 order by kind', [source]);
    expect(db.rows).toEqual([
      { kind: 'provisional_source', state: 'resolved' },
      { kind: 'role_sample', state: 'resolved' },
    ]);
    expect(
      (await owner.query("select count(*)::int n from chunks where source_id = $1 and status = 'live'", [source]))
        .rows[0].n,
    ).toBe(2);

    // The editor can change labels only: not the words of the judgment.
    await expect(
      (async () => {
        const c = await app.connect();
        try {
          await c.query('begin');
          await c.query(
            "select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', 'library_editor', true)",
            [randomUUID(), college],
          );
          await c.query("update chunks set text = 'tampered' where id = $1", [paras[0]]);
        } finally {
          await c.query('rollback');
          c.release();
        }
      })(),
    ).rejects.toThrow(/permission denied/);
  });

  it("records the expert's case status; lectures read it live (grey cleared, overruled turns yellow)", async () => {
    // A teacher's lecture with one line resting on the case, grey because its status was not verified when built.
    const lecture = (
      await owner.query<{ id: string }>(
        "insert into lectures (college_id, owner_id, topic, length_min, level, style_key, status, grey_open) values ($1, $2, 'Review topic', 50, 'standard', 'usual', 'ready', 1) returning id",
        [college, users.teacher],
      )
    ).rows[0]!.id;
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'claimLine',
          attrs: { lineKey: 'p0-s1-l1', kind: 'claim' },
          content: [{ type: 'text', text: 'The court decided the point.' }],
        },
      ],
    };
    const slide = (
      await owner.query<{ id: string }>(
        "insert into slides (college_id, owner_id, lecture_id, position, part_index, layout, title, body, notes) values ($1, $2, $3, 0, 0, 'bullets', 'A slide', $4, $5) returning id",
        [college, users.teacher, lecture, doc, { type: 'doc', content: [] }],
      )
    ).rows[0]!.id;
    await owner.query(
      `insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, risk, source_id, chunk_id, span_text,
                              check_status, checks, flag_kind, flag_reason, tag, source_label, part_index)
       values ($1, $2, $3, $4, 'p0-s1-l1', 'The court decided the point.', 'rule', 'normal', $5, $6, 'Paragraph 1 of the review test', 'supported',
               '[]', 'grey', 'Status not verified', 'S1', 'Review Test ¶1', 0)`,
      [college, users.teacher, lecture, slide, source, paras[0]],
    );
    const t = await signIn(`t-${tag}@rv.test`, `10.68.${tag.charCodeAt(0)}.1`);
    const ed = await signIn(`ed-${tag}@rv.test`, `10.69.${tag.charCodeAt(0)}.1`);
    const counts = async () => (await t.agent.get(`/api/v1/lectures/${lecture}`).expect(200)).body.counts;
    const line = async () =>
      (await t.agent.get(`/api/v1/lectures/${lecture}/slides`).expect(200)).body.slides[0].lines[0];
    expect(await counts()).toMatchObject({ yellow: 0, grey: 1 });

    await t.agent
      .post(`/api/v1/library/judgments/${source}/status`)
      .set('x-csrf-token', t.csrf)
      .send({ status: 'good_law', note: 'Checked the citator.' })
      .expect(403);
    await ed.agent
      .post(`/api/v1/library/judgments/${source}/status`)
      .set('x-csrf-token', ed.csrf)
      .send({ status: 'overruled', note: 'Checked the citator.' })
      .expect(400); // which judgment?
    await ed.agent
      .post(`/api/v1/library/judgments/${source}/status`)
      .set('x-csrf-token', ed.csrf)
      .send({ status: 'good_law', note: 'Checked the citator to Nov 2026; followed, never overruled.' })
      .expect(204);
    expect(await counts()).toMatchObject({ yellow: 0, grey: 0 });
    expect(await line()).toMatchObject({ flag: null, status: 'supported', sources: [{ caseStatus: 'good_law' }] });

    await ed.agent
      .post(`/api/v1/library/judgments/${source}/status`)
      .set('x-csrf-token', ed.csrf)
      .send({
        status: 'overruled',
        note: 'Overruled by a Constitution Bench.',
        byCase: 'Later Case v. Union of India (2026)',
      })
      .expect(204);
    expect(await counts()).toMatchObject({ yellow: 1, grey: 0 });
    expect(await line()).toMatchObject({ flag: 'yellow', flagReason: 'This case was overruled' });

    const j = (await ed.agent.get(`/api/v1/library/judgments/${source}`).expect(200)).body;
    expect(j.caseStatus).toBe('overruled');
    expect(j.statusHistory.map((h: { status: string; byCase: string | null }) => [h.status, h.byCase])).toEqual([
      ['overruled', 'Later Case v. Union of India (2026)'],
      ['good_law', null],
    ]);
    expect(
      (await ed.agent.get('/api/v1/library/judgments').expect(200)).body.judgments.find(
        (x: { id: string }) => x.id === source,
      ).caseStatus,
    ).toBe('overruled');
  });
});
