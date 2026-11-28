/** Loads seeds/dev.sql as nyaai_owner. Development only. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { ownerDatabaseUrl } from '../src/owner-url.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let url: string;
try {
  url = ownerDatabaseUrl(); // also loads the repo-root .env
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
if ((process.env.NODE_ENV ?? 'development') !== 'development') {
  console.error('Refusing to seed: NODE_ENV is not development.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const which = process.argv[2] ?? 'dev';
  const file = { dev: 'dev.sql', concepts: 'concepts.draft.sql', 'concepts-pilot': 'concepts.pilot.draft.sql' }[which];
  if (!file) throw new Error(`unknown seed "${which}" (dev | concepts | concepts-pilot)`);
  await client.query(await readFile(path.resolve(here, `../seeds/${file}`), 'utf8'));
  console.log(`seeded ${file}`);
} finally {
  await client.end();
}
