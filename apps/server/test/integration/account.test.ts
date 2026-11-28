/**
 * "Export my data" and "Delete my data" (BRD NFR-8, migration 0015), against the real database and storage:
 *  - export: one zip of everything about her (rows and the files she uploaded), nothing of another teacher's;
 *  - delete: she confirms with her own email; she is signed out at once; the job removes every row about her, her
 *    private notes and their search text, her files, and closes her account; another teacher keeps everything;
 *    a question she asked the library stays, without her name; the deletion is logged with counts.
 */
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '@nyaai/shared';
import { classifyGap } from '@nyaai/legal';
import { withTenant } from '@nyaai/db';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { forgetTeacher } from '../../src/services/account/index.ts';
import { ingestUpload } from '../../src/services/ingest/note.ts';
import { recordGap } from '../../src/services/lookup/index.ts';
import { createStorage } from '../../src/services/storage/index.ts';
import { usageSink } from '../../src/services/usage.ts';
import { EMBED_DIMS, type Voyage } from '../../src/services/voyage/index.ts';
import { csrfFrom } from '../helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

const fakeVoyage: Voyage = {
  embed: async (texts) =>
    texts.map((t) => {
      const v = new Array<number>(EMBED_DIMS).fill(0);
      for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? [])
        v[createHash('md5').update(w).digest().readUInt16BE(0) % EMBED_DIMS]! += 1;
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    }),
  rerank: async (_q, docs) => docs.map((_, index) => ({ index, score: 1 })),
};

async function stackUp(): Promise<boolean> {
  if (
    !process.env.DATABASE_URL_MIGRATE ||
    !process.env.DATABASE_URL_WORKER ||
    !process.env.REDIS_URL ||
    !process.env.S3_BUCKET
  )
    return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (
      (await c.query("select exists (select 1 from pg_proc where proname = 'forget_teacher') as ok")).rows[0]?.ok ===
      true
    );
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();

describe.skipIf(!up)('export and delete my data (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const her = randomUUID();
  const other = randomUUID();
  const tag = college.slice(0, 8);
  const herEmail = `t-${tag}@acc.test`;
  const storage = up
    ? createStorage({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'ap-south-1',
        bucket: process.env.S3_BUCKET!,
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      })
    : undefined;
  const ingestJobs: { data: { uploadId: string } }[] = [];
  const opsJobs: { name: string; data: Record<string, unknown> }[] = [];
  const herId = { userId: her, collegeId: college, role: 'teacher' as const };
  const otherId = { userId: other, collegeId: college, role: 'teacher' as const };
  let gapId = '';
  let noteKey = '';

  const http = () =>
    createApp({
      config: parseConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        SESSION_SECRET: 'a'.repeat(32),
        CSRF_SECRET: 'b'.repeat(32),
        ALLOWED_EMAIL_DOMAINS: 'acc.test',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'development',
        DEV_LOGIN: 'true',
      }),
      logger: pino({ level: 'silent' }),
      pool: app,
      redis,
      storage,
      queues: {
        ingest: { add: async (_: string, data: never) => (ingestJobs.push({ data }), { id: 'i' }) } as never,
        build: { add: async () => ({ id: 'b' }) } as never,
        ops: {
          add: async (name: string, data: never) => (opsJobs.push({ name, data }), { id: `ops-${opsJobs.length}` }),
        } as never,
      },
    });
  const signIn = async (email: string, ip: string) => {
    const agent = request.agent(http());
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', ip).send({ email }).expect(204);
    const csrf = csrfFrom(login);
    return { agent, csrf };
  };

  /** Rows each teacher owns, counted as the owner role (it sees every row). */
  const owned = async (userId: string) => {
    const out: Record<string, number> = {};
    for (const t of [
      'courses',
      'course_units',
      'lectures',
      'lecture_inputs',
      'uploads',
      'examples',
      'usage',
      'teacher_profiles',
      'library_gap_askers',
    ]) {
      out[t] = (await owner.query(`select count(*)::int n from ${t} where owner_id = $1`, [userId])).rows[0].n;
    }
    out.private_sources = (
      await owner.query("select count(*)::int n from sources where owner_id = $1 and visibility = 'private'", [userId])
    ).rows[0].n;
    out.private_chunks = (
      await owner.query("select count(*)::int n from chunks where owner_id = $1 and visibility = 'private'", [userId])
    ).rows[0].n;
    return out;
  };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Account Test College', $2)", [
      college,
      `acc-${college}`,
    ]);
    for (const [id, email] of [
      [her, herEmail],
      [other, `o-${tag}@acc.test`],
    ] as const) {
      await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'Teacher')", [
        id,
        college,
        email,
      ]);
      await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [id, college]);
      await owner.query("insert into consents (college_id, owner_id, version, processors) values ($1, $2, $3, '[]')", [
        college,
        id,
        CONSENT_VERSION,
      ]);
      await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [college, email]);
    }
    // Both teachers have a course, a note, a lecture, an example, AI usage; she also asked the library a question.
    for (const [who, email, n] of [
      [herId, herEmail, 1],
      [otherId, `o-${tag}@acc.test`, 2],
    ] as const) {
      const s = await signIn(email, `10.98.${tag.charCodeAt(0)}.${n}`);
      await s.agent
        .post('/api/v1/courses')
        .set('x-csrf-token', s.csrf)
        .send({ name: `Course of ${email}`, topics: ['Seat of arbitration'] })
        .expect(201);
      const note = await s.agent
        .post(`/api/v1/notes?title=${encodeURIComponent(`Notes of ${email}`)}&fileName=notes.md`)
        .set('x-csrf-token', s.csrf)
        .set('content-type', 'text/markdown')
        .send(Buffer.from(`# Seat\nPrivate words of ${email}.`))
        .expect(202);
      await ingestUpload(note.body.id, who, {
        worker,
        storage: storage!,
        voyageFor: () => fakeVoyage,
        embedModel: 'fake',
      });
      await s.agent
        .post('/api/v1/lectures')
        .set('x-csrf-token', s.csrf)
        .send({
          topic: 'seat of arbitration',
          course: { kind: 'one_off' },
          lengthMin: 40,
          level: 'standard',
          styleKey: 'usual',
          notes: [note.body.id],
        })
        .expect(202);
      await withTenant(worker, who, async (c) => {
        await c.query(
          "insert into examples (college_id, owner_id, text) values ($1, $2, 'A Delhi company and a Mumbai company')",
          [college, who.userId],
        );
        // A built lecture has citations, and coverage notes that point at them (the order the deletion must respect).
        const lecture = (
          await c.query<{ id: string }>('select id from lectures where owner_id = $1 limit 1', [who.userId])
        ).rows[0]!.id;
        const citation = (
          await c.query<{ id: string }>(
            `insert into citations (college_id, owner_id, lecture_id, line_key, claim_text, claim_type, span_text, check_status, checks)
             values ($1, $2, $3, 'p0-s1-l1', 'The seat decides the court.', 'rule', 'the seat decides', 'supported', '[]') returning id`,
            [college, who.userId, lecture],
          )
        ).rows[0]!.id;
        await c.query(
          `insert into coverage_items (college_id, owner_id, lecture_id, section_key, item_kind, item_ref, state, covered_by)
           values ($1, $2, $3, 'ACA:s20', 'explanation', gen_random_uuid(), 'covered', $4)`,
          [college, who.userId, lecture, citation],
        );
        await usageSink(c, { collegeId: college, ownerId: who.userId })({
          provider: 'voyage',
          model: 'fake',
          purpose: 'test',
          costMicroUsd: 5,
        });
      });
      if (who === herId) {
        gapId = await withTenant(app, herId, (c) =>
          recordGap(c, `What is the seat ${tag}?`, classifyGap(`What is the seat ${tag}?`, [])),
        );
        noteKey = (
          await withTenant(worker, herId, (c) =>
            c.query<{ storage_key: string }>('select storage_key from uploads where owner_id = $1', [her]),
          )
        ).rows[0]!.storage_key;
      }
    }
  });

  afterAll(async () => {
    if (!owner) return;
    await withTenant(worker, otherId, async (c) => {
      await c.query('delete from lectures where owner_id = $1', [other]);
      await c.query('delete from uploads where owner_id = $1', [other]);
      await c.query("delete from sources where owner_id = $1 and visibility = 'private'", [other]);
    });
    await owner.query('delete from review_queue where ref_id = $1', [gapId]);
    await owner.query('delete from library_gaps where id = $1', [gapId]);
    await owner.query('delete from deletion_log where college_id = $1', [college]);
    for (const t of [
      'course_units',
      'courses',
      'examples',
      'usage',
      'teacher_profiles',
      'consents',
      'invite_allowlist',
      'users',
    ])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  it('exports everything about her, and nothing of another teacher, as one zip', async () => {
    const s = await signIn(herEmail, `10.99.${tag.charCodeAt(0)}.1`);
    const r = await s.agent
      .get('/api/v1/me/export-data')
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (d: Buffer) => parts.push(d));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="nyaai-my-data-\d{4}-\d{2}-\d{2}\.zip"/);
    const zip = await JSZip.loadAsync(r.body as Buffer);
    expect(Object.keys(zip.files).sort()).toEqual(['README.txt', 'my-data.json', 'notes/', 'notes/1-notes.md'].sort());
    const data = JSON.parse(await zip.file('my-data.json')!.async('string'));
    expect(data.account).toMatchObject({ email: herEmail });
    expect(data.courses.map((c: { name: string }) => c.name)).toEqual([`Course of ${herEmail}`]);
    expect(data.note_sections.map((x: { text: string }) => x.text)).toEqual([`Private words of ${herEmail}.`]);
    expect(data.lecture_inputs[0].note_upload_ids).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain(`o-${tag}@acc.test`); // nothing of the other teacher
    expect(await zip.file('notes/1-notes.md')!.async('string')).toContain(`Private words of ${herEmail}.`);
  });

  it('asks for her own email, signs her out at once, and queues the deletion for her only', async () => {
    const s = await signIn(herEmail, `10.99.${tag.charCodeAt(0)}.2`);
    await s.agent
      .post('/api/v1/me/delete-data')
      .set('x-csrf-token', s.csrf)
      .send({ confirmEmail: `o-${tag}@acc.test` })
      .expect(400);
    expect(opsJobs).toEqual([]);
    const r = await s.agent
      .post('/api/v1/me/delete-data')
      .set('x-csrf-token', s.csrf)
      .send({ confirmEmail: herEmail.toUpperCase() })
      .expect(202);
    expect(r.headers['set-cookie']?.toString()).toMatch(/nyaai_session=;/);
    expect(opsJobs).toEqual([{ name: 'ops.delete_user_data', data: { userId: her, collegeId: college } }]);
    await s.agent.get('/api/v1/me').expect(401); // signed out
  });

  it('the job removes everything about her, closes her account, and leaves the other teacher untouched', async () => {
    const before = await owned(other);
    expect(Object.values(await owned(her)).every((n) => n > 0)).toBe(true);
    expect(await storage!.exists(noteKey)).toBe(true);

    const r = await forgetTeacher(herId, { worker, storage: storage! });
    expect(r.files).toBe(1);
    expect(r.counts).toMatchObject({
      courses: 1,
      lectures: 1,
      uploads: 1,
      sources: 1,
      examples: 1,
      invite_allowlist: 1,
      library_gap_askers: 1,
      citations: 1,
      coverage_items: 1,
    });

    expect(Object.values(await owned(her)).every((n) => n === 0)).toBe(true);
    expect(await storage!.exists(noteKey)).toBe(false);
    const account = (await owner.query('select email, name, google_sub, status from users where id = $1', [her]))
      .rows[0];
    expect(account).toEqual({
      email: `removed-${her}@removed.invalid`,
      name: 'Removed teacher',
      google_sub: null,
      status: 'removed',
    });
    expect(
      (await owner.query('select count(*)::int n from invite_allowlist where email = $1', [herEmail])).rows[0].n,
    ).toBe(0);
    // Her question stays a library question, without her name.
    expect((await owner.query('select question from library_gaps where id = $1', [gapId])).rows[0].question).toContain(
      'seat',
    );
    const log = (await owner.query('select counts, finished_at from deletion_log where subject_user_id = $1', [her]))
      .rows[0];
    expect(log.finished_at).not.toBeNull();
    expect(log.counts).toMatchObject({ files: 1, lectures: 1 });

    expect(await owned(other)).toEqual(before);
    // Her email can no longer sign in (the invite is gone).
    await request(http())
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.99.${tag.charCodeAt(0)}.3`)
      .send({ email: herEmail })
      .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));
  });

  it('nobody can delete another teacher’s data: the function refuses anyone but her', async () => {
    await expect(withTenant(worker, herId, (c) => c.query('select forget_teacher($1)', [other]))).rejects.toThrow(
      /only the teacher herself/,
    );
  });

  it('withdrawing consent pauses everything that sends her work out; her data stays and she can still take it', async () => {
    const o = await signIn(`o-${tag}@acc.test`, `10.99.${tag.charCodeAt(0)}.4`);
    expect((await o.agent.get('/api/v1/me').expect(200)).body.consented).toBe(true);
    await o.agent.post('/api/v1/consents/withdraw').set('x-csrf-token', o.csrf).expect(204);
    expect((await o.agent.get('/api/v1/me').expect(200)).body.consented).toBe(false);

    const lecture = {
      topic: 'seat of arbitration',
      course: { kind: 'one_off' },
      lengthMin: 40,
      level: 'standard',
      styleKey: 'usual',
    };
    const refused = await o.agent.post('/api/v1/lectures').set('x-csrf-token', o.csrf).send(lecture).expect(403);
    expect(refused.body.error.code).toBe('CONSENT_REQUIRED');
    await o.agent
      .post('/api/v1/notes?title=x&fileName=x.md')
      .set('x-csrf-token', o.csrf)
      .set('content-type', 'text/markdown')
      .send(Buffer.from('# A\nb'))
      .expect(403);
    await o.agent
      .post('/api/v1/courses')
      .set('x-csrf-token', o.csrf)
      .send({ name: 'Course C', topics: ['One'], findSources: true })
      .expect(403);
    // Nothing is deleted, and she can still download it.
    await o.agent.get('/api/v1/me/export-data').expect(200);
    expect((await owner.query('select count(*)::int n from lectures where owner_id = $1', [other])).rows[0].n).toBe(1);

    // She agrees again: work resumes.
    await o.agent
      .post('/api/v1/consents')
      .set('x-csrf-token', o.csrf)
      .send({ version: CONSENT_VERSION, accept: true })
      .expect(204);
    await o.agent.post('/api/v1/lectures').set('x-csrf-token', o.csrf).send(lecture).expect(202);
  });
});
