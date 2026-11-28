/**
 * A quick Research run end to end (RES-1, RES-3, RES-4, RES-6), against the real database with the scripted fake AI:
 * started over HTTP (consent, ids only in the job), planned into sub-questions, gathered from the library, an evidence
 * table (relation, status no more than confirmed, the years she chose), a brief written from the evidence only with
 * every line checked (a planted wrong quote is caught), saved under "My research", and private to her.
 */
import { randomUUID } from 'node:crypto';
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
import { runResearch } from '../../src/services/research/index.ts';
import JSZip from 'jszip';
import { extractText } from 'unpdf';
import { toVector } from '../../src/services/voyage/index.ts';
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
          "select exists (select 1 from information_schema.columns where table_name = 'research_runs' and column_name = 'error_code') as ok",
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

describe.skipIf(!up)('quick Research (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const other = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq();
  const actId = randomUUID();
  const newCase = randomUUID();
  const oldCase = randomUUID();
  const jobs: { name: string; data: { runId: string; ownerId: string; collegeId: string } }[] = [];
  let plantWrongQuote = false;
  const fake = createFakeGateway();
  const gateway: Gateway = {
    async run<S extends z.ZodType>(req: GatewayRequest<S>, usage: Parameters<Gateway['run']>[1]) {
      const r = await fake.run(req, usage);
      if (plantWrongQuote && req.prompt.id === 'research.write') {
        const d = r.data as { keyPoints: unknown[] };
        d.keyPoints = [
          {
            text: 'An otter must always swim.',
            kind: 'claim',
            claims: [
              {
                text: 'An otter must always swim.',
                type: 'rule',
                tag: 'S1',
                span: `An otter ${w} must always swim in every river`,
              },
            ],
          },
        ];
      }
      return r;
    },
  };
  const deps = () => ({ worker, gateway, voyageFor: () => fakeVoyage, lookup: null, minScore: 0.3 });

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Research Test College', $2)", [
      college,
      `rs-${college}`,
    ]);
    for (const [id, email] of [
      [teacher, `t-${tag}@rs.test`],
      [other, `o-${tag}@rs.test`],
    ] as const) {
      await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'T')", [
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
    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    const act = `Otter ${w} Act`;
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`,
      [actId, g, act, `rs-${tag}`],
    );
    await owner.query(
      `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding, law_status)
       values ($1, 'shared', $2, 1, 'section', $3, $4, '9', 'act', $5, $6, 'live', $7, 'in_force')`,
      [
        g,
        actId,
        `${act} › s. 9 Otter rivers`,
        act,
        `9. Otter rivers.—An otter ${w} may swim in a river only with the leave of the river warden.`,
        `rsc-${tag}`,
        toVector(fakeVector(`otter ${w} swim river warden leave`)),
      ],
    );
    for (const [id, title, date, text] of [
      [
        newCase,
        `Otter ${w} v. River Warden`,
        '2021-03-01',
        `We hold that the otter ${w} needs the leave of the river warden before it swims in the river.`,
      ],
      [
        oldCase,
        `Heron ${w} v. Otter Board`,
        '1988-06-01',
        `The otter ${w} river warden leave was not required in 1988 for a swim in the river.`,
      ],
    ] as const) {
      await owner.query(
        `insert into sources (id, college_id, visibility, type, origin, title, court, court_level, decided_on, content_hash, status)
         values ($1, $2, 'shared', 'judgment', 'court_site', $3, 'Supreme Court of India', 'supreme_court', $4, $5, 'live')`,
        [id, g, title, date, `rsj-${id}`],
      );
      await owner.query(
        `insert into chunks (college_id, visibility, source_id, seq, kind, header, para_no, opinion, para_role, court, court_level, decided_on, source_type, text, content_hash, status, embedding)
         values ($1, 'shared', $2, 1, 'paragraph', $3, '1', 'majority', 'holding', 'Supreme Court of India', 'supreme_court', $4, 'judgment', $5, $6, 'live', $7)`,
        [g, id, `${title} (${date.slice(0, 4)}) › ¶1`, date, text, `rsjc-${id}`, toVector(fakeVector(text))],
      );
    }
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from sources where id = any($1::uuid[])', [[actId, newCase, oldCase]]);
    const gaps = (
      await owner.query<{ id: string }>('select id from library_gaps where question ilike $1', [`%${w}%`])
    ).rows.map((r) => r.id);
    await owner.query('delete from review_queue where ref_id = any($1::uuid[])', [gaps]);
    await owner.query('delete from library_gaps where id = any($1::uuid[])', [gaps]);
    for (const t of [
      'product_events',
      'evidence_items',
      'research_questions',
      'research_runs',
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

  const http = (research?: unknown) =>
    createApp({
      config: parseConfig({
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        SESSION_SECRET: 'a'.repeat(32),
        CSRF_SECRET: 'b'.repeat(32),
        ALLOWED_EMAIL_DOMAINS: 'rs.test',
        LOG_LEVEL: 'silent',
        NODE_ENV: 'development',
        DEV_LOGIN: 'true',
      }),
      logger: pino({ level: 'silent' }),
      pool: app,
      redis,
      queues: {
        research: (research ?? {
          add: async (name: string, data: never) => (jobs.push({ name, data }), { id: `r-${jobs.length}` }),
        }) as never,
      },
    });
  const signIn = async (email: string, n: number) => {
    const agent = request.agent(http());
    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.88.${tag.charCodeAt(0)}.${n}`)
      .send({ email })
      .expect(204);
    return {
      agent,
      csrf: csrfFrom(login),
    };
  };
  let runId = '';

  it('starts a run over HTTP: checked first, ids only in the job, "planning" until the worker takes it', async () => {
    const t = await signIn(`t-${tag}@rs.test`, 1);
    await request(http())
      .post('/api/v1/research')
      .send({ question: 'x' })
      .expect((r) => expect([401, 403]).toContain(r.status));
    await t.agent.post('/api/v1/research').set('x-csrf-token', t.csrf).send({ question: 'short' }).expect(400);
    const r = await t.agent
      .post('/api/v1/research')
      .set('x-csrf-token', t.csrf)
      .send({ question: `When may an otter ${w} swim in a river?`, scope: { comparative: false, fromYear: 2000 } })
      .expect(202);
    runId = r.body.id;
    expect(jobs).toEqual([{ name: 'research.run', data: { runId, ownerId: teacher, collegeId: college } }]);
    expect((await t.agent.get(`/api/v1/research/${runId}`).expect(200)).body).toMatchObject({
      status: 'planning',
      brief: null,
      subQuestions: [],
    });
  });

  it('the run plans, gathers, writes from the evidence only, checks every line, and saves', async () => {
    const r = await runResearch(jobs[0]!.data, deps());
    expect(r.evidence).toBeGreaterThan(0);
    const t = await signIn(`t-${tag}@rs.test`, 2);
    const view = (await t.agent.get(`/api/v1/research/${runId}`).expect(200)).body;
    expect(view.status).toBe('ready');
    expect(view.subQuestions).toHaveLength(3);
    const brief = view.brief;
    expect(brief.shortAnswer.length).toBe(1);
    // Every brief line quotes its evidence and passes the checks (an unconfirmed case is grey, never yellow).
    for (const l of [...brief.shortAnswer, ...brief.keyPoints]) expect(l.flag).not.toBe('yellow');
    // The evidence table: the Act in force, the 2021 case "Status not verified", the 1988 case left out (years from 2000).
    const titles = brief.evidence.map((e: { header: string }) => e.header).join(' | ');
    expect(titles).toContain('s. 9 Otter rivers');
    expect(titles).toContain(`Otter ${w} v. River Warden`);
    expect(titles).not.toContain(`Heron ${w} v. Otter Board`);
    const act = brief.evidence.find((e: { header: string }) => e.header.includes('s. 9'));
    expect(act).toMatchObject({ statusLabel: 'In force' });
    const judgment = brief.evidence.find((e: { header: string }) => e.header.includes('River Warden'));
    expect(judgment).toMatchObject({
      statusLabel: 'Status not verified',
      caseStatus: 'not_verified',
      court: 'Supreme Court of India',
    });
    expect(
      brief.evidence.every((e: { relation: string }) => ['supports', 'limits', 'conflicts'].includes(e.relation)),
    ).toBe(true);
    expect(
      brief.evidence.every((e: { spans: string[]; text: string }) => e.spans.every((s) => e.text.includes(s))),
    ).toBe(true);
    // Saved rows and the run's cost.
    const saved = (await owner.query('select count(*)::int n from evidence_items where run_id = $1', [runId])).rows[0]
      .n;
    expect(saved).toBe(brief.evidence.length);
    // "My research" lists it; it is hers alone.
    expect((await t.agent.get('/api/v1/research').expect(200)).body.runs.map((x: { id: string }) => x.id)).toContain(
      runId,
    );
    const o = await signIn(`o-${tag}@rs.test`, 3);
    await o.agent.get(`/api/v1/research/${runId}`).expect(404);
    expect((await o.agent.get('/api/v1/research').expect(200)).body.runs).toEqual([]);
  });

  it('a quote that is not in the evidence is caught and shown as a point to verify', async () => {
    const t = await signIn(`t-${tag}@rs.test`, 4);
    const r = await t.agent
      .post('/api/v1/research')
      .set('x-csrf-token', t.csrf)
      .send({ question: `Must an otter ${w} always swim in the river?` })
      .expect(202);
    plantWrongQuote = true;
    await runResearch(jobs.at(-1)!.data, deps());
    plantWrongQuote = false;
    const view = (await t.agent.get(`/api/v1/research/${r.body.id}`).expect(200)).body;
    expect(view.brief.keyPoints).toEqual([
      expect.objectContaining({
        text: 'An otter must always swim.',
        flag: 'yellow',
        reason: 'These words are not in the source',
      }),
    ]);
    expect(view.counts.yellow).toBe(1);

    // RES-5: Word and PDF carry the flag: a note on the line, and the closing "Please verify" list.
    const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const docx = await t.agent
      .post(`/api/v1/research/${r.body.id}/export`)
      .set('x-csrf-token', t.csrf)
      .send({ format: 'docx' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(docx.headers['content-disposition']).toMatch(
      /attachment; filename="Research_Must_An_Otter_\w+_Always_Swim_In_The_\d{4}-\d{2}-\d{2}\.docx"/,
    );
    expect(docx.headers['x-lines-to-verify']).toBe('1');
    const zip = await JSZip.loadAsync(docx.body as Buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('An otter must always swim.');
    expect(xml).toContain('Please verify (1)');
    expect(xml).toMatch(/<w:footnoteReference w:id="1"\/>/);
    expect(await zip.file('word/footnotes.xml')!.async('string')).toContain(
      'Please verify: These words are not in the source',
    );

    const pdf = await t.agent
      .post(`/api/v1/research/${r.body.id}/export`)
      .set('x-csrf-token', t.csrf)
      .send({ format: 'pdf' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const { text } = await extractText(new Uint8Array(pdf.body as Buffer), { mergePages: true });
    expect(text).toContain('An otter must always swim.');
    expect(text).toContain('Please verify (1)');
    expect(text).toContain('These words are not in the source');
    // Hers alone, and only when ready.
    const o = await signIn(`o-${tag}@rs.test`, 6);
    await o.agent
      .post(`/api/v1/research/${r.body.id}/export`)
      .set('x-csrf-token', o.csrf)
      .send({ format: 'pdf' })
      .expect(404);
    await t.agent
      .post(`/api/v1/research/${r.body.id}/export`)
      .set('x-csrf-token', t.csrf)
      .send({ format: 'rtf' })
      .expect(400);
  });

  it('a question the library cannot answer: an honest empty brief, and the library team hears of it', async () => {
    const t = await signIn(`t-${tag}@rs.test`, 5);
    const r = await t.agent
      .post('/api/v1/research')
      .set('x-csrf-token', t.csrf)
      .send({ question: `Quokka ${w} moonbeam zephyrs xylophonic?` })
      .expect(202);
    await runResearch(jobs.at(-1)!.data, deps());
    const view = (await t.agent.get(`/api/v1/research/${r.body.id}`).expect(200)).body;
    expect(view.status).toBe('ready');
    expect(view.brief).toMatchObject({
      shortAnswer: [],
      evidence: [],
      notFound: [`Quokka ${w} moonbeam zephyrs xylophonic?`],
    });
    // "My research" is paged: her three runs, two to a page, newest first.
    const p1 = (await t.agent.get('/api/v1/research?limit=2').expect(200)).body;
    expect(p1.runs).toHaveLength(2);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (await t.agent.get(`/api/v1/research?limit=2&cursor=${p1.nextCursor}`).expect(200)).body;
    expect(p2).toMatchObject({ runs: [expect.objectContaining({ id: runId })], nextCursor: null });
    await t.agent.get('/api/v1/research?cursor=forged').expect(400);
    // The library team has the question.
    expect(
      (await owner.query('select count(*)::int n from library_gaps where question ilike $1', [`%${w} moonbeam%`]))
        .rows[0].n,
    ).toBeGreaterThan(0);
  });

  it('when the queue refuses the run, it is "did not finish", not "planning" for ever', async () => {
    const agent = request.agent(http({ add: async () => Promise.reject(new Error('Redis is down')) }));

    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.88.${tag.charCodeAt(0)}.9`)
      .send({ email: `t-${tag}@rs.test` })
      .expect(204);
    await agent
      .post('/api/v1/research')
      .set('x-csrf-token', csrfFrom(login))
      .send({ question: `Can an otter ${w} refuse the queue?` })
      .expect(503);
    const run = (
      await owner.query('select status, error_code from research_runs where question like $1', [
        `%${w} refuse the queue%`,
      ])
    ).rows[0];
    expect(run).toMatchObject({ status: 'failed', error_code: 'SERVICE_UNAVAILABLE' });
  });
});
