/**
 * A teacher's own notes, Option A (migration 0013, decision 2026-11-25), against the real database and storage:
 *  - upload over HTTP → read in the worker as her → private, split by heading, searchable only when named;
 *  - a search names no notes → none of hers comes back (row security alone would allow them all);
 *  - research for a lecture uses only the attached notes, always uses each one, and never an older note;
 *  - a newer version replaces the old one for lectures prepared later; a removed note is gone at once;
 *  - Prepare waits for a note still being read; another teacher never sees her notes.
 */
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '@nyaai/shared';
import type { z } from 'zod';
import { withTenant } from '@nyaai/db';
import type { LecturePlan } from '@nyaai/shared';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { researchLecture } from '../../src/services/build/research.ts';
import { attachedNotes, ingestUpload } from '../../src/services/ingest/note.ts';
import type { Gateway, GatewayRequest } from '../../src/services/llm-gateway/index.ts';
import { search, type SearchDeps } from '../../src/services/search/index.ts';
import { createStorage } from '../../src/services/storage/index.ts';
import { EMBED_DIMS, type Voyage } from '../../src/services/voyage/index.ts';

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
const noGaps: Gateway = {
  async run<Sc extends z.ZodType>(req: GatewayRequest<Sc>) {
    if (req.prompt.id !== 'research.gaps') throw new Error(`unexpected prompt ${req.prompt.id}`);
    return { data: req.schema.parse({ questions: [] }), model: 'fake', tier: req.prompt.tier, escalated: false };
  },
};

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.DATABASE_URL_WORKER || !process.env.REDIS_URL || !process.env.S3_BUCKET) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select exists (select 1 from information_schema.columns where table_name = 'lecture_inputs' and column_name = 'note_upload_ids') as ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();
const uniq = () => Array.from({ length: 9 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

describe.skipIf(!up)("a teacher's own notes (integration)", () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const other = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  const storage = up
    ? createStorage({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'ap-south-1',
        bucket: process.env.S3_BUCKET!,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      })
    : undefined;
  const jobs: { name: string; data: { uploadId?: string } }[] = [];
  const builds: unknown[] = [];
  const her = { userId: teacher, collegeId: college, role: 'teacher' as const };
  const ingest = (id: string, who = her) => ingestUpload(id, who, { worker, storage: storage!, voyageFor: () => fakeVoyage, embedModel: 'fake' });
  const tenant = <T,>(fn: (c: pg.PoolClient) => Promise<T>, who = her) => withTenant(worker, who, fn);
  const searchDeps = (): SearchDeps => ({ voyage: fakeVoyage, gateway: null, usage: async () => {}, minScore: 0.3 });

  const OLD = `# Seat ${w}\nOld view: the seat ${w} of arbitration is always Delhi oldmarker.`;
  const NEW = `# Seat ${w}\nNew view: the seat ${w} of arbitration is chosen by the parties newmarker.\n\n# Venue ${w}\nThe venue ${w} is only where hearings sit.`;
  const ANECDOTE = '# Classroom story\nA story about a cricket match and an umpire anecdotemarker.';
  const ids: Record<string, string> = {};

  const http = () =>
    createApp({
      config: parseConfig({
        DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
        SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'nt.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
      }),
      logger: pino({ level: process.env.NOTES_DEBUG ? 'error' : 'silent' }),
      pool: app,
      redis,
      storage,
      queues: {
        ingest: { add: async (name: string, data: never) => (jobs.push({ name, data }), { id: `job-${jobs.length}` }) } as never,
        build: { add: async (_: string, data: never) => (builds.push(data), { id: `b-${builds.length}` }) } as never,
      },
    });
  const signIn = async (email: string, ip: string) => {
    const agent = request.agent(http());
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', ip).send({ email }).expect(204);
    const csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));
    return { agent, csrf };
  };
  const upload = async (s: Awaited<ReturnType<typeof signIn>>, title: string, body: string, replaces?: string) =>
    (
      await s.agent
        .post(`/api/v1/notes?title=${encodeURIComponent(title)}&fileName=${encodeURIComponent(`${title}.md`)}${replaces ? `&replaces=${replaces}` : ''}`)
        .set('x-csrf-token', s.csrf)
        .set('content-type', 'text/markdown')
        .send(Buffer.from(body))
        .expect(202)
    ).body as { id: string; status: string };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Notes Test College', $2)", [college, `nt-${college}`]);
    for (const [id, email] of [[teacher, `t-${tag}@nt.test`], [other, `o-${tag}@nt.test`]] as const) {
      await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'T')", [id, college, email]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query("insert into consents (college_id, owner_id, version, processors) values ($1, $2, $3, '[]')", [college, id, CONSENT_VERSION]);
      await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [college, email]);
    }
  });

  afterAll(async () => {
    if (!owner) return;
    // Her rows are hers: removed as her (row security hides them from everyone else).
    for (const who of [her, { ...her, userId: other }]) {
      await tenant(async (c) => {
        await c.query('delete from lectures where owner_id = $1', [who.userId]);
        await c.query('update uploads set replaces = null, replaced_by = null where owner_id = $1', [who.userId]);
        await c.query('delete from uploads where owner_id = $1', [who.userId]);
        await c.query("delete from sources where owner_id = $1 and visibility = 'private'", [who.userId]);
      }, who);
    }
    for (const t of ['usage', 'teacher_profiles', 'consents', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  it('uploads over HTTP, then the worker reads each one as hers, split by heading', async () => {
    const s = await signIn(`t-${tag}@nt.test`, `10.93.${tag.charCodeAt(0)}.1`);
    await s.agent.post('/api/v1/notes?title=Bad&fileName=x.exe').set('x-csrf-token', s.csrf).set('content-type', 'application/octet-stream').send(Buffer.from('MZ')).expect(415);
    for (const [k, body] of [['old', OLD], ['new', NEW], ['anecdote', ANECDOTE]] as const) {
      const n = await upload(s, k, body);
      expect(n.status).toBe('queued');
      ids[k] = n.id;
    }
    expect(jobs.map((j) => j.name)).toEqual(['ingest.upload', 'ingest.upload', 'ingest.upload']);
    expect(jobs.map((j) => j.data.uploadId)).toEqual([ids.old, ids.new, ids.anecdote]);

    for (const k of ['old', 'new', 'anecdote']) expect(await ingest(ids[k]!)).toMatchObject({ kind: 'ready' });
    const list = (await s.agent.get('/api/v1/notes').expect(200)).body.notes as { id: string; status: string; sections: number }[];
    expect(list.find((n) => n.id === ids.new)).toMatchObject({ status: 'ready', sections: 2 });
    const chunks = await tenant(async (c) =>
      (await c.query("select k.header, k.visibility, k.source_type from chunks k join uploads u on u.source_id = k.source_id where u.id = $1 order by k.seq", [ids.new])).rows,
    );
    expect(chunks).toEqual([
      { header: `Your notes: new › Seat ${w}`, visibility: 'private', source_type: 'teacher_note' },
      { header: `Your notes: new › Venue ${w}`, visibility: 'private', source_type: 'teacher_note' },
    ]);
  });

  it('a search that names no notes returns none of hers; naming one returns only that one', async () => {
    const [newNote] = await tenant((c) => attachedNotes(c, [ids.new!]));
    const q = { query: `seat ${w} arbitration`, purpose: 'explore' as const, noExpand: true };
    const none = await tenant((c) => search(c, q, searchDeps()));
    expect(none.sources.some((x) => x.meta.private)).toBe(false);
    const one = await tenant((c) => search(c, { ...q, notes: [newNote!.sourceId] }, searchDeps()));
    expect(one.sources.some((x) => x.text.includes('newmarker'))).toBe(true);
    expect(one.sources.some((x) => x.text.includes('oldmarker'))).toBe(false);
  });

  it('research uses only the attached notes, and uses each one even when no search finds it', async () => {
    const attached = await tenant((c) => attachedNotes(c, [ids.new!, ids.anecdote!]));
    const plan: LecturePlan = {
      parts: [{ title: `Seat ${w} of arbitration`, minutes: 30, kind: 'content', questions: [`What is the seat ${w} of arbitration?`], mustInclude: false }],
      leftOut: [],
    };
    const notes = await researchLecture(
      { plan, topic: `Seat ${w}`, level: 'standard', filters: {}, conceptId: null, notes: attached.map((a) => a.sourceId) },
      { tenant, searchDeps, lookup: null, gateway: noGaps, usage: async () => {} },
    );
    const texts = notes.parts[0]!.sources.map((x) => x.text).join('\n');
    expect(texts).toContain('newmarker');
    expect(texts).toContain('anecdotemarker'); // no search found it; attached, so it is used
    expect(texts).not.toContain('oldmarker'); // her older note, not attached, never appears
    expect(notes.parts[0]!.sources.filter((x) => x.meta.private).every((x) => attached.some((a) => a.sourceId === x.sourceId))).toBe(true);
  });

  it('a newer version replaces the old one for lectures prepared later; a removed note is gone at once', async () => {
    const s = await signIn(`t-${tag}@nt.test`, `10.94.${tag.charCodeAt(0)}.1`);
    const v2 = await upload(s, 'new v2', NEW.replace('newmarker', 'versiontwomarker'), ids.new);
    expect(await ingest(v2.id)).toMatchObject({ kind: 'ready' });
    const [resolved] = await tenant((c) => attachedNotes(c, [ids.new!]));
    expect(resolved).toMatchObject({ uploadId: v2.id });
    expect(await tenant(async (c) => (await c.query('select status, replaced_by from uploads where id = $1', [ids.new])).rows[0])).toEqual({ status: 'replaced', replaced_by: v2.id });
    const q = { query: `seat ${w} arbitration`, purpose: 'explore' as const, noExpand: true };
    const found = await tenant((c) => search(c, { ...q, notes: [resolved!.sourceId] }, searchDeps()));
    expect(found.sources.some((x) => x.text.includes('versiontwomarker'))).toBe(true);
    expect(found.sources.some((x) => x.text.includes('newmarker'))).toBe(false);

    await s.agent.delete(`/api/v1/notes/${ids.anecdote}`).set('x-csrf-token', s.csrf).expect(204);
    expect(await tenant((c) => attachedNotes(c, [ids.anecdote!]))).toEqual([]);
    expect(await ingest(ids.anecdote!)).toEqual({ kind: 'removed' });
    const list = (await s.agent.get('/api/v1/notes').expect(200)).body.notes as { id: string }[];
    expect(list.map((n) => n.id).sort()).toEqual([ids.old, v2.id].sort());
  });

  it('Prepare waits for a note still being read, then keeps the attached notes on the lecture', async () => {
    const s = await signIn(`t-${tag}@nt.test`, `10.95.${tag.charCodeAt(0)}.1`);
    const reading = await upload(s, 'still reading', '# Draft\nNot read yet.');
    const body = { topic: `seat ${w}`, course: { kind: 'one_off' }, lengthMin: 40, level: 'standard', styleKey: 'usual' };
    const wait = await s.agent.post('/api/v1/lectures').set('x-csrf-token', s.csrf).send({ ...body, notes: [reading.id] }).expect(409);
    expect(wait.body.error.code).toBe('NOTES_NOT_READY');
    const ok = await s.agent.post('/api/v1/lectures').set('x-csrf-token', s.csrf).send({ ...body, notes: [ids.old] }).expect(202);
    const saved = await tenant(async (c) => (await c.query('select note_upload_ids from lecture_inputs where lecture_id = $1', [ok.body.lectureId])).rows[0]);
    expect(saved.note_upload_ids).toEqual([ids.old]);
  });

  it('another teacher never sees her notes, even by id; signed out, nothing at all', async () => {
    await request(http()).get('/api/v1/notes').expect(401);
    const o = await signIn(`o-${tag}@nt.test`, `10.96.${tag.charCodeAt(0)}.1`);
    expect((await o.agent.get('/api/v1/notes').expect(200)).body.notes).toEqual([]);
    const body = { topic: `seat ${w}`, course: { kind: 'one_off' }, lengthMin: 40, level: 'standard', styleKey: 'usual', notes: [ids.old] };
    await o.agent.post('/api/v1/lectures').set('x-csrf-token', o.csrf).send(body).expect(404);
    const theirs = { userId: other, collegeId: college, role: 'teacher' as const };
    expect(await tenant((c) => attachedNotes(c, [ids.old!]), theirs)).toEqual([]);
    const [mine] = await tenant((c) => attachedNotes(c, [ids.old!]));
    const r = await tenant((c) => search(c, { query: `seat ${w} arbitration`, purpose: 'explore', noExpand: true, notes: [mine!.sourceId] }, searchDeps()), theirs);
    expect(r.sources.some((x) => x.meta.private)).toBe(false);
  });
});
