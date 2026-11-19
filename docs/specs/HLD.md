# NYAAI — High-Level Design (HLD)

Nov 19, 2026 · @aryan Agrawal

## 1. Overview

NYAAI is a web app with one API, one background worker and one main database (PostgreSQL + pgvector) that turns a teacher's topic into a source-checked lecture and .pptx. This HLD turns the decisions in the BRD and the two reference videos into one system picture that the LLD and the code must follow.

**Inputs.** The BRD (75 requirements, quality section), the roadmap doc, and the finalized videos *NYAAI teacher walkthrough* and *NYAAI teacher end to end*.

**Scope.** The CNLU pilot (law only, 3 to 5 teachers) on managed hosting in week 1, then production on AWS Mumbai in weeks 2 to 4. Student features and multi-college support are out of scope, but every table carries a college id from day 1. What is built in week 1 and what follows is set out in Section 14.

### Design principles

1. **Accuracy over speed.** Every claim is traced to a stored paragraph; anything unproven is removed or flagged. When the two conflict, the system is slower, never wrong.
2. **Postgres is the source of truth.** Text, labels, citations and accounts live there. Vectors, caches and files can be rebuilt or re-fetched.
3. **Slow work runs in the background.** The API answers fast; ingestion, lecture builds and checks run as queued jobs with retries.
4. **One door per concern.** All search goes through one search service; all AI calls through one LLM gateway; all files through one storage client. Each can change provider without touching the rest.
5. **Private by default.** Every teacher-owned row carries an owner id and every query filters on it.
6. **Same code everywhere.** One Docker image runs as API or worker; pilot and AWS differ only in configuration.

## 2. System architecture

The teacher's browser talks only to the API; anything slow goes through Redis to the worker; both API and worker read and write Postgres, the single source of truth.

[embedded content: NYAAI architecture · web app, API, worker, 3 stores, outside services]

*Text version of the diagram:* Browser (web app) → API (Express) → Redis queue → Worker. API and Worker both read and write PostgreSQL + pgvector; files go to object storage (R2 or S3); only the Worker calls Claude, Voyage (embeddings and reranker), Indian Kanoon, Perplexity and the official law sites.

Only the worker calls Claude and the other outside services, so all AI cost, retries and checks live in one place.

## 3. Components and responsibilities

There are 4 runtime parts we build (web app, API, worker, scheduler) and 3 stores; everything else is an outside service reached through a single module.

| Component | Built with | Responsibility |
| --- | --- | --- |
| Web app | React + Vite + Tailwind + shadcn/ui; Tiptap editor | Home, Courses, Explore, Lecture Studio, My Style, setup wizard; live progress over SSE |
| API | Node.js + Express + Zod | Sign-in, sessions, roles; CRUD for courses, lectures, examples; suggest search; starts jobs; signed file links; SSE progress |
| Worker | Node.js + BullMQ (same Docker image as API) | Ingestion, lecture build (search → plan → write → check), research runs (F6), re-checks of edits, PPT build, syllabus-to-plan, style learning |
| Scheduler | BullMQ repeatable jobs | Nightly update check, re-checks of lectures that cite changed law, cache clean-up |
| Search service (module) | pgvector + Postgres full-text + reranker | The only door to search: hybrid query, privacy filter, rank fusion, rerank |
| LLM gateway (module) | Anthropic SDK | The only door to Claude: model choice (Sonnet / Haiku), retries, token and cost logging, per-teacher budget |
| Checker (module) | Plain code + Haiku | Citation, detail, quote and law-mapping checks; claim-by-claim fact check |
| PPT builder (module) | pptx-automizer (+ pptxgenjs fallback) | Fills the teacher's template; slides, speaker notes, citations |
| Storage client (module) | AWS SDK v3 S3Client | The only door to files: R2 in the pilot, S3 Mumbai in production |
| PostgreSQL + pgvector | Neon (pilot), RDS (production) | Source of truth: users, profiles, courses, lectures, slides, citations, sources, chunks, vectors, topic map, feedback |
| Redis | Upstash (pilot), ElastiCache (production) | Job queue, progress events, short-term cache |
| Object storage | Cloudflare R2 (pilot), S3 Mumbai (production) | Original source files, teacher uploads, finished .pptx |

## 4. Key flows

Thirteen flows cover every pilot feature; the lecture flow (F3) and Research mode (F6) are the core, and the checks they share are drawn in Section 5. Every flow that produces legal content passes the same accuracy pipeline.

### F1. Sign-in and account setup

1. Web app redirects to Google; API checks the email domain is CNLU and creates or loads the user.
2. API sets a secure, HTTP-only session cookie (JWT), with role Teacher or Admin.
3. First sign-in opens the 5-step setup; each step saves to `teacher_profiles` straight away, so a teacher can stop and resume.
4. Uploaded old slides go to storage, then an ingestion job (F2) runs with `visibility = private`; a style job reads layout, colours and fonts into the profile.
5. Syllabus upload creates a course; a job turns it into `course_units` the teacher can reorder.

### F2. Building the library (ingestion)

1. A job is queued per item (official source, teacher upload, or live lookup result).
2. Worker fetches the item and saves the original file to storage.
3. Extract text (PDF, HTML, DOCX, PPTX; OCR for scans), clean it, cut by legal structure — section, Article, sub-clause or judgment paragraph, never by character count, provisos and exceptions kept with their rule (see 5.1, Layer 1).
4. Label each piece (source, section/paragraph, court, date, citation, owner, visibility, status) and compute a content hash; unchanged pieces are skipped.
5. Get a vector from Voyage law-2; upsert into `chunks`; link to the topic map.
6. Quality gate: required labels present, no duplicates, paragraph roles set for judgments. Official sources become live after automatic checks plus a sampled expert check; live lookups and scans stay provisional (usable, labelled) until the library editor reviews them (5.2 f); then `status = live`.

**Who or what starts ingestion.** Every trigger only queues a job; the worker does the work and the person sees live progress (queued → reading → cleaning → indexing → live, or "needs review").

| Trigger | When | Example | Visibility |
| --- | --- | --- | --- |
| Admin or library editor (manual) | Before launch and any time | Load the starter library from the pilot syllabi; add a single source by hand | Shared |
| System (automatic) | On events | Syllabus upload → fetch sources for every planned lecture; search or research gap → live Indian Kanoon lookup saved; fixed wrong-fact report → re-process that piece | Shared |
| Scheduler (nightly) | Every night | New judgments and amendments for topics in active courses | Shared |
| Teacher (manual) | Any time | Notes, old slides, readings uploaded in setup, Explore or Lecture Studio | Private (shared only after review, F11) |

Teachers never write to the shared library directly; only official sources and approved shares reach it.

**Supported files (pilot).**

| Type | How it is read | Notes |
| --- | --- | --- |
| PDF with text (acts, judgments, articles) | Direct text extraction | Most common, most accurate |
| Scanned PDF and images (JPG, PNG, phone photos) | OCR (for example Tesseract, English + Hindi) | Marked "from a scan"; low-confidence pages go to review |
| Word (.docx) | Text and headings | Teacher notes, articles |
| PowerPoint (.pptx) | Slide text and speaker notes; layout, colours, fonts for style | Pictures inside slides kept for style only, never used as legal sources |
| Web pages (HTML) | Main text extraction | India Code pages, official notifications |
| Indian Kanoon API results | Structured text with court, date, citation | No file needed |
| Plain text / Markdown | Read as is | Quick notes |

Not in the pilot: audio and video (later, via speech-to-text), Excel, password-protected files.

**Ingestion rules.**

- Limits: about 50 MB or 300 pages per file; unreadable or password-protected files are rejected with a clear message.
- No duplicates: a content hash per piece means the same text is stored once.
- Scanned text is never treated as official law until matched against the official source or checked by the library editor, because one wrong letter in a section number matters.
- Handwritten notes are accepted but marked low-confidence.
- Hindi documents: voyage-law-2 is tuned for English legal text; test voyage-multilingual-2 before relying on Hindi search.

### F3. Preparing a lecture

1. **Home:** topic, course (or one-off), length, level and style must all be chosen before Prepare is enabled. Two optional boxes: **Must-include example** and **Anything special?** (focus or tone, up to 500 characters).
2. **Pre-build checks (API, a few seconds):** an ambiguous topic asks the teacher to pick one meaning (HOME-9); a lecture that builds on units not yet taught shows a warning she can accept (HOME-10). These and the other Home rules are designed in 4.1.
3. API saves a draft lecture, queues a build job, and opens an SSE progress stream.
4. **Plan:** Claude (Sonnet) builds a timed outline of parts from course memory (recap, terms taught, cases used) and the "Anything special?" note. Each part lists the questions it must answer. The must-include example is placed in the part it fits and labelled "Your example".
5. **Retrieve per part:** each part runs its own search (5.1: filters → about 50 candidates → reranker → top 5–8 → parent expansion). Budget: at most 8 sources per part and about 30 unique sources per lecture (to confirm in the pilot); shared sources are reused across parts. The worker also builds the lecture's **must-cover list** (5.2 d).
6. **Write:** parts are written in parallel (bounded), each closed-book from its own sources. Every sentence carries a source tag and the exact supporting words copied from that source.
7. **Check (Section 5 and 5.2):** span match by code, detail/quote/law-mapping checks, AI support check, a stronger second check for high-risk claims, the paragraph-role rule for "held" claims, then the coverage check. Unsupported claims are removed or flagged yellow.
8. Save slides and the line-to-chunk `citations`; the outline appears in about 20 seconds and the full draft within 5 minutes.
9. **Studio and download:** the teacher edits in Lecture Studio (F7). Download runs the PPT builder. If yellow points are still open, a warning lists them first; each open point is written into that slide's speaker notes (5.2 e). The .pptx is stored and a signed link returned.
10. **Mark taught** updates course memory (summary, terms, cases).

### F4. Explore

1. The topic map comes from the curated concept list (legal concepts table, see 4.1, EXP-1): key sections, expert-confirmed leading cases, and open questions from past research runs.
2. Follow-up questions use the same closed-book write and check steps as lectures.
3. Library gaps trigger a live Indian Kanoon lookup (saved via F2) and, if needed, the Perplexity Search API; every web link is opened and checked before showing.
4. "Turn into" passes the saved sources and notes to F3.

For deep, multi-source research on a topic, Explore hands over to Research mode (F6).

### F5. Nightly update check

1. Scheduler queues checks for topics in active courses.
2. New judgments and amendments are fetched from official sources and run through F2.
3. Lectures that cite a changed section or an overruled case get a warning badge and appear in the teacher's "needs review" list.

### F6. Research mode (deep research on a topic)

Research mode turns one research question into a cited brief by first gathering and tabling the evidence, then writing only from that table.

[embedded content: F6 Research mode · plan, gather per sub-question, evidence, write, check]

*Text version of the diagram:* Question + scope chips → plan of 3–8 sub-questions (teacher can edit) → gather evidence for each sub-question (library, then Indian Kanoon, then checked web for recent changes) → evidence table → brief written only from the table → full accuracy pipeline → saved, exported or turned into a lecture.

1. **Ask.** The teacher types a research question in Explore (or clicks "Research this topic"), and picks scope chips: India only or comparative, time range, quick or thorough.
2. **Plan.** Sonnet splits the question into 3–8 sub-questions. They are shown first, and the teacher can edit or remove them before the run starts.
3. **Gather (per sub-question, in parallel with a limit).** Hybrid search of the library (shared + her own); if evidence is thin, a live Indian Kanoon lookup (saved via F2); for recent changes, the Perplexity Search API with every link opened and checked.
4. **Evidence table.** One row per source: what it says (tied to the exact paragraph), how it relates (supports / limits / conflicts), status (for laws: in force, amended, repealed; for cases: overruled, followed and so on only when a law expert has confirmed it, otherwise "Status not verified"), court and date.
5. **Write.** The brief is written closed-book from the evidence table only: short answer, key points, conflicts between authorities, open questions, and gaps marked "Not found in sources".
6. **Check.** The full accuracy pipeline (Section 5) runs on every line of the brief.
7. **Use.** The brief is saved under "My research"; it exports to Word or PDF, its sources go to the reading list, and "Turn into" creates a lecture, topic brief or tutorial problems (F3).
8. **Progress** streams live; target about 2 minutes for quick and under 8 minutes for thorough (estimates to confirm in the pilot).

### F7. Lecture Studio: editing on the go

Rule: nothing reaches the downloaded .pptx without a check status — *supported*, *your example*, or *verified by you*.

1. Every change autosaves within a few seconds as a new slide version; undo, redo and version history are always available.
2. **Typed edits** are marked "edited by you". If the new text names a case, section or quote, the code checks run at once (does it exist in the library, do the details match). Any typed legal statement, even one with no case or section named, also gets the AI support check in the background a few seconds later. Results flag, never block: anything unconfirmed turns yellow with "Not found in the library, please verify".
3. **Rewrite this part** re-runs closed-book writing for that part only, from the same sources, followed by the full check; the old version is kept.
4. **Add example** saves the teacher's text labelled "Your example" (no citation needed); any case or section it names is still checked; it can be saved to her example bank.
5. **Mark verified** removes the yellow flag and records who verified it and when.
6. **Coach suggestion → Add to lecture** inserts a slide that goes through the checks if it contains legal claims.
7. Every edit is logged as an event (before, after, type) for style learning (F10).

### F8. Connected course series

1. A course plan (`course_units`) is created from the syllabus, with order and prerequisites.
2. Building lecture N reads course memory: summaries of the last two lectures, terms taught, cases used, the running example, open threads.
3. The writer is told to open with a recap, reuse taught terms, and end with a bridge to the next lecture.
4. Series checks run as suggestions only: repeated cases, syllabus gaps, lectures that build on untaught units.
5. **Mark taught** triggers a summary job (Haiku) and updates terms, cases and threads in course memory.
6. Editing an earlier lecture gives dependent later lectures a "may need update" badge.

### F9. Adding a one-off lecture to a course

1. "Add to course" → choose the course and the position: new lecture after X, or in place of planned lecture X.
2. Fit checks are shown (order, repeated cases, missing recap); each needs the teacher's confirmation.
3. On confirm: units renumber, the lecture links to the course, an optional recap and bridge are written and checked.
4. If it was already taught, the teacher adds the date; course memory updates as in F8.

### F10. Learning the teacher's style

1. Edit events from F7 are stored per teacher.
2. After each lecture, a job groups similar edits (shortened bullets, added Supreme Court case, removed analogies).
3. After 3 similar edits it updates `teacher_profiles` and tells the teacher ("Got it — shorter bullets from now on. Undo?").
4. One-lecture style choices ask "Use this style again?"; yes saves to the profile.
5. Edits made in try-out mode are ignored.

### F11. Sharing material and library review

1. "Share with colleagues" on an upload or example sends it to the review queue.
2. The library editor checks accuracy, the source, and permission to share (her own notes yes; copied books or paid articles stay private).
3. Approve → `visibility = shared`, labelled "Faculty contributed" with her name. Reject → stays private, with the reason.

### F12. Wrong-fact reports

1. "Report wrong fact" on any line saves the line, its citation, the chunk and the teacher's note.
2. The report enters the library editor's queue, to be reviewed within 24 hours.
3. Outcome: fix the chunk, label or law mapping, or confirm it was correct. Lectures citing a fixed chunk are re-checked and badged; the reporter is told.
4. The case is added to the exam paper (gold set) before the report is closed.

### F13. Admin

1. Invite teachers (email allowlist) and remove access.
2. Assign roles: Teacher, Admin, Library editor.
3. Usage view: active teachers, lectures and research runs, AI cost, accuracy score, open reports.
4. Set per-teacher monthly AI budgets.

### 4.1 Design notes for the remaining BRD requirements

| Requirement | Design |
| --- | --- |
| HOME-2 Topic suggestions from the library only | The suggest box searches only concept names and aliases, the course's planned units and section/case titles in the library (exact-word + vector). No AI writing and no web, so it is fast and never invents a topic. |
| HOME-4 "This topic is Lecture 12" hint | The typed topic is matched against the chosen course's planned units. A match above a set score shows "This is Lecture 12 in your plan — link it?" The teacher decides; the app never links it by itself. |
| HOME-7 Must-include example | Saved in `lecture_inputs`. The planner must place it in a part; it is shown labelled "Your example". Any case or section it names is still checked; if it conflicts with the sources it is flagged, never silently changed. |
| HOME-8 "Anything special?" | Free text (up to 500 characters) passed to the planner as focus and tone instructions only. Any fact inside it is treated as a claim and checked like any other. |
| HOME-9 Ambiguous topic | Before queuing, the topic is matched to the concept list. If it fits more than one concept (for example "consideration" in contract vs. sale of goods), the teacher picks one; nothing is built until she does. Fallback for topics not in the list: if the top search results span different acts or subjects, she is asked which one she means. |
| HOME-10 Earlier lectures not yet taught | If the unit's prerequisites are not marked taught, a warning names them. She can continue, and the recap is adjusted. |
| ACC-4, ACC-6 Her template | At setup: (1) if her .pptx has proper layouts and placeholders, use it directly; (2) if not, copy her theme (colours, fonts, logo, background) onto a NYAAI base deck with standard layouts (title, bullets, two columns, case box, quote); (3) if that fails, she picks one of 3 ready CNLU templates. She previews and approves; the result is saved in `templates`. |
| ACC-5, O4 Her writing voice | A style job reads her old slides and notes: sentence and bullet length, "we" or "you", questions to the class, Hindi terms, kinds of examples. It writes a short writing guide (up to 200 words) and keeps 3 of her own slides as samples. She can edit the guide in My Style. Measured by the "sounds like me" rating (O4). |
| STUDIO-5 Coach suggestions | After a draft, Sonnet reviews it against a teaching checklist: learning outcomes, recap, a question every 10 minutes or so, a problem question, timing. Teaching moves need no source. Any suggestion that adds legal content is written from the lecture's sources and passes the full check. Stored in `coach_suggestions` with accept or reject (O7). |
| EXP-1, DATA-1 Topic map and concept list | `legal_concepts` is seeded per pilot course by the library editor: topic name, aliases, parent topic, key sections, leading cases. AI proposes links from chunks to concepts; leading-case links need expert confirmation. The topic map shows a concept with its sections, confirmed leading cases and open questions. |
| EXP-5 Reading list | `reading_list_items` (teacher, course or lecture, source, note, order), filled from Explore and Research mode; exports to Word or PDF. |
| EXP-6 Tutorial problems | The fact pattern is labelled "Hypothetical". The model answer is written from sources like a lecture, and every legal statement in it passes the full check. |
| COURSE-3 Merging or splitting units | Merge: course memory of both units is combined (terms and cases joined, summaries kept in order). Split: the teacher assigns each taught lecture to one of the new units. Lectures keep their links, and "may need update" badges are recalculated. |
| Budget runs out mid-build | The running build finishes, and its checks are never skipped. New builds are blocked with a clear message; the admin can raise the budget. Alerts go out at 80%. |

## 5. Accuracy pipeline

Inside the lecture flow, every written line passes rule-based code checks and then an independent AI fact check; nothing unproven reaches the teacher without a yellow flag.

[embedded content: Accuracy pipeline inside F3 · 2 checks, 1 decision, teacher review]

*Text version of the diagram:* Sources for each part → closed-book writing with tags and spans → code checks (tag, span, details, quotes, mapping, source type, paragraph role) → AI support check → second check for high-risk claims → coverage check → each line is supported, removed, or flagged yellow → teacher review. The table below and 5.2 are the full list; where the diagram and the table differ, the table wins.

Weak search results stop early with "Not found" instead of being padded by the writer. The full list of safety layers and how they are measured is in BRD Section 13.

| Check | Where it runs | What it catches |
| --- | --- | --- |
| Metadata filters + retrieval threshold | Search service (5.1) | Out-of-date or wrong-court law; too little evidence → "Not found" |
| Closed-book prompt + tags + spans | LLM gateway (Sonnet) | Writing from memory; untagged lines; claims without copied supporting words |
| Tag exists | Checker (code) | Citations to paragraphs that were not supplied |
| Span match | Checker (code) | Supporting words that do not appear word for word in the cited paragraph (5.2 c) |
| Details match | Checker (code) | Wrong case name, year, court or section |
| Exact quotes | Checker (code) | Any changed word inside quotation marks |
| Law mapping | Checker (code) | IPC/BNS, CrPC/BNSS, Evidence Act/BSA mix-ups; "equivalent" said of a changed or unmatched provision (5.2 g) |
| Source type | Checker (code) | News or web items used to support a statement of law (5.2 f) |
| Paragraph role | Checker (code) | "The Court held" backed by arguments, a dissent, a lower-court summary or unchecked labels (5.2 b) |
| Claim support | Checker (Haiku) | Claims the span does not support ("partly" = not) |
| High-risk second check | Checker (Sonnet, separate prompt) | Holdings, commencement dates, punishments, time limits, old/new law links that the first check missed (5.2 c) |
| Coverage | Checker (code) | Exceptions, provisos and leading cases silently left out (5.2 d) |
| Case status | Library + Library editor | Overruled or doubted cases; unconfirmed cases shown grey "Status not verified" (5.2 a) |
| Freshness | Scheduler (F5) | Amended sections, newly overruled cases |
| Teacher review | Lecture Studio | Final human judgement; wrong-fact reports |

### 5.1 Legal retrieval essentials (three required layers)

Standard RAG fails on law because one word — "not", "unless", "provided that" — changes a rule. NYAAI makes three retrieval layers mandatory; the LLD and the tests must prove each one.

#### Layer 1 — Structure-aware chunking (never fixed character counts)

| Document | One chunk is | Always kept together |
| --- | --- | --- |
| Acts and rules | One section | Its sub-sections, clauses, provisos, explanations, illustrations and exceptions |
| Long sections (over about 1,500 tokens) | One sub-section | Each piece repeats a header "Act › Chapter › Section title" and links to its sibling pieces |
| Constitution | One Article | Its clauses, provisos and explanations |
| Judgments | One numbered paragraph (the court's own numbering) | Headnotes stored separately and labelled "summary, not the court's words" |
| Teacher notes and slides | One heading block or one slide | — |

- A proviso or exception is never stored on its own, so a rule is never separated from its exceptions.
- **Parent expansion:** search finds the best piece, then the whole section (its parent) is sent to Claude, so exceptions travel with the rule.
- Amendments create a new version with `valid_from` / `valid_to`; the old text is kept.
- Unit tests check the chunker on sections with provisos and exceptions (for example s. 25 of the Contract Act and its exceptions).

#### Layer 2 — Metadata extracted at ingestion, used as filters before vector search

| Field | Examples | Used for |
| --- | --- | --- |
| `jurisdiction` | India (central), Bihar, UK (comparative) | India by default; comparative only when chosen |
| `source_type` | act, rule, constitution, judgment, notification, teacher note | Mix of sources |
| `act_name`, `act_year`, `chapter`, `section` | Indian Contract Act, 1872 · s. 56 | Exact matches, law mapping |
| `court`, `court_level`, `bench_size` | Supreme Court, High Court; 5-judge bench | Filtering and authority weight |
| `judgment_date`, `year` | Date of judgment | Time filters |
| `status` | in force, amended, repealed, overruled, good law | Repealed and overruled excluded unless the question is historical |
| `valid_from`, `valid_to` | BNS in force from 1 July 2024 | "Law as on a date" |
| `citations` | Reporter citations | Display and exact match |
| `language`, `owner_id`, `visibility` | en / hi; teacher id; shared / private | Language and privacy |

- **How filters are chosen:** from the question and the Home or Explore chips (course jurisdiction, "as on" date = today unless the question is historical). They are shown as editable chips in Explore and Research mode.
- **Example:** a question about BNS filters to criminal law in force from 1 July 2024; a question about IPC gets the pre-2024 law, labelled as old law.
- **How it runs in Postgres:** filters sit in the same SQL `WHERE` as the vector `ORDER BY`, with B-tree indexes on the filter columns. pgvector 0.8+ iterative index scans (`hnsw.iterative_scan`) keep scanning until enough rows pass strict filters, so filtering never silently drops good results. For very small filtered sets (one act), exact search without the vector index.

#### Layer 3 — Two-stage retrieval with a reranker

1. **Stage 1, wide net:** vector top 50 + exact-word top 50, both already filtered (Layer 2), merged by rank fusion into about 50 candidates.
2. **Stage 2, precise pick:** a reranker reads the question with each candidate and scores it. Default: **Voyage rerank-2.5** (same vendor as our embeddings; 32K-token context, so a whole section fits; listed at about US$0.05 per million tokens). Fallback: Cohere's reranker. Later self-hosted option: bge-reranker-v2-m3.
3. Keep the **top 5–8** above a minimum score, apply parent expansion (Layer 1), and send them to Claude as S1–S8.
4. If fewer than 3 candidates pass the score: live lookup (F2), otherwise "Not found".

**Measured by:** a retrieval test on the gold set — "the correct paragraph is in the final top 8" (target 95% or more, to confirm in the pilot), with and without the reranker, plus filter tests (no repealed or overruled text returned for a present-day question).

### 5.2 Further accuracy safeguards

These rules close the gaps where a wrong statement could otherwise reach a class without a yellow mark.

#### a) Case status ("good law" or "overruled")

- **Default:** every case starts as **"Status not verified"**, shown as a grey flag. The system never shows "good law" by itself.
- **Suggestion job:** for each case, find later judgments that cite it (Indian Kanoon citing list plus citations already in the library). AI reads the citing paragraphs and suggests a treatment: overruled, reversed, doubted, distinguished, followed. The citing paragraph is kept as evidence.
- **Expert confirms:** the library editor (a law expert) confirms or rejects each suggestion. Only confirmed statuses are used as filters (5.1, Layer 2) or shown as "good law" or "overruled". Each confirmation records who, when and the evidence paragraph (`case_treatments`).
- **Order of work:** leading cases of pilot course topics first. The nightly check (F5) adds new citing judgments to the queue.
- **In lectures:** a case with unverified status can still be used. Its speaker notes say "Status not verified", and Research mode shows the same flag in the evidence table.

* **Before launch (decided):** the library editor confirms the status of every leading case for the pilot topics (a launch-checklist item), so week-1 lectures don't rest on grey cases. The suggestion job takes over from week 2.
* **Counting:** grey "Status not verified" flags are counted and shown separately from yellow "please verify" points. They do not count toward the 5-yellow-point target.

#### b) Judgment paragraph roles

- Each judgment chunk carries `opinion_type` (majority, concurring, dissent), the authoring `judge`, and `para_role` (facts, counsel's arguments, lower-court summary, discussion, holding). The values are set at ingestion by AI plus rules ("dissenting" headings, counsel names), and the library editor checks a sample. If unsure, the role is `unknown`.
- **Checker rule:** a claim that "the Court held / ruled / laid down" must be supported by a majority-opinion paragraph with role holding or discussion. Support from arguments, a dissent, a lower-court summary or an unknown role is flagged. A dissent can only be cited as a dissent.
- **Parent expansion for judgments:** the matched paragraph plus two paragraphs before and after it, from the same opinion, so "In view of the above…" keeps its reasoning.
- **Judgments without the court's paragraph numbers** (older or scanned): split at headings and blank lines into blocks labelled "paragraph numbers added by NYAAI"; citations show the page number instead.

* **Opinion boundaries by rules first:** judge-name headings, the usual opening lines of a separate opinion ("I have had the advantage of reading…", "I respectfully disagree…") and the court's own "per" lines. AI labels only what the rules leave unclear.
* **Benches with several opinions and no clear majority** are labelled "separate opinions — no single majority". A "held" claim resting on such a judgment is flagged unless the library editor has recorded what the court held.
* **Unreviewed labels never carry high-risk claims alone:** a high-risk "held" claim from a judgment whose roles have not been sampled by the library editor (including every live lookup) is flagged, not passed.

#### c) Span check and a stronger second check

1. For each claim, the writer returns the source tag and the exact supporting span (words copied from the source).
2. **Code** confirms the span appears word for word in the cited chunk, ignoring spaces and quote styles. If it doesn't, the line turns yellow.
3. **AI check (Haiku)** judges only one thing: does this span support this claim? Answers are yes, partly or no; "partly" counts as no.
4. **High-risk claims** get a second, independent check by a stronger model (Sonnet, separate prompt, no access to the writer's reasoning). High-risk means holdings, dates of coming into force, punishments and penalties, time limits and numbers, and old/new law equivalents. Both checks must say yes.
5. **Targets:** catch 100% of planted errors; no more than 10% of correct claims flagged; no more than 5 yellow points in a typical 50-minute lecture. Too many flags would break the 15-minute goal (O1), so false flags are tracked weekly.

- **Model for the second check (decided):** Sonnet with a separate prompt in week 1. In week 2 the team measures how often it disagrees with the first check on the planted-error set and what share of real claims count as high-risk. If the second check misses planted errors, or high-risk claims are most of a lecture, switch the second check to a different model and update the cost estimate.
- **Same checks for every way text enters a slide:** "Rewrite this part", Add example and coach slides get the full pipeline, including the second check. Typed edits get the code checks at once and the AI support check in the background; a typed high-risk claim also gets the second check.

#### d) Coverage check (errors of omission)

- After writing, code builds a **must-cover list**: every proviso, exception and explanation of each section the lecture states, plus the leading cases `legal_concepts` links to the topic.
- Each item must either appear on a slide or be deliberately left out (outside the plan's scope, or the teacher ticks "leave out").
- Missing items show as yellow notes, for example "Missing: exception to s. 56", with a one-click **Add** that goes through the full check.
- Each lecture gets a coverage score, the same measure as the research exam's evidence coverage.

* **No silent exclusions:** the AI planner cannot mark an item as left out. Anything the plan leaves out appears in a visible "Left out of this lecture" list, and only the teacher's tick clears it.
* **Long provisions:** missing items are grouped per section into one note (for example "Article 19: 3 of 6 clauses not covered"). Coverage notes are a separate list and do not count toward the 5-yellow-point target.
* **After "Remove unverified lines":** the coverage check runs again, and anything the removed lines were covering comes back as a "Missing" note before the file is built.

#### e) Download with open yellow points (decided)

- Download is allowed. A warning first lists every open point, with two choices: **Download with flags** or **Remove unverified lines and download**.
- With flags, each open point is written into that slide's speaker notes: "PLEASE VERIFY — not confirmed by NYAAI: \[claim\] (\[reason\])". The file carries the flag.
- Each download records the number of open points, for the weekly accuracy review.

* **Every export, not just the .pptx:** research briefs, topic briefs, tutorial problems and reading lists exported to Word or PDF use the same rule. The same warning appears first; open points and "Status not verified" cases are written into the file as footnotes or a closing "Please verify" list.

#### f) Web and news never become law

- Every web item is stored with `source_type = news` or `web`. The checker refuses these as support for any legal claim (rule, holding, date of coming into force). They can support only lines worded "It was reported that…" and labelled **News**.
- **"Link checked"** means all four: the domain is on an allowlist (gov.in, nic.in, court websites, named law-news sites), or the item is marked "other source"; the page was fetched now; the claimed fact was found in the fetched text (span match); and the fetch date is saved.
- **Live Indian Kanoon results** enter the library as `provisional`. They can be used straight away, because the text is the court's own, but they are labelled "Live lookup — not yet reviewed" and still pass every code and AI check. Automatic gates (court, date and citation parsed; no duplicate) run before use. They become `live` after the library editor's review.

#### g) Old and new criminal law mapping

- `law_mappings` is **many-to-many**: old provision(s) ↔ new provision(s). Each row has a relation type (same, renumbered, merged, split, substantively changed, no direct equivalent), a note and its source (the official comparison tables).
- **Owner:** a named criminal-law expert signs off every row before use (`reviewed_by`, `reviewed_at`). Unreviewed rows make the line "please verify".
- Rows marked "substantively changed" or "no direct equivalent" must be stated that way on the slide. The checker flags any "equivalent" wording for them.

## 6. Data design overview

One PostgreSQL database holds every record and the search vectors; Redis and object storage hold only what can be rebuilt or re-fetched. Exact columns and indexes belong to the LLD.

### Main entities (PostgreSQL)

| Group | Tables | Notes |
| --- | --- | --- |
| Tenancy | `colleges` | `college_id` on every owned table from day 1 (CNLU only for now), so multi-college later needs no migration |
| People | `users`, `teacher_profiles`, `consents`, `invite_allowlist` | Role, subjects, style answers, writing guide, switches; consent version and date; invited emails |
| Courses | `courses`, `course_units`, `lectures`, `lecture_inputs`, `slides`, `slide_versions` | Plan order, prerequisites, status (draft / ready / taught), course memory, must-include example and "Anything special?", edit history |
| Evidence | `citations`, `coverage_items` | Every slide line → supporting chunk, exact span, check results, risk level, status (supported / your example / verified by you / open); must-cover items and whether each is covered or left out |
| Research | `research_runs`, `research_questions`, `evidence_items`, `reading_list_items` | Sub-questions, evidence table rows, the brief, reading lists |
| Library | `sources`, `chunks`, `legal_concepts`, `concept_links`, `law_mappings`, `case_treatments` | Chunks carry text, paragraph number (court's or added), opinion type, paragraph role, judge, metadata (5.1), owner, visibility, status (provisional / live), `tsv`, `embedding vector(1024)`, model version, content hash. Law mappings are many-to-many with relation type and reviewer. Case treatments hold suggested and confirmed status with evidence. |
| Teacher material | `uploads`, `examples`, `share_requests`, `templates` | Always owner-scoped; sharing goes through review; approved slide templates |
| Learning | `edit_events`, `style_changes`, `coach_suggestions` | Edits for style learning; every automatic style change with undo; coach suggestions with accept or reject |
| Quality | `feedback`, `reports`, `eval_runs`, `review_queue` | Ratings, wrong-fact reports, exam results; one queue for the library editor (reports, shares, case status, provisional sources, mapping rows) |
| Operations | `jobs_log`, `usage`, `notifications`, `product_events`, `deletion_log` | Job history; AI tokens and cost per teacher; "needs review" and "reporter is told" messages; product metrics (Section 11); every deletion |

### Indexes that matter at this level

- HNSW index on `chunks.embedding` (cosine) for meaning search.
- GIN index on `chunks.tsv` for exact-word search.
- B-tree on `(visibility, owner_id, status)` so the privacy filter is cheap.

* B-tree indexes on the filter columns (jurisdiction, court, act and section, judgment date, status, valid\_from / valid\_to) and on `college_id`.
* **Postgres row-level security** on every teacher-owned table (chunks, lectures, course memory, research runs, examples, uploads) as a backstop to the query filter: a missed `WHERE` returns nothing instead of another teacher's data.

### Retention

| Data | Kept |
| --- | --- |
| Official law (India Code, Gazette) and judgments from official court websites (Supreme Court, High Courts) — the main source for leading cases | Permanent; amended text kept with dates |
| Text fetched from Indian Kanoon | Used only for gaps the official sites don't cover. Kept as long as Indian Kanoon's terms allow; those terms must be answered before Day 1 because they shape the schema. Until then: 30 days, then fetched again when needed. Metadata and citation links are always kept |
| Lectures, slides, research briefs | Until the teacher deletes them (BRD DATA-7 updated to match) |
| Teacher uploads and examples | Until the teacher deletes them or the account is removed |
| Edit events | 12 months, then summarised into the style profile |
| AI traces (Langfuse) | 30 days, with private upload text redacted |
| Search cache (Redis) | Hours; rebuilt on a miss |
| Job progress (Redis) | Until the job ends + 1 day |
| Backups | Production: daily, kept 7 days, so deleted data leaves backups within 7 days. Pilot: the provider's point-in-time restore. Recovery target for both: lose at most 24 hours, restore within 4 hours. |

**Supporting words travel with the work.** Each citation stores the claim's exact supporting span (usually one or two sentences) with the lecture or research brief, permanently. So click-to-source, saved briefs, re-checks after a wrong-fact report and span checks on older lectures keep working even if a cached judgment has expired.

## 7. External services and failure handling

Every outside call goes through one module with a timeout, retries with backoff and a clear fallback; no outside failure may produce an unchecked claim.

| Service | Used for | If it is slow or down |
| --- | --- | --- |
| Anthropic Claude (Sonnet, Haiku) | Planning, writing, coach (Sonnet); fact checks, summaries (Haiku) | Retry 3× with backoff; job pauses and resumes; teacher sees "Writing is delayed, we'll continue automatically". Never skip the fact check. |
| Voyage AI (voyage-law-2) | Vectors for chunks and queries | Queue ingestion for later; query falls back to exact-word search only, with a note |
| Voyage rerank-2.5 (Cohere as fallback) | Ordering search results | Use rank-fusion order without rerank (slightly lower quality, still checked) |
| Indian Kanoon API | Live judgment lookups | Use the stored library; show "Live lookup unavailable" |
| Perplexity Search API | "What's new" and web gaps | Skip the web step; show the last checked date |
| India Code, e-Gazette | Bare acts and amendments (nightly) | Retry next night; alert after 3 failed nights |
| Google sign-in | Login | Existing sessions continue; new logins show a clear error |
| Object storage | Files | Retry uploads; downloads show "try again"; nothing lost (Postgres keeps records) |

**Rules for every outside call:** a timeout (for example 30 s for Claude, 10 s for search services), at most 3 retries with growing waits, a circuit breaker after repeated failures, and a log line with service, time taken and cost.

## 8. Security and privacy

A teacher can only ever see shared library content and her own material; this is enforced in the database query, not just the screen.

| Area | Design |
| --- | --- |
| Sign-in | Google OAuth limited to the CNLU email domain; HTTP-only, secure, same-site session cookie; short-lived token with refresh |
| Roles | Teacher, Admin, Library editor (reviews shared contributions and error reports); checked on every API route |
| Privacy filter | Every search and read of teacher material includes `visibility = 'shared' OR owner_id = :me`; tested with two-account tests (Section 12) |
| Files | Private buckets only; downloads through short-lived signed links (minutes, not days) |
| Secrets | Environment variables in the pilot; AWS Secrets Manager in production; never in code or logs |
| Input safety | Zod validation on every request; upload type and size limits; uploaded text never executed |
| AI safety | Sources are passed as quoted data, not instructions; the checker ignores any "instructions" inside uploaded documents |
| Limits | Rate limits per teacher; monthly AI budget per teacher; alerts on unusual spend |
| Data location | Production: database, files and cache in AWS Mumbai. Pilot: runs under a written CNLU data-residency exception signed before any real teacher data is loaded, using India or the nearest Asia region wherever a provider offers one. AI providers (Anthropic, Voyage, Perplexity, Cohere fallback) process content outside India in both phases, so CNLU sign-off covers them too. |
| Personal data (DPDP Act, 2023) | Consent screen at sign-up lists every processor and what it receives (hosting, database, storage, AI writing and checking, embeddings, reranking, web search, monitoring). "Delete my data" removes the profile, uploads, files, chunks and vectors, lectures, research runs, edit events, AI traces and her approved shares (or anonymises them, as agreed at share time). Every deletion goes in deletion\_log; backups clear within 7 days. |
| Transport | HTTPS everywhere; database and Redis on private networks in production |

**More privacy rules:**

- **Cache:** only results built purely from shared sources are cached across teachers. Any cache key that touches private material includes the teacher's id.
- **AI traces:** Langfuse is self-hosted in production. Private upload text is redacted from stored prompts in every environment, and traces are covered by "delete my data".
- **Privacy filter everywhere:** the owner-or-shared rule applies to lectures, course memory, research runs, examples and templates, not just chunks, and row-level security backs it up (Section 6).
- **Tenancy:** every query also filters on `college_id`.

* **Row-level security with pooled connections:** Neon's pooler and any RDS pooler reuse connections, so the teacher id and college id are set inside each transaction (`SET LOCAL`), never per connection; a request without them sees nothing. Worker jobs set the id of the teacher they act for. Admin and library-editor access use their own policies. Shared library rows carry a global college id that every college can read.
* **Outside AI providers:** written no-training and limited-retention terms from Anthropic, Voyage, Perplexity and Cohere are attached to the CNLU exception.

## 9. Deployment and environments

The pilot runs on managed services in week 1; production moves to AWS Mumbai in weeks 2 to 4 with the same Docker image and new configuration. No release reaches production without passing the accuracy exam and end-to-end tests.

[embedded content: Deployment · pilot vs AWS production, CI/CD with the exam gate]

*Text version of the diagram:* Pilot = Vercel (web app) + Render (API and worker) + Neon (Postgres) + Upstash (Redis) + R2 (files). Production = AWS Mumbai: CloudFront and WAF → load balancer → ECS Fargate (API and worker) → RDS Postgres, ElastiCache Redis, S3; Secrets Manager for keys. GitHub Actions: tests → staging → exam + E2E → manual approval → production.

### Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | Development | Docker Compose: Postgres (pgvector), Redis, MinIO for files; test fixtures |
| Staging | Every merge to main; full tests and the exam | Copy of the library; test teacher accounts only |
| Production | Pilot teachers | Real data; daily backups |

### Production details (AWS Mumbai, ap-south-1)

- VPC with public subnets for the load balancer and private subnets for ECS, RDS and ElastiCache.
- Application Load Balancer with HTTPS (ACM certificate); AWS WAF in front.
- ECS Fargate: API service (2 tasks) and worker service (1–3 tasks), same image, different start command.
- RDS PostgreSQL with pgvector, daily backups kept 7 days; Secrets Manager for all keys.
- Infrastructure as code (Terraform or AWS CDK) so staging and production match.
- CI/CD on GitHub Actions: build → tests → push image to ECR → deploy to staging → exam + E2E → manual approve → production.

## 10. Performance and scaling

The pilot is small, so the design aims for steady speed and easy growth rather than heavy scaling on day 1.

| Target | Value | How |
| --- | --- | --- |
| Home page load | Under 2 s | Small API responses; profile and course list cached in Redis |
| Topic suggestions | Under 0.5 s after typing stops | Debounce; indexed exact-word + vector search; popular shared-only queries cached (never private results) |
| Lecture outline | About 20 s | Plan step runs first and streams over SSE |
| Full lecture draft | Under 5 min | Parts written in parallel (bounded), checks in batches |
| .pptx download | Under 10 s | Template filled in the worker; file served by signed link |
| Concurrent teachers | 50 building at once (before Phase 3) | Workers scale out; queue absorbs bursts |

### What grows first, and the lever for each

- **Worker load** (AI calls): add worker tasks; queue concurrency per worker; per-teacher limits.
- **Database reads:** connection pooling; read replica in Phase 3 if needed.
- **Vector search:** HNSW on pgvector handles the pilot and likely all of CNLU; move vectors to Qdrant only if search slows at many millions of chunks (migration plan agreed separately).
- **AI cost:** Haiku for small jobs, caching, per-teacher budget.

## 11. Monitoring and alerts

We watch four things: is it up, is it fast, is it accurate, and what does it cost. Accuracy has its own dashboard because it is the product's promise.

| What | Tool | Alert when |
| --- | --- | --- |
| Errors (API, worker, web app) | Sentry | New error type, or error rate above 2% for 10 min |
| Logs | Structured JSON logs → CloudWatch (production) | — |
| AI calls: tokens, cost, time, prompts | Langfuse | Cost per lecture above US$1; one teacher above the monthly budget |
| Queue health | BullMQ metrics | Waiting jobs above 50, or a job failed 3 times |
| Accuracy | Automatic score per lecture + weekly human check | Any unsupported claim shown without a flag; any teacher wrong-fact report (reviewed within 24 h) |
| Release gate | Exam paper (eval\_runs) | Any fake or wrong citation → release blocked |
| Infrastructure | CloudWatch | Database CPU above 80%, low disk, Redis memory high |
| Spend | AWS Budgets + provider dashboards | Monthly spend above plan |

Every request and job carries one **trace id** from the web app through API, worker and AI calls, so one teacher's problem can be followed end to end.

### Product metrics (BRD objectives)

Each metric is an event in `product_events`, shown on a weekly dashboard so the week-8 go/no-go decision is made from data.

| Objective | Event(s) | Measure |
| --- | --- | --- |
| O1 Time to a ready lecture | `prepare_clicked`, `download_done` | Median minutes from Prepare to download (goal: 15 minutes of teacher time) |
| O4 Sounds like me | 1–5 rating after download | Average rating per teacher per week |
| O5 Setup alone | `setup_started`, `setup_finished`, help requests | Share of teachers who finish setup without help |
| O6 Real use | `download_done` | Lectures per teacher per week |
| O7 Coach useful | `coach_shown`, `coach_accepted` | Acceptance rate |
| Accuracy load | Yellow points per lecture, false-flag marks, open points at download | Weekly trend (targets in 5.2 c) |

## 12. Testing strategy

Testing follows a pyramid: many fast unit tests, fewer integration tests, a small set of end-to-end tests — plus an AI accuracy exam that no other app needs but NYAAI's promise depends on. Nothing reaches production unless every gate in this section passes.

### Types of tests

| Type | What it checks | Tools | NYAAI examples |
| --- | --- | --- | --- |
| Unit (backend) | One function or module on its own | Vitest | Chunker cuts at sections/paragraphs; citation checker rejects a tag not in S1–S8; quote matcher flags one changed word; IPC→BNS mapping; rank fusion order |
| Unit (frontend) | One component on its own | Vitest + React Testing Library | Prepare button stays disabled until course, length, level, style are chosen; yellow "please verify" chip renders; source chip opens the right paragraph |
| Integration (backend) | API + real Postgres (pgvector) + Redis together | Vitest + Supertest + Testcontainers | Hybrid search returns shared + own chunks only; job queued and progress events sent; upload → chunks with `visibility = private` |
| Contract (API) | Every response matches the agreed API contract | OpenAPI spec + response validation in tests | Frontend and backend can't silently drift apart |
| Outside-service mocks | Behaviour when Claude, Voyage, Kanoon or storage fail | MSW / nock, fault injection | Claude down → job pauses, no unchecked text ever saved; Voyage down → exact-word search with a note |
| Output (PPT) | The .pptx is correct | Open the file (JSZip) and assert | Uses teacher template; slide count; every cited line has notes with full citation |
| End-to-end (E2E) | Real browser, whole journeys | Playwright | The two reference videos as scripts: setup (J3) and topic → download → next lecture (J1) |
| AI accuracy exam | Facts and citations are right | Custom eval runner on `eval_runs` | Gold set (30 → 200 questions): 0 fake or wrong citations; red-team set (fake cases, repealed sections): must answer "Not found" |
| Checker quality | The fact-checker itself catches errors | Labelled claim/paragraph pairs | Catches 100% of planted wrong claims (release gate); flags no more than 10% of correct claims (target, tuned in the pilot); high-risk claim set tested separately |
| Privacy | No data leaks between teachers | Two-account tests (integration + E2E) | Teacher B never sees Teacher A's uploads, examples or lectures in search, Explore or files |
| Load | Speed under pressure | k6 | 50 teachers building at once; suggestions stay under 0.5 s |
| Security | Common attacks and weak packages | Dependabot / npm audit, OWASP ZAP baseline | Signed links expire; role checks on every route; no secrets in logs |
| Accessibility | Usable by everyone | axe-core in Playwright | Keyboard use, labels, contrast on Home and Studio |
| Manual (with teachers) | Real-world use | Guided sessions | Day 7 pilot: teachers repeat the end-to-end video on their own topics |

**Tests added for flows F6–F13:**

- **Research mode:** a research exam (10 topics at launch, growing) scored on evidence coverage, correct handling of conflicting judgments, and 0 fake citations; red-team topics with no authority must end in "Not found".
- **Edit re-check:** a typed edit naming a non-existent case turns yellow; "Rewrite this part" output always passes the full check; no unchecked line ever reaches the .pptx.
- **Course series:** recap appears in lecture N+1; a repeated case is flagged; adding a one-off renumbers units correctly.
- **Style learning:** 3 similar edits change the profile once; Undo restores it; try-out edits are ignored.
- **Sharing and reports:** a private upload never appears for another teacher until approved; a fixed chunk triggers re-check of lectures that cite it.

**Tests for the legal retrieval layers (5.1):**

- **Chunker (unit):** sections with provisos, explanations and exceptions come out as one chunk; long sections split only at sub-section boundaries and carry the Act › Chapter › Section header; judgment chunks match the court's paragraph numbers.
- **Metadata extraction (unit + golden files):** court, date, act, section and status are read correctly from 50 sample documents.
- **Filters (integration, Testcontainers Postgres):** a present-day question never returns repealed or overruled text; "as on" dates return the right version; strict filters still return enough rows (iterative scan on).
- **Reranker (integration, mocked + live nightly):** the correct paragraph is in the final top 8 on the gold set; thin evidence below the score threshold leads to live lookup or "Not found", never a guess.

**Tests for the further safeguards (5.2):**

- **Paragraph roles:** "the Court held" backed by a dissent, counsel's argument or a lower-court summary is flagged; backed by a majority holding paragraph, it passes.
- **Span check:** a span not found word for word in the cited chunk turns yellow; a high-risk claim passes only when both checks agree.
- **Coverage:** a lecture stating s. 56 without its second paragraph gets a "Missing" note; a ticked "leave out" clears it.
- **Case status:** a case with no confirmed treatment shows "Status not verified", never "good law".
- **News:** a legal claim supported only by a news item is flagged.
- **Law mapping:** a "no direct equivalent" row described as equivalent is flagged; unreviewed rows give "please verify".
- **Download:** open yellow points appear in the speaker notes of the .pptx (checked with JSZip); "Remove unverified lines" leaves none.
- **Privacy:** a cached result never contains another teacher's private chunk; row-level security blocks a query with a missing owner filter; "delete my data" leaves no rows, files, vectors or traces.

### When each test runs (CI gates)

| Stage | Runs | Must pass to continue |
| --- | --- | --- |
| Every pull request | Lint, type check, unit (backend + frontend), integration, contract, PPT output, privacy tests, 10-question smoke eval | All green |
| Merge to main → staging | Full E2E (Playwright), accessibility, full gold set + red-team | 0 fake or wrong citations; all E2E green |
| Before a production release | Load test (k6), security scan (ZAP baseline), manual teacher check | Targets in Section 10 met; no high-risk findings |
| Nightly | Smoke eval with recorded answers, dependency scan (full live eval weekly and before each release, about US$10 a run) | Failures alert the team; next release blocked |

### Test data and rules

- **Fixed mini law library** for tests: s. 32 and s. 56 of the Contract Act, *Satyabrata Ghose*, *Taylor v. Caldwell*, *Alopi Parshad*, plus one repealed section and one amended section with dates.
- **Two test teachers** (A and B) with private uploads, for every privacy test.
- **Recorded AI answers** (record and replay) for unit and integration tests, so they are fast, free and repeatable; live AI calls only in the eval runs.
- **Coverage:** about 80% of backend lines overall; every rule in the privacy filter, citation checker, quote matcher and law mapping has its own test.
- **Every bug becomes a test.** Each wrong-fact report from a teacher is added to the gold set before it is closed.

## 13. Key decisions and next steps

These decisions are fixed for the pilot; changing one needs a note here with the reason.

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Node.js + Express only (no Python service) | One language, one image, team already fluent; fits 1 week |
| D2 | Claude Sonnet writes, Haiku checks; Sonnet re-checks high-risk claims with a separate prompt | Strong long-form writing; cheap, fast checking; a stronger check where errors cost most |
| D3 | PostgreSQL + pgvector as the single main database | Privacy filter, joins and vectors in one query; one system to run |
| D4 | Redis only for queue, progress and cache | Safe to wipe; never the source of truth |
| D5 | Object storage via S3 API: R2 in the pilot, S3 Mumbai in production | Free pilot; switch by config, not code |
| D6 | Voyage law-2 embeddings (1024 dims) | Built for legal text; first 50M tokens free |
| D7 | Closed-book writing + code checks + AI fact check + teacher review | Zero-hallucination promise (BRD Section 13) |
| D8 | App never selects the course; Prepare needs course, length, level, style | Teacher stays in control (Home rules, 18 Nov) |
| D9 | Perplexity Search API for web updates, every link verified | Raw results we check ourselves |
| D10 | Managed hosting only in the MVP; AWS Mumbai for production | Speed now, data in India later |
| D11 | Vectors may move to Qdrant later via the search service | Growth path without app changes |
| D12 | Research mode output = cited brief + evidence table, exportable to Word/PDF | Detailed research is the USP; teachers see who says what |
| D13 | Every edit, rewrite or added slide is re-checked; nothing unchecked reaches any export without a flag | Editing must not become a back door for errors |
| D14 | Structure-aware chunking by section, Article, sub-clause or judgment paragraph, with parent expansion | A rule is never separated from its exceptions |
| D15 | Metadata filters (jurisdiction, court, date, act, status, validity) applied before vector search, with pgvector iterative scans | Outdated or irrelevant law never pollutes answers |
| D16 | Two-stage retrieval: \~50 candidates → Voyage rerank-2.5 → top 5–8 | Precise passages reduce hallucination on complex questions |
| D17 | Case status: AI suggests from citing judgments, a law expert confirms; default "Status not verified" | The system never guesses "good law" (review, 19 Nov) |
| D18 | Judgment chunks carry opinion type, paragraph role and judge; opinion boundaries found by rules first; "held" needs a majority holding or discussion paragraph | Arguments and dissents are never presented as the law |
| D19 | Retrieval per lecture part with a source budget; the writer returns exact spans that code verifies | A full lecture gets enough sources, and every claim is pinned to real words |
| D20 | Coverage check for provisos, exceptions and leading cases; only the teacher can clear a left-out item | A slide can't be "all supported" and still misleading |
| D21 | Downloads and exports allowed with open points: warning first, then markers in the file | Teachers keep control; the file always carries the flag (review, 19 Nov) |
| D22 | Pilot runs under a written CNLU data-residency exception; every processor listed on the consent screen; production storage in AWS Mumbai | Fast pilot without breaking CNLU's rules (review, 19 Nov) |
| D23 | News and web items never support a legal claim; law mappings are many-to-many and expert-signed | Two easy ways for errors to slip in are closed |
| D24 | `college_id` on every table, plus Postgres row-level security set per transaction | Cheap now, painful later; a second lock on privacy that survives connection pooling |
| D25 | Leading judgments from official court websites, kept permanently; supporting spans stored with each lecture; Indian Kanoon only for gaps; lectures kept until the teacher deletes them | Sources and click-to-source never expire (second review, 19 Nov) |
| D26 | Teaching coach, unit merge/split and Explore web search move to weeks 2–4 | Week 1 stays focused on accuracy (second review, 19 Nov) |
| D27 | Second check stays on Sonnet in week 1; disagreement and high-risk share measured in week 2 | Simple now, switch on evidence (second review, 19 Nov) |
| D28 | Library editor confirms leading cases' status before launch; grey flags counted separately from yellow points | No grey-only lectures at launch; the yellow target stays reachable (second review, 19 Nov) |

**Platform decisions added with the LLD (19 Nov; details in LLD Section 17):**

| # | Decision | Reason |
| --- | --- | --- |
| D29 | Claude only: the gateway switches between a light model (Haiku) and a heavy model (Sonnet) per task; no self-hosted models or vLLM | Accuracy and the 1-week build; no GPU cost or operations |
| D30 | Hybrid search keeps Postgres built-in full-text ranking now; true BM25 later behind one swappable function | Works on Neon and RDS; BM25 extensions need self-managed Postgres |
| D31 | RAGAS-style evals (faithfulness, response relevancy, context precision, context recall) rebuilt in TypeScript, plus legal metrics | One toolchain; no Python |
| D32 | Every data-returning AI call uses JSON-schema structured output; prompts ordered stable-to-variable with cache breakpoints | Fewer retries and tokens; cheaper repairs and second checks |
| D33 | No AI call holds all three lethal-trifecta legs: no model tools, outgoing queries from clean context only, plain-text output, strict CSP | Prompt injection cannot become data theft |

### The LLD must cover next

- [ ] Database schema: every table, column, type, index and foreign key (including research, versions, edit events)
- [ ] API contract (OpenAPI): every endpoint, request, response and error
- [ ] Job designs: input, steps, retries, timeouts for ingestion, lecture build, research run, PPT, nightly check, style learning
- [ ] Lecture and research pipelines: prompts, chunk budget, sub-question planning, evidence table rules, check rules, flag/remove logic
- [ ] Lecture Studio editing: versioning, instant checks on edits, rewrite scope
- [ ] Search service: query shapes, fusion and rerank settings, privacy filter tests
- [ ] Code layout: monorepo folders, modules, naming, error format
- [ ] Test plan detail: first 30 gold questions, 10 research topics, red-team set, fixtures

* Chunker rules per document type, size limits, header format and parent/child linking (5.1, Layer 1)
* Metadata schema, extraction rules, B-tree indexes on filter columns, iterative-scan settings and filter-chip defaults (5.1, Layer 2)
* Candidate counts, fusion formula, reranker call, score threshold and fallback order (5.1, Layer 3)
* Opinion-boundary rules, paragraph-role extraction, case-treatment suggestion prompt and review screen (5.2 a, b)
* Span format, high-risk claim list, second-check prompt, disagreement and false-flag measurement (5.2 c)
* Must-cover list rules, grouping per section, "Left out" list, coverage re-run after removal (5.2 d)
* Flag format for the .pptx and for Word/PDF exports (5.2 e)
* Domain allowlist, provisional-source rules, law-mapping schema and sign-off screen (5.2 f, g)
* Official court-website loaders and span storage in citations (Section 6)
* Template derivation, writing-guide job, coach checklist, concept-list editor, HOME-9 fallback (4.1)
* Row-level security policies with `SET LOCAL` per transaction, worker, admin and library-editor policies, cache key rules, Langfuse redaction, deletion job (Section 8)
* Product event names and dashboard (Section 11)

## 14. Delivery plan

One week is enough for a working pilot on a few topics, not for all thirteen flows. This section says what ships when, who does the human work, and how the pilot moves to AWS.

### 14.1 What ships when

| Phase | Flows and features | Tests and operations |
| --- | --- | --- |
| **Week 1 — pilot launch (all BRD Must items)** | F1 sign-in and setup (template fallback to ready decks); F2 loaded by the admin and library editor for the pilot topics (official court websites first, Indian Kanoon for gaps); F3 in full (pre-build checks, per-part retrieval, span check, high-risk second check, paragraph-role rule, coverage check, download and export rule); F4 Explore (topic map, follow-ups, turn into a lecture; library only, no web search yet); F7 editing with checks and the example bank; F8 course series (plan, reorder, memory, recap, series checks); F12 wrong-fact reports with one library-editor queue; quick Research mode; F13 invites and roles | Unit, integration, privacy (including row-level security under pooling) and PPT/export output tests; 30-question gold set + red-team set; checker test (100% planted errors caught); Sentry; cost logging |
| **Weeks 2–4 — production (BRD Should items)** | Move to AWS Mumbai (14.3); teaching coach; merging and splitting course units; checked web search in Explore and What's new; F5 nightly checks; F9 add a one-off to a course; case-status suggestion job; second-check measurement (5.2 c); checker tuned against false flags; reading list; topic brief and tutorial problems; thorough Research mode with editable sub-questions; Word/PDF export | Self-hosted Langfuse; contract tests; k6 load test; ZAP scan; product-metrics dashboard |
| **After the week-8 decision (Could items)** | F10 automatic style learning; F11 sharing and library review of teacher material; EXP-4 compare; try-out mode; Hindi search; other colleges | Gold set grows to 200 questions |

### 14.2 People (human work)

The accuracy promise depends on law experts as much as on code. Each role needs a named person before launch; this is a launch gate.

| Role | Work | Time (estimate) | Owner |
| --- | --- | --- | --- |
| Library editor | Load and spot-check the pilot library; confirm case statuses; review provisional sources; answer wrong-fact reports within 24 h | 6–8 h a week in the pilot | To be named |
| Criminal-law reviewer | Sign off every IPC→BNS, CrPC→BNSS and Evidence Act→BSA mapping row | About 15–20 h once, then on change | To be named |
| Gold-set authors (2) | 30 questions with answers and source paragraphs by day 3; 200 by week 8 | About 10 h each to start | To be named |
| Weekly checker | Line-by-line check of 10 random lectures a week | About 3 h a week | To be named |
| Concept-list curator | Concept list and leading cases for each pilot course | About 2 h per course | To be named |

### 14.2a Week-1 plan, day by day

Keep the pilot small, about 2 courses and 8 topics, so the experts finish by day 4. Day 0 is the working day before the build starts.

| Day | Build team | Law experts | Product lead |
| --- | --- | --- | --- |
| 0 | Repo, environments, CI | — | Request the CNLU exception; name the experts; choose pilot topics; ask Indian Kanoon about storage terms; request no-training terms from AI providers |
| 1 | Database schema with RLS; sign-in; ingestion and chunker | Concept lists for pilot topics; start loading official sources | Chase the exception and terms |
| 2 | Search (filters, reranker); F3 plan and per-part retrieval | Mapping review for pilot topics; gold questions 1–15 | Consent screen text with processor list |
| 3 | Writer with spans; code checks; AI and second checks; coverage | Confirm leading-case status; gold questions 16–30 | — |
| 4 | Lecture Studio, PPT and export flags; course series | **Cut-off:** sample paragraph roles of loaded judgments; finish everything | Go/no-go on the exception (fallback below) |
| 5 | Explore (library only), quick Research mode, reports queue; run gold + red-team sets; fix | Review the first failed answers | — |
| 6 | Privacy and E2E tests; deploy pilot | Dry-run the weekly check on 3 lectures | Pilot teacher invites |
| 7 | On call for fixes | On call for wrong-fact reports | Sit with teachers (J1, J3); launch decision |

**If the CNLU exception isn't signed by day 4:** finish the build on test data only and start the pilot directly on AWS Mumbai, about one week later.

### 14.3 Moving the pilot to AWS Mumbai

1. Confirm pgvector 0.8 or later on both Neon and the chosen RDS PostgreSQL version (needed for iterative scans).
2. Announce a short evening window and pause writes.
3. Dump Neon and restore to RDS. Vectors are copied as data, with no re-embedding; then rebuild the HNSW index.
4. Copy R2 files to S3 Mumbai and check counts and hashes. Redis is not copied; it rebuilds.
5. Switch configuration and DNS; run the smoke tests.
6. Re-run the full gold set, red-team set and privacy tests on AWS. Scores must match the last pilot run before teachers are let back in.
7. Keep the pilot read-only for 7 days, then delete it and record the deletion in deletion\_log.

### 14.4 Open items to confirm

- Written CNLU data-residency exception for the pilot (needed before real teacher data is loaded), with providers' no-training and limited-retention terms attached.
- Indian Kanoon terms on storing and reusing fetched text: an answer is needed before Day 1.
- Regions offered by each pilot provider, and the pgvector version on Neon.
- Week 2: share of claims that count as high-risk, and second-check disagreement rate (may change the model and the cost).
