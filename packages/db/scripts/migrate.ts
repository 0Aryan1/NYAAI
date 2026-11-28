/**
 * Minimal forward-only SQL migration runner. Applies packages/db/migrations/*.sql in name order,
 * each in its own transaction, as the owner role (DATABASE_URL_MIGRATE). SQL files are the source
 * of truth (LLD §3); Drizzle types are generated from the live schema.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { ownerDatabaseUrl } from '../src/owner-url.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');
let url: string;
try {
  url = ownerDatabaseUrl(); // also loads the repo-root .env
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`create table if not exists schema_migrations (
    name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  // Default privileges would hand this table to the runtime roles; it is migration-only.
  await client.query('revoke all on schema_migrations from nyaai_app, nyaai_worker, nyaai_library');
  const applied = new Map(
    (await client.query<{ name: string; checksum: string }>('select name, checksum from schema_migrations')).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = applied.get(file);
    if (prior) {
      if (prior !== checksum) throw new Error(`${file} changed after it was applied; add a new migration instead.`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file, checksum]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('migrations up to date');
} finally {
  await client.end();
}
