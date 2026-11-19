# Project memory (running log)

Append the newest entries at the top of each section. Never put secrets here.

## Status
- **2026-11-19, Day 0 done:**
  - `pnpm dev` runs web on :5173, API on :4000 and the worker.
  - `/api/v1/health` returns db, redis and pgvector 0.8.7 all ok.
  - The worker ran `ops.ping`.
  - lint, typecheck and 52 tests are green.
  - Next: Day 1 (schema + RLS, sign-in, ingestion, statute splitter).
- **2026-11-19:** BRD, HLD and LLD finalized (by Aryan Agrawal) and saved to `docs/specs/`.

## Credentials available (values live only in `.env`)
| Service | Status |
|---|---|
| Anthropic API | ✅ available; paste into `.env` as `ANTHROPIC_API_KEY` (still blank) |
| Voyage AI | ✅ available; paste as `VOYAGE_API_KEY` (still blank) |
| Indian Kanoon API | ✅ available; paste as `INDIAN_KANOON_TOKEN` (still blank) |
| Google OAuth client | ❌ not yet; dev stub login (`DEV_LOGIN=true`, development only) |
| Perplexity, Cohere, Langfuse, Sentry | not needed for week 1 |

## Mocks and stand-ins currently in place
- Sign-in: dev stub login until the Google client exists. Not built yet (Day 1).
- Local stack (`pnpm db:up`), with ports offset so nothing clashes with Homebrew Postgres:
  - Postgres `pgvector/pgvector:pg17` on **54329** (stands in for Neon/RDS)
  - Redis on **63799**
  - SeaweedFS S3 on **19000** (stands in for R2/S3)

## Build decisions (with reasons)
- **2026-11-19, local S3 is SeaweedFS, not MinIO.** MinIO no longer publishes images on Docker Hub or Quay (pulls fail). SeaweedFS is Apache-2.0 and S3-compatible. Credentials are in `infra/seaweedfs/s3.json`, and the bucket is created by the `s3-init` container. Storage code must only use the S3 API (D5), so nothing else changes.
- **2026-11-19, pnpm 12.21 is installed via `npm i -g pnpm --prefix ~/.local`.** `corepack enable` could not write to `/usr/local/bin` (EACCES). `~/.local/bin` must be on PATH; it is **not** in the user's `~/.zshrc` yet.
- **2026-11-19, TypeScript is pinned `~6.0.3`, not 7.x.** typescript-eslint 8.73 supports TS only up to 6.1.
- **2026-11-19, pnpm 12's minimum release age is respected.**
  - Version ranges were relaxed (`bullmq ^6`, `react-router ^8`, `@tanstack/react-query ^5.90`, `lucide-react ^1`) so pnpm picks mature releases. Do not add `minimumReleaseAgeExclude`.
  - Dependency build scripts are allowed only for esbuild and msgpackr-extract (`allowBuilds` in `pnpm-workspace.yaml`).
- **2026-11-19, jsdom is pinned to 29.x.**
  - Reason: the machine runs Node **22.15**, and jsdom 30+ needs ≥ 22.22.
  - react-router 8 also declares Node ≥ 22.22. It runs in the browser, so this is a warning only.
  - **Recommendation:** upgrade local Node to 22.22+ or 24 LTS. CI uses `.nvmrc` = 22, which resolves to the latest 22.x.
- **2026-11-19, provider keys are required only when `NODE_ENV=production`.** In development the API and worker start with a warning that lists the missing keys. This changes the plan, which said "required outside test". The reason: the stack must run before keys are pasted.
- **2026-11-19, added env vars beyond LLD §15.4:**
  - `DATABASE_URL_WORKER`: the worker connects as `nyaai_worker`, not `nyaai_app`.
  - `DATABASE_URL_MIGRATE`: the `nyaai_owner` role, used for migrations only.
  - `API_PORT`, `WEB_ORIGIN`, `LOG_LEVEL`.
- **2026-11-19, DB roles and extensions are created by `infra/postgres/init/00-roles.sql`** (superuser, first boot only). Default privileges grant the runtime roles CRUD on tables `nyaai_owner` creates. On Neon or RDS, run the equivalent role setup by hand.
- **2026-11-19, migrations are plain SQL** in `packages/db/migrations`, applied by `packages/db/scripts/migrate.ts`. It uses a checksum table and refuses to run if an applied file has been edited. Drizzle types will be pulled from the live schema.
- **2026-11-19, the server runs through `tsx` in dev and in the Docker image**, with no build step yet. Revisit if cold start matters.
- **2026-11-19, font tokens are named `--font-ui` and `--font-legal`**, not `--font-sans`, to avoid a circular reference in Tailwind's `@theme inline`.
- **2026-11-19, all 24 token contrast pairs from LLD §13.1 pass WCAG AA (4.5:1)** in both themes (`packages/ui/src/tokens.test.ts`).
- **2026-11-19, the `/api/v1/health` endpoint is unauthenticated.** It returns 503 when a dependency is down.
