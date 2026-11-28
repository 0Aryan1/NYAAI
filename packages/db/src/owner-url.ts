/**
 * The owner role's connection string (DATABASE_URL_MIGRATE), for the tools that change the schema or load seed data:
 * migrations, seeds, Drizzle type pulls and the E2E account script. The app itself never connects as the owner.
 * Reads the repo-root .env when present; stops with a clear message when the variable is missing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function ownerDatabaseUrl(): string {
  try {
    process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'));
  } catch {
    /* env may come from the shell instead */
  }
  const url = process.env.DATABASE_URL_MIGRATE?.trim();
  if (!url)
    throw new Error('DATABASE_URL_MIGRATE is not set; it must point at the nyaai_owner role (see .env.example).');
  return url;
}
