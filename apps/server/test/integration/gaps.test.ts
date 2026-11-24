/**
 * Library gaps and the trusted-source lookup against the real database (migration 0004), with fake outside
 * services: a fake Voyage (bag-of-words), a fake India Code, a fake Indian Kanoon that serves one synthetic judgment,
 * and a fake web search. Creates its own college and users, and removes everything it created afterwards.
 */
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyGap } from '@nyaai/legal';
import { withTenant } from '@nyaai/db';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import type { IndiaCode, IndiaCodeAct } from '../../src/services/india-code/index.ts';
import type { Kanoon } from '../../src/services/kanoon/index.ts';
import { createGapLookup, recordGap, searchWithLookup, type LookupDeps } from '../../src/services/lookup/index.ts';
import { AlreadyHeldError, ingestKanoonJudgment } from '../../src/services/ingest/kanoon.ts';
import { keepReplacedCopy } from '../../src/services/ingest/judgment-pdf.ts';
import { createStorage } from '../../src/services/storage/index.ts';
import { noUsage } from '../../src/services/usage.ts';
import { EMBED_DIMS, type Voyage } from '../../src/services/voyage/index.ts';
import type { WebSearch } from '../../src/services/web-search/index.ts';

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
    return docs
      .map((d, index) => {
        const w = new Set(words(d));
        return { index, score: q.size ? [...q].filter((x) => w.has(x)).length / q.size : 0 };
      })
      .sort((a, b) => b.score - a.score);
  },
};

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.DATABASE_URL_LIBRARY || !process.env.REDIS_URL || !process.env.S3_BUCKET) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select to_regclass('public.library_gaps') is not null and exists (select 1 from colleges where is_global) as ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();

/** A letters-only word unique to this run, so the fake search finds only what this test created. */
const uniq = () => Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe.skipIf(!up)('library gaps and trusted-source lookup (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, library: pg.Pool, redis: Redis;
  const college = randomUUID();
  const t1 = randomUUID();
  const t2 = randomUUID();
  const editor = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  // A made-up Act unique to this run, so the test never depends on what the real library holds.
  const actName = `Harbour ${w[0]!.toUpperCase()}${w.slice(1)} Act`;
  const tid = 900_000_000 + Math.floor(Math.random() * 90_000_000);
  const kanoonUrl = `https://indiankanoon.org/doc/${tid}/`;
  const as = (userId: string, role: 'teacher' | 'library_editor' = 'teacher') => ({ userId, collegeId: college, role });
  /** Sources a test moved off the Kanoon link (an official copy took over), for clean-up. */
  const moved: string[] = [];

  // Fakes: India Code finds two Acts with the same name (so nothing is loaded automatically), Kanoon serves one judgment.
  const indiaCodeCalls: string[] = [];
  const fakeIndiaCode: IndiaCode = {
    findCentralActs: async (name) => {
      indiaCodeCalls.push(name);
      const y = 1950;
      const act = (id: string): IndiaCodeAct => ({ itemId: id, title: `The ${name}, ${y}`, year: y, repealed: false, actNumber: '1', pageUrl: `https://indiacode.gov.in/handle/${id}` });
      return [act('11111111-1111-1111-1111-111111111111'), act('22222222-2222-2222-2222-222222222222')];
    },
    englishPdf: async () => null,
  };
  const kanoonQueries: string[] = [];
  const fakeKanoon: Kanoon = {
    search: async (q) => {
      kanoonQueries.push(q);
      return q.includes(w) ? [{ tid, title: `Pelican Herd vs Harbour Board ${w} on 1 January, 1999`, publishdate: '1999-01-01', docsource: 'Supreme Court of India', docsize: null }] : [];
    },
    doc: async (id) => ({
      tid: id,
      title: `Pelican Herd vs Harbour Board ${w} on 1 January, 1999`,
      docsource: 'Supreme Court of India',
      doc: [
        `<h2 class="doc_title">Pelican Herd vs Harbour Board ${w} on 1 January, 1999</h2>`,
        `<p>1. The appellant keeps a pelican herd ${w} beside the harbour.</p>`,
        `<p>2. The Board fenced the harbour and the pelican herd ${w} could not nest.</p>`,
        `<p>3. Counsel argued that the fence kept the pelican herd ${w} from the harbour unlawfully.</p>`,
        `<p>4. We hold that a pelican herd ${w} may nest in a fenced harbour.</p>`,
        '<p>5. The appeal is allowed. No costs.</p>',
      ].join('\n'),
    }),
  };
  const fakeWeb: WebSearch = {
    findLeads: async () => [
      { title: 'Official page', url: 'https://indiacode.gov.in/handle/1', lastUpdated: '2026-11-01', checked: true },
      { title: 'Dead link', url: 'https://example.gov.in/gone', lastUpdated: null, checked: false },
    ],
  };
  let deps: LookupDeps;

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    library = new pg.Pool({ connectionString: process.env.DATABASE_URL_LIBRARY, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Gap Test College', $2)", [college, `gt-${college}`]);
    for (const [id, email, role] of [[t1, `t1-${tag}@gt.test`, 'teacher'], [t2, `t2-${tag}@gt.test`, 'teacher'], [editor, `ed-${tag}@gt.test`, 'library_editor']] as const) {
      await owner.query('insert into users (id, college_id, email, name, role) values ($1, $2, $3, $4, $5)', [id, college, email, email, role]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query('insert into invite_allowlist (college_id, email, role) values ($1, $2, $3)', [college, email, role]);
    }
    deps = {
      library,
      voyage: fakeVoyage,
      gateway: null,
      usage: noUsage,
      embedModel: 'fake',
      storage: createStorage({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'ap-south-1',
        bucket: process.env.S3_BUCKET!,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      }),
      kanoon: fakeKanoon,
      indiaCode: fakeIndiaCode,
      web: fakeWeb,
      cacheDays: 1,
    };
  });

  afterAll(async () => {
    if (!owner) return;
    const gaps = (await owner.query<{ id: string }>('select id from library_gaps where college_id = $1', [college])).rows.map((r) => r.id);
    const srcs = [...(await owner.query<{ id: string }>('select id from sources where url = $1', [kanoonUrl])).rows.map((r) => r.id), ...moved];
    await owner.query('delete from review_queue where ref_id = any($1) or college_id = $2', [[...gaps, ...srcs], college]);
    await owner.query('delete from sources where id = any($1)', [srcs]);
    await owner.query('delete from library_gaps where college_id = $1', [college]);
    for (const t of ['usage', 'teacher_profiles', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), library.end(), redis.quit()]);
  });

  const record = (userId: string, q: string) => withTenant(app, as(userId), (c) => recordGap(c, q, classifyGap(q, ['Indian Contract Act'])));

  it('counts asks and distinct teachers, and keeps one review item whose priority rises', async () => {
    const q = `Passing of property under the ${actName} ${tag}`;
    const id = await record(t1, q);
    expect(await record(t1, `passing of property under the ${actName.toLowerCase()} ${tag}?`)).toBe(id);
    expect(await record(t2, q)).toBe(id);
    const g = (await owner.query('select asks, teachers, kind, act_name, act_year, state from library_gaps where id = $1', [id])).rows[0];
    expect(g).toMatchObject({ asks: 3, teachers: 2, kind: 'act', act_name: actName, act_year: null, state: 'open' });
    const items = (await owner.query("select priority, state from review_queue where ref_id = $1 and kind = 'library_gap'", [id])).rows;
    expect(items).toEqual([{ priority: 2, state: 'open' }]);
  });

  it('hides the list from teachers and who asked from everyone; the editor sees the gap', async () => {
    const teacherSees = await withTenant(app, as(t1), async (c) => (await c.query('select count(*)::int n from library_gaps')).rows[0].n);
    expect(teacherSees).toBe(0);
    const editorSees = await withTenant(app, as(editor, 'library_editor'), async (c) => ({
      gaps: (await c.query('select count(*)::int n from library_gaps where college_id = $1', [college])).rows[0].n,
      askers: (await c.query('select count(*)::int n from library_gap_askers')).rows[0].n,
    }));
    expect(editorSees).toEqual({ gaps: 1, askers: 0 });
    await expect(withTenant(app, as(t1), (c) => c.query("insert into library_gaps (college_id, question_key, question, kind) values ($1, 'x', 'x', 'topic')", [college]))).rejects.toThrow(/row-level security/);
  });

  it('never loads an Act automatically when India Code has more than one match: links go to the editor', async () => {
    const id = (await owner.query<{ id: string }>('select id from library_gaps where college_id = $1', [college])).rows[0]!.id;
    const r = await createGapLookup(deps).run(id);
    expect(indiaCodeCalls).toEqual([actName]);
    expect(r.loadedSourceIds).toEqual([]);
    expect(r.state).toBe('open');
    expect(r.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual(['india_code:ambiguous', 'indian_kanoon:nothing', 'web:loaded']);
    // Only links that opened are kept; India Code's two candidates come first.
    expect(r.leads.map((l) => l.url)).toEqual([
      'https://indiacode.gov.in/handle/11111111-1111-1111-1111-111111111111',
      'https://indiacode.gov.in/handle/22222222-2222-2222-2222-222222222222',
      'https://indiacode.gov.in/handle/1',
    ]);
    // A second run within the cooldown does nothing; the editor can force it.
    expect((await createGapLookup(deps).run(id)).skipped).toBe('recent');
    expect((await createGapLookup(deps).run(id, { force: true })).skipped).toBeUndefined();
  });

  it('on a topic gap, loads the judgment from Indian Kanoon (provisional) and the second search finds it', async () => {
    const tenant = <T,>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(app, as(t1), fn);
    const r = await searchWithLookup(
      tenant,
      { query: `pelican herd ${w} nest fenced harbour`, purpose: 'explore', noExpand: true },
      { voyage: fakeVoyage, gateway: null, usage: noUsage, minScore: 0.5 },
      createGapLookup(deps),
    );
    expect(r.gap?.lookup?.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual(['indian_kanoon:loaded', 'web:loaded']);
    expect(r.gap?.recheck).toBe('ok');
    expect(r.outcome).toBe('ok');
    expect(r.sources.every((s) => s.provisional)).toBe(true);
    expect(r.sources.some((s) => s.text.includes('We hold that a pelican herd'))).toBe(true);
    const g = (await owner.query('select state, kind, loaded_source_ids from library_gaps where id = $1', [r.gap!.id])).rows[0];
    expect(g.state).toBe('answered');
    expect(g.kind).toBe('topic');
    const src = (await owner.query('select status, origin from sources where url = $1', [kanoonUrl])).rows[0];
    expect(src).toEqual({ status: 'provisional', origin: 'indian_kanoon' });
    // The query that left the system is the teacher's own words.
    expect(kanoonQueries.at(-1)).toBe(`pelican herd ${w} nest fenced harbour`);
  });

  it('lets the editor list, re-run and close gaps over HTTP; teachers get 403', async () => {
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'gt.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
    });
    const added: { name: string; data: unknown }[] = [];
    const fakeQueue = { add: async (name: string, data: unknown) => (added.push({ name, data }), { id: `job-${added.length}` }) };
    const http = createApp({ config, logger: pino({ level: 'silent' }), pool: app, redis, queues: { ingest: fakeQueue as never } });
    const signIn = async (email: string, ip: string) => {
      const agent = request.agent(http);
      const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', ip).send({ email }).expect(204);
      const csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));
      return { agent, csrf };
    };
    const ed = await signIn(`ed-${tag}@gt.test`, `10.77.${tag.charCodeAt(0)}.1`);
    const list = await ed.agent.get('/api/v1/library/gaps').expect(200);
    const gap = list.body.gaps.find((g: { kind: string }) => g.kind === 'act');
    expect(gap).toMatchObject({ teachers: 2, asks: 3, actName });
    expect(gap.leads.length).toBeGreaterThan(0);

    const run = await ed.agent.post(`/api/v1/library/gaps/${gap.id}/lookup`).set('x-csrf-token', ed.csrf).expect(202);
    expect(run.body.jobId).toBe('job-1');
    expect(added[0]).toMatchObject({ name: 'ingest.lookup', data: { gapId: gap.id, force: true } });

    const closed = await ed.agent.patch(`/api/v1/library/gaps/${gap.id}`).set('x-csrf-token', ed.csrf).send({ state: 'resolved', note: 'Loaded the Act by hand' }).expect(200);
    expect(closed.body).toMatchObject({ state: 'resolved', note: 'Loaded the Act by hand' });
    expect((await owner.query("select state from review_queue where ref_id = $1 and kind = 'library_gap'", [gap.id])).rows[0].state).toBe('resolved');
    const again = await ed.agent.post(`/api/v1/library/gaps/${gap.id}/lookup`).set('x-csrf-token', ed.csrf).expect(409);
    expect(again.body.error.code).toBe('GAP_CLOSED');

    const teacher = await signIn(`t1-${tag}@gt.test`, `10.78.${tag.charCodeAt(0)}.1`);
    await teacher.agent.get('/api/v1/library/gaps').expect(403);
  });
  it('one case, one source: a replaced Kanoon copy keeps its link; the same case is skipped; a maybe is asked', async () => {
    const lookup = async (n: number) => createGapLookup(deps).run(await record(t1, `pelican herd ${w} harbour round ${n}`));
    const kanoonStep = (r: { attempts: { provider: string; outcome: string; detail: string }[] }) => r.attempts.find((a) => a.provider === 'indian_kanoon')!;
    const held = (await owner.query<{ id: string }>('select id from sources where url = $1', [kanoonUrl])).rows[0]!.id;
    moved.push(held);

    // The official copy replaces the Kanoon text (as judgment-pdf does): the Kanoon copy stays on record.
    const c = await library.connect();
    try {
      await keepReplacedCopy(c, held, 0.97, `official-${w}`);
      await c.query("update sources set origin = 'court_site', url = $2, content_hash = $3, status = 'live' where id = $1", [held, `https://court.example/${w}.pdf`, `official-${w}`]);
    } finally {
      c.release();
    }
    // source_copies is library data: the library role reads it (the owner has no policy on it).
    const copy = (await library.query('select origin, url, in_use, agreement from source_copies where source_id = $1', [held])).rows;
    expect(copy).toEqual([{ origin: 'indian_kanoon', url: kanoonUrl, in_use: false, agreement: '0.970' }]);

    // 1. By link: Kanoon finds the same document again; it is not loaded, by the lookup or directly.
    const byLink = await lookup(1);
    expect(kanoonStep(byLink)).toMatchObject({ outcome: 'skipped' });
    expect(byLink.loadedSourceIds).toEqual([]);
    await expect(ingestKanoonJudgment(tid, { ...deps, kanoon: fakeKanoon, storage: deps.storage, cacheDays: 1 })).rejects.toBeInstanceOf(AlreadyHeldError);

    // 2. By case: without the link (an official copy loaded directly), parties + date + court still say "held".
    await library.query('delete from source_copies where source_id = $1', [held]);
    const byCase = await lookup(2);
    expect(kanoonStep(byCase)).toMatchObject({ outcome: 'skipped', detail: expect.stringContaining(`Pelican Herd v. Harbour Board ${w}`) });

    // 3. Maybe: same parties, another date. Loaded (never skipped when unsure), and the editor is asked.
    await owner.query("update sources set decided_on = '1998-05-05' where id = $1", [held]);
    const maybe = await lookup(3);
    expect(kanoonStep(maybe)).toMatchObject({ outcome: 'loaded', detail: expect.stringContaining('may be the same case as') });
    const second = maybe.loadedSourceIds[0]!;
    expect((await owner.query('select maybe_same_as from sources where id = $1', [second])).rows[0].maybe_same_as).toBe(held);

    // The editor answers on the review screen: approval waits for the answer; "same case" retires the copy and
    // keeps its link on the case that stays, so the next lookup skips it by link.
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'gt.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
    });
    const agent = request.agent(createApp({ config, logger: pino({ level: 'silent' }), pool: app, redis }));
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', `10.79.${tag.charCodeAt(0)}.1`).send({ email: `ed-${tag}@gt.test` }).expect(204);
    const csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((x) => x.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));
    const list = await agent.get('/api/v1/library/judgments').expect(200);
    expect(list.body.judgments.find((x: { id: string }) => x.id === second)).toMatchObject({ maybeSame: true });
    const detail = await agent.get(`/api/v1/library/judgments/${second}`).expect(200);
    expect(detail.body.maybeSameAs).toMatchObject({ id: held, title: `Pelican Herd v. Harbour Board ${w}`, decidedOn: '1998-05-05' });
    await agent.post(`/api/v1/library/judgments/${second}/approve`).set('x-csrf-token', csrf).expect(400);
    await agent.post(`/api/v1/library/judgments/${second}/same-case`).set('x-csrf-token', csrf).send({ same: true }).expect(204);
    expect((await owner.query('select status, maybe_same_as from sources where id = $1', [second])).rows[0]).toEqual({ status: 'retired', maybe_same_as: null });
    expect((await owner.query("select count(*)::int n from chunks where source_id = $1 and status <> 'retired'", [second])).rows[0].n).toBe(0);
    expect((await library.query('select url from source_copies where source_id = $1', [held])).rows).toEqual([{ url: kanoonUrl }]);
    expect(kanoonStep(await lookup(4))).toMatchObject({ outcome: 'skipped' });
  });
});
