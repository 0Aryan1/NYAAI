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
- [x] Syllabus upload (COURSE-2, DATA-3, 2026-11-25): "Upload your syllabus" on Courses (Word, PDF or text; read by code, not kept; one lecture per unit or per topic; she edits the list); "Find the sources for every lecture now" runs `ingest.syllabus` (library search, then India Code / Indian Kanoon for gaps; no AI model); the course plan shows "Sources ready / Few sources / None found yet" per lecture

## Added 2026-11-21: pilot library for ADR and Property Law (quality first; see memory.md)
- [x] Course packs `packages/db/seeds/packs/{adr,property}.json` + `pnpm library pack` (Acts from India Code, cases from Kanoon by party-word title match)
- [x] 14 Acts loaded and complete (A&C 1996, CPC, Mediation 2023, LSA, Family Courts, Gram Nyayalayas, Commercial Courts, Lokpal, IR Code 2020, TPA, Easements, Trusts, RFCTLARR 2013, Registration): no missing section numbers
- [x] Splitter fixes found by auditing them (contents, footnotes, wrapped headings, chapters, State amendments, Objects and Reasons, letter-spacing) + 9 new tests; `pnpm library reload` updates in place (ids kept)
- [x] Draft concept list for both courses (52 concepts, 105 key sections; `pnpm --filter @nyaai/db seed concepts-pilot`); search matches concept aliases inside a question
- [x] Draft retrieval set `eval/sets/retrieval.adr-property.draft.json` (60 questions + 1 red team)
- [x] Leading cases loaded: Property 22/25, ADR 31/34 (6 not on Kanoon's API, listed in memory.md for the editor)
- [x] Judgment splitter fixes (`<pre>` judgments, numbering skips/restarts, quoted provisions, size cap) + `pnpm library resplit`
- [x] Retrieval on the new set: hit@8 60/60 (55 at rank 1), red team 1/1
- [x] Official judgments first (BRD DATA-7, HLD D25; 2026-11-22): Supreme Court Reports loader (`services/escr`, e-SCR mirror), PDF judgment reader (`pdfToJudgment`), in-place replacement with ids and labels kept, `source_copies` + `sources.scanned` (migration 0007), `pnpm library official`, packs try the official report first, `resplit` also re-reads stored PDFs
- [x] Re-loaded the library from the official report: 16 typeset judgments now official and permanent; 39 scanned official copies attached beside the cleaner Kanoon text (with citations and agreement); 4 not in the official report
- [x] The 6 missing pack cases loaded (TRF, In Re: Interplay, Kinnari Mullick, Shanti Prasad Devi from the official report; Rambaran Prosad and Rajes Kanta Roy found under their official spellings)
- [x] Editor uploads a judgment PDF (new case or a better copy): `POST /library/uploads/judgment`, `ingest.judgment` job, "Add a judgment" on `/library`; the review screen shows where each text came from and every copy held
- [ ] Editor: approve the 3 scanned official judgments (TRF, Kinnari Mullick, Shanti Prasad Devi) after checking quotes against the PDF; find clean copies (sci.gov.in) for scanned leading cases worth replacing
- [ ] Not in the official report mirror: Naihati Jute Mills (1967), M.H. Hoskot (1978), Justiniano Antao (2004), "M.D., Army Welfare Housing" (2003, bad Kanoon title): editor checks or uploads
- [ ] High Court judgments from official sites (eCourts judgments portal): not built; upload covers them for now
- [ ] Retrieval items that expect specific judgment paragraphs (needs the expert's choice of passages)
- [ ] Expert review: pack case lists, concept list, retrieval set; "Labels checked" on the leading cases

## Added 2026-11-22: A2 course series (pulled forward from Day 4; see memory.md)
- [x] Course memory, recap and bridge (COURSE-4, COURSE-5, HLD F8.2–F8.3): pure logic in `packages/legal/src/course.ts` (memory for a lecture, series checks, terms kept only if on the slides) + 9 tests
- [x] `learn.summary` prompt and `learn` queue/worker; mark taught and undo (`POST/DELETE /lectures/:id/taught`, COURSE-7)
- [x] Build reads course memory: planner v2 (recap first only when something was taught, bridge last to the next lecture), recap/bridge written even when the library has nothing; writer v3 sees the whole outline (flow between parts) and the course memory as data
- [x] Courses API: `GET/POST /courses`, `GET/PATCH/DELETE /courses/:id`, `PATCH /courses/:id/units` (add, rename, delete, reorder, prerequisites, skip), `GET /courses/:id/series-checks` (COURSE-1, -3, -6); Prepare warns on untaught prerequisites (HOME-10)
- [x] Web: Courses list (new course from a pasted list), course plan (status, taught date, memory, suggestions, reorder, rename, delete, skip, builds-on), Prepare from the plan, "Mark taught" in the Studio
- [x] Integration test with a fake Claude (6): plan → lecture 1 → taught → memory → lecture 2 with a recap; prerequisite warning; series checks; undo
- [x] Measured on two real lectures in a row (ADR: Seat of arbitration → Setting aside): recap and bridge work; fixed topic matching, bare section refs, unsourced legal lines, meeting-sense "held" (see memory.md)
- [ ] Lecture cost: L01 US$0.67, L02 US$0.87 (8 parts) against the US$0.59 target; writer.part is ~85% of it
- [ ] Repair sometimes empties a slide (L01 "BGS SGS Soma v. NHPC" slide kept one question): refill or merge thin slides
- [ ] Before the VC demo: expert confirms case status and "Labels checked" for the demo topics' cases (grey on every case line until then)
- [ ] Setup step 6 (courses) still a placeholder: point it at the Courses screen
- [ ] "May need update" badge on later lectures when an earlier one is edited (F8.6), with Studio editing

## Added 2026-11-22: expert screens, editing, download, UI cleanup (in the suggested order)
- [x] Expert confirms case status (LIB-2, D28): migration 0008, `POST /library/judgments/:id/status`, "Is it still good law?" panel; the Studio reads case status live
- [x] UI cleanup: shell (working screens only, account menu), Studio (header, status bar, 16:9 slide, notes, Source/Coverage tabs), library (to-do filter, plain status line, folded citations), course plan (row menu)
- [x] Slide editing (STUDIO-2, -4, -6, -7): edit, remove, add a line or note, your example (+ example bank), mark verified, undo/restore with sources; code checks at once, `check.lines` job for C9/C10; migration 0009
- [x] PowerPoint download (PPT-1 to PPT-4): base design, footnotes, notes with sources and flags, hidden "Points to verify" slide, "(cont.)" splitting, Download dialog with "I have seen them" or "Remove unverified lines"
- [ ] Coverage re-run after edits and after "Remove unverified lines" (COVERAGE_CHANGED stop)
- [ ] An edited line with no source: search the lecture's sources and the library for a match (LLD §8.6)
- [ ] Her own template (ACC-6) with `pptx-automizer` once CNLU's templates arrive
- [ ] "Rewrite this part" (needs credits), coach, wrong-fact report button (ADM-2)
- [ ] Expert: confirm the status of the demo topics' cases (about 25) in the new panel

## Added 2026-11-24: research stage before writing (gap fill)
- [x] Library review: fixed list order and the open judgment stays selected after a save; Coverage tab shows the Act's own words for a missing item
- [x] Research stage in the build: every part searched at once, notes merged and de-duplicated, key sections and leading cases added, AI gap check (`research.gaps`, Sonnet, up to 2 rounds, library only), notes saved on the lecture (migration 0010); writers get MUST COVER and "taught in full in another part"; writer v6
- [ ] Try the research stage on a real lecture (needs credits) and compare coverage and yellow counts with L02
- [x] Source standing: sources ordered by relevance, then authority (court, bench, official copy, the court's own reasoning, expert status); relevance saved on each citation (migration 0011); "Why this source" in the Source tab
- [ ] Library: check the bench size of the 5 judgments stored as 1, 4 or 6 judges (e.g. BALCO is stored as 4; it was a 5-judge Constitution Bench); bench size comes from automatic reading of the judges' names
- [ ] Coverage tab: "X of Y covered" instead of a bare % (L01 showed 0% for 0 of 1)
- [ ] Coverage note "Add this for me" (put the item's own words on a slide, linked to its source) and a coverage re-run after edits
- [x] One case, one source (migration 0012): an official copy that replaces a Kanoon text keeps the Kanoon copy on record; before a Kanoon download the lookup checks every held link, then the case (parties, decision date, court); a "maybe" is loaded and the editor asks "same case?" on the review screen (approval waits for the answer); `pnpm library relink` restored the Kanoon link of 15 official copies (from storage, nothing fetched)
- [x] Teacher's own notes, Option A (migration 0013): "My notes" page and "Use your own notes" on Prepare (nothing ticked by default; a document uploaded there is ticked); Word, PDF or text read by the worker as her (`ingest.upload`), one private chunk per heading block, "Your notes: …" labels; a lecture searches only the attached notes (search filter `notes`), each attached note is always used, any other private source is dropped (`onlyAttached`); newer version replaces older; remove takes it out at once; C6: her notes support examples and facts only, never a statement of law; writer v7
- [ ] Notes: try a real build with an attached note (needs credits)
- [ ] Notes: read scanned PDFs (pictures of pages). Today they are refused with "This PDF is a scan with no text in it. Upload a Word copy or a typed PDF." Needs OCR (picture → text); OCR misreads characters (1/l, 0/O), so OCR'd notes must be labelled as machine-read and quotes checked, as for scanned judgments

## Day 4: PPT, edits, course series
- [x] PPT builder: pptxgenjs base design now (automizer with her template later), flags in notes, remove-unverified (2026-11-22)
- [ ] Edit checks (C1–C8 inline; C9/C10 background); ~~course memory, recap and bridge~~ (done 2026-11-22, above)
- [x] Web: save on every change, versions with undo, Download dialog, course plan (2026-11-22)
- [x] DATA-3: syllabus upload → for each planned lecture, the same gap check + lookup in the background (`ingest.syllabus`) (done 2026-11-25, see Day 3)
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
