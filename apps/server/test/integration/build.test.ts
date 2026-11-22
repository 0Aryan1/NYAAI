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
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { buildLecture } from '../../src/services/build/index.ts';
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
              { title: 'Grazing rule', minutes: 30, kind: 'content', questions: [`When may a zebra ${w} graze in the meadow or the orchard?`], mustInclude: false },
              { title: 'Quantum chromodynamics', minutes: 10, kind: 'content', questions: ['How do gluons bind quarks in neutron stars?'], mustInclude: false },
            ],
            leftOut: [{ item: 'Grazing tolls', reason: 'Outside this class' }],
          };
          break;
        case 'writer.part':
          data = {
            partIndex: 0,
            slides: [
              {
                layout: 'bullets',
                title: 'Where a zebra may graze',
                lines: [
                  { lineKey: 'x', text: 'A zebra may graze in the meadow.', kind: 'claim', claims: [{ text: 'A zebra may graze in the meadow.', type: 'rule', tag: 'S1', span: S.mayMeadow }] },
                  { lineKey: 'x', text: 'A zebra may graze in the orchard.', kind: 'claim', claims: [{ text: 'A zebra may graze in the orchard.', type: 'rule', tag: 'S1', span: `A zebra ${w} may graze in the orchard` }] },
                  { lineKey: 'x', text: 'The court held that zebras may graze.', kind: 'claim', claims: [{ text: 'The court held that zebras may graze.', type: 'holding', tag: 'S1', span: S.mayMeadow }] },
                  { lineKey: 'x', text: 'Section 901 makes grazing lawful.', kind: 'teaching', claims: [] },
                  { lineKey: 'x', text: 'Think about why meadows matter.', kind: 'teaching', claims: [] },
                  { lineKey: 'x', text: 'So only the meadow court hears grazing quarrels.', kind: 'teaching', claims: [] },
                  { lineKey: 'x', text: 'A zebra must always graze.', kind: 'claim', claims: [{ text: 'A zebra must always graze.', type: 'rule', tag: 'S1', span: S.mayMeadow }] },
                ],
                notes: [{ text: 'A zebra must leave within 30 days of notice.', claims: [{ text: 'A zebra must leave within 30 days of notice.', type: 'time_limit', tag: 'S1', span: S.leave }] }],
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
              { id: 'p0-s1-l2', action: 'replace', lineText: 'A zebra may not graze in the orchard.', claims: [{ text: 'A zebra may not graze in the orchard.', type: 'rule', tag: 'S1', span: S.notOrchard }] },
              { id: 'p0-s1-l7', action: 'drop', lineText: null, claims: [] },
            ],
          };
          break;
        }
        case 'checker.support': {
          const ids = [...req.task.matchAll(/ITEM id=(\S+)\nCLAIM: (.*)/g)].map((m) => ({ id: m[1]!, claim: m[2]! }));
          data = { verdicts: ids.map((x) => ({ id: x.id, verdict: /always/.test(x.claim) ? 'partly' : 'yes', reason: /always/.test(x.claim) ? 'The source says may, not must always.' : 'Supported.' })) };
          break;
        }
        case 'checker.unsourced': {
          const items = [...req.task.matchAll(/ITEM id=(\S+)\n<<<\w+ line>>>\n(.*)/g)].map((m) => ({ id: m[1]!, text: m[2]! }));
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
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Build Test College', $2)", [college, `bt-${college}`]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'Builder')", [teacher, college, `b-${tag}@bt.test`]);
    await owner.query('insert into teacher_profiles (owner_id, college_id, style) values ($1, $2, $3)', [teacher, college, { density: 'balanced', case_first: 'rule_first' }]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [college, `b-${tag}@bt.test`]);

    const g = (await owner.query('select id from colleges where is_global')).rows[0].id;
    await owner.query(`insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status) values ($1, $2, 'shared', 'act', 'india_code', $3, $3, $4, 'live')`, [sourceId, g, act, `zb-${tag}`]);
    const text = [
      `901. Grazing rights.—(1) ${S.mayMeadow}.`,
      `(2) ${S.notOrchard}.`,
      `(3) ${S.leave}.`,
      `Explanation.—For the purposes of this section, striped animals include every zebra ${w} of the herd.`,
    ].join('\n');
    await owner.query(
      `insert into chunks (college_id, visibility, source_id, seq, kind, header, act_name, section, source_type, text, content_hash, status, embedding)
       values ($1, 'shared', $2, 1, 'section', $3, $4, '901', 'act', $5, $6, 'live', $7)`,
      [g, sourceId, `${act} › s. 901 Grazing rights`, act, text, `c-${tag}`, toVector(fakeVector(`zebra ${w} graze grazing meadow orchard rule when may the`))],
    );
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from lectures where college_id = $1', [college]);
    await owner.query('delete from sources where id = $1', [sourceId]);
    await owner.query('delete from review_queue where college_id = $1', [college]);
    await owner.query('delete from library_gaps where college_id = $1', [college]);
    for (const t of ['usage', 'teacher_profiles', 'invite_allowlist', 'users']) await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await redis.del('rl_signin:::ffff:127.0.0.1', 'rl_signin:127.0.0.1', 'rl_signin:::1');
    await Promise.all([owner.end(), app.end(), worker.end(), redis.quit()]);
  });

  const config = () =>
    parseConfig({
      DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32), CSRF_SECRET: 'b'.repeat(32), ALLOWED_EMAIL_DOMAINS: 'bt.test', LOG_LEVEL: 'silent', NODE_ENV: 'development', DEV_LOGIN: 'true',
    });
  const queued: { name: string; data: { lectureId: string; ownerId: string; collegeId: string } }[] = [];
  const http = () =>
    createApp({ config: config(), logger: pino({ level: 'silent' }), pool: app, redis, queues: { build: { add: async (name: string, data: never) => (queued.push({ name, data }), { id: `job-${queued.length}` }) } as never } });
  let agent: ReturnType<typeof request.agent>;
  let csrf = '';

  it('Prepare validates every field and queues one build with ids only', async () => {
    agent = request.agent(http());
    const login = await agent.post('/api/v1/auth/dev-login').set('x-forwarded-for', `10.91.${tag.charCodeAt(0)}.1`).send({ email: `b-${tag}@bt.test` }).expect(204);
    csrf = decodeURIComponent(([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='))!.split(';')[0]!.slice(11));
    await agent.post('/api/v1/lectures').set('x-csrf-token', csrf).send({ topic: 'zebra grazing', course: { kind: 'one_off' }, lengthMin: 45, level: 'standard', styleKey: 'usual' }).expect(400);
    const r = await agent
      .post('/api/v1/lectures')
      .set('x-csrf-token', csrf)
      .send({ topic: `zebra ${w} grazing`, course: { kind: 'one_off' }, lengthMin: 40, level: 'standard', styleKey: 'usual' })
      .expect(202);
    lectureId = r.body.lectureId;
    expect(queued).toEqual([{ name: 'build.lecture', data: { lectureId, ownerId: teacher, collegeId: college } }]);
  });

  it('builds: catches every planted error, repairs once, and saves slides, citations and coverage', async () => {
    const counts = await buildLecture(queued[0]!.data, { worker, gateway: fakeGateway, voyageFor: () => fakeVoyage, lookup: null, publisher: null, minScore: 0.5 });
    expect(calls.filter((c) => c === 'writer.part')).toHaveLength(1); // part 2 had no sources: nothing written
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

    const { slides } = (await agent.get(`/api/v1/lectures/${lectureId}/slides`).expect(200)).body as { slides: { title: string; lines: { text: string; status: string; flag: string | null; flagReason: string | null; sources: { label: string; citationId: string }[]; risk: string }[]; notes: { status: string; risk: string }[] }[] };
    const lines = slides[0]!.lines;
    const by = (t: string) => lines.find((l) => l.text.startsWith(t));
    expect(by('A zebra may graze in the meadow')).toMatchObject({ status: 'supported', flag: null, sources: [{ label: `s. 901 ${act}` }] });
    expect(by('A zebra may not graze in the orchard')).toMatchObject({ status: 'supported', flag: null }); // repaired
    expect(by('The court held')).toMatchObject({ status: 'open', flag: 'yellow', flagReason: "Not the court's majority reasoning" });
    expect(by('Section 901 makes')).toMatchObject({ status: 'open', flag: 'yellow', flagReason: 'No source for this statement' });
    expect(by('Think about why')).toMatchObject({ status: 'supported', flag: null, sources: [] });
    expect(by('So only the meadow court')).toMatchObject({ status: 'open', flag: 'yellow', flagReason: 'No source for this statement' });
    expect(by('A zebra must always')).toBeUndefined(); // dropped by repair
    expect(slides[0]!.notes[0]).toMatchObject({ status: 'supported', risk: 'high' });
    expect(slides[1]!.lines[0]).toMatchObject({ status: 'open', flag: 'yellow', flagReason: 'Not found in the library' });

    const src = await agent.get(`/api/v1/citations/${by('A zebra may graze in the meadow')!.sources[0]!.citationId}/source`).expect(200);
    expect(src.body.span).toBe(S.mayMeadow);
    expect(src.body.text).toContain(S.mayMeadow);
    expect(src.body.checks.map((c: { name: string; result: string }) => `${c.name}:${c.result}`)).toEqual(['C1:pass', 'C2:pass', 'C3:pass', 'C4:pass', 'C5:skipped', 'C6:pass', 'C7:skipped', 'C8:skipped', 'C9:pass', 'C10:skipped']);
  });

  it('lists coverage notes and left-out items; only the teacher clears one', async () => {
    const cov = (await agent.get(`/api/v1/lectures/${lectureId}/coverage`).expect(200)).body;
    expect(cov.groups).toEqual([expect.objectContaining({ sectionKey: `${act}:s901`, title: `s. 901 ${act}`, missing: 1, total: 1 })]);
    expect(cov.groups[0].items[0]).toMatchObject({ kind: 'explanation', label: 'Explanation to s. 901', state: 'missing' });
    expect(cov.leftOut).toEqual([expect.objectContaining({ label: 'Grazing tolls', reason: 'Outside this class' })]);
    expect(cov.notFound).toEqual([{ partIndex: 1, question: 'How do gluons bind quarks in neutron stars?' }]);

    await agent.post(`/api/v1/coverage/${cov.groups[0].items[0].id}/leave-out`).set('x-csrf-token', csrf).expect(204);
    const lec = (await agent.get(`/api/v1/lectures/${lectureId}`).expect(200)).body;
    expect(lec.counts.coverage).toBe(0);
    expect(lec.coverageScore).toBeNull();
  });

  it('a rebuild resumes: finished parts are not written again, and her tick survives', async () => {
    const before = calls.length;
    await owner.query("update lectures set status = 'failed' where id = $1", [lectureId]);
    const counts = await buildLecture(queued[0]!.data, { worker, gateway: fakeGateway, voyageFor: () => fakeVoyage, lookup: null, publisher: null, minScore: 0.5 });
    expect(calls.slice(before)).toEqual([]); // plan and both parts were kept
    expect(counts.coverage).toBe(0);
  });

  it("keeps her lecture from another teacher (RLS)", async () => {
    const other = randomUUID();
    const seen = await (async () => {
      const c = await app.connect();
      try {
        await c.query('begin');
        await c.query("select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', 'teacher', true)", [other, college]);
        return (await c.query('select count(*)::int n from slides where lecture_id = $1', [lectureId])).rows[0].n;
      } finally {
        await c.query('rollback');
        c.release();
      }
    })();
    expect(seen).toBe(0);
  });
});
