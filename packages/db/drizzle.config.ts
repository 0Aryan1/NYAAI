import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* env may come from the shell */
}

// SQL migrations in ./migrations are the source of truth; `drizzle-kit pull` generates typed schema into ./src/schema.
export default defineConfig({
  dialect: 'postgresql',
  out: './src/schema',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? '' },
});
