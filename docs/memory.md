# Project memory (running log)

Append the newest entries at the top of each section. Never put secrets here.

## Status
- **2026-11-20, library gaps and trusted-source lookup added** (between Day 2 and Day 3). A thin or not-found search now records a gap for the library editor and can look up India Code (Acts), Indian Kanoon (judgments) and official-site links (Perplexity). Live: the Sale of Goods Act, 1930 loaded from India Code (67 sections, provisional) and the question was answered; live cost ≈ US$0.03. 40 server tests green.
- **2026-11-20, Day 2 done.** Library: official ICA (268) and Constitution (551 chunks) live and indexed; 5 frustration cases from Kanoon (provisional). Retrieval test on the draft set: hit@8 15/15 with rerank, 11/15 without; red team 2/2. 138 tests green. Day 2 cost ≈ US$0.16 (Voyage 0.077, Kanoon 0.06, Haiku 0.02). Next: Day 3 (planner, writer, checks, coverage).
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
| Perplexity | ✅ set; used only for official-site links on library gaps (editor-facing), live-tested 2026-11-20 |
| Cohere, Langfuse, Sentry | not needed for week 1 |

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

## Course documents received (2026-11-21, in ~/Downloads; pilot subjects not yet chosen)
- `Revised-Academic-Regulations-for-2022-27-2023-28.pdf`: subject list per semester only (no topics). Sem 1 law subject: Torts + Consumer Protection + Motor Vehicles. Law of Contracts I is Sem 2.
- `Syllabus-July-December-2024-Sem-3.pdf`: CNLU outlines with modules, topics and session counts for Criminal Law I (BNS 2023, 9 modules), Family Law II (Hindu + Muslim succession, HSA 1956, ISA 1925; 16 modules), Property Law (TPA 1882, Easements, Trusts; 8 modules); plus 3 non-law courses.
- `ADR Course Outline 2025.pdf` (Sem 6): 5 units with lecture counts (60); Arbitration Act 1996, Mediation Act 2023, LSA Act 1987, Family Courts Act 1984, Gram Nyayalayas Act 2008. Best fit for the library model.
- `Taxation 1 - Course Outline` (Sem 5): 6 modules; Income-tax Act 1961 + CGST Act 2017. Check against the Income-tax Act, 2025 before use (a law-change risk like IPC → BNS).
- `Course Outline_5th year_Cross Border Investment Law` (Sem 9): treaties, ICSID, arbitral awards — not in India Code or Indian Kanoon; poor fit without a new source type.
- `Course_Outline Economic Analysis of Law` — Dalhousie (Canada), not CNLU; not a fit.
- `vc6.pdf` — a transcript of a recorded Constitutional Law lecture (citizenship: Izhar Ahmad, Abdul Qadir, Razia Begum). Useful for style learning (F1 old material) and as a real test of the checker on a teacher's own claims.

## Build decisions (with reasons)
- **2026-11-21, second real lecture ("Frustration of contract" again): 19 yellow (was 46), US$0.84 (was 1.05).** 17 of the 19 are "labels not yet checked by an expert"; "partly" false flags gone; unsourced-line flags 8 → 3. Grey rose to 53 (the writer now cites cases more; no status is confirmed yet). Measured: `writer.part` reads ~1.7K cached tokens (system + teacher, shared across parts), but `writer.repair` wrote ~14K again instead of reading, **so the output schema is part of the cached prefix**. Fixed: both calls now send one schema (`WriterReply` with `written` / `repairs`, each nullable; refinements checked on our side and not sent), proven byte-identical by a test. Not yet measured on a real build.
- **2026-11-21, the gateway validates replies itself** (`messages.create` + the JSON schema from `zodOutputFormat`, then `JSON.parse` + Zod), instead of `messages.parse`. With `parse`, a reply breaking a rule (a repaired line over 220 characters) threw inside the SDK: the call's cost was not logged and the part failed as a request error. Now it is logged once and retried as a schema failure. Line limits were also loosened (line 400, note 1,200, claim 600); the writer is still asked for ≤ 220-character slide lines.
- **2026-11-21, integration tests use separate made-up words per file** (`gaps.test` pelican/harbour, `build.test` zebra/meadow): vitest runs files in parallel against one database, and a shared word let one file's search find the other's rows.
- **2026-11-21, cost fixes after the first real lecture (US$1.05, zero cache reads).** The gateway cached only blocks of 16K+ characters and gave `writer.repair` its own system text, so each part's sources (~18K tokens) were written to the cache at 1.25× and never read. Now:
  - `writer.part` and `writer.repair` share one system text (`WRITER_SYSTEM`, v2; the TASK line says WRITE or REPAIR), the same effort (`medium`; an effort change invalidates the cache) and the same TEACHER + SOURCES context blocks, so a repair reads the sources at 0.1×.
  - Breakpoints: after each context block whose prefix is ≥ 2,400 characters (Sonnet 5.5 / Haiku 5.5 cache from 512 tokens), at most 3, all 5-minute. Not yet known: whether the different output schema of writer vs repair breaks the prefix; the second lecture's `cache_read_tokens` on `writer.repair` answers it.
  - 6 sources per part instead of 8 (spec allows 5–8): about a quarter less writer input.
- **2026-11-21, false-flag fixes.** `looksLegal` no longer flags a section, Article or case named in passing ("Next: what does s. 56 say?") or a year in an Act's title; it flags "held", a legal effect ("is void"), a time limit or penalty, or a named source made to say something ("Section 65 requires…"). A question is never flagged unless it states a holding. `checker.support` v2 writes its reason before the verdict (schema order) and is told paraphrase is fine and the verdict must follow the reason. The writer prompt now asks for a lecture (plain rule, then explanation or question, then case/example; detail in speaker notes; varied layouts), not a list of quotations.
- **2026-11-21, Studio slide view.** Lines read as a slide: small footnote numbers open the source, sources listed once at the slide's foot (with "status not verified" / "not yet reviewed" in words), layouts drawn (case box, question, example, two columns). "Show checks" brings back the chips. Yellow lines keep their underline, dot and a labelled control in both views: an open point is never hidden.
- **2026-11-21, library editor review pulled forward from Day 5 (migration 0006, `/library`).** The editor sees every judgment, corrects paragraph roles, presses "Labels checked" (`sources.roles_sampled`, which C7 needs before a high-risk "held" claim may rest on it) and approves live lookups (provisional → live); each closes its review item. Column grants: the app role may update only `para_role`, `opinion`, `status` on chunks, and RLS limits that to shared rows for library editors (a test proves the text cannot be changed). Lectures built before a check keep their flags until rebuilt; an automatic re-check is Day 5 (`check.recheck`).
- **2026-11-21, the first real build finished after the credit top-up** (Try again resumed at part 6 and kept parts 1–5). 7 parts, 35 slides; 46 yellow (27 "labels not yet checked by an expert", 8 "no source for this statement", about 11 support-check "partly"), 35 grey; coverage 50% (s. 56's compensation paragraph missing; 4 planner left-out items). Total US$1.05, cache reads 0. Day 3's "done when" is met; quality and cost are the next job.
- **2026-11-20, first real build ("Frustration of contract", 50 min, one-off): stopped at part 6 of 7, Anthropic account out of credit.** Lecture `0f88c6a3…` is `failed` with 5 parts saved; Try again resumes once credit is added. What the 5 real parts showed:
  - 28 slides; 33 supported lines (31 grey "Status not verified": no case status is confirmed yet) and 35 yellow.
  - 22 of the 35 yellow are "Labels not yet checked by an expert": high-risk "held" claims on Kanoon judgments whose roles the library editor hasn't sampled (HLD 5.2 b, by design). Sampling the leading cases' roles before launch (D28 checklist) removes most of them.
  - 6 "No source for this statement" on teaching lines and 5 C9 "partly" verdicts whose reasons say "essentially supported": likely false flags. Tune `looksLegal` and the `checker.support` wording against the planted-error set (week-2 checker tuning, HLD 5.2 c).
  - Cost so far US$0.78 for 5 parts: `writer.part` 0.45, `writer.repair` 0.29 (5 calls). Over the US$0.59 per-lecture target, and **cache reads were 0**: the 16K-char cache threshold is never reached by a part's blocks. Next: lower repair effort, batch repairs per part (already one call per part), and cache the teacher+sources prefix at the model's real minimum.
  - A billing refusal now maps to `SERVICE_UNAVAILABLE` (it showed as `BUILD_FAILED`).
- **2026-11-20, Day 3: the build is one resumable job, not a BullMQ flow.** LLD §5 asks for a parent job with one child per part so a failed part retries alone. One `build.lecture` job gives the same result more simply: the plan is saved once (`lectures.plan`), each part saves in its own transaction and is added to `lectures.parts_done`, and a retry (BullMQ's 2 retries, or `POST /lectures/:id/retry`) skips both. Parts run 3 at a time inside the job. Budget and not-found errors are `UnrecoverableError`s (no retry); anything else retries, then the lecture is `failed` with a plain `error_code`.
- **2026-11-20, migration 0005 (beyond LLD §3.3).** `coverage_items` gains `item_label`, `item_text`, `reason`, a nullable `item_ref` and kind `left_out`, because one section can have several provisos (section + kind + chunk does not identify an item) and "covered" means a span lies inside the item's words. `citations` gains `tag`, `source_label` (chip text fixed at build time, so the Studio never needs a possibly expired chunk) and `part_index` (a part can be rebuilt alone). `lectures` gains `error_code` and `parts_done`.
- **2026-11-20, must-cover list.** Provisos, exceptions and Explanations of every section the lecture cites; for Articles, clauses and sub-clauses (omitted ones skipped; clause (1) counted through its sub-clauses); and **headed paragraphs inside a section** (ICA s. 56's second paragraph is the frustration rule itself). Illustrations are not listed: they teach the rule, they do not limit it, and listing them would bury the real notes. Leading cases: confirmed `concept_links` only, so none appear until the editor confirms them (D28).
- **2026-11-20, checks beyond the LLD table.** A line the writer marked teaching/question/transition that still looks legal (a section, Article, case name, year, "held", "is void", a time limit) is yellow "No source for this statement"; a `claim` line with no claims is the same, instead of a schema failure. A missing C9 or C10 verdict counts as a failure. C3 accepts a case name when a distinctive word of each party appears in the source (generic parties like "Union of India" skipped). Counts: one yellow point per line (not per claim); grey only for lines with no open claim.
- **2026-11-20, structured output and lengths.** The writer's tag is an enum (S1–S8), not a pattern: the SDK moves length and pattern constraints into descriptions, and Zod still enforces them after the reply.
- **2026-11-20, every chunk read stays in `services/search`** (`loadPieces`, `sourceDetails`, `statuteUnits`, `conceptHints`, `chunkForDrawer`), so the one-door rule holds for the build and the Studio.
- **2026-11-20, library gaps (migration 0004, not in LLD §3).** Before this, a "Not found" was shown to one teacher and forgotten: the editor never learned which Acts or cases teachers needed. Now `searchWithLookup` records every thin/not-found search (`purpose` other than eval/suggest) through `record_library_gap()` (security definer, identity from SET LOCAL): one row per college + normalised question, `asks`, distinct `teachers`, one `library_gap` review item whose priority rises with teachers (1 → 3, 2–4 → 2, 5+ → 1). Privacy: teachers can't read the list; who asked lives in `library_gap_askers` with no policy at all (editor sees counts only) and cascades on user delete. The question text itself stays, unattributed, until Day 6 decides.
- **2026-11-20, trusted-source lookup (extends F2/DATA-4 beyond Kanoon).** Each source is used only for what it is the right source of:
  - **India Code → Acts.** Only when the question names an Act the library lacks, and only on an exact name match (year must agree when known), single, not repealed (`pickAct`). Otherwise the candidates go to the editor as links. Auto-loaded Acts stay **provisional** (`finishSource({ provisional: true })`) although official, because which Act and edition was picked hasn't been checked by a person (India Code's Constitution copy was out of date, see below).
  - **Indian Kanoon → judgments.** Case gaps load a hit only if a distinctive word of each party is in its title (`caseMatches`; generic parties like "Union of India" are skipped). Kanoon does not hold some old Privy Council judgments: "Mohori Bibee v. Dharmodas Ghose" returns only later cases citing it, which are correctly refused. Topic gaps load the top 3. For an Act gap, Kanoon runs only if the Act could not be loaded.
  - **Web (Perplexity Search API) → links for the editor only.** This moves part of D26/WEB-2 (week 2) earlier, deliberately narrow: domains limited to `WEB_ALLOWLIST` (default gov.in, nic.in) in the request and re-checked in code; each link opened (2xx, still on the allowlist) before it is kept; snippets not stored; never library content, never shown to teachers, never supports a claim.
  - Queries leaving the system are the teacher's own words, or an Act/case name code took from them (LLD §17.6 rule 2). No AI step in the lookup.
  - Cost and time limits: a 24-hour cooldown per gap (the editor's re-run ignores it), 15-minute lock against double runs, 3-minute budget inline (10 minutes as a job).
- **2026-11-20, `searchWithLookup` is the search entry point for builds, Explore and Research.** Each step runs in its own short tenant transaction, so no connection is held while sources load. Search deps are built per transaction, because `usage` rows must be written inside the teacher's own transaction (RLS). Callers with no time (API requests) pass `lookup = null` and queue `ingest.lookup`.
- **2026-11-20, more Act aliases** (Transfer of Property, Negotiable Instruments, Partnership, Arbitration and Conciliation, Consumer Protection) with years in `ACT_YEARS`. They also narrow the search's Act filter when a question names one of them.
- **2026-11-20, error code `GAP_CLOSED` (409)** for re-running the lookup on a resolved or won't-fill gap.
- **2026-11-20, paragraphs broken across report pages are rejoined.** Kanoon gives old SCR judgments as one block per printed chunk, so a paragraph crossing a page arrives in two pieces (Satyabrata Ghose para "…in its practical and not literal sense. It must be borne in mind…"). A block that starts in lower case, or follows one that didn't end a sentence, joins the paragraph before it. This was the only miss in the first retrieval run (14/15 → 15/15).
- **2026-11-20, reporter headnotes often rank first** for questions their summary repeats (r-08). That is allowed for retrieval, but a headnote can never support a "held" claim (C7, Day 3), so the writer must cite the court's paragraph that the window also carries.
- **2026-11-20, Voyage account needs a payment method.** Without one Voyage allows 3 requests and 10K tokens per minute: indexing would take ~45 min and every rerank (~25K tokens) would fail. Free tokens still apply after adding a card. The client now waits 21 s on a 429 and `VOYAGE_MAX_BATCH_TOKENS` (default 60K) can be lowered.
- **2026-11-20, judgments come from Indian Kanoon for now** (decision for Day 2), stored `provisional` with `expires_at = fetch + KANOON_CACHE_DAYS`; the raw Kanoon JSON is kept in storage under the same expiry. Kanoon's own `data-structure` paragraph labels are machine guesses and are ignored. Repo fixtures hold only the court's text (`kanoonToJudgment` output), not Kanoon markup.
- **2026-11-20, judgment splitter rules learned from real judgments:**
  - Caption, appearances and the "judgment of … was delivered by …" sentence are dropped; that sentence also names the majority (Kharak Singh: 4 of 6 → majority; Subba Rao J → dissent).
  - Opinion starts: judge signature alone on a line ("R.F. NARIMAN, J."), inline after the delivered-by sentence (also with "--"), or an opener ("We have had the advantage…"). Signature lines and dates at the end are dropped.
  - Quoted blocks join the paragraph before them; with court numbering, any block that doesn't carry the next number (quoted extracts with their own "1.2") belongs to the current paragraph.
  - Roles: a court conclusion ("we hold", "we are of the view", "in our opinion", "the appeal is allowed") decides "holding" even when counsel is mentioned; "accordingly" alone is not a holding (Energy Watchdog para 22 describes a statute). "Facts" only before the paragraph that states the issue.
  - Kanoon truncates long titles ("Energy Watchdog vs Central Electricity Regulatory ..."); Haiku `extract.metadata` proposes the full name and code keeps it only if it extends the known prefix and appears in the text.
- **2026-11-20, schema changes:** `0002` lets the library role and the API write `usage`, the library role create/read GLOBAL review items, and editors of any college see GLOBAL items. `0003` lets a concept have several key sections in one Act (LLD keyed concept_links on concept+source+kind).
- **2026-11-20, search details:** statute parents with children are not embedded (search runs on children, the writer gets the parent); judgment windows are ±2 paragraphs of the same opinion; the rerank instruction is prefixed to the query; suggestions are not yet cached in Redis (fast enough on the pilot library; add the 6 h cache when the library grows).
- **2026-11-20, prompts carry no temperature**: current Haiku/Sonnet reject non-default sampling. Labelling runs at effort `low`.
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
