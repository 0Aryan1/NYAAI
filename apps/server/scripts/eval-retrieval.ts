/**
 * Retrieval test (Day 2 gate, LLD §17.5 "Retrieval hit@8"): is the expected passage among the final 8 sources?
 * Runs every question as the seeded Teacher A (row-level security applies), with and without the reranker, plus
 * the red-team checks, and records the run in eval_runs.
 *   pnpm eval:retrieval [--set eval/sets/retrieval.draft.json] [--no-expand] [--only r-06]
 */
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createPool, withTenant } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { gatewayFrom, voyageFrom } from '../src/services/factory/index.ts';
import { search, type SearchResult } from '../src/services/search/index.ts';
import { usageSink } from '../src/services/usage/index.ts';

interface Expect {
  act?: string;
  section?: string;
  article?: string;
  case?: string;
  contains?: string;
}
interface EvalSet {
  set: string;
  status: string;
  items: { id: string; question: string; expect: Expect[]; asOn?: string }[];
  redteam: { id: string; question: string; check: 'no_source_titled' | 'no_repealed_text'; value?: string }[];
}

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'eval/sets/retrieval.draft.json' },
    'no-expand': { type: 'boolean' },
    only: { type: 'string' },
  },
});
const root = path.resolve(process.env.INIT_CWD ?? process.cwd());
const config = loadConfig();
const evalSet = JSON.parse(await readFile(path.resolve(root, values.set!), 'utf8')) as EvalSet;
const TEACHER = {
  userId: '00000000-0000-4000-8000-00000000000a',
  collegeId: '00000000-0000-4000-8000-000000000002',
  role: 'teacher' as const,
};

const app = createPool(config.DATABASE_URL, 2);
const library = createPool(config.DATABASE_URL_LIBRARY!, 2);
const gateway = values['no-expand'] ? null : gatewayFrom(config);

/** Expected passage → chunk ids that count as a hit (the passage itself; for a section, its children too). */
async function resolve(e: Expect): Promise<string[]> {
  if (e.act && e.section) {
    return (
      await library.query<{ id: string }>(
        `select c.id from chunks c join sources s on s.id = c.source_id
        where c.act_name = $1 and c.section = $2 and s.origin <> 'indian_kanoon' and c.status in ('live','provisional')`,
        [e.act, e.section],
      )
    ).rows.map((r) => r.id);
  }
  if (e.article) {
    return (
      await library.query<{ id: string }>(
        "select id from chunks where article = $1 and status in ('live','provisional')",
        [e.article],
      )
    ).rows.map((r) => r.id);
  }
  if (e.case && e.contains) {
    return (
      await library.query<{ id: string }>(
        `select c.id from chunks c join sources s on s.id = c.source_id
        where s.type = 'judgment' and s.title ilike $1 and c.kind <> 'headnote' and regexp_replace(c.text, '\\s+', ' ', 'g') ilike $2`,
        [`%${e.case}%`, `%${e.contains}%`],
      )
    ).rows.map((r) => r.id);
  }
  throw new Error(`bad expectation ${JSON.stringify(e)}`);
}

async function runOne(question: string, noRerank: boolean, asOn?: string): Promise<SearchResult> {
  return withTenant(app, TEACHER, async (c) => {
    const usage = usageSink(c, { collegeId: TEACHER.collegeId, ownerId: TEACHER.userId });
    return search(
      c,
      { query: question, purpose: 'eval', filters: { asOn }, noRerank, noExpand: !gateway },
      {
        voyage: voyageFrom(config, usage),
        gateway,
        usage,
        minScore: config.RERANK_MIN_SCORE,
      },
    );
  });
}

const results: Record<string, unknown>[] = [];
let hitsRerank = 0;
let hitsPlain = 0;
const items = evalSet.items.filter((i) => !values.only || i.id === values.only);
try {
  for (const item of items) {
    const expected = (await Promise.all(item.expect.map(resolve))).flat();
    if (!expected.length) {
      console.log(`${item.id}  ✗ expected passage not in the library (load it first): ${JSON.stringify(item.expect)}`);
      results.push({ id: item.id, error: 'expected passage not found in library' });
      continue;
    }
    const withRerank = await runOne(item.question, false, item.asOn);
    const plain = await runOne(item.question, true, item.asOn);
    const rank = (r: SearchResult) => r.sources.findIndex((s) => s.coveredChunkIds.some((id) => expected.includes(id)));
    const [rr, rp] = [rank(withRerank), rank(plain)];
    if (rr >= 0) hitsRerank++;
    if (rp >= 0) hitsPlain++;
    console.log(
      `${item.id}  ${rr >= 0 ? `✓ S${rr + 1}` : '✗   '}  (no rerank: ${rp >= 0 ? `S${rp + 1}` : 'miss'})  ${withRerank.outcome.padEnd(9)} ${withRerank.trace.ms}ms  ${item.question.slice(0, 70)}`,
    );
    if (rr < 0) {
      console.log(
        `      top sources: ${withRerank.sources
          .slice(0, 4)
          .map((s) => `${s.tag} ${s.header.slice(-60)} [${s.rerankScore?.toFixed(2)}]`)
          .join(' | ')}`,
      );
      console.log(
        `      expected found by vector: ${withRerank.trace.vector.some((id) => expected.includes(id))}, by words: ${withRerank.trace.words.some((id) => expected.includes(id))}, reranked at: ${withRerank.trace.reranked.findIndex((x) => expected.includes(x.id))}`,
      );
    }
    results.push({
      id: item.id,
      hit: rr >= 0,
      rank: rr + 1,
      hitNoRerank: rp >= 0,
      outcome: withRerank.outcome,
      ms: withRerank.trace.ms,
    });
  }

  let redOk = 0;
  for (const rt of evalSet.redteam) {
    const r = await runOne(rt.question, false);
    let pass: boolean;
    if (rt.check === 'no_source_titled')
      pass = !r.sources.some((s) => s.header.toLowerCase().includes(rt.value!.toLowerCase()));
    else pass = !r.sources.some((s) => s.status.law === 'repealed');
    if (pass) redOk++;
    console.log(`${rt.id}  ${pass ? '✓' : '✗'}  ${rt.check}  outcome=${r.outcome}  ${rt.question.slice(0, 70)}`);
    results.push({ id: rt.id, redteam: rt.check, pass, outcome: r.outcome });
  }

  const n = items.length;
  const passed = hitsRerank === n && redOk === evalSet.redteam.length;
  console.log(
    `\nhit@8 with rerank: ${hitsRerank}/${n} · without rerank: ${hitsPlain}/${n} · red team: ${redOk}/${evalSet.redteam.length} · ${passed ? 'PASS' : 'FAIL'} (${evalSet.status})`,
  );
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  await library.query(
    `insert into eval_runs (set_name, git_sha, prompt_versions, model_ids, results, passed)
     values ('retrieval', $1, $2, $3, $4, $5)`,
    [
      sha,
      JSON.stringify({ 'query.expand': gateway ? '1' : 'off', 'rerank.instruction': '1' }),
      JSON.stringify({
        embed: config.VOYAGE_EMBED_MODEL,
        rerank: config.VOYAGE_RERANK_MODEL,
        light: config.MODEL_CHECKER,
      }),
      JSON.stringify({ status: evalSet.status, hitsRerank, hitsPlain, n, redOk, items: results }),
      passed,
    ],
  );
  process.exitCode = passed ? 0 : 1;
} finally {
  await Promise.all([app.end(), library.end()]);
}
