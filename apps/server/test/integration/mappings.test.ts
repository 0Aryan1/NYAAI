/**
 * Old ↔ new criminal law mapping rows over HTTP against the real database (LIB-1, DATA-6): the library editor adds a
 * row (unsigned), signs it, a change removes the signature, duplicates and impossible rows are refused, a teacher
 * cannot touch the table; changing, un-signing or removing a signed row turns the lecture lines that relied on it
 * yellow, in the background (`ops.mapping_changed`, migration 0021). Section numbers are unique to the run; every row
 * made here is removed afterwards.
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
import { opsProcessor } from '../../src/jobs/ops.ts';
import { MAPPING_REASONS } from '../../src/services/mappings.ts';
import { parseConfig } from '../../src/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

async function stackUp(): Promise<boolean> {
  if (
    !process.env.DATABASE_URL_MIGRATE ||
    !process.env.DATABASE_URL ||
    !process.env.DATABASE_URL_WORKER ||
    !process.env.REDIS_URL
  )
    return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (
      (
        await c.query(
          "select to_regprocedure('reflag_mapping_lines(text[],text[],mapping_relation,text)') is not null as ok",
        )
      ).rows[0]?.ok === true
    );
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();

describe.skipIf(!up)('law mapping rows (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const jobs: { name: string; data: never }[] = [];
  const fakeOps = {
    add: async (name: string, data: never) => (jobs.push({ name, data }), { id: `o-${jobs.length}` }),
  } as never;
  const college = randomUUID();
  const editor = randomUUID();
  const teacher = randomUUID();
  const tag = college.slice(0, 8);
  // Sections no real row uses: four digits and letters.
  const n = 1000 + Math.floor(Math.random() * 8999);
  const [s1, s2, s3] = [`${n}ZA`, `${n}ZB`, `${n}ZC`];
  const made: string[] = [];

  const config = () =>
    parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32),
      CSRF_SECRET: 'b'.repeat(32),
      ALLOWED_EMAIL_DOMAINS: 'mt.test',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
      DEV_LOGIN: 'true',
    });
  const signIn = async (email: string, i: number) => {
    const agent = request.agent(
      createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis, queues: { ops: fakeOps } }),
    );
    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.97.${tag.charCodeAt(0)}.${i}`)
      .send({ email })
      .expect(204);
    return {
      agent,
      csrf: decodeURIComponent(
        ([] as string[])
          .concat(login.headers['set-cookie'] ?? [])
          .find((x) => x.startsWith('nyaai_csrf='))!
          .split(';')[0]!
          .slice(11),
      ),
    };
  };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 2 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Mapping Test College', $2)", [
      college,
      `mt-${college}`,
    ]);
    for (const [id, email, role, name] of [
      [editor, `ed-${tag}@mt.test`, 'library_editor', 'Prof. Criminal Law'],
      [teacher, `t-${tag}@mt.test`, 'teacher', 'Teacher'],
    ] as const) {
      await owner.query('insert into users (id, college_id, email, name, role) values ($1, $2, $3, $4, $5)', [
        id,
        college,
        email,
        name,
        role,
      ]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query('insert into invite_allowlist (college_id, email, role) values ($1, $2, $3)', [
        college,
        email,
        role,
      ]);
    }
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from law_mappings where id = any($1::uuid[])', [made]);
    await owner.query('delete from lectures where college_id = $1', [college]);
    for (const t of ['teacher_profiles', 'invite_allowlist', 'users'])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  it('the editor adds a row, signs it, and a change removes the signature', async () => {
    const { agent, csrf } = await signIn(`ed-${tag}@mt.test`, 1);
    const row = {
      pair: 'IPC → BNS',
      relation: 'renumbered',
      oldSections: [`s. ${s1}`],
      newSections: [s2.toLowerCase()],
      note: 'Cheating: same ingredients, new number.',
      sourceUrl: 'https://www.mha.gov.in/en/commoncontent/new-criminal-laws',
    };
    const created = (await agent.post('/api/v1/library/mappings').set('x-csrf-token', csrf).send(row).expect(201)).body;
    made.push(created.id);
    expect(created).toMatchObject({
      pair: 'IPC → BNS',
      oldAct: 'Indian Penal Code, 1860',
      newAct: 'Bharatiya Nyaya Sanhita, 2023',
      oldSections: [s1],
      newSections: [s2],
      signedBy: null,
    });

    // Unsigned rows are listed first ("To sign"); the same sections again are refused.
    let list = (await agent.get('/api/v1/library/mappings').expect(200)).body;
    expect(list.mappings.map((m: { id: string }) => m.id)).toContain(created.id);
    expect(list.unsigned).toBeGreaterThanOrEqual(1);
    expect(
      (await agent.post('/api/v1/library/mappings').set('x-csrf-token', csrf).send(row).expect(409)).body.error.code,
    ).toBe('ALREADY_IN_LIBRARY');

    const signed = (
      await agent.post(`/api/v1/library/mappings/${created.id}/sign`).set('x-csrf-token', csrf).expect(200)
    ).body;
    expect(signed).toMatchObject({ signedBy: 'Prof. Criminal Law', signedAt: expect.any(String) });
    list = (await agent.get('/api/v1/library/mappings').expect(200)).body;
    expect(list.mappings.map((m: { id: string }) => m.id)).not.toContain(created.id);
    expect(
      (await agent.get('/api/v1/library/mappings?show=all').expect(200)).body.mappings.map((m: { id: string }) => m.id),
    ).toContain(created.id);
    // What the checker reads (C5): the row as signed.
    const checker = (
      await owner.query('select reviewed_at is not null signed from law_mappings where id = $1', [created.id])
    ).rows[0];
    expect(checker.signed).toBe(true);

    const changed = (
      await agent
        .patch(`/api/v1/library/mappings/${created.id}`)
        .set('x-csrf-token', csrf)
        .send({ ...row, relation: 'substantively_changed', note: 'Punishment changed.' })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({ relation: 'substantively_changed', signedBy: null, signedAt: null });

    // Undo a signature; remove a row.
    await agent.post(`/api/v1/library/mappings/${created.id}/sign`).set('x-csrf-token', csrf).expect(200);
    expect(
      (await agent.delete(`/api/v1/library/mappings/${created.id}/sign`).set('x-csrf-token', csrf).expect(200)).body
        .signedBy,
    ).toBeNull();
    await agent.delete(`/api/v1/library/mappings/${created.id}`).set('x-csrf-token', csrf).expect(204);
    await agent.delete(`/api/v1/library/mappings/${created.id}`).set('x-csrf-token', csrf).expect(404);
  });

  it('impossible rows are refused with a plain reason', async () => {
    const { agent, csrf } = await signIn(`ed-${tag}@mt.test`, 2);
    const base = { pair: 'CrPC → BNSS', oldSections: [s3], note: 'A note.', sourceUrl: 'https://www.mha.gov.in/x' };
    const refused = async (body: object) =>
      (await agent.post('/api/v1/library/mappings').set('x-csrf-token', csrf).send(body).expect(400)).body.error;
    expect(JSON.stringify(await refused({ ...base, relation: 'no_direct_equivalent', newSections: [s1] }))).toContain(
      'has no new section',
    );
    expect(JSON.stringify(await refused({ ...base, relation: 'renumbered', newSections: [] }))).toContain(
      'No direct equivalent',
    );
    expect(JSON.stringify(await refused({ ...base, relation: 'split', newSections: [s1] }))).toContain(
      'two or more new sections',
    );
    expect(JSON.stringify(await refused({ ...base, relation: 'same', newSections: ['not a section'] }))).toContain(
      'A section number',
    );
    const none = (
      await agent
        .post('/api/v1/library/mappings')
        .set('x-csrf-token', csrf)
        .send({ ...base, relation: 'no_direct_equivalent', newSections: [] })
        .expect(201)
    ).body;
    made.push(none.id);
    expect(none).toMatchObject({ pair: 'CrPC → BNSS', newSections: [] });
  });

  it('a teacher cannot read or change the table', async () => {
    const { agent, csrf } = await signIn(`t-${tag}@mt.test`, 3);
    await agent.get('/api/v1/library/mappings').expect(403);
    await agent.post('/api/v1/library/mappings').set('x-csrf-token', csrf).send({}).expect(403);
  });

  it('changing, un-signing or removing a signed row turns the lines that relied on it yellow, in the background', async () => {
    const { agent, csrf } = await signIn(`ed-${tag}@mt.test`, 4);
    jobs.length = 0; // the first test's changes queued jobs too
    const [a, b, c] = [`${n}YA`, `${n}YB`, `${n}YC`];
    // A teacher's lecture: one line passed C5 on the row; one names other sections; one never needed C5.
    const lecture = (
      await owner.query<{ id: string }>(
        "insert into lectures (college_id, owner_id, topic, length_min, level, style_key, status) values ($1, $2, 'Cheating', 50, 'standard', 'usual', 'ready') returning id",
        [college, teacher],
      )
    ).rows[0]!.id;
    const slide = (
      await owner.query<{ id: string }>(
        "insert into slides (college_id, owner_id, lecture_id, position, part_index, layout, title, body, notes) values ($1, $2, $3, 0, 0, 'title_bullets', 'Cheating', '{}', '{}') returning id",
        [college, teacher, lecture],
      )
    ).rows[0]!.id;
    const passed = JSON.stringify([
      { name: 'C1', result: 'pass', detail: null },
      { name: 'C5', result: 'pass', detail: null },
      { name: 'C9', result: 'pass', detail: null },
    ]);
    const cite = async (key: string, text: string, checks: string) =>
      (
        await owner.query<{ id: string }>(
          "insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, span_text, check_status, checks) values ($1, $2, $3, $4, $5, $6, 'mapping', 'x', 'supported', $7) returning id",
          [college, teacher, lecture, slide, key, text, checks],
        )
      ).rows[0]!.id;
    const relied = await cite('l1', `Section ${a} IPC is now section ${b} of the BNS.`, passed);
    const other = await cite('l2', `Section ${c} IPC is now section ${b} of the BNS.`, passed);
    const noC5 = await cite(
      'l3',
      `Section ${a} IPC and section ${b} BNS are taught together.`,
      JSON.stringify([{ name: 'C5', result: 'skipped', detail: null }]),
    );
    const state = async (id: string) =>
      (await owner.query('select check_status, flag_kind, flag_reason, checks from citations where id = $1', [id]))
        .rows[0];
    const run = async () => opsProcessor({ logger: pino({ level: 'silent' }), worker })(jobs.at(-1) as never);

    const row = {
      pair: 'IPC → BNS',
      relation: 'renumbered',
      oldSections: [a],
      newSections: [b],
      note: 'Renumbered.',
      sourceUrl: 'https://www.mha.gov.in/z',
    };
    const id = (await agent.post('/api/v1/library/mappings').set('x-csrf-token', csrf).send(row).expect(201)).body.id;
    made.push(id);
    // An unsigned row supported nothing: changing it queues nothing.
    await agent
      .patch(`/api/v1/library/mappings/${id}`)
      .set('x-csrf-token', csrf)
      .send({ ...row, note: 'Renumbered only.' })
      .expect(200);
    expect(jobs).toHaveLength(0);

    await agent.post(`/api/v1/library/mappings/${id}/sign`).set('x-csrf-token', csrf).expect(200);
    await agent
      .patch(`/api/v1/library/mappings/${id}`)
      .set('x-csrf-token', csrf)
      .send({ ...row, relation: 'substantively_changed' })
      .expect(200);
    expect(jobs).toEqual([
      {
        name: 'ops.mapping_changed',
        data: {
          userId: editor,
          collegeId: college,
          mapping: { oldSections: [a], newSections: [b], relation: 'renumbered', change: 'changed' },
        },
      },
    ]);
    expect(await state(relied)).toMatchObject({ check_status: 'supported' }); // nothing yet: the job does it
    expect(await run()).toEqual({ linesFlagged: 1, lectures: 1 });
    const flagged = await state(relied);
    expect(flagged).toMatchObject({ check_status: 'open', flag_kind: 'yellow', flag_reason: MAPPING_REASONS.changed });
    expect(flagged.checks.find((x: { name: string }) => x.name === 'C5')).toEqual({
      name: 'C5',
      result: 'fail',
      detail: MAPPING_REASONS.changed,
    });
    expect(await state(other)).toMatchObject({ check_status: 'supported' });
    expect(await state(noC5)).toMatchObject({ check_status: 'supported' });
    expect((await owner.query('select yellow_open from lectures where id = $1', [lecture])).rows[0].yellow_open).toBe(
      1,
    );
    // Running it again changes nothing (a retried job is harmless).
    expect(await run()).toEqual({ linesFlagged: 0, lectures: 0 });

    // Un-sign and remove: each queues its own reason (here, for the line about the other sections, on a row for them).
    const id2 = (
      await agent
        .post('/api/v1/library/mappings')
        .set('x-csrf-token', csrf)
        .send({ ...row, oldSections: [c] })
        .expect(201)
    ).body.id;
    made.push(id2);
    await agent.post(`/api/v1/library/mappings/${id2}/sign`).set('x-csrf-token', csrf).expect(200);
    await agent.delete(`/api/v1/library/mappings/${id2}/sign`).set('x-csrf-token', csrf).expect(200);
    expect(jobs.at(-1)).toMatchObject({ data: { mapping: { oldSections: [c], change: 'unsigned' } } });
    await agent.post(`/api/v1/library/mappings/${id2}/sign`).set('x-csrf-token', csrf).expect(200);
    await agent.delete(`/api/v1/library/mappings/${id2}`).set('x-csrf-token', csrf).expect(204);
    expect(jobs.at(-1)).toMatchObject({ data: { mapping: { oldSections: [c], change: 'removed' } } });
    expect(await run()).toEqual({ linesFlagged: 1, lectures: 1 });
    expect(await state(other)).toMatchObject({ check_status: 'open', flag_reason: MAPPING_REASONS.removed });
    expect((await owner.query('select yellow_open from lectures where id = $1', [lecture])).rows[0].yellow_open).toBe(
      2,
    );
  });

  it('only a library editor may run the re-flag', async () => {
    const c = await worker.connect();
    try {
      await c.query('begin');
      await c.query(
        "select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', 'teacher', true)",
        [teacher, college],
      );
      await expect(c.query("select reflag_mapping_lines(array['1'], array['2'], 'same', 'x')")).rejects.toThrow(
        /only a library editor/,
      );
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
