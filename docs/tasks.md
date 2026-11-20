# Tasks

Main goal: **finish the week-1 pilot**, meaning every BRD Must requirement works on MVP hosting. Build order follows [LLD §16.4](specs/LLD.md) and [HLD §14](specs/HLD.md). Tick items here as they are done.

## Day 0: Monorepo, CI, Docker, config, tokens (done when `pnpm dev` runs web + API + worker)
- [x] Docs: specs saved, working docs, CLAUDE.md, memory
- [x] git init, pnpm via corepack, workspace, turbo, tsconfig base, eslint (one-door rule), prettier
- [x] `.env.example` (LLD §15.4) + `.gitignore`
- [x] `infra/docker-compose.yml`: pgvector pg17 + DB roles, redis, SeaweedFS S3 + bucket
- [x] `packages/shared` (ApiError), `packages/db` (drizzle config, `0000_extensions.sql`), `packages/ui` (tokens, fonts)
- [x] `packages/prompts`, `packages/legal`, `packages/checker-rules` shells with tests; `eval/` README
- [x] `apps/server`: config schema, API (`/api/v1/health`), worker (`ops.ping`), Dockerfile
- [x] `apps/web`: Vite + React 19 + Tailwind v4 + router + Query, token-themed placeholder pages
- [x] CI workflow (lint, typecheck, test)
- [x] Verified: install, lint, typecheck, test, compose healthy, `pnpm dev` health OK

## Day 1: Schema + RLS, sign-in, ingestion 1–3, statute splitter
- [x] `0001_init.sql`: all 41 tables, enums, indexes, RLS policies, `global_college()`, `auth_find_user()` (+ `auth_accept_invite()`), dev seed
- [x] Tenant middleware (`req.db`, SET LOCAL per transaction) + RLS tests (9: pooled connection, A vs B, worker, editor, library, role/budget guards)
- [x] Sign-in: dev stub login + **Google sign-in verified live** with a test client (Gmail, `GOOGLE_SKIP_HD_CHECK` in development); session JWT, CSRF, rate limits. CNLU's own Workspace client still needed for the pilot
- [x] Ingestion stages 1–4: fetch, extract (PDF/HTML/text), clean, split; `ingest` queue + worker + `pnpm ingest:source` CLI
- [x] Statute splitter with tests (ICA ss. 25, 32, 56; Art. 19; provisos, explanations, footnotes, orphan check)
- [x] Web: login (dev accounts), setup wizard (consent + 5 steps; 3 are placeholders), app shell, Home with empty chips and gated Prepare
- [x] Done when: a loaded Act appears as section chunks: **official ICA PDF from indiacode.gov.in → 268 units (ss. 1–266 + 19A, 178A; 76 repealed), chapters and pages right**
- [x] RLS tests green (also in CI with Postgres + Redis service containers)
- [x] Statute fixtures checked word for word against the official ICA text (ss. 25, 32, 56 now identical)
- [x] Current Constitution loaded (Legislative Department, as on 10 Sep 2026): 503 Articles + 48 clause-level children, Parts and Chapters labelled; Art. 18–20 fixtures checked word for word

## Day 2: Judgments, metadata, embeddings, search
- [x] Judgment splitter, opinion boundaries, paragraph roles (rules first, then Haiku); Kanoon adapter; court list. Tested on Satyabrata Ghose, Kharak Singh (dissent), Energy Watchdog
- [x] Ingestion stages 5–7: label (Haiku `labeller.roles`), embed (Voyage), gate (official → live + sample item; Kanoon → provisional); `pnpm library finish|kanoon`
- [x] LLM gateway (light/heavy tiers, structured output, escalation, never downgrade, usage costs); Voyage and Kanoon services
- [x] Search service: exact refs, concepts, vector + FTS with filters, RRF, rerank, outcomes, parent expansion, trace (integration-tested with a fake Voyage)
- [x] API: `/suggest`, `/topics/resolve`, `/events/stream` (SSE with replay), `/library/search`
- [x] Web: topic box suggestions (combobox), ambiguity dialog, Build screen over SSE
- [x] Draft retrieval set (15 + 2 red-team, `eval/sets/retrieval.draft.json`) and `pnpm eval:retrieval`; draft concept list (`pnpm db:seed:concepts`)
- [x] Indexed ICA (268) and the Constitution (548 embedded); loaded 5 frustration cases from Kanoon (provisional); linked the draft concepts
- [x] Done when: **retrieval hit@8 15/15 with rerank (11/15 without), red team 2/2 — PASS** on the draft set (`eval_runs`, 2026-11-20). Day 2 total AI/search cost ≈ US$0.16
- [ ] Draft test set and concept list reviewed by a law expert

## Added 2026-11-20: library gaps + trusted-source lookup (not in LLD; see memory.md)
- [x] `0004_library_gaps.sql`: `library_gaps`, `library_gap_askers` (who asked, hidden), `record_library_gap()`, review kind `library_gap`
- [x] Gap logic in `packages/legal/src/gaps.ts` (Act/case/topic, exact-match Act pick, case-title check, allowlist); more Act aliases
- [x] India Code client (`services/india-code`), web-leads client (`services/web-search`, Perplexity, allowlist only), lookup + `searchWithLookup` (`services/lookup`)
- [x] `ingest.lookup` job; editor API `GET /library/gaps`, `PATCH /library/gaps/:id`, `POST /library/gaps/:id/lookup`; `pnpm library gaps|lookup`
- [x] Tests: 17 unit (legal), 3 client, 5 integration (counting, RLS, no auto-load on ambiguity, Kanoon load → answered, HTTP)
- [x] Live: "Sale of Goods Act" question → India Code → 67 sections (provisional) → answered; "Mohori Bibee" → not on Kanoon → 2 official links for the editor
- [ ] Day 3: the lecture build retrieves with `searchWithLookup` (lookup inline, within the build's time budget)
- [ ] Day 5: Explore uses `searchWithLookup` with `lookup = null` and queues `ingest.lookup`; editor queue screen shows gaps (attempts, links, close/re-run) and lets the editor confirm auto-loaded India Code Acts
- [ ] Day 6: "delete my data" — askers cascade; decide whether her gap questions are deleted or kept unattributed

## Day 3: Planner, writer, checks, coverage
- [x] LLM gateway: tiers, structured output, cost logging (Day 2); budget gate in Prepare and the build; per-lecture cost tagging
- [x] planner.lecture, writer.part, writer.repair, checker.support, checker.second (`packages/prompts`)
- [x] checker-rules C1–C8, risk, decision table, coverage matching (20 tests incl. planted errors); C9/C10 orchestration; must-cover list in `packages/legal`
- [x] `0005_build.sql`; build job (plan → parts in parallel → checks → one repair → save → coverage), resumable; Prepare, lecture, slides, source, coverage, leave-out, retry endpoints
- [x] Web: Prepare → Build (outline, retry, auto-open) → Studio (outline, slide canvas, ClaimLine, flag popover, Source drawer with highlighted words, coverage panel, N/[ ] keys)
- [x] Integration test with a fake Claude: every planted error caught, repaired or flagged; resume; RLS
- [ ] Prompt caching: the gateway caches blocks ≥ 16K chars only; check cache reads on repair and C10 once real lectures run (target ≥ 60%)
- [x] Done when: one full lecture builds with flags and coverage — **"Frustration of contract" (50 min): 7 parts, 35 slides, 46 yellow, 35 grey, coverage 50%, US$1.05** (2026-11-21, resumed after the credit top-up)
- [x] Cost and false-flag fixes: shared writer/repair cache prefix, 512-token breakpoints, 6 sources per part, `looksLegal` narrowed, `checker.support` v2, writer v2 (lecture-style slides)
- [x] Studio slide view (footnotes, layouts, "Show checks"); library editor review screen `/library` + migration 0006 (pulled forward from Day 5)
- [ ] Bring a lecture to ≤ 5 yellow and ≤ US$0.59 — measure on the second real build; most remaining yellow needs the expert's "Labels checked"
- [ ] Syllabus: create a course from the CNLU semester 1 syllabus (COURSE-2) and load its sources (DATA-1, DATA-3)

## Day 4: PPT, edits, course series
- [ ] PPT builder (pptx-automizer + pptxgenjs fallback), flags in notes, remove-unverified
- [ ] Edit checks (C1–C8 inline; C9/C10 background); course memory, recap and bridge
- [ ] Web: autosave and versions, Download dialog, course plan
- [ ] DATA-3: syllabus upload → for each planned lecture, the same gap check + lookup in the background (`ingest.syllabus`); was missing from the plan
- [ ] Done when: J1 end to end; .pptx output tests green

## Day 5: Explore, quick Research, reports queue
- [ ] Explore (library only), quick Research, wrong-fact reports, library editor queue
- [ ] Done when: full gold + red-team + planted sets pass

## Day 6: Privacy, deletion, deploy
- [ ] Delete and export my data; consent screen; axe fixes; empty, error and slow states; landing page
- [ ] Done when: E2E J1 and J3 green; pilot live

## Day 7: With teachers
- [ ] Teachers repeat the end-to-end video on their own topics

## Weeks 2–4 (Should items, HLD §14.1)
AWS Mumbai move · teaching coach · merge/split units · web search + What's new · nightly checks (F5) · add one-off to course (F9) · case-status suggestion job · second-check measurement · checker false-flag tuning · reading list · topic brief and tutorial problems · thorough Research · Word/PDF export · Langfuse · contract tests · k6 · ZAP · metrics dashboard.

## Launch checklist (BRD §12)
See [BRD §12](specs/BRD.md). Copy items here as they become actionable.

## Open questions (BRD §11, HLD §14.4)
- [ ] Pilot teachers and courses (about 2 courses, 8 topics)
- [ ] CNLU data-residency exception: who signs, and when
- [ ] Indian Kanoon storage terms (decides `KANOON_CACHE_DAYS`)
- [ ] Named law experts (library editor, criminal-law reviewer, gold-set authors, weekly checker)
- [ ] Google OAuth client for the CNLU domain
- [ ] 3 ready CNLU slide templates
- [ ] Production domain
