/**
 * Development CLI: load one statute into the shared library and run ingestion stages 1–4 inline.
 *   pnpm ingest:source --file ~/Downloads/A1872-09.pdf --type act --act "Indian Contract Act" --year 1872 --origin india_code
 *   pnpm ingest:source --url https://... --type constitution --act "Constitution of India" --origin india_code
 * Uses DATABASE_URL_LIBRARY (nyaai_library), exactly like the worker.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createPool } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { createStorage } from '../src/services/storage/index.ts';
import { ingestSource } from '../src/services/ingest/source.ts';

const { values: a } = parseArgs({
  options: {
    url: { type: 'string' },
    file: { type: 'string' },
    type: { type: 'string', default: 'act' },
    act: { type: 'string' },
    year: { type: 'string' },
    title: { type: 'string' },
    origin: { type: 'string', default: 'india_code' },
  },
});

const config = loadConfig();
if (config.NODE_ENV !== 'development') throw new Error('ingest:source is a development tool.');
if (!a.act || (!a.url && !a.file)) {
  console.error('Usage: pnpm ingest:source (--url <https> | --file <path>) --act "<Act name>" [--year 1872] [--type act|constitution] [--origin india_code]');
  process.exit(1);
}
const url = a.file ? pathToFileURL(path.resolve(process.env.INIT_CWD ?? process.cwd(), a.file.replace(/^~(?=\/)/, process.env.HOME ?? '~'))).href : a.url!;
const library = createPool(config.DATABASE_URL_LIBRARY!, 2);
const storage = createStorage({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  bucket: config.S3_BUCKET,
  accessKeyId: config.S3_ACCESS_KEY_ID,
  secretAccessKey: config.S3_SECRET_ACCESS_KEY,
});

try {
  const title = a.title ?? (a.year ? `${a.act}, ${a.year}` : a.act);
  const existing = (
    await library.query<{ id: string }>('select id from sources where url = $1 and origin = $2 order by created_at desc limit 1', [url, a.origin])
  ).rows[0];
  const sourceId =
    existing?.id ??
    (
      await library.query<{ id: string }>(
        `insert into sources (college_id, visibility, type, origin, title, act_name, act_year, url, content_hash)
         values ((select id from colleges where is_global), 'shared', $1, $2, $3, $4, $5, $6, 'pending:' || gen_random_uuid())
         returning id`,
        [a.type, a.origin, title, a.act, a.year ? Number(a.year) : null, url],
      )
    ).rows[0]!.id;
  const started = Date.now();
  const result = await ingestSource(sourceId, { library, storage, allowFile: true, progress: (s) => console.log(`  ${s}…`) });
  console.log(JSON.stringify({ sourceId, ...result, seconds: (Date.now() - started) / 1000 }, null, 2));
} finally {
  await library.end();
}
