/**
 * Library CLI (development and library-editor support). Runs as nyaai_library, like the worker.
 *   pnpm library finish --all                 stages 5–7 (label, embed, gate) for every source still processing
 *   pnpm library finish --source <uuid>       the same for one source
 *   pnpm library kanoon --tid 1214064 [--tid …]   load judgments from Indian Kanoon (provisional, expiring)
 *   pnpm library gaps [--state waiting|all|open|…]   the library-gap list, most teachers first
 *   pnpm library lookup --question "…" [--as teacher.a@cnlu.ac.in]
 *                                             search as that teacher; on a gap, record it, run the trusted-source
 *                                             lookup (India Code, Indian Kanoon, official links) and search again
 *   pnpm library lookup --gap <uuid>          run the lookup again for one gap (ignores the 24-hour cooldown)
 */
import { parseArgs } from 'node:util';
import { createPool, withTenant } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { usageSink } from '../src/services/usage.ts';
import { gatewayFrom, indiaCodeFrom, kanoonFrom, storageFrom, voyageFrom, webSearchFrom } from '../src/services/factory.ts';
import { finishSource } from '../src/services/ingest/finish.ts';
import { ingestKanoonJudgment } from '../src/services/ingest/kanoon.ts';
import { createGapLookup, searchWithLookup, type TenantRunner } from '../src/services/lookup/index.ts';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    all: { type: 'boolean' },
    source: { type: 'string', multiple: true },
    tid: { type: 'string', multiple: true },
    state: { type: 'string', default: 'waiting' },
    question: { type: 'string' },
    as: { type: 'string', default: 'teacher.a@cnlu.ac.in' },
    gap: { type: 'string' },
  },
});

const config = loadConfig();
if (!config.DATABASE_URL_LIBRARY) throw new Error('DATABASE_URL_LIBRARY is not set');
const library = createPool(config.DATABASE_URL_LIBRARY, 2);
const usage = usageSink(library, { collegeId: 'global', ownerId: null });
const deps = {
  library,
  voyage: voyageFrom(config, usage),
  gateway: gatewayFrom(config),
  usage,
  embedModel: config.VOYAGE_EMBED_MODEL,
  progress: (s: string) => void process.stdout.write(`  ${s}…\n`),
};

try {
  if (command === 'finish') {
    const ids = values.all
      ? (await library.query<{ id: string }>("select id from sources where status = 'processing' order by created_at")).rows.map((r) => r.id)
      : (values.source ?? []);
    for (const id of ids) {
      const t = Date.now();
      console.log(id, JSON.stringify(await finishSource(id, deps)), `${(Date.now() - t) / 1000}s`);
    }
  } else if (command === 'kanoon') {
    const kanoon = kanoonFrom(config, usage);
    for (const tid of values.tid ?? []) {
      const t = Date.now();
      const r = await ingestKanoonJudgment(Number(tid), { ...deps, kanoon, storage: storageFrom(config), cacheDays: config.KANOON_CACHE_DAYS });
      console.log(tid, JSON.stringify(r), `${(Date.now() - t) / 1000}s`);
    }
  } else if (command === 'gaps') {
    const states = values.state === 'waiting' ? ['open', 'looking', 'loaded'] : values.state === 'all' ? null : [values.state!];
    const rows = await library.query<{ id: string; state: string; kind: string; teachers: number; asks: number; question: string; act_name: string | null; leads: unknown[]; attempts: { provider: string; outcome: string; detail: string }[] }>(
      `select id, state, kind, teachers, asks, question, act_name, leads, attempts from library_gaps
        where ($1::gap_state[] is null or state = any($1)) order by teachers desc, asks desc, last_seen_at desc limit 50`,
      [states],
    );
    if (!rows.rows.length) console.log('No gaps.');
    for (const g of rows.rows) {
      console.log(`${g.id}  [${g.state}] ${g.kind}${g.act_name ? ` (${g.act_name})` : ''}  teachers ${g.teachers}, asked ${g.asks}×\n  "${g.question}"`);
      for (const a of g.attempts.slice(-4)) console.log(`    ${a.provider}: ${a.outcome} — ${a.detail}`);
      if (g.leads.length) console.log(`    ${g.leads.length} official link(s) for the editor`);
    }
  } else if (command === 'lookup') {
    const lookup = createGapLookup({
      ...deps,
      storage: storageFrom(config),
      kanoon: config.INDIAN_KANOON_TOKEN ? kanoonFrom(config, usage) : null,
      indiaCode: indiaCodeFrom(),
      web: webSearchFrom(config, usage),
      cacheDays: config.KANOON_CACHE_DAYS,
    });
    if (values.gap) {
      console.log(JSON.stringify(await lookup.run(values.gap, { force: true }), null, 2));
    } else if (values.question) {
      // Search exactly as the teacher would (her tenant, RLS on), on the app role.
      const app = createPool(config.DATABASE_URL, 2);
      try {
        // The library role cannot read users; the API's sign-in lookup can.
        const user = (await app.query<{ id: string; college_id: string; role: 'teacher' | 'admin' | 'library_editor' }>(
          'select id, college_id, role from auth_find_user($1)', [values.as],
        )).rows[0];
        if (!user) throw new Error(`No user ${values.as}; run pnpm db:seed`);
        const tenant: TenantRunner = (fn) => withTenant(app, { userId: user.id, collegeId: user.college_id, role: user.role }, fn);
        const t = Date.now();
        const r = await searchWithLookup(
          tenant,
          { query: values.question, purpose: 'explore' },
          (c) => {
            const teacherUsage = usageSink(c, { collegeId: user.college_id, ownerId: user.id });
            return { voyage: voyageFrom(config, teacherUsage), gateway: deps.gateway, usage: teacherUsage, minScore: config.RERANK_MIN_SCORE };
          },
          lookup,
        );
        console.log(`outcome: ${r.outcome} (${(Date.now() - t) / 1000}s)`);
        for (const s of r.sources) console.log(`  ${s.tag} ${s.rerankScore?.toFixed(2) ?? '—'} ${s.provisional ? '[not yet reviewed] ' : ''}${s.header}`);
        if (r.gap) console.log(JSON.stringify(r.gap, null, 2));
      } finally {
        await app.end();
      }
    } else {
      throw new Error('lookup needs --question "<text>" or --gap <id>');
    }
  } else {
    console.error('Usage: pnpm library finish (--all | --source <id>) | kanoon --tid <n> | gaps [--state …] | lookup (--question "…" [--as <email>] | --gap <id>)');
    process.exitCode = 1;
  }
  const spent = await library.query<{ provider: string; calls: number; cost: string }>(
    "select provider, count(*)::int calls, sum(cost_micro_usd) cost from usage where created_at > now() - interval '1 hour' group by provider",
  );
  for (const r of spent.rows) console.log(`last hour: ${r.provider} ${r.calls} calls, US$${(Number(r.cost) / 1e6).toFixed(4)}`);
} finally {
  await library.end();
}
