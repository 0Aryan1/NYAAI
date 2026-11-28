/**
 * Search service against the real database, with a deterministic fake Voyage (bag-of-words vectors, word-overlap
 * rerank), so filters, fusion, parent expansion and outcomes are tested without network calls.
 * Creates its own shared source (in the GLOBAL college) and its own college, and removes both afterwards.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '@nyaai/db';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';
import { search } from '../../src/services/search/index.ts';
import { noUsage } from '../../src/services/usage.ts';
import { toVector, type Voyage } from '../../src/services/voyage/index.ts';
import { csrfFrom, fakeVector, fakeVoyage } from '../helpers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

const downVoyage: Voyage = { embed: fakeVoyage.embed, rerank: async () => Promise.reject(new Error('down')) };

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (
      (
        await c.query(
          "select to_regclass('public.concept_links') is not null and exists (select 1 from colleges where is_global) as ok",
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

describe.skipIf(!up)('search service (integration)', () => {
  let owner: pg.Pool, app: pg.Pool, redis: Redis;
  const college = randomUUID();
  const teacher = randomUUID();
  const sourceAct = randomUUID();
  const sourceCase = randomUUID();
  const tag = college.slice(0, 8);
  const who = () => ({ userId: teacher, collegeId: college, role: 'teacher' as const });
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 2 });
    app = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Search Test College', $2)", [
      college,
      `st-${college}`,
    ]);
    await owner.query("insert into users (id, college_id, email, name) values ($1, $2, $3, 'Searcher')", [
      teacher,
      college,
      `s-${tag}@st.test`,
    ]);
    await owner.query('insert into teacher_profiles (owner_id, college_id) values ($1, $2)', [teacher, college]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2)', [
      college,
      `s-${tag}@st.test`,
    ]);

    // A shared test statute: one section split into two children, one short section, one repealed section.
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, act_name, content_hash, status)
       values ($1, global_college(), 'shared', 'act', 'india_code', $2, $2, $3, 'live')`,
      [sourceAct, `Zebra Test Act ${tag}`, `zebra-${tag}`],
    );
    const chunk = async (key: string, fields: Record<string, unknown>) => {
      const cols = Object.keys(fields);
      const r = await owner.query<{ id: string }>(
        `insert into chunks (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        Object.values(fields),
      );
      ids[key] = r.rows[0]!.id;
    };
    const act = {
      college_id: null,
      visibility: 'shared',
      source_id: sourceAct,
      act_name: `Zebra Test Act ${tag}`,
      source_type: 'act',
      status: 'live',
    };
    const globalId = (await owner.query('select id from colleges where is_global')).rows[0].id;
    act.college_id = globalId;
    await chunk('parent', {
      ...act,
      seq: 1,
      kind: 'section',
      section: '901',
      header: 'Zebra Test Act › s. 901 Grazing rights',
      text: '901. Grazing rights.—(1) A zebra may graze in the meadow. (2) A zebra may not graze in the orchard. Provided that striped animals keep to the path.',
      content_hash: `p-${tag}`,
    });
    await chunk('child1', {
      ...act,
      seq: 2,
      kind: 'subsection',
      section: '901',
      parent_id: ids.parent,
      header: 'Zebra Test Act › s. 901 Grazing rights › sub-s. (1)',
      text: '(1) A zebra may graze in the meadow.',
      content_hash: `c1-${tag}`,
      embedding: toVector(fakeVector('zebra graze meadow grazing rights')),
    });
    await chunk('child2', {
      ...act,
      seq: 3,
      kind: 'subsection',
      section: '901',
      parent_id: ids.parent,
      header: 'Zebra Test Act › s. 901 Grazing rights › sub-s. (2)',
      text: '(2) A zebra may not graze in the orchard.',
      content_hash: `c2-${tag}`,
      embedding: toVector(fakeVector('zebra graze orchard grazing rights')),
    });
    await chunk('short', {
      ...act,
      seq: 4,
      kind: 'section',
      section: '902',
      header: 'Zebra Test Act › s. 902 Fences',
      text: '902. Fences.—Every meadow shall have a fence around it for the zebra herd.',
      content_hash: `s-${tag}`,
      embedding: toVector(fakeVector('meadow fence zebra herd fences')),
    });
    await chunk('repealed', {
      ...act,
      seq: 5,
      kind: 'section',
      section: '903',
      law_status: 'repealed',
      header: 'Zebra Test Act › s. 903 Old tolls',
      text: '903. [Old tolls for zebra meadow crossings.] Rep. by Act 1 of 1950.',
      content_hash: `r-${tag}`,
      embedding: toVector(fakeVector('zebra meadow tolls crossings')),
    });

    // A shared provisional judgment with a run of paragraphs.
    await owner.query(
      `insert into sources (id, college_id, visibility, type, origin, title, court, court_level, decided_on, content_hash, status)
       values ($1, global_college(), 'shared', 'judgment', 'indian_kanoon', $2, 'Supreme Court of India', 'supreme_court', '1999-01-01', $3, 'provisional')`,
      [sourceCase, `Stripe v. Meadowland Board ${tag}`, `case-${tag}`],
    );
    const paras = [
      'The appellant keeps a zebra herd.',
      'The Board fenced the meadow.',
      'Counsel argued the fence was unlawful.',
      'We hold that a zebra herd may graze in a fenced meadow.',
      'The appeal is allowed.',
      'No costs.',
    ];
    for (let i = 0; i < paras.length; i++) {
      await chunk(`p${i + 1}`, {
        college_id: globalId,
        visibility: 'shared',
        source_id: sourceCase,
        source_type: 'judgment',
        status: 'provisional',
        seq: i + 1,
        kind: 'paragraph',
        para_no: String(i + 1),
        para_no_source: 'court',
        opinion: 'majority',
        para_role: i === 3 ? 'holding' : 'unknown',
        court: 'Supreme Court of India',
        court_level: 'supreme_court',
        decided_on: '1999-01-01',
        header: `Stripe v. Meadowland Board (1999) › para ${i + 1}`,
        text: paras[i],
        content_hash: `j${i}-${tag}`,
        embedding: toVector(fakeVector(paras[i]!)),
      });
    }
    // Concepts in the test college: one clear, one ambiguous across subjects.
    await owner.query(
      `insert into legal_concepts (college_id, name, aliases, subject) values
        ($1, 'Zebra grazing', array['grazing rights'], 'Animals'),
        ($1, 'Stripes (contract)', array['stripes${tag}'], 'Contract'),
        ($1, 'Stripes (tort)', array['stripes${tag}'], 'Torts')`,
      [college],
    );
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from sources where id = any($1)', [[sourceAct, sourceCase]]);
    await owner.query('delete from legal_concepts where college_id = $1', [college]);
    for (const t of ['usage', 'teacher_profiles', 'invite_allowlist', 'users'])
      await owner.query(`delete from ${t} where college_id = $1`, [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await redis.del('rl_signin:::ffff:127.0.0.1', 'rl_signin:127.0.0.1', 'rl_signin:::1');
    await Promise.all([owner.end(), app.end(), redis.quit()]);
  });

  const run = (query: string, extra: Partial<Parameters<typeof search>[1]> = {}, voyage = fakeVoyage) =>
    withTenant(app, who(), (c) =>
      search(
        c,
        { query, purpose: 'eval', noExpand: true, ...extra },
        { voyage, gateway: null, usage: noUsage, minScore: 0.5 },
      ),
    );

  it('expands a statute child to its whole section, collapsing the two children into one source', async () => {
    const r = await run(`zebra graze grazing rights ${tag}`);
    // This test's own Act only: the build test's made-up Act has an s. 901 too, and the files run side by side.
    const s901 = r.sources.filter((s) => s.sourceId === sourceAct && s.header.includes('s. 901'));
    expect(s901).toHaveLength(1);
    expect(s901[0]!.text).toContain('Provided that striped animals keep to the path.');
    expect(s901[0]!.coveredChunkIds).toEqual(expect.arrayContaining([ids.parent, ids.child1]));
    expect(r.sources[0]!.tag).toBe('S1');
  });

  it('pins an exact section reference first', async () => {
    const r = await run(`fences s. 902 Zebra Test Act ${tag}`);
    expect(r.trace.pinned).toContain(ids.short);
  });

  it('never returns repealed text for a present-day question, but does for a historical one', async () => {
    const now = await run('zebra meadow tolls crossings');
    expect(now.sources.some((s) => s.coveredChunkIds.includes(ids.repealed!))).toBe(false);
    const then = await run('zebra meadow tolls crossings', { filters: { asOn: '1940-01-01' } });
    expect(then.trace.vector).toContain(ids.repealed);
  });

  it('expands a judgment paragraph to ±2 paragraphs of the same opinion and marks it provisional', async () => {
    const r = await run('herd graze fenced meadow hold');
    const held = r.sources.find((s) => s.coveredChunkIds.includes(ids.p4!));
    expect(held).toBeTruthy();
    expect(held!.text).toMatch(/\[para 2\][\s\S]*\[para 6\]/);
    expect(held!.provisional).toBe(true);
    expect(held!.status.case).toBe('not_verified');
  });

  it('says not_found when nothing reaches the score, and falls back to fused order when the reranker is down', async () => {
    expect((await run('quantum chromodynamics of galaxies')).outcome).toBe('not_found');
    const fb = await run(`zebra graze grazing rights ${tag}`, {}, downVoyage);
    expect(fb.trace.fallback).toMatch(/reranker unavailable/);
    expect(fb.sources.length).toBeLessThanOrEqual(6);
  });

  it('suggests from the library and asks one question for an ambiguous topic (HTTP)', async () => {
    const config = parseConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: process.env.REDIS_URL,
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      SESSION_SECRET: 'a'.repeat(32),
      CSRF_SECRET: 'b'.repeat(32),
      ALLOWED_EMAIL_DOMAINS: 'st.test',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'development',
      DEV_LOGIN: 'true',
    });
    const http = createApp({ config, logger: pino({ level: 'silent' }), pool: app, redis });
    const agent = request.agent(http);
    const login = await agent
      .post('/api/v1/auth/dev-login')
      .set('x-forwarded-for', `10.${tag.charCodeAt(0)}.0.1`)
      .send({ email: `s-${tag}@st.test` })
      .expect(204);
    const csrf = csrfFrom(login);

    const sug = await agent.get('/api/v1/suggest?q=zebra gr').expect(200);
    expect(sug.body.suggestions[0]).toMatchObject({ kind: 'concept', label: 'Zebra grazing' });

    const amb = await agent
      .post('/api/v1/topics/resolve')
      .set('x-csrf-token', csrf)
      .send({ topic: `stripes${tag}` })
      .expect(409);
    expect(amb.body.error.code).toBe('TOPIC_AMBIGUOUS');
    const choices = amb.body.error.details.choices as { conceptId: string; subject: string }[];
    expect(choices.map((c) => c.subject).sort()).toEqual(['Contract', 'Torts']);
    const ok = await agent
      .post('/api/v1/topics/resolve')
      .set('x-csrf-token', csrf)
      .send({ topic: `stripes${tag}`, choice: choices[0]!.conceptId })
      .expect(200);
    expect(ok.body.conceptId).toBe(choices[0]!.conceptId);
    expect(
      (
        await agent
          .post('/api/v1/topics/resolve')
          .set('x-csrf-token', csrf)
          .send({ topic: 'Zebra grazing' })
          .expect(200)
      ).body.conceptId,
    ).toBeTruthy();
  });
});
