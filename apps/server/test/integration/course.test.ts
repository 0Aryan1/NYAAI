/**
 * The course series end to end (HLD F8) against the real database, with a scripted fake Claude:
 *  - a course from a pasted list; reorder, rename, prerequisites;
 *  - lecture 1 is planned without a recap (nothing taught yet) and with a bridge to lecture 2; every part's writer
 *    sees the whole outline; a bridge the library has nothing for is still written;
 *  - mark taught → learn.summary → course memory (terms only if on the slides; cases from citations);
 *  - a lecture whose prerequisite is not taught needs her go-ahead (HOME-10);
 *  - lecture 2 reads the course memory: the planner and the recap's writer get it;
 *  - series checks are suggestions; undoing "taught" clears the memory.
 */
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { PromptId } from '@nyaai/prompts';
import { withTenant } from '@nyaai/db';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { buildLecture } from '../../src/services/build/index.ts';
import { summariseTaught } from '../../src/services/course/index.ts';
import type { Gateway, GatewayRequest } from '../../src/services/llm-gateway/index.ts';
import { EMBED_DIMS, toVector, type Voyage } from '../../src/services/voyage/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

const words = (t: string) => t.toLowerCase().match(/[a-z]{3,}/g) ?? [];
function fakeVector(text: string): number[] {
  const v = new Array<number>(EMBED_DIMS).fill(0);
  for (const w of words(text)) v[createHash('md5').update(w).digest().readUInt16BE(0) % EMBED_DIMS]! += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
const fakeVoyage: Voyage = {
  embed: async (texts) => texts.map(fakeVector),
  rerank: async (query, docs) => {
    const q = new Set(words(query.split('Question:').pop() ?? query));
    return docs.map((d, index) => ({ index, score: q.size ? [...q].filter((x) => new Set(words(d)).has(x)).length / q.size : 0 })).sort((a, b) => b.score - a.score);
  },
};

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.DATABASE_URL_WORKER || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select exists (select 1 from information_schema.columns where table_name = 'citations' and column_name = 'source_label') as ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();
const uniq = () => Array.from({ length: 9 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe.skipIf(!up)('course series (integration, fake Claude)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const sourceId = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  const act = `Okapi ${w} Act`;
  const rule = `An okapi ${w} may browse in the forest`;
  const tasks: { id: PromptId; task: string }[] = [];
  let planFor: 'first' | 'second' = 'first';

  const fakeGateway: Gateway = {
    async run<Sc extends z.ZodType>(req: GatewayRequest<Sc>, usage: Parameters<Gateway['run']>[1]) {
      tasks.push({ id: req.prompt.id, task: req.task });
      await usage({ provider: 'anthropic', model: 'fake', purpose: req.prompt.id, costMicroUsd: 10 });
      let data: unknown;
      switch (req.prompt.id) {
        case 'planner.lecture':
          data =
            planFor === 'first'
              ? {
                  // The bridge comes back first: the build puts it last.
                  parts: [
                    { title: 'Next week', minutes: 5, kind: 'bridge', questions: ['How do gluons bind quarks in neutron stars?'], mustInclude: false },
                    { title: 'Browsing rule', minutes: 35, kind: 'content', questions: [`Where may an okapi ${w} browse?`], mustInclude: false },
                  ],
                  leftOut: [],
                }
              : {
                  parts: [
                    { title: 'Where we left off', minutes: 5, kind: 'recap', questions: [`Where may an okapi ${w} browse?`], mustInclude: false },
                    { title: 'Browsing limits', minutes: 35, kind: 'content', questions: [`When may an okapi ${w} browse in the forest?`], mustInclude: false },
                  ],
                  leftOut: [],
                };
          break;
        case 'writer.part': {
          const partIndex = Number(/partIndex (\d+)/.exec(req.task)![1]);
          const none = /Tags available: none/.test(req.task);
          data = {
            written: {
              partIndex,
              slides: [
                {
                  layout: 'bullets',
                  title: none ? 'Coming up' : 'Browsing',
                  lines: none
                    ? [{ lineKey: 'x', text: 'What do you expect next week?', kind: 'question', claims: [] }]
                    : [
                        { lineKey: 'x', text: 'Last time we looked at the forest.', kind: 'transition', claims: [] },
                        { lineKey: 'x', text: 'An okapi may browse in the forest.', kind: 'claim', claims: [{ text: 'An okapi may browse in the forest.', type: 'rule', tag: 'S1', span: rule }] },
                        { lineKey: 'x', text: 'Forest browsing is the running theme: Zola the okapi.', kind: 'teaching', claims: [] },
                      ],
                  notes: [],
                },
              ],
              notFound: [],
              leftOut: [],
            },
            repairs: null,
          };
          break;
        }
        case 'checker.support': {
          const ids = [...req.task.matchAll(/ITEM id=(\S+)/g)].map((m) => m[1]!);
          data = { verdicts: ids.map((id) => ({ id, verdict: 'yes', reason: 'Supported.' })) };
          break;
        }
        case 'learn.summary':
          // "quantum tunnelling" is not on the slides: it must be dropped.
          data = { summary: 'Where an okapi may browse.', terms: ['browse', 'quantum tunnelling'], runningExample: 'Zola the okapi', openThreads: ['Browsing at night'] };
          break;
        default:
          throw new Error(`unexpected prompt ${req.prompt.id}`);
      }
      return { data: req.schema.parse(data), model: 'fake', tier: req.prompt.tier, escalated: false };
    },
  };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Course Test College', $2)", [college, `ct-${college}`]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'Planner')", [teacher, college, `c-${tag}@ct.test`]);
    await owner.query('insert into teacher_profiles (owner_id, college_id, style) values ($1, $2, $3)', [teacher, college, { density: 'balanced' }]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [college, `c-${tag}@ct.test`]);
    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query(`insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`, [sourceId, g, act, `ok-${tag}`]);
    await owner.query(
      `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding)
       values ($1, 'shared', $2, 1, 'section', $3, $4, '7', 'act', $5, $6, 'live', $7)`,
      [g, sourceId, `${act} › s. 7 Browsing`, act, `7. Browsing.—${rule}.`, `ck-${tag}`, toVector(fakeVector(`okapi ${w} browse browsing forest where when may the`))],
    );
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from lectures where college_id = $1', [college]);
    await owner.query('delete from courses where college_id = $1', [college]);
    await owner.query('delete from sources where id = $1', [sourceId]);
    for (const t of ['review_queue', 'library_gaps', 'usage', 'teacher_profiles', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await redis.del('rl_signin:::ffff:127.0.0.1', 'rl_signin:127.0.0.1', 'rl_signin:::1');
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  const config = () =>
    parseConfig({
      DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'ct.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
    });
  type Job = { name: string; data: { lectureId: string; ownerId: string; collegeId: string } };
  const built: Job[] = [];
  const learnt: Job[] = [];
  const fakeQueue = (into: Job[]) => ({ add: async (name: string, data: never) => (into.push({ name, data }), { id: `job-${into.length}` }) }) as never;
  let agent: ReturnType<typeof request.agent>;
  let csrf = '';
  let courseId = '';
  let units: { id: string; title: string; position: number }[] = [];
  const buildDeps = () => ({ worker, gateway: fakeGateway, voyageFor: () => fakeVoyage, lookup: null, publisher: null, minScore: 0.5 });
  const prepare = (unitId: string, extra: object = {}) =>
    agent
      .post('/api/v1/lectures')
      .set('x-csrf-token', csrf)
      .send({ topic: `okapi ${w} browsing`, course: { kind: 'course', courseId, unitId }, lengthMin: 40, level: 'standard', styleKey: 'usual', ...extra });

  it('creates a course from a pasted list, then reorders, renames and sets a prerequisite', async () => {
    agent = request.agent(createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis, queues: { build: fakeQueue(built), learn: fakeQueue(learnt) } }));
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', `10.92.${tag.charCodeAt(0)}.1`).send({ email: `c-${tag}@ct.test` }).expect(204);
    csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));

    const created = (await agent.post('/api/v1/courses').set('x-csrf-token', csrf).send({ name: 'Okapi Law', classCount: 3, topics: ['Browsing', 'Limits', 'Remedies'] }).expect(201)).body;
    courseId = created.id;
    expect(created.units.map((u: { title: string }) => u.title)).toEqual(['Browsing', 'Limits', 'Remedies']);
    const [b, l, r] = created.units as { id: string }[];
    const patched = (
      await agent
        .patch(`/api/v1/courses/${courseId}/units`)
        .set('x-csrf-token', csrf)
        .send({ order: [b!.id, r!.id, l!.id], rename: [{ id: r!.id, title: 'Browsing limits' }], prerequisites: [{ id: r!.id, prerequisites: [l!.id] }] })
        .expect(200)
    ).body;
    units = patched.units;
    expect(units.map((u) => [u.position, u.title])).toEqual([
      [1, 'Browsing'],
      [2, 'Browsing limits'],
      [3, 'Limits'],
    ]);
    expect(patched.units[1].prerequisites).toEqual([l!.id]);
    const home = (await agent.get('/api/v1/home').expect(200)).body;
    expect(home.courses).toEqual([{ id: courseId, name: 'Okapi Law', nextUnit: { id: b!.id, position: 1, title: 'Browsing' } }]);
  });

  it('lecture 1: no recap yet, a bridge to lecture 2 last, the whole outline for each part', async () => {
    const r = await prepare(units[0]!.id).expect(202);
    const lectureId = r.body.lectureId as string;
    await buildLecture(built[0]!.data, buildDeps());
    const planner = tasks.find((t) => t.id === 'planner.lecture')!.task;
    expect(planner).toContain('COURSE RECAP: no lecture taught yet: no recap. COURSE BRIDGE: yes: plan a bridge part last, to L02 Browsing limits.');
    expect(planner).toContain('No lecture of this course has been marked taught yet.');
    const lec = (await agent.get(`/api/v1/lectures/${lectureId}`).expect(200)).body;
    expect(lec.plan.parts.map((p: { kind: string }) => p.kind)).toEqual(['content', 'bridge']);
    expect(lec.course).toEqual({ id: courseId, name: 'Okapi Law', unitId: units[0]!.id, position: 1 });
    const writers = tasks.filter((t) => t.id === 'writer.part').map((t) => t.task);
    expect(writers).toHaveLength(2);
    for (const t of writers) expect(t).toContain('OUTLINE (the whole class):\nPart 1: Browsing rule (35 min, content).');
    // The bridge question finds nothing in the library: still written, with no sources to cite.
    expect(writers.find((t) => t.includes('PART 2: Next week'))).toContain('Tags available: none');
    const slides = (await agent.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body.slides as { layout: string; lines: { flag: string | null }[] }[];
    expect(slides.map((s) => s.layout)).toEqual(['bullets', 'bridge']);
    expect(slides[1]!.lines[0]!.flag).toBeNull();
  });

  it('mark taught → course memory, only from what is on her slides', async () => {
    const lectureId = built[0]!.data.lectureId;
    const res = (await agent.post(`/api/v1/lectures/${lectureId}/taught`).set('x-csrf-token', csrf).send({ taughtOn: '2026-11-20' }).expect(200)).body;
    expect(res.unitId).toBe(units[0]!.id);
    expect(learnt).toEqual([{ name: 'learn.summary', data: { lectureId, ownerId: teacher, collegeId: college } }]);
    const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(worker, { userId: teacher, collegeId: college, role: 'teacher' }, fn);
    const memory = await summariseTaught(learnt[0]!.data, { tenant, gateway: fakeGateway, usage: async () => {} });
    expect(memory).toMatchObject({ summary: 'Where an okapi may browse.', terms: ['browse'], runningExample: 'Zola the okapi', openThreads: ['Browsing at night'], cases: [] });
    const course = (await agent.get(`/api/v1/courses/${courseId}`).expect(200)).body;
    expect(course.units[0]).toMatchObject({ status: 'taught', taughtOn: '2026-11-20', memory: { summary: 'Where an okapi may browse.', terms: ['browse'] } });
  });

  it('a lecture whose prerequisite is not taught needs her go-ahead (HOME-10)', async () => {
    const r = await prepare(units[1]!.id).expect(422);
    expect(r.body.error.code).toBe('PREREQ_WARNING_UNACKED');
    expect(r.body.error.message).toContain('L03 Limits');
    await prepare(units[1]!.id, { prereqAck: true }).expect(202);
  });

  it('lecture 2 opens with a recap from course memory; the recap writer gets it as data', async () => {
    planFor = 'second';
    const before = tasks.length;
    await buildLecture(built[1]!.data, buildDeps());
    const mine = tasks.slice(before);
    const planner = mine.find((t) => t.id === 'planner.lecture')!.task;
    expect(planner).toContain('COURSE RECAP: yes: plan a recap part first');
    expect(planner).toContain('L01 Browsing (taught 2026-11-20): Where an okapi may browse.');
    expect(planner).toContain('Terms the class already knows: browse');
    expect(planner).toContain('Running example used in class: Zola the okapi');
    expect(planner).toContain('This lecture builds on lectures not taught yet (do not assume the class knows them): L03 Limits');
    const recap = mine.find((t) => t.id === 'writer.part' && t.task.includes('PART 1: Where we left off'))!.task;
    expect(recap).toMatch(/<<<[0-9a-f]{12} COURSE MEMORY>>>/);
    const slides = (await agent.get(`/api/v1/lectures/${built[1]!.data.lectureId}/slides`).expect(200)).body.slides as { layout: string }[];
    expect(slides[0]!.layout).toBe('recap');
  });

  it('series checks are suggestions; undoing "taught" clears the memory', async () => {
    await agent.post(`/api/v1/lectures/${built[1]!.data.lectureId}/taught`).set('x-csrf-token', csrf).send({ taughtOn: '2026-11-27' }).expect(200);
    const { checks } = (await agent.get(`/api/v1/courses/${courseId}/series-checks`).expect(200)).body as { checks: { kind: string; unitId: string }[] };
    expect(checks.map((c) => [c.kind, c.unitId])).toEqual([['untaught_prerequisite', units[1]!.id]]);
    await agent.delete(`/api/v1/lectures/${built[0]!.data.lectureId}/taught`).set('x-csrf-token', csrf).expect(204);
    const course = (await agent.get(`/api/v1/courses/${courseId}`).expect(200)).body;
    expect(course.units[0]).toMatchObject({ status: 'planned', memory: null });
    expect(course.checks.map((c: { kind: string }) => c.kind)).toEqual(['untaught_prerequisite', 'out_of_order']);
    await agent.patch(`/api/v1/courses/${courseId}/units`).set('x-csrf-token', csrf).send({ remove: [units[1]!.id] }).expect(400);
  });
});
