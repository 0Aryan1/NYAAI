# Project memory (running log)

Append the newest entries at the top of each section. Never put secrets here.

## Status
- **2026-11-20, Day 1 done.**
  - Official Indian Contract Act loaded from India Code: 268 units (ss. 1–266 + 19A, 178A; 76 repealed).
  - Schema (41 tables) with RLS forced on every table; 9 RLS tests green.
  - Dev sign-in → consent → setup → Home works through the Vite proxy; CSRF and rate limits on.
  - lint, typecheck and 101 tests green.
  - Current Constitution loaded (as on 10 Sep 2026): 503 Articles, 48 clause children; only Art. 238 absent (the PDF prints Part VII only as omitted).
  - Next: Day 2 (judgment splitter, labels, embeddings, search).
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
| Google OAuth client | ✅ test client (Aryan's Google Cloud project "NYAAI", External, Testing mode, redirect `http://localhost:5173/api/v1/auth/google/callback`); live sign-in verified 2026-11-20. The pilot still needs CNLU's own client (Internal, cnlu.ac.in). |
| Perplexity, Cohere, Langfuse, Sentry | not needed for week 1 |

## Mocks and stand-ins currently in place
- Google sign-in works locally with a Gmail test account (`aryanagrawal0102@gmail.com`, invited as admin) because `GOOGLE_SKIP_HD_CHECK=true` (development only). Remove it, and set `ALLOWED_EMAIL_DOMAINS=cnlu.ac.in`, once CNLU's Workspace client exists.
- Sign-in: dev stub login (`POST /auth/dev-login`, only when `DEV_LOGIN=true` and `NODE_ENV=development`). Seeded accounts: `teacher.a@`, `teacher.b@`, `admin@`, `editor@cnlu.ac.in` (`pnpm db:seed`). Google code is in place and returns 503 until `GOOGLE_CLIENT_ID`/`SECRET` are set.
- Setup steps Old slides, Template and Courses are placeholders with "Skip for now" (Day 4).
- Home's Prepare button shows a "being switched on" note; building starts Day 3.
- Library chunks stay `status = processing` until stages 5–7 (labels, embeddings, gate) land on Day 2.
- Local stack (`pnpm db:up`), with ports offset so nothing clashes with Homebrew Postgres:
  - Postgres `pgvector/pgvector:pg17` on **54329** (stands in for Neon/RDS)
  - Redis on **63799**
  - SeaweedFS S3 on **19000** (stands in for R2/S3)

## Build decisions (with reasons)
- **2026-11-20, `GOOGLE_SKIP_HD_CHECK` (development only).** The app accepts only Google Workspace accounts (`hd` claim = the email's domain, LLD §15.1). appnox.ai mail is on Hostinger and Gmail has no `hd`, so no local test account could pass. The switch skips only the `hd` check (and the `hd` hint to Google); verified email, allowed domain and invitation still apply. Config refuses it outside `NODE_ENV=development`; tests cover both.
- **2026-11-20, India Code moved to https://indiacode.gov.in** (the old indiacode.nic.in only redirects, which is why fetches timed out). The new site is DSpace 7 with a public REST API:
  - Search: `/server/api/discover/search/objects?query=dc.identifier.collection:ACT AND dc.date.act_year:1872 AND dc.identifier.state_name:CENTRAL&dsoType=ITEM`. Central Acts have `state_name = CENTRAL`; each section is also its own item, so filter on the ACT collection.
  - Files: `/server/api/core/items/<uuid>?embed=bundles/bitstreams`; the English PDF is the `a<year>-<no>.pdf` bitstream in the ORIGINAL bundle (`H…pdf` is Hindi), downloaded from `…/bitstreams/<uuid>/content`.
  - ICA 1872 = item `0e782442-f035-4d53-aace-81b1552a8cf2`, PDF bitstream `e7571d39-11a7-4a2c-86e3-c515ae43e617`.
  - India Code's "The Constitution of India" PDF (filed under UTs) is **out of date**: its last amendment is the 94th (2006), so it lacks the 97th (Art. 19(1)(c) co-operative societies), 101st (GST), 103rd (EWS) and 106th. Do not load it. Use the Legislative Department's current edition (legislative.gov.in renders its links with JavaScript, so download it in a browser).
- **2026-11-20, the Constitution comes from the Legislative Department's edition** ("As on 10th September, 2026", 402 pages, includes the 106th Amendment), downloaded by Aryan from legislative.gov.in as `~/Downloads/Constitution of India page.pdf`. Stored with origin `india_code` (same Ministry of Law publisher; the enum has no Legislative Department value). Re-download when a new "as on" edition appears.
- **2026-11-20, splitter rules learned from the official Constitution PDF:**
  - Its contents list is headed "Contents", and some entries look like real headings ("[31. … —Omitted.]"): contents now end only at the full heading of section/Article **1**, and Part/Chapter headings seen inside the contents still set the context.
  - Context is "Part V: The union › Chapter I: The executive"; markers and brackets are stripped from Part/Chapter labels and from titles.
  - Parsing stops at the first Schedule or Appendix heading (Schedules get their own chunking later).
  - A marker right after the number ("368. 1[Power of …") is stripped before matching.
  - The PDF uses "⎯" (U+23AF) as a dash; the cleaner maps it to an em dash.
  - Running headers like "(Part III.—Fundamental Rights)" sit mid-page in the extracted order: any short, fully bracketed line on 3+ pages is dropped.
  - Fixture correction found by the check: Art. 19's 97th-Amendment change took effect **8-2-2012** (the fixture had 15-2-2012, which is Art. 43B's date).
- **2026-11-20, splitter rules learned from the official ICA PDF:**
  - Skip the "ARRANGEMENT OF SECTIONS" block until the first full section heading; contents entries otherwise become sections (a glued superscript turned "66." into "266.").
  - Join a heading that wraps to the next line before its ".—" (s. 25, s. 174).
  - Recognise repealed one-liners ("120. [...] Rep. by s. 65, ibid.", also wrapped and without spaces) as repealed sections; label repealed chapters "Sales of goods (repealed)".
  - Footnote numbers are ≤ 30 (they restart per page), and any numbered line inside the footnote block starts a new footnote; otherwise "Rep. by" one-liners threw the splitter into footnote mode and swallowed Chapter VIII.
  - Superscript markers: the PDF line builder now ignores baseline shifts below 70% of the font size; markers left on their own line or glued after a word ("unlawful.1") are absorbed as markers, not text.
  - A line-end hyphen after a compound prefix (non-, co-, sub-, self-…) is kept ("non-performance"); India Code PDFs have no soft hyphenation.
  - The official extracted ICA text is a regression fixture: `packages/legal/test/fixtures/ica-1872-indiacode-lines.tsv`.
- **2026-11-19, Indian Kanoon is not a source of statute text.** Its ICA copy has OCR slips ("tmlawful"), dropped letters and no s. 6; its Article 19 page mixes editorial comment into the Article. Acts and the Constitution come from India Code / Gazette only; Kanoon stays for judgment gaps (D25). Splitter fixtures were built from Kanoon's ICA wording with the slips corrected and must be checked against India Code (`packages/legal/test/fixtures/README.md`).
- **2026-11-19, schema additions to LLD §3 (all in `0001_init.sql`):**
  - `auth_accept_invite(email, name, google_sub)`: security-definer helper that turns an invite into a user and profile at first sign-in. The LLD has no path to create a user before identity exists.
  - `owner_all` policy for `nyaai_owner` on every table: `FORCE RLS` applies to the table owner, and migrations, seeds and the security-definer helpers run as owner. The API and worker never use that role.
  - `users_guard` trigger plus column grants: a teacher can't change her own role, status, email or budget (RLS can't compare old and new values).
  - `teacher_profiles.department` (ACC-3 needs it) and `chunks.amendments jsonb` (amending Act + w.e.f. per footnote; LLD §6.3 says amendments are metadata but gives no column).
  - `case_status_v` is `security_invoker`, so the caller's RLS applies.
  - Policies were written for all 41 tables (the LLD shows the pattern for a few); eval tables are library-role only.
- **2026-11-19, setup order is consent first, then the five ACC-2 steps.** Old slides (step 3) are sent to processors, so consent has to come before them (DPDP).
- **2026-11-19, RLS and sign-in integration tests run against the compose database**, not Testcontainers (LLD §16.1). They skip with a message when the stack is down; CI starts Postgres and Redis service containers. Revisit Testcontainers if parallel CI jobs ever share a database.
- **2026-11-19, `unpdf` is pinned to 1.9.x**: 2.x needs Node ≥ 24 and this machine has 22.15. Upgrading Node lets it move to 2.x.
- **2026-11-19, splitter rules beyond LLD §6.3:**
  - Section numbers must move forward (15 → 15A → 16), so footnotes and schedule items are never read as sections.
  - Section titles end at "." + dash or an em/en dash, so hyphenated words and "etc." stay in the title.
  - Footnotes run from the first footnote (or a rule line) to the end of the page; markers ("1[", "3* * *") lose their number but keep brackets.
  - A short heading line before a section ("Right to Freedom") is context, not law text.
  - An explanation saying "this sub-section" stays with that sub-section; other explanations, illustrations and exceptions go with every child of a split section; provisos stay with their sub-section.
  - A long section with no sub-sections stays one chunk (ICA s. 73 ≈ 2,400 tokens): never split by size.
- **2026-11-19, running headers are detected only in the first and last 2 lines of a page**, so repeated statute wording in the body is never removed.
- **2026-11-19, `react-hook-form` not added yet**: the setup and Home forms are small; add it with the Prepare form on Day 2–3.
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
