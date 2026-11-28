/**
 * A course from her syllabus (COURSE-2) and the background source check (DATA-3), against the real database:
 *  - the syllabus file is read into units and topics and returned; nothing is kept;
 *  - creating the course with `findSources` marks every lecture waiting and queues `ingest.syllabus` (ids only);
 *  - the check finds the library's sources for a lecture, records a gap for one the library cannot answer, and
 *    marks lectures past its time budget "not checked"; the course plan shows each result.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '@nyaai/shared';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { findCourseSources } from '../../src/services/course/sources.ts';
import { toVector, type Voyage } from '../../src/services/voyage/index.ts';
import { csrfFrom, fakeVector, fakeVoyage } from '../helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.DATABASE_URL_WORKER || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (
      (
        await c.query(
          "select exists (select 1 from information_schema.columns where table_name = 'course_units' and column_name = 'sources') as ok",
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
const uniq = () => Array.from({ length: 9 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe.skipIf(!up)('a course from her syllabus, with sources found in the background (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const sourceId = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  const jobs: { name: string; data: Record<string, unknown> }[] = [];
  let courseId = '';
  let agent: ReturnType<typeof request.agent>;
  let csrf = '';

  const SYLLABUS = [
    'Property Law',
    'Course Objectives',
    'Students learn the transfer of property.',
    `Unit I: Pelican ${w} transfers`,
    `1. Pelican ${w} transfer and its conditions`,
    `2. Quokka ${w} grammar of nebulae`,
    'Suggested Readings',
    '1. Mulla, The Transfer of Property Act',
  ].join('\n');

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Syllabus Test College', $2)", [
      college,
      `sy-${college}`,
    ]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'T')", [
      teacher,
      college,
      `t-${tag}@sy.test`,
    ]);
    await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [teacher, college]);
    await owner.query("insert into consents (college_id, owner_id, version, processors) values ($1, $2, $3, '[]')", [
      college,
      teacher,
      CONSENT_VERSION,
    ]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [
      college,
      `t-${tag}@sy.test`,
    ]);
    // One shared section the library holds for the first lecture; nothing for the second.
    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    const act = `Pelican ${w} Act`;
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`,
      [sourceId, g, act, `sy-${tag}`],
    );
    for (const [i, text] of [
      `A pelican ${w} transfer is valid only on its conditions.`,
      `The conditions of a pelican ${w} transfer are written.`,
      `A pelican ${w} transfer needs a deed.`,
    ].entries()) {
      await owner.query(
        `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding)
         values ($1, 'shared', $2, $3, 'section', $4, $5, $6, 'act', $7, $8, 'live', $9)`,
        [
          g,
          sourceId,
          i + 1,
          `${act} › s. ${i + 1} Transfers`,
          act,
          String(i + 1),
          text,
          `syc-${tag}-${i}`,
          toVector(fakeVector(`property law pelican ${w} transfer conditions ${text}`)),
        ],
      );
    }
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32),
      CSRF_SECRET: 'b'.repeat(32),
      ALLOWED_EMAIL_DOMAINS: 'sy.test',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
      DEV_LOGIN: 'true',
    });
    const http = createApp({
      config,
      logger: pino({ level: 'silent' }),
      pool: app,
      redis,
      queues: {
        ingest: {
          add: async (name: string, data: never) => (jobs.push({ name, data }), { id: `j-${jobs.length}` }),
        } as never,
      },
    });
    agent = request.agent(http);
    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.97.${tag.charCodeAt(0)}.1`)
      .send({ email: `t-${tag}@sy.test` })
      .expect(204);
    csrf = csrfFrom(login);
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from sources where id = $1', [sourceId]);
    const gaps = (
      await owner.query<{ id: string }>('select id from library_gaps where question ilike $1', [`%${w}%`])
    ).rows.map((r) => r.id);
    await owner.query('delete from review_queue where ref_id = any($1)', [gaps]);
    await owner.query('delete from library_gaps where id = any($1)', [gaps]);
    for (const t of ['course_units', 'courses', 'usage', 'teacher_profiles', 'consents', 'invite_allowlist', 'users'])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  it('reads her syllabus file into units and topics, keeps nothing, and refuses other files', async () => {
    const r = await agent
      .post('/api/v1/courses/syllabus')
      .set('x-csrf-token', csrf)
      .set('content-type', 'text/plain')
      .send(Buffer.from(SYLLABUS))
      .expect(200);
    expect(r.body).toEqual({
      courseName: null, // a plain-text first line is not a heading
      units: [
        {
          title: `Pelican ${w} transfers`,
          topics: [`Pelican ${w} transfer and its conditions`, `Quokka ${w} grammar of nebulae`],
        },
      ],
      perUnit: [`Pelican ${w} transfers`],
      perTopic: [`Pelican ${w} transfer and its conditions`, `Quokka ${w} grammar of nebulae`],
      suggested: 'topic',
    });
    await agent
      .post('/api/v1/courses/syllabus')
      .set('x-csrf-token', csrf)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('MZ'))
      .expect(415);
    const none = await agent
      .post('/api/v1/courses/syllabus')
      .set('x-csrf-token', csrf)
      .set('content-type', 'text/plain')
      .send(Buffer.from('Course Objectives\nTo learn.'))
      .expect(400);
    expect(none.body.error.message).toMatch(/no lecture topics/);
  });

  it('creating the course with "find sources" marks each lecture waiting and queues one background job (ids only)', async () => {
    const topics = [`Pelican ${w} transfer and its conditions`, `Quokka ${w} grammar of nebulae`, `Third lecture ${w}`];
    const r = await agent
      .post('/api/v1/courses')
      .set('x-csrf-token', csrf)
      .send({ name: `Course ${w}`, topics, findSources: true })
      .expect(201);
    courseId = r.body.id;
    expect(r.body.units.map((u: { sources: { state: string } | null }) => u.sources?.state)).toEqual([
      'waiting',
      'waiting',
      'waiting',
    ]);
    expect(jobs).toEqual([
      { name: 'ingest.syllabus', data: { courseId, ownerId: teacher, collegeId: college, requestedBy: teacher } },
    ]);
    // A course typed by hand, without the check, has nothing waiting.
    const plain = await agent
      .post('/api/v1/courses')
      .set('x-csrf-token', csrf)
      .send({ name: 'Plain', topics: ['One'] })
      .expect(201);
    expect(plain.body.units[0].sources).toBeNull();
    expect(jobs).toHaveLength(1);
  });

  it('the background check finds sources, records a gap the library cannot answer, and stops at its time budget', async () => {
    const who = { userId: teacher, collegeId: college, role: 'teacher' as const };
    // Budget for exactly the first two lectures: the third is left "not checked".
    let calls = 0;
    const counting: Voyage = { ...fakeVoyage, embed: async (t, k, p) => (calls++, fakeVoyage.embed(t, k, p)) };
    const r = await findCourseSources(courseId, who, {
      worker,
      voyageFor: () => counting,
      lookup: null,
      minScore: 0.3,
      budgetMs: 60_000,
    });
    expect(r.checked).toBe(3);
    expect(calls).toBeGreaterThan(0);
    const detail = (await agent.get(`/api/v1/courses/${courseId}`).expect(200)).body as {
      units: { title: string; sources: { state: string; found: number } }[];
    };
    const [first, second] = detail.units;
    expect(first!.sources).toMatchObject({ state: 'ok' });
    expect(first!.sources.found).toBeGreaterThanOrEqual(3);
    expect(second!.sources).toMatchObject({ state: 'not_found', found: 0 });
    // The library team hears about the lecture it could not answer.
    const gap = (await owner.query('select kind, state from library_gaps where question ilike $1', [`%Quokka ${w}%`]))
      .rows[0];
    expect(gap).toMatchObject({ state: 'open' });

    // Past the time budget: what is left is marked "not checked" (checked when she prepares it).
    await owner.query("update course_units set sources = jsonb_build_object('state', 'waiting') where course_id = $1", [
      courseId,
    ]);
    const late = await findCourseSources(courseId, who, {
      worker,
      voyageFor: () => fakeVoyage,
      lookup: null,
      minScore: 0.3,
      budgetMs: -1,
    });
    expect(late).toMatchObject({ checked: 0, notChecked: 3 });
    const after = (await agent.get(`/api/v1/courses/${courseId}`).expect(200)).body as {
      units: { sources: { state: string } }[];
    };
    expect(after.units.map((u) => u.sources.state)).toEqual(['not_checked', 'not_checked', 'not_checked']);
  });
});
