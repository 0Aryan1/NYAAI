import { defineConfig } from 'drizzle-kit';

// SQL migrations in ./migrations are the source of truth; `drizzle-kit pull` generates typed schema into ./src/schema.
export default defineConfig({
  dialect: 'postgresql',
  out: './src/schema',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? '' },
});
