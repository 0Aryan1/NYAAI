/**
 * Library CLI (development and library-editor support). Runs as nyaai_library, like the worker.
 *   pnpm library finish --all                 stages 5–7 (label, embed, gate) for every source still processing
 *   pnpm library finish --source <uuid>       the same for one source
 *   pnpm library kanoon --tid 1214064 [--tid …]   load judgments from Indian Kanoon (provisional, expiring)
 */
import { parseArgs } from 'node:util';
import { createPool } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { usageSink } from '../src/services/usage.ts';
import { gatewayFrom, kanoonFrom, storageFrom, voyageFrom } from '../src/services/factory.ts';
import { finishSource } from '../src/services/ingest/finish.ts';
import { ingestKanoonJudgment } from '../src/services/ingest/kanoon.ts';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { all: { type: 'boolean' }, source: { type: 'string', multiple: true }, tid: { type: 'string', multiple: true } } });

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
  } else {
    console.error('Usage: pnpm library finish (--all | --source <id>) | pnpm library kanoon --tid <n> [--tid <n>]');
    process.exitCode = 1;
  }
  const spent = await library.query<{ provider: string; calls: number; cost: string }>(
    "select provider, count(*)::int calls, sum(cost_micro_usd) cost from usage where created_at > now() - interval '1 hour' group by provider",
  );
  for (const r of spent.rows) console.log(`last hour: ${r.provider} ${r.calls} calls, US$${(Number(r.cost) / 1e6).toFixed(4)}`);
} finally {
  await library.end();
}
