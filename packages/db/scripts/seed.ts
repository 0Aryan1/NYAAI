/** Loads seeds/dev.sql as nyaai_owner. Development only. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../.env'));
} catch {
  /* env may come from the shell instead */
}

if ((process.env.NODE_ENV ?? 'development') !== 'development') {
  console.error('Refusing to seed: NODE_ENV is not development.');
  process.exit(1);
}
const url = process.env.DATABASE_URL_MIGRATE;
if (!url) {
  console.error('DATABASE_URL_MIGRATE is not set.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const which = process.argv[2] ?? 'dev';
  const file = { dev: 'dev.sql', concepts: 'concepts.draft.sql' }[which];
  if (!file) throw new Error(`unknown seed "${which}" (dev | concepts)`);
  await client.query(await readFile(path.resolve(here, `../seeds/${file}`), 'utf8'));
  console.log(`seeded ${file}`);
} finally {
  await client.end();
}
