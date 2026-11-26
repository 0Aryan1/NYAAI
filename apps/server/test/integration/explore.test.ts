/**
 * Explore (EXP-1, EXP-2), against the real database: the concept list, the topic map (key sections, leading cases
 * with their confirmation, her courses), and a follow-up question answered closed-book from the library with every
 * claim checked: a planted wrong quote is caught, a question the library cannot answer says so and reaches the
 * library team, and nothing runs without consent.
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
import { CONSENT_VERSION } from '@nyaai/shared';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { createFakeGateway } from '../../src/services/llm-gateway/fake.ts';
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
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select exists (select 1 from pg_proc where proname = 'resolve_wrong_fact_report') as ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();
const uniq = () => Array.from({ length: 9 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe.skipIf(!up)('Explore (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  const act = `Heron ${w} Act`;
  const actId = randomUUID();
  const caseA = randomUUID();
  const caseB = randomUUID();
  const concept = randomUUID();
  const RULE = `A heron ${w} may nest on the riverbank only with the consent of the riverbank owner`;
  // Planted for one question: a quote that is not in the source (C2 must catch it).
  let plantWrongQuote = false;
  const fake = createFakeGateway();
  const gateway: Gateway = {
    async run<S extends z.ZodType>(req: GatewayRequest<S>, usage: Parameters<Gateway['run']>[1]) {
      if (plantWrongQuote && req.prompt.id === 'explore.answer') {
        const data = { lines: [{ text: 'A heron must always nest.', kind: 'claim', claims: [{ text: 'A heron must always nest.', type: 'rule', tag: 'S1', span: `A heron ${w} must always nest on every riverbank` }] }], notFound: [] };
        return { data: req.schema.parse(data), model: 'fake', tier: req.prompt.tier, escalated: false };
      }
      return fake.run(req, usage);
    },
  };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Explore Test College', $2)", [college, `ex-${college}`]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'T')", [teacher, college, `t-${tag}@ex.test`]);
    await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [teacher, college]);
    await owner.query("insert into consents (college_id, owner_id, version, processors) values ($1, $2, $3, '[]')", [college, teacher, CONSENT_VERSION]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [college, `t-${tag}@ex.test`]);
    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query(`insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`, [actId, g, act, `ex-${tag}`]);
    const chunk = (
      await owner.query<{ id: string }>(
        `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding)
         values ($1, 'shared', $2, 1, 'section', $3, $4, '7', 'act', $5, $6, 'live', $7) returning id`,
        [g, actId, `${act} › s. 7 Nesting`, act, `7. Nesting.—${RULE}.`, `exc-${tag}`, toVector(fakeVector(`heron ${w} nest riverbank consent owner`))],
      )
    ).rows[0]!.id;
    for (const [id, title, year] of [[caseA, `Heron ${w} v. Riverbank Board`, 2019], [caseB, `Egret ${w} v. State`, 2001]] as const) {
      await owner.query(
        `insert into sources (id, college_id, visibility, type, origin, title, court, court_level, decided_on, content_hash, status)
         values ($1, $2, 'shared', 'judgment', 'court_site', $3, 'Supreme Court of India', 'supreme_court', $4, $5, 'live')`,
        [id, g, title, `${year}-01-01`, `exj-${id}`],
      );
    }
    await owner.query("insert into legal_concepts (id, college_id, name, aliases, subject) values ($1, $2, $3, $4, 'Property Law')", [concept, g, `Heron ${w} nesting`, [`nesting ${w}`]]);
    await owner.query("insert into concept_links (concept_id, source_id, chunk_id, kind) values ($1, $2, $3, 'key_section')", [concept, actId, chunk]);
    await owner.query("insert into concept_links (concept_id, source_id, kind, confirmed_at) values ($1, $2, 'leading_case', now())", [concept, caseA]);
    await owner.query("insert into concept_links (concept_id, source_id, kind) values ($1, $2, 'leading_case')", [concept, caseB]);
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from concept_links where concept_id = $1', [concept]);
    await owner.query('delete from legal_concepts where id = $1', [concept]);
    await owner.query('delete from sources where id = any($1::uuid[])', [[actId, caseA, caseB]]);
    const gaps = (await owner.query<{ id: string }>('select id from library_gaps where question ilike $1', [`%${w}%`])).rows.map((r) => r.id);
    await owner.query('delete from review_queue where ref_id = any($1::uuid[])', [gaps]);
    await owner.query('delete from library_gaps where id = any($1::uuid[])', [gaps]);
    for (const t of ['course_units', 'courses', 'usage', 'teacher_profiles', 'consents', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), redis.quit()]);
  });

  const http = () =>
    createApp({
      config: parseConfig({
        DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
        SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'ex.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
      }),
      logger: pino({ level: 'silent' }),
      pool: app,
      redis,
      search: { voyage: () => fakeVoyage, gateway, minScore: 0.3 },
    });
  let agent: ReturnType<typeof request.agent>;
  let csrf = '';

  it('lists the concept and opens its topic map: key section, leading cases (confirmed or not), her course', async () => {
    agent = request.agent(http());
    await request(http()).get('/api/v1/explore/concepts').expect(401);
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', `10.89.${tag.charCodeAt(0)}.1`).send({ email: `t-${tag}@ex.test` }).expect(204);
    csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));
    await agent.post('/api/v1/courses').set('x-csrf-token', csrf).send({ name: 'Property Law', topics: ['Introduction', `Heron ${w} nesting rights`] }).expect(201);

    const list = (await agent.get(`/api/v1/explore/concepts?q=nesting ${w}`).expect(200)).body.concepts;
    expect(list).toEqual([{ id: concept, name: `Heron ${w} nesting`, subject: 'Property Law', aliases: [`nesting ${w}`], keySections: 1, leadingCases: 2 }]);

    const map = (await agent.get(`/api/v1/explore/topic/${concept}`).expect(200)).body;
    expect(map.keySections).toEqual([expect.objectContaining({ act, number: '7', excerpt: `7. Nesting.—${RULE}.` })]);
    expect(map.leadingCases.map((c: { title: string; confirmed: boolean; year: number }) => [c.title, c.confirmed, c.year])).toEqual([
      [`Heron ${w} v. Riverbank Board`, true, 2019],
      [`Egret ${w} v. State`, false, 2001],
    ]);
    expect(map.inCourses).toEqual([expect.objectContaining({ courseName: 'Property Law', position: 2, title: `Heron ${w} nesting rights` })]);
    await agent.get(`/api/v1/explore/topic/${randomUUID()}`).expect(404);
  });

  it('answers a follow-up from the library: every claim quotes its source and passes the checks', async () => {
    const r = (await agent.post('/api/v1/explore/ask').set('x-csrf-token', csrf).send({ question: `When may a heron ${w} nest on the riverbank?`, conceptId: concept }).expect(200)).body;
    expect(r.outcome).not.toBe('not_found');
    expect(r.lines.length).toBeGreaterThan(0);
    // Supported everywhere; a judgment no expert has confirmed yet is grey ("Status not verified"), never yellow.
    expect(r.lines.every((l: { status: string; flag: string | null }) => l.status === 'supported' && l.flag !== 'yellow')).toBe(true);
    expect(r.lines.find((l: { sources: { label: string }[] }) => l.sources.some((x) => x.label.startsWith('s. 7')))).toMatchObject({ flag: null });
    const s1 = r.sources.find((s: { header: string }) => s.header.includes('s. 7'));
    expect(s1.spans.every((sp: string) => s1.text.includes(sp))).toBe(true);
  });

  it('a quote that is not in the source is caught (C2) and shown as a point to verify', async () => {
    plantWrongQuote = true;
    const r = (await agent.post('/api/v1/explore/ask').set('x-csrf-token', csrf).send({ question: `Must a heron ${w} nest on the riverbank?`, conceptId: concept }).expect(200)).body;
    plantWrongQuote = false;
    expect(r.lines).toEqual([expect.objectContaining({ text: 'A heron must always nest.', status: 'open', flag: 'yellow', reason: 'These words are not in the source' })]);
  });

  it('a question the library cannot answer says so, and the library team gets the question', async () => {
    const r = (await agent.post('/api/v1/explore/ask').set('x-csrf-token', csrf).send({ question: `What did the ${w} quokka tribunal decide about moonlight?` }).expect(200)).body;
    expect(r).toMatchObject({ outcome: 'not_found', lines: [], libraryTold: true });
    expect((await owner.query('select count(*)::int n from library_gaps where question ilike $1', [`%${w} quokka%`])).rows[0].n).toBe(1);
  });

  it('nothing is sent out without her consent', async () => {
    await agent.post('/api/v1/consents/withdraw').set('x-csrf-token', csrf).expect(204);
    const r = await agent.post('/api/v1/explore/ask').set('x-csrf-token', csrf).send({ question: `When may a heron ${w} nest?` }).expect(403);
    expect(r.body.error.code).toBe('CONSENT_REQUIRED');
    await agent.get(`/api/v1/explore/topic/${concept}`).expect(200); // reading the library stays open
  });

  it("the library editor confirms a topic's leading case (or removes it); Explore and lectures follow", async () => {
    await agent.get('/api/v1/library/topics').expect(403); // teachers do not confirm
    const editor = randomUUID();
    const email = `ed-${tag}@ex.test`;
    await owner.query("insert into users (id, college_id, email, name, role) values ($1, $2, $3, 'Expert', 'library_editor')", [editor, college, email]);
    await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [editor, college]);
    await owner.query("insert into invite_allowlist (college_id, email, role) values ($1, $2, 'library_editor')", [college, email]);
    const ed = request.agent(http());
    const login = await ed.post('/api/v1/auth/dev-login').set('x-forwarded-for', `10.89.${tag.charCodeAt(0)}.2`).send({ email }).expect(204);
    const tok = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));

    const toConfirm = (await ed.get('/api/v1/library/topics').expect(200)).body;
    const mine = toConfirm.topics.find((t: { conceptId: string }) => t.conceptId === concept);
    expect(mine.cases.map((c: { title: string }) => c.title)).toEqual([`Egret ${w} v. State`]); // only the unconfirmed one
    expect(toConfirm.unconfirmed).toBeGreaterThanOrEqual(1);

    await ed.post(`/api/v1/library/topics/${concept}/cases/${caseB}/confirm`).set('x-csrf-token', tok).expect(204);
    const all = (await ed.get('/api/v1/library/topics?show=all').expect(200)).body.topics.find((t: { conceptId: string }) => t.conceptId === concept);
    expect(all.cases.find((c: { sourceId: string }) => c.sourceId === caseB)).toMatchObject({ confirmedBy: 'Expert' });
    const map = (await agent.get(`/api/v1/explore/topic/${concept}`).expect(200)).body;
    expect(map.leadingCases.every((c: { confirmed: boolean }) => c.confirmed)).toBe(true);

    await ed.delete(`/api/v1/library/topics/${concept}/cases/${caseB}/confirm`).set('x-csrf-token', tok).expect(204);
    expect((await owner.query("select confirmed_at from concept_links where concept_id = $1 and source_id = $2 and kind = 'leading_case'", [concept, caseB])).rows[0].confirmed_at).toBeNull();

    // Not this topic: the link goes.
    await ed.delete(`/api/v1/library/topics/${concept}/cases/${caseB}`).set('x-csrf-token', tok).expect(204);
    expect((await agent.get(`/api/v1/explore/topic/${concept}`).expect(200)).body.leadingCases.map((c: { sourceId: string }) => c.sourceId)).toEqual([caseA]);
    await ed.delete(`/api/v1/library/topics/${concept}/cases/${caseB}`).set('x-csrf-token', tok).expect(404);

    // Removed by mistake: put back, unconfirmed.
    await ed.post(`/api/v1/library/topics/${concept}/cases/${caseB}`).set('x-csrf-token', tok).expect(204);
    expect((await owner.query("select confirmed_at from concept_links where concept_id = $1 and source_id = $2 and kind = 'leading_case'", [concept, caseB])).rows).toEqual([{ confirmed_at: null }]);
    await ed.post(`/api/v1/library/topics/${concept}/cases/${randomUUID()}`).set('x-csrf-token', tok).expect(404);
    await agent.post(`/api/v1/library/topics/${concept}/cases/${caseB}`).set('x-csrf-token', csrf).expect(403);
  });
});
