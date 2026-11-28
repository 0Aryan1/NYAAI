/**
 * The lecture build end to end against the real database (worker role, RLS on), with a scripted fake Claude and a
 * bag-of-words fake Voyage. The fake writer plants errors; the test checks each is caught, repaired or flagged:
 *  - words not in the source (C2) → repaired with the right words → supported;
 *  - "held" resting on a statute (C7) → repair gives no answer → yellow;
 *  - a teaching line that states law with no claim → yellow "No source for this statement" (by the word rules, or
 *    by the unsourced-line check when the words give nothing away);
 *  - a claim the support check calls "partly" (C9) → repair drops the line;
 *  - a time limit (high risk) → second check (C10) runs → supported;
 *  - a part the library cannot answer → "Not found in the library";
 *  - the section's Explanation, never cited → a coverage note; the teacher can leave it out.
 * Then the Prepare, slides, source and coverage endpoints over HTTP.
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
import type { z } from 'zod';
import type { PromptId } from '@nyaai/prompts';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { buildLecture } from '../../src/services/build/index.ts';
import { checkEditedLines } from '../../src/services/edit/check-lines.ts';
import { withTenant } from '@nyaai/db';
import type { Gateway, GatewayRequest } from '../../src/services/llm-gateway/index.ts';
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
          "select exists (select 1 from information_schema.columns where table_name = 'citations' and column_name = 'source_label') as ok",
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

describe.skipIf(!up)('lecture build (integration, fake Claude)', () => {
  let owner: pg.Pool, app: pg.Pool, worker: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const sourceId = randomUUID();
  const tag = college.slice(0, 8);
  const w = uniq(); // a word only this run's act contains
  const act = `Zebra ${w} Act`;
  const calls: PromptId[] = [];
  const secondChecked: string[] = [];
  const writerTasks: string[] = [];
  const gapTasks: string[] = [];
  let lectureId = '';

  const S = {
    mayMeadow: `A zebra ${w} may graze in the meadow`,
    notOrchard: `A zebra ${w} may not graze in the orchard`,
    leave: `A zebra ${w} must leave the meadow within 30 days of notice`,
  };

  /** Scripted Claude: answers by prompt id, and validates through the request's own schema like the real gateway. */
  const fakeGateway: Gateway = {
    async run<Sc extends z.ZodType>(req: GatewayRequest<Sc>, usage: Parameters<Gateway['run']>[1]) {
      calls.push(req.prompt.id);
      await usage({ provider: 'anthropic', model: 'fake', purpose: req.prompt.id, costMicroUsd: 10 });
      let data: unknown;
      switch (req.prompt.id) {
        case 'planner.lecture':
          data = {
            parts: [
              {
                title: 'Grazing rule',
                minutes: 30,
                kind: 'content',
                questions: [`When may a zebra ${w} graze in the meadow or the orchard?`],
                mustInclude: false,
              },
              {
                title: 'Quantum chromodynamics',
                minutes: 10,
                kind: 'content',
                questions: ['How do gluons bind quarks in neutron stars?'],
                mustInclude: false,
              },
            ],
            leftOut: [{ item: 'Grazing tolls', reason: 'Outside this class' }],
          };
          break;
        case 'research.gaps':
          // Round 1 asks one question the library cannot answer; nothing new turns up, so there is no round 2.
          gapTasks.push(req.task);
          data = {
            questions:
              gapTasks.length === 1
                ? [
                    {
                      why: 'Part 2 found nothing.',
                      part: 2,
                      question: 'What holds quarks together inside a neutron star?',
                    },
                  ]
                : [],
          };
          break;
        case 'writer.part':
          writerTasks.push(req.task);
          data = {
            partIndex: 0,
            slides: [
              {
                layout: 'bullets',
                title: 'Where a zebra may graze',
                lines: [
                  {
                    lineKey: 'x',
                    text: 'A zebra may graze in the meadow.',
                    kind: 'claim',
                    claims: [{ text: 'A zebra may graze in the meadow.', type: 'rule', tag: 'S1', span: S.mayMeadow }],
                  },
                  {
                    lineKey: 'x',
                    text: 'A zebra may graze in the orchard.',
                    kind: 'claim',
                    claims: [
                      {
                        text: 'A zebra may graze in the orchard.',
                        type: 'rule',
                        tag: 'S1',
                        span: `A zebra ${w} may graze in the orchard`,
                      },
                    ],
                  },
                  {
                    lineKey: 'x',
                    text: 'The court held that zebras may graze.',
                    kind: 'claim',
                    claims: [
                      { text: 'The court held that zebras may graze.', type: 'holding', tag: 'S1', span: S.mayMeadow },
                    ],
                  },
                  { lineKey: 'x', text: 'Section 901 makes grazing lawful.', kind: 'teaching', claims: [] },
                  { lineKey: 'x', text: 'Think about why meadows matter.', kind: 'teaching', claims: [] },
                  {
                    lineKey: 'x',
                    text: 'So only the meadow court hears grazing quarrels.',
                    kind: 'teaching',
                    claims: [],
                  },
                  {
                    lineKey: 'x',
                    text: 'A zebra must always graze.',
                    kind: 'claim',
                    claims: [{ text: 'A zebra must always graze.', type: 'rule', tag: 'S1', span: S.mayMeadow }],
                  },
                ],
                notes: [
                  {
                    text: 'A zebra must leave within 30 days of notice.',
                    claims: [
                      {
                        text: 'A zebra must leave within 30 days of notice.',
                        type: 'time_limit',
                        tag: 'S1',
                        span: S.leave,
                      },
                    ],
                  },
                ],
              },
            ],
            notFound: [],
            leftOut: [],
          };
          break;
        case 'writer.repair': {
          // Fix the orchard line (p0-s1-l2); give no answer for the "held" line; drop the "always" line.
          data = {
            repairs: [
              {
                id: 'p0-s1-l2',
                action: 'replace',
                lineText: 'A zebra may not graze in the orchard.',
                claims: [
                  { text: 'A zebra may not graze in the orchard.', type: 'rule', tag: 'S1', span: S.notOrchard },
                ],
              },
              { id: 'p0-s1-l7', action: 'drop', lineText: null, claims: [] },
            ],
          };
          break;
        }
        case 'checker.support': {
          const ids = [...req.task.matchAll(/ITEM id=(\S+)\nCLAIM: (.*)/g)].map((m) => ({ id: m[1]!, claim: m[2]! }));
          data = {
            verdicts: ids.map((x) => ({
              id: x.id,
              verdict: /always/.test(x.claim) ? 'partly' : 'yes',
              reason: /always/.test(x.claim) ? 'The source says may, not must always.' : 'Supported.',
            })),
          };
          break;
        }
        case 'checker.unsourced': {
          const items = [...req.task.matchAll(/ITEM id=(\S+)\n<<<\w+ line>>>\n(.*)/g)].map((m) => ({
            id: m[1]!,
            text: m[2]!,
          }));
          data = { verdicts: items.map((x) => ({ id: x.id, reason: 'r', statesLaw: /court hears/.test(x.text) })) };
          break;
        }
        case 'checker.second': {
          const ids = [...req.task.matchAll(/ITEM id=(\S+)/g)].map((m) => m[1]!);
          secondChecked.push(...ids);
          data = { verdicts: ids.map((id) => ({ id, verdict: 'yes', reason: 'Supported.', correctedClaim: null })) };
          break;
        }
        default:
          throw new Error(`unexpected prompt ${req.prompt.id}`);
      }
      if (req.prompt.id === 'writer.part') data = { written: data, repairs: null };
      if (req.prompt.id === 'writer.repair') data = { written: null, repairs: (data as { repairs: unknown }).repairs };
      return { data: req.schema.parse(data), model: 'fake', tier: req.prompt.tier, escalated: false };
    },
  };

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    worker = new pg.Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 4 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Build Test College', $2)", [
      college,
      `bt-${college}`,
    ]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'Builder')", [
      teacher,
      college,
      `b-${tag}@bt.test`,
    ]);
    await owner.query('insert into teacher_profiles (owner_id, college_id, style) values ($1, $2, $3)', [
      teacher,
      college,
      { density: 'balanced', case_first: 'rule_first' },
    ]);
    await owner.query("insert into consents (college_id, owner_id, version, processors) values ($1, $2, $3, '[]')", [
      college,
      teacher,
      CONSENT_VERSION,
    ]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [
      college,
      `b-${tag}@bt.test`,
    ]);

    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`,
      [sourceId, g, act, `zb-${tag}`],
    );
    const text = [
      `901. Grazing rights.—(1) ${S.mayMeadow}.`,
      `(2) ${S.notOrchard}.`,
      `(3) ${S.leave}.`,
      `Explanation.—For the purposes of this section, striped animals include every zebra ${w} of the herd.`,
    ].join('\n');
    await owner.query(
      `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding)
       values ($1, 'shared', $2, 1, 'section', $3, $4, '901', 'act', $5, $6, 'live', $7)`,
      [
        g,
        sourceId,
        `${act} › s. 901 Grazing rights`,
        act,
        text,
        `c-${tag}`,
        toVector(fakeVector(`zebra ${w} graze grazing meadow orchard rule when may the`)),
      ],
    );
  });

  afterAll(async () => {
    if (!owner) return;
    const reports = (
      await owner.query<{ id: string }>('select id from reports where college_id = $1', [college])
    ).rows.map((r) => r.id);
    await owner.query('delete from eval_items where from_report = any($1::uuid[])', [reports]);
    await owner.query('delete from review_queue where ref_id = any($1::uuid[])', [reports]);
    await owner.query('delete from reports where college_id = $1', [college]);
    await owner.query('delete from lectures where college_id = $1', [college]);
    await owner.query('delete from sources where id = $1', [sourceId]);
    await owner.query('delete from review_queue where college_id = $1', [college]);
    await owner.query('delete from library_gaps where college_id = $1', [college]);
    for (const t of ['usage', 'edit_events', 'examples', 'teacher_profiles', 'consents', 'invite_allowlist', 'users'])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await redis.del('rl_signin:::ffff:127.0.0.1', 'rl_signin:127.0.0.1', 'rl_signin:::1');
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  const config = () =>
    parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32),
      CSRF_SECRET: 'b'.repeat(32),
      ALLOWED_EMAIL_DOMAINS: 'bt.test',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
      DEV_LOGIN: 'true',
    });
  const queued: { name: string; data: { lectureId: string; ownerId: string; collegeId: string } }[] = [];
  const http = () =>
    createApp({
      config: config(),
      logger: pino({ level: 'silent' }),
      pool: app,
      redis,
      queues: {
        build: {
          add: async (name: string, data: never) => (queued.push({ name, data }), { id: `job-${queued.length}` }),
        } as never,
      },
    });
  let agent: ReturnType<typeof request.agent>;
  let csrf = '';

  it('Prepare validates every field and queues one build with ids only', async () => {
    agent = request.agent(http());
    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.91.${tag.charCodeAt(0)}.1`)
      .send({ email: `b-${tag}@bt.test` })
      .expect(204);
    csrf = csrfFrom(login);
    await agent
      .post('/api/v1/lectures')
      .set('x-csrf-token', csrf)
      .send({
        topic: 'zebra grazing',
        course: { kind: 'one_off' },
        lengthMin: 45,
        level: 'standard',
        styleKey: 'usual',
      })
      .expect(400);
    const r = await agent
      .post('/api/v1/lectures')
      .set('x-csrf-token', csrf)
      .send({
        topic: `zebra ${w} grazing`,
        course: { kind: 'one_off' },
        lengthMin: 40,
        level: 'standard',
        styleKey: 'usual',
      })
      .expect(202);
    lectureId = r.body.lectureId;
    expect(queued).toEqual([{ name: 'build.lecture', data: { lectureId, ownerId: teacher, collegeId: college } }]);
  });

  it('builds: catches every planted error, repairs once, and saves slides, citations and coverage', async () => {
    const counts = await buildLecture(queued[0]!.data, {
      worker,
      gateway: fakeGateway,
      voyageFor: () => fakeVoyage,
      lookup: null,
      publisher: null,
      minScore: 0.5,
    });
    expect(calls.filter((c) => c === 'writer.part')).toHaveLength(1); // part 2 had no sources: nothing written
    // Research ran before writing: one gap round (nothing new found, so no second round).
    expect(calls.indexOf('research.gaps')).toBeLessThan(calls.indexOf('writer.part'));
    expect(calls.filter((c) => c === 'research.gaps')).toHaveLength(1);
    expect(gapTasks[0]).toContain('Part 2: nothing found');
    expect(gapTasks[0]).toContain('Explanation to s. 901: in Part 1');
    expect(gapTasks[0]).not.toContain(S.mayMeadow); // labels only, never source text
    // The writer of part 1 is told to teach the Explanation of s. 901.
    expect(writerTasks[0]).toMatch(/MUST COVER IN THIS PART[^\n]*\n- Explanation to s\. 901 \(in S1\)/);
    expect(calls).toContain('writer.repair');
    expect(secondChecked.length).toBeGreaterThan(0);
    // Yellow: the "held" line, the two unsourced teaching lines, the unanswerable question. Coverage: the Explanation.
    expect(counts).toMatchObject({ yellow: 4, grey: 0, coverage: 1 });
    expect(counts.score).toBe(0);
    expect(counts.costMicroUsd).toBeGreaterThan(0);
  });

  it('serves the Studio: line status, reasons, source chips and the exact source words', async () => {
    const lec = await agent.get(`/api/v1/lectures/${lectureId}`).expect(200);
    expect(lec.body).toMatchObject({ status: 'ready', counts: { yellow: 4, grey: 0, coverage: 1 }, partsDone: [0, 1] });

    const { slides } = (await agent.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body as {
      slides: {
        title: string;
        lines: {
          text: string;
          status: string;
          flag: string | null;
          flagReason: string | null;
          sources: { label: string; citationId: string }[];
          risk: string;
        }[];
        notes: { status: string; risk: string }[];
      }[];
    };
    const lines = slides[0]!.lines;
    const by = (t: string) => lines.find((l) => l.text.startsWith(t));
    expect(by('A zebra may graze in the meadow')).toMatchObject({
      status: 'supported',
      flag: null,
      sources: [{ label: `s. 901 ${act}` }],
    });
    expect(by('A zebra may not graze in the orchard')).toMatchObject({ status: 'supported', flag: null }); // repaired
    expect(by('The court held')).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: "Not the court's majority reasoning",
    });
    expect(by('Section 901 makes')).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: 'No source for this statement',
    });
    expect(by('Think about why')).toMatchObject({ status: 'supported', flag: null, sources: [] });
    expect(by('So only the meadow court')).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: 'No source for this statement',
    });
    expect(by('A zebra must always')).toBeUndefined(); // dropped by repair
    expect(slides[0]!.notes[0]).toMatchObject({ status: 'supported', risk: 'high' });
    expect(slides[1]!.lines[0]).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: 'Not found in the library',
    });

    const src = await agent
      .get(`/api/v1/citations/${by('A zebra may graze in the meadow')!.sources[0]!.citationId}/source`)
      .expect(200);
    expect(src.body.span).toBe(S.mayMeadow);
    // Why this source: the relevance saved at build time, and the authority reasons read from the source.
    expect(src.body.whyChosen).toMatchObject({ reasons: ['the Act itself', 'official copy (India Code)'] });
    expect(src.body.whyChosen.relevance).toEqual(expect.any(Number));
    expect(src.body.text).toContain(S.mayMeadow);
    expect(src.body.checks.map((c: { name: string; result: string }) => `${c.name}:${c.result}`)).toEqual([
      'C1:pass',
      'C2:pass',
      'C3:pass',
      'C4:pass',
      'C5:skipped',
      'C6:pass',
      'C7:skipped',
      'C8:skipped',
      'C9:pass',
      'C10:skipped',
    ]);
  });

  it('lists coverage notes and left-out items; only the teacher clears one', async () => {
    const cov = (await agent.get(`/api/v1/lectures/${lectureId}/coverage`).expect(200)).body;
    expect(cov.groups).toEqual([
      expect.objectContaining({ sectionKey: `${act}:s901`, title: `s. 901 ${act}`, missing: 1, total: 1 }),
    ]);
    expect(cov.groups[0].items[0]).toMatchObject({
      kind: 'explanation',
      label: 'Explanation to s. 901',
      state: 'missing',
    });
    expect(cov.leftOut).toEqual([expect.objectContaining({ label: 'Grazing tolls', reason: 'Outside this class' })]);
    expect(cov.notFound).toEqual([
      { partIndex: 1, question: 'What holds quarks together inside a neutron star?' }, // the gap check's question
      { partIndex: 1, question: 'How do gluons bind quarks in neutron stars?' },
    ]);

    await agent.post(`/api/v1/coverage/${cov.groups[0].items[0].id}/leave-out`).set('x-csrf-token', csrf).expect(204);
    const lec = (await agent.get(`/api/v1/lectures/${lectureId}`).expect(200)).body;
    expect(lec.counts.coverage).toBe(0);
    expect(lec.coverageScore).toBeNull();
  });

  it('a rebuild resumes: finished parts are not written again, and her tick survives', async () => {
    const before = calls.length;
    await owner.query("update lectures set status = 'failed' where id = $1", [lectureId]);
    const counts = await buildLecture(queued[0]!.data, {
      worker,
      gateway: fakeGateway,
      voyageFor: () => fakeVoyage,
      lookup: null,
      publisher: null,
      minScore: 0.5,
    });
    expect(calls.slice(before)).toEqual([]); // plan and both parts were kept
    expect(counts.coverage).toBe(0);
  });

  it('keeps her lecture from another teacher (RLS)', async () => {
    const other = randomUUID();
    const seen = await (async () => {
      const c = await app.connect();
      try {
        await c.query('begin');
        await c.query(
          "select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', 'teacher', true)",
          [other, college],
        );
        return (await c.query('select count(*)::int n from slides where lecture_id = $1', [lectureId])).rows[0].n;
      } finally {
        await c.query('rollback');
        c.release();
      }
    })();
    expect(seen).toBe(0);
  });

  it('edits in the Studio: code checks at once, background check, verify, remove, add, undo (F7)', async () => {
    const checks: { name: string; data: { citationIds: string[] } }[] = [];
    const ed = request.agent(
      createApp({
        config: config(),
        logger: pino({ level: 'silent' }),
        pool: app,
        redis,
        queues: {
          check: { add: async (name: string, data: never) => (checks.push({ name, data }), { id: 'c' }) } as never,
        },
      }),
    );
    const login = await ed
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.93.${tag.charCodeAt(0)}.1`)
      .send({ email: `b-${tag}@bt.test` })
      .expect(204);
    const tok = csrfFrom(login);
    type Line = {
      lineKey: string;
      text: string;
      kind: string;
      status: string;
      flag: string | null;
      flagReason: string | null;
      edited: boolean;
      sources: { label: string }[];
    };
    type Slide = { id: string; version: number; title: string; lines: Line[]; notes: Line[] };
    const first = async () =>
      ((await ed.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body.slides as Slide[])[0]!;
    const asEdit = (
      s: Slide,
      lines: { lineKey: string | null; text: string; kind: string; yourExample?: boolean }[],
    ) => ({
      version: s.version,
      title: s.title,
      lines,
      notes: s.notes.map((n) => ({ lineKey: n.lineKey, text: n.text, kind: n.kind })),
    });
    const keep = (s: Slide) => s.lines.map((l) => ({ lineKey: l.lineKey, text: l.text, kind: l.kind }));
    const yellowCount = async () =>
      (await ed.get(`/api/v1/lectures/${lectureId}`).expect(200)).body.counts.yellow as number;

    // 1. A small change to a sourced line: C1–C8 pass at once; it stays yellow until the background check.
    let s = await first();
    const meadow = s.lines.find((l) => l.text.startsWith('A zebra may graze in the meadow'))!;
    let r = await ed
      .patch(`/api/v1/slides/${s.id}`)
      .set('x-csrf-token', tok)
      .send(
        asEdit(
          s,
          keep(s).map((l) =>
            l.lineKey === meadow.lineKey ? { ...l, text: 'A zebra may graze in the meadow, says the Act.' } : l,
          ),
        ),
      )
      .expect(200);
    expect(r.body.checking).toBe(1);
    expect(r.body.slide.lines.find((l: Line) => l.lineKey === meadow.lineKey)).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: 'Changed by you: being checked against the source',
      edited: true,
      sources: [{ label: `s. 901 ${act}` }],
    });
    expect(checks).toHaveLength(1);
    const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) =>
      withTenant(worker, { userId: teacher, collegeId: college, role: 'teacher' }, fn);
    expect(
      await checkEditedLines(tenant, checks[0]!.data.citationIds, { gateway: fakeGateway, usage: async () => {} }),
    ).toBe(1);
    s = await first();
    expect(s.lines.find((l) => l.lineKey === meadow.lineKey)).toMatchObject({ status: 'supported', flag: null });

    // 2. A change that names a section the source does not: C3 fails at once, no background check.
    r = await ed
      .patch(`/api/v1/slides/${s.id}`)
      .set('x-csrf-token', tok)
      .send(
        asEdit(
          s,
          keep(s).map((l) =>
            l.lineKey === meadow.lineKey ? { ...l, text: 'Section 77 lets a zebra graze in the meadow.' } : l,
          ),
        ),
      )
      .expect(200);
    expect(r.body.checking).toBe(0);
    expect(r.body.slide.lines.find((l: Line) => l.lineKey === meadow.lineKey)).toMatchObject({ flag: 'yellow' });
    expect(r.body.slide.lines.find((l: Line) => l.lineKey === meadow.lineKey).flagReason).not.toContain(
      'Changed by you',
    );

    // 3. A stale save is refused with the newer version.
    const stale = await ed
      .patch(`/api/v1/slides/${s.id}`)
      .set('x-csrf-token', tok)
      .send(asEdit(s, keep(s)))
      .expect(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { version: s.version + 1 } });

    // 4. Undo: the slide as it was, with the line's checked source back.
    r = await ed
      .post(`/api/v1/slides/${s.id}/restore`)
      .set('x-csrf-token', tok)
      .send({ version: s.version })
      .expect(200);
    expect(r.body.slide.lines.find((l: Line) => l.lineKey === meadow.lineKey)).toMatchObject({
      text: 'A zebra may graze in the meadow, says the Act.',
      status: 'supported',
      flag: null,
    });

    // 5. Remove a yellow line, add a line that states law with no source, and verify another yellow line.
    s = await first();
    const before = await yellowCount();
    const held = s.lines.find((l) => l.text.startsWith('The court held'))!;
    r = await ed
      .patch(`/api/v1/slides/${s.id}`)
      .set('x-csrf-token', tok)
      .send(
        asEdit(s, [
          ...keep(s).filter((l) => l.lineKey !== held.lineKey),
          { lineKey: null, text: 'A zebra must leave within 9 days.', kind: 'teaching' },
        ]),
      )
      .expect(200);
    const added = (r.body.slide.lines as Line[]).at(-1)!;
    expect(added).toMatchObject({
      text: 'A zebra must leave within 9 days.',
      flag: 'yellow',
      flagReason: 'Not found in the library, please verify',
      edited: true,
    });
    expect(r.body.slide.lines.some((l: Line) => l.lineKey === held.lineKey)).toBe(false);
    expect(await yellowCount()).toBe(before); // one removed, one added
    r = await ed
      .post(`/api/v1/slides/${s.id}/verify`)
      .set('x-csrf-token', tok)
      .send({ lineKey: added.lineKey })
      .expect(200);
    expect(r.body.slide.lines.find((l: Line) => l.lineKey === added.lineKey)).toMatchObject({
      status: 'verified_by_you',
      flag: null,
    });
    expect(await yellowCount()).toBe(before - 1);

    // 6. Her example: fine as it is; naming a section the library lacks makes it yellow.
    r = await ed
      .post(`/api/v1/slides/${s.id}/examples`)
      .set('x-csrf-token', tok)
      .send({ text: 'Think of Raju, whose zebra wanders into a neighbour’s meadow.', save: true })
      .expect(200);
    expect((r.body.slide.lines as Line[]).at(-1)).toMatchObject({ status: 'your_example', flag: null });
    r = await ed
      .post(`/api/v1/slides/${s.id}/examples`)
      .set('x-csrf-token', tok)
      .send({ text: `Under section 4471 of the ${act}, Raju's zebra may stay.` })
      .expect(200);
    expect((r.body.slide.lines as Line[]).at(-1)).toMatchObject({ flag: 'yellow' });
    expect((await owner.query('select count(*)::int n from examples where owner_id = $1', [teacher])).rows[0].n).toBe(
      1,
    );

    const versions = (await ed.get(`/api/v1/slides/${s.id}/versions`).expect(200)).body.versions.map(
      (v: { reason: string }) => v.reason,
    );
    expect(versions.slice(0, 3)).toEqual(['add_example', 'add_example', 'edit']);
  });

  it('downloads the .pptx: open points need her go-ahead, or are removed from the lecture first (PPT-1 to PPT-4)', async () => {
    const dl = request.agent(createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis }));
    const login = await dl
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.94.${tag.charCodeAt(0)}.1`)
      .send({ email: `b-${tag}@bt.test` })
      .expect(204);
    const tok = csrfFrom(login);
    const yellow = async () => (await dl.get(`/api/v1/lectures/${lectureId}`).expect(200)).body.counts.yellow as number;
    expect(await yellow()).toBeGreaterThan(0);
    await dl
      .post(`/api/v1/lectures/${lectureId}/download`)
      .set('x-csrf-token', tok)
      .send({ mode: 'with_flags' })
      .expect(400);
    const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const file = await dl
      .post(`/api/v1/lectures/${lectureId}/download`)
      .set('x-csrf-token', tok)
      .send({ mode: 'with_flags', acknowledgeOpen: true })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(file.headers['content-disposition']).toMatch(
      /attachment; filename="OneOff_Zebra_\w+_Grazing_\d{4}-\d{2}-\d{2}\.pptx"/,
    );
    expect((file.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const clean = await dl
      .post(`/api/v1/lectures/${lectureId}/download`)
      .set('x-csrf-token', tok)
      .send({ mode: 'remove_unverified' })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(Number(clean.headers['x-removed-lines'])).toBeGreaterThan(0);
    expect(await yellow()).toBe(0);
  });

  it('coverage: "X of Y", "Add this for me" puts the Act\'s words on a slide, and a removal that uncovers it stops the download (LLD §8.5)', async () => {
    const cv = request.agent(createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis }));
    const login = await cv
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.96.${tag.charCodeAt(0)}.1`)
      .send({ email: `b-${tag}@bt.test` })
      .expect(204);
    const tok = csrfFrom(login);
    // She takes back her "leave out" (as if never ticked): the Explanation is missing again, 0 of 1 covered.
    await owner.query(
      "update coverage_items set state = 'missing', ticked_by = null, ticked_at = null where lecture_id = $1 and item_kind = 'explanation'",
      [lectureId],
    );
    await owner.query('update lectures set coverage_score = 0, coverage_open = 1 where id = $1', [lectureId]);
    let cov = (await cv.get(`/api/v1/lectures/${lectureId}/coverage`).expect(200)).body;
    expect(cov).toMatchObject({ covered: 0, counted: 1 });
    const item = cov.groups[0].items[0];
    expect(item).toMatchObject({ label: 'Explanation to s. 901', state: 'missing', canAdd: true });
    expect((await cv.get(`/api/v1/lectures/${lectureId}`).expect(200)).body.coverageCounts).toEqual({
      covered: 0,
      counted: 1,
    });

    // Add this for me: the Act's words in quotation marks, on the slide citing s. 901, supported by code checks alone.
    const added = (await cv.post(`/api/v1/coverage/${item.id}/add`).set('x-csrf-token', tok).expect(201)).body;
    type Line = {
      lineKey: string;
      text: string;
      status: string;
      flag: string | null;
      sources: { label: string; citationId: string }[];
    };
    const slides = (await cv.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body.slides as {
      id: string;
      lines: Line[];
    }[];
    const line = slides.find((x) => x.id === added.slideId)!.lines.find((l) => l.lineKey === added.lineKey)!;
    expect(line.text).toBe(
      `Explanation to s. 901: “Explanation.—For the purposes of this section, striped animals include every zebra ${w} of the herd.”`,
    );
    expect(line).toMatchObject({ status: 'supported', flag: null, sources: [{ label: `s. 901 ${act}` }] });
    const src = (await cv.get(`/api/v1/citations/${line.sources[0]!.citationId}/source`).expect(200)).body;
    expect(src.checks.find((c: { name: string }) => c.name === 'C9')).toMatchObject({ result: 'pass' });
    cov = (await cv.get(`/api/v1/lectures/${lectureId}/coverage`).expect(200)).body;
    expect(cov).toMatchObject({ covered: 1, counted: 1, score: 1 });
    expect((await cv.get(`/api/v1/lectures/${lectureId}`).expect(200)).body).toMatchObject({
      coverageCounts: { covered: 1, counted: 1 },
      counts: { coverage: 0 },
    });
    // Twice is refused: the item is no longer open.
    await cv.post(`/api/v1/coverage/${item.id}/add`).set('x-csrf-token', tok).expect(404);

    // If that line were unverified, "Remove unverified lines" would uncover the Explanation: the download stops and
    // lists it; the removal is kept, and the next download builds the file.
    await owner.query(
      "update citations set check_status = 'open', flag_kind = 'yellow', flag_reason = 'Please verify' where lecture_id = $1 and line_key = $2",
      [lectureId, added.lineKey],
    );
    const stop = await cv
      .post(`/api/v1/lectures/${lectureId}/download`)
      .set('x-csrf-token', tok)
      .send({ mode: 'remove_unverified' })
      .expect(409);
    expect(stop.body.error).toMatchObject({
      code: 'COVERAGE_CHANGED',
      details: { removed: 1, items: [{ id: item.id, label: 'Explanation to s. 901', canAdd: true }] },
    });
    expect((await cv.get(`/api/v1/lectures/${lectureId}/coverage`).expect(200)).body).toMatchObject({
      covered: 0,
      counted: 1,
    });
    expect((await cv.get(`/api/v1/lectures/${lectureId}`).expect(200)).body.counts).toMatchObject({
      yellow: 0,
      coverage: 1,
    });
    await cv
      .post(`/api/v1/lectures/${lectureId}/download`)
      .set('x-csrf-token', tok)
      .send({ mode: 'remove_unverified' })
      .expect(200);
  });

  it('a wrong-fact report: her copy goes to the editor; a fixed source re-flags every line on it; the case joins the gold set (F12)', async () => {
    const editorEmail = `ed-${tag}@bt.test`;
    const editor = randomUUID();
    await owner.query(
      "insert into users (id, college_id, email, name, role) values ($1, $2, $3, 'Editor', 'library_editor')",
      [editor, college, editorEmail],
    );
    await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [editor, college]);
    await owner.query("insert into invite_allowlist (college_id, email, role) values ($1, $2, 'library_editor')", [
      college,
      editorEmail,
    ]);
    const signIn = async (email: string, n: number) => {
      const agent = request.agent(createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis }));
      const login = await agent
        .post('/api/v1/auth/dev-login')
        .set('x-forwarded-for', `10.95.${tag.charCodeAt(0)}.${n}`)
        .send({ email })
        .expect(204);
      return {
        agent,
        csrf: csrfFrom(login),
      };
    };
    const t = await signIn(`b-${tag}@bt.test`, 1);
    type Line = {
      lineKey: string;
      text: string;
      status: string;
      flag: string | null;
      flagReason: string | null;
      sources: unknown[];
    };
    const slides = (await t.agent.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body.slides as {
      id: string;
      lines: Line[];
    }[];
    const slide = slides.find((x) => x.lines.some((l) => l.sources.length && l.status === 'supported'))!;
    const line = slide.lines.find((l) => l.sources.length && l.status === 'supported')!;

    // She reports it, with a note.
    const filed = await t.agent
      .post(`/api/v1/lectures/${lectureId}/reports`)
      .set('x-csrf-token', t.csrf)
      .send({ slideId: slide.id, lineKey: line.lineKey, note: 'The Act says may, not must.' })
      .expect(201);
    const mine = (await t.agent.get(`/api/v1/lectures/${lectureId}/reports`).expect(200)).body.reports;
    expect(mine).toEqual([
      expect.objectContaining({ id: filed.body.id, lineKey: line.lineKey, status: 'open', outcome: null }),
    ]);
    await t.agent.get('/api/v1/library/reports').expect(403);

    // The editor sees copies (the line, the source words, her note), due within 24 hours.
    const e = await signIn(editorEmail, 2);
    const queue = (await e.agent.get('/api/v1/library/reports').expect(200)).body;
    const item = queue.reports.find((x: { id: string }) => x.id === filed.body.id);
    expect(item).toMatchObject({ lineCopy: line.text, note: 'The Act says may, not must.', status: 'open' });
    expect(item.spanCopy.length).toBeGreaterThan(8);
    expect(new Date(item.dueAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    // An editor cannot file a report on a lecture that is not hers.
    await e.agent
      .post(`/api/v1/lectures/${lectureId}/reports`)
      .set('x-csrf-token', e.csrf)
      .send({ slideId: slide.id, lineKey: line.lineKey })
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

    // She fixed the source: every line resting on that piece turns yellow again, for its teacher to check.
    const fixed = await e.agent
      .post(`/api/v1/library/reports/${filed.body.id}/resolve`)
      .set('x-csrf-token', e.csrf)
      .send({ outcome: 'fixed_chunk', note: 'Corrected the section text from the Gazette.' })
      .expect(200);
    expect(fixed.body.linesFlagged).toBeGreaterThanOrEqual(1);
    await e.agent
      .post(`/api/v1/library/reports/${filed.body.id}/resolve`)
      .set('x-csrf-token', e.csrf)
      .send({ outcome: 'was_correct' })
      .expect(404);
    const after = (await t.agent.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body.slides as {
      id: string;
      lines: Line[];
    }[];
    const again = after.find((x) => x.id === slide.id)!.lines.find((l) => l.lineKey === line.lineKey)!;
    expect(again).toMatchObject({
      status: 'open',
      flag: 'yellow',
      flagReason: 'The library corrected this source after a report; check this line again',
    });
    expect((await t.agent.get(`/api/v1/lectures/${lectureId}/reports`).expect(200)).body.reports[0]).toMatchObject({
      status: 'resolved',
      outcome: 'fixed_chunk',
      resolutionNote: 'Corrected the section text from the Gazette.',
    });

    // F12.4: the case is in the gold set; the queue item is closed.
    const gold = (
      await owner.query('select set_name, question, expected from eval_items where from_report = $1', [filed.body.id])
    ).rows[0];
    expect(gold).toMatchObject({
      set_name: 'gold',
      question: line.text,
      expected: expect.objectContaining({ outcome: 'fixed_chunk' }),
    });
    expect(
      (await owner.query("select state from review_queue where ref_id = $1 and kind = 'wrong_fact'", [filed.body.id]))
        .rows[0].state,
    ).toBe('resolved');
  });
});
