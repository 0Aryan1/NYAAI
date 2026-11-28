import { defineConfig } from 'drizzle-kit';
import { ownerDatabaseUrl } from './src/owner-url.ts';

// SQL migrations in ./migrations are the source of truth; `drizzle-kit pull` generates typed schema into ./src/schema.
export default defineConfig({
  dialect: 'postgresql',
  out: './src/schema',
  dbCredentials: { url: ownerDatabaseUrl() },
});
