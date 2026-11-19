# NYAAI — Business Requirements Document (BRD)

Nov 19, 2026 · @aryan Agrawal

## 1. Summary

NYAAI is a web app that helps law teachers prepare a full, source-checked lecture and a .pptx in their own style in about 15 minutes instead of several hours. The first version is a pilot for law teachers at CNLU Patna, on law subjects only, built in 1 week and moved to AWS (Mumbai region) in weeks 2 to 4.

**The problem.** Preparing one law lecture means reading bare acts and judgments, checking what changed recently, building notes and making slides. It often takes an evening per class. General AI chat tools are fast but can invent cases and sections, which a law teacher cannot risk in class.

**The solution.** NYAAI writes only from a checked law library (acts, judgments, the teacher's own notes). Every claim carries a clickable source, and anything it cannot confirm is marked for the teacher to verify. It learns each teacher's style, keeps lectures in a course connected as a series, and suggests better teaching methods.

**Core promise (USP).** Detailed, high-quality research with accurate facts and zero tolerance for hallucination: no wrong fact may reach a teacher without a warning on it. Section 13 sets out how this is achieved and measured.

**Reference for this document.** Two finalized videos define the expected experience: *NYAAI teacher walkthrough* (the feature tour) and *NYAAI teacher end to end* (Prof. Sharma preparing a lecture on frustration of contract, s. 56, from sign-in to download to the next lecture). Where this document and the videos differ, the decisions in Section 6 win.

## 2. Business objectives and success measures

The pilot succeeds if teachers save real time, trust the content, and keep using it without help. All targets are measured over the first 8 weeks of the pilot with 3 to 5 CNLU teachers.

| # | Objective | Measure | Pilot target |
| --- | --- | --- | --- |
| O1 | Cut lecture prep time | Time from topic to downloaded .pptx | Under 15 minutes (median) |
| O2 | Zero made-up law | Fake or wrong citations in the test set and in teacher reports | 0 |
| O3 | Every claim traceable | Claims with a valid, clickable source | 100% |
| O4 | Slides feel like the teacher's own | Teacher rating "sounds like me" (1 to 5) | 4 or higher by week 4 |
| O5 | Easy to use without training | Teachers who finish setup and a first lecture alone | 100% of pilot teachers |
| O6 | Real, repeated use | Lectures prepared per teacher per week | 2 or more |
| O7 | Better teaching, not just faster | Coach suggestions accepted | 30% or more |
| O8 | Affordable to run | AI + hosting cost per teacher per month | Within the budget in Section 9 |

**Decision at week 8.** If O1, O2, O3 and O5 are met, the pilot moves to more CNLU teachers and subjects (Phase 3). If O2 fails even once, expansion stops until the cause is fixed.

## 3. Stakeholders and users

Teachers are the only daily users in the pilot; everyone else approves, funds, supports or benefits indirectly.

| Who | Role in NYAAI | What they need from it |
| --- | --- | --- |
| Law teachers (CNLU faculty) | Primary users | Fast, accurate lectures and slides in their style; no AI jargon; their files kept private |
| Head of department / Dean | Approver for the pilot | Proof of time saved and accuracy; no risk to academic standards |
| CNLU management | Owner of the pilot | Data stays in India; simple rollout; a clear decision point at week 8 |
| Funding sponsor (government backing, as stated) | Funder | Measurable results; responsible use of public money |
| NYAAI product and dev team | Builds and runs the app | Clear, prioritised requirements; stable APIs and data sources |
| Admin (pilot coordinator) | Light admin role | Invite teachers, see usage, handle access and support |
| Students | Indirect beneficiaries | Clearer, up-to-date, well-structured lectures |
| Data providers (India Code, Indian Kanoon API, Perplexity) | External services | Use within their terms of use |

**User types inside the app (pilot):** Teacher, Admin and Library editor. The Library editor is a law expert who reviews wrong-fact reports, new sources, case status and the old/new criminal law table. Student accounts are out of scope for the pilot.

## 4. Scope

The pilot covers everything a teacher needs from first sign-in to a downloaded, checked .pptx and the next lecture in a series. Anything for students, other colleges or non-law subjects waits for later phases.

### In scope (pilot)

- Google sign-in with college email; Teacher, Admin and Library editor roles
- Account setup: profile, optional old slides, 5 style questions, slide template, courses with syllabus
- Home screen: topic box with library suggestions, course / length / level / style chips, must-include examples, Prepare
- Lecture build: sources → 50-minute plan → writing in the teacher's style → claim checking
- Lecture Studio: edit slides, click-to-source, "please verify" marks, teaching coach, add example
- Download .pptx in the teacher's own template, with citations in speaker notes
- Courses: create, upload syllabus, reorder plan, connected series (recap, no repeats, gaps), mark taught
- One-off lectures and adding a one-off to an existing course
- Explore: topic map, what's new, follow-up questions, compare, reading list, turn into lecture/brief/problems
- Controlled web search for updates (checked, labelled, dated); Research mode: a research question becomes a cited brief with an evidence table
- Learning from edits, My Style card with simple switches
- Law subjects only, English with optional Hindi examples

### Out of scope (pilot)

- Student accounts, student-facing pages, quizzes delivered to students
- Non-law subjects
- Other colleges and multi-college admin
- Mobile apps (the web app works on phones for review only)
- Fully Hindi lectures, voice input, video lectures
- Direct export to Google Slides or LMS (Moodle and similar)
- Payments and pricing

### Later phases (summary)

- **Phase 3:** all CNLU law faculty and subjects; teachers share reviewed material with colleagues (shared department libraries)
- **Phase 4:** other law colleges (multi-college setup); optional Hindi lectures; LMS export
- **Phase 5:** student companion (revision notes and practice questions from a teacher's lecture)

## 5. User journeys

Four journeys cover the pilot; the first two match the finalized videos step for step.

### J1. Prepare a lecture end to end (video: *NYAAI teacher end to end*)

1. Sign in with Google (college email).
2. Home: type the topic; pick a suggested source (for example s. 56).
3. Tap course, class length, level and style (all required, none pre-selected).
4. Optionally add a must-include example (for example a wedding hall booking cancelled in lockdown).
5. Click Prepare; watch: finding sources → planning → writing → checking.
6. Review the 50-minute plan; open the slides.
7. Click a source number to see the exact text; mark the yellow "please verify" point verified; edit a long bullet.
8. Add the teaching coach's class activity (available from week 2).
9. Download the .pptx in her own template, with citations in speaker notes.
10. After class, mark the lecture taught; prepare the next lecture, which opens with a recap.

### J2. Feature tour (video: *NYAAI teacher walkthrough*)

1. One-time setup: sign in, upload old slides, answer 5 style questions.
2. Course page: Prepare next lecture; pick length and level.
3. Watch the build; review in Lecture Studio with source chips, yellow verify marks and coach tips.
4. Download the .pptx.
5. Next week: the series continues with a recap and no repeats.
6. Style updates quietly after repeated edits, with an Undo.

### J3. Account setup (first sign-in)

1. Welcome screen: 5 steps, about 3 minutes, all changeable later.
2. Profile: name and department from Google; subjects taught; teaching language.
3. Old slides (optional, private): NYAAI shows what it learned (colours, fonts, bullets per slide, how cases are shown).
4. Five style questions (one tap each).
5. Slide template (from her slides, or a ready template).
6. Courses: name, semester, syllabus upload → lecture plan she can reorder.
7. My Style card with simple switches → Finish → Home.

### J4. Explore a new topic

1. Type a topic, section, case or question.
2. Read the topic map: key laws, leading cases, open questions, link to her courses.
3. Check What's new; ask follow-up questions; compare; save sources; upload readings if the library is thin.
4. Turn the research into a lecture, a topic brief or tutorial problems.

## 6. Functional requirements

There are 75 requirements across 11 areas; 54 are Must for the pilot. Priority: **Must** = needed at pilot launch (end of week 1); **Should** = needed in the pilot, can follow in weeks 2 to 4; **Could** = later phase if time is short. The HLD (Section 14) maps each to a build phase.

### 6.1 Account and setup (ACC)

| ID | Requirement | Priority |
| --- | --- | --- |
| ACC-1 | Teachers sign in with Google using a CNLU email domain only | Must |
| ACC-2 | First sign-in opens a 5-step setup: Profile, Old slides, Your style, Template, Courses | Must |
| ACC-3 | Name and department are filled from Google; teacher picks subjects taught and teaching language | Must |
| ACC-4 | Teacher can upload old PPT/PDF files (optional); the app shows what it learned (colours, fonts, bullets per slide, case layout) | Should |
| ACC-5 | Five one-tap style questions: slide density, case-first or rule-first, structure, language, kind of examples | Must |
| ACC-6 | Teacher picks a slide template: from her own slides or a ready template | Must |
| ACC-7 | My Style card shows a plain summary and on/off switches; every setting can be changed later | Must |
| ACC-8 | Admin can invite teachers and remove access | Must |

### 6.2 Home and starting a lecture (HOME)

| ID | Requirement | Priority |
| --- | --- | --- |
| HOME-1 | One topic box accepts plain words, a section, a case name or a question | Must |
| HOME-2 | Suggestions appear while typing and come only from the law library, never from the AI | Must |
| HOME-3 | Course row shows every course the teacher teaches, each with its next untaught lecture, plus "No course, one-off" | Must |
| HOME-4 | The app never selects the course itself; it may show a hint ("This topic is Lecture 12 in Company Law") | Must |
| HOME-5 | Course, class length, level and style chips start empty | Must |
| HOME-6 | Prepare stays disabled until course (or one-off), class length, level and style are all selected | Must |
| HOME-7 | Must-include lets the teacher add her own example or pick from her example bank | Must |
| HOME-8 | An "Anything special?" line lets the teacher describe a one-time style in plain words | Should |
| HOME-9 | If a topic is unclear (for example "damages": contract or tort), the app asks one tap question before starting | Must |
| HOME-10 | If the chosen lecture builds on untaught lectures, the app warns and offers to prepare the earlier one | Should |

### 6.3 Building the lecture (BUILD)

| ID | Requirement | Priority |
| --- | --- | --- |
| BUILD-1 | Live progress steps: finding sources, planning, writing, checking | Must |
| BUILD-2 | A plan that fits the chosen class length (for example 50 minutes) with time per part | Must |
| BUILD-3 | Writing uses only sources found for each part of the plan; each claim carries a source tag and the exact supporting words | Must |
| BUILD-4 | Code checks: every tag exists; the supporting words appear in the source; case names, sections and years match | Must |
| BUILD-5 | AI claim check: unsupported claims are removed or marked "please verify" | Must |
| BUILD-6 | Old and new criminal law (IPC/BNS, CrPC/BNSS, Evidence Act/BSA) come from an expert-reviewed mapping table that records splits, merges, changes and "no direct equivalent"; always labelled | Must |
| BUILD-7 | Outline appears within about 20 seconds; the full draft within 5 minutes | Should |
| BUILD-8 | Coverage check: exceptions, provisos and explanations of every section stated, and the topic's leading cases, are on a slide or deliberately left out | Must |
| BUILD-9 | High-risk claims (holdings, dates of coming into force, punishments, time limits, old/new law equivalents) get a second, stronger check | Must |
| BUILD-10 | "The Court held" is only accepted when backed by a majority holding or reasoning paragraph, never by arguments, a dissent or a lower-court summary | Must |

### 6.4 Lecture Studio (STUDIO)

| ID | Requirement | Priority |
| --- | --- | --- |
| STUDIO-1 | Three columns: outline, slide preview, sources and coach | Must |
| STUDIO-2 | Click any slide text to edit; "Rewrite this part" for one section | Must |
| STUDIO-3 | Click a source number to see the exact paragraph | Must |
| STUDIO-4 | Yellow "please verify" points can be marked verified or edited | Must |
| STUDIO-5 | Teaching coach gives 2 to 3 suggestions; "Add to lecture" inserts one (from week 2) | Should |
| STUDIO-6 | "Add example" on any slide; marked "Your example"; any case it names is still checked | Must |
| STUDIO-7 | Undo and autosave everywhere | Must |
| STUDIO-8 | Try-out mode: two versions side by side; nothing changes style or course | Could |

### 6.5 Slides output (PPT)

| ID | Requirement | Priority |
| --- | --- | --- |
| PPT-1 | Download as .pptx in the teacher's chosen template | Must |
| PPT-2 | Speaker notes hold the explanation and full citations | Must |
| PPT-3 | File names follow course and lecture (for example L09\_Frustration.pptx) | Should |
| PPT-4 | Download with open yellow points is allowed after a warning; each open point is written into that slide's speaker notes, or the teacher removes all unverified lines (coverage is then re-checked) | Must |
| PPT-5 | Every other export (research brief, topic brief, tutorial problems, reading list as Word or PDF) carries the same flags: open points and "Status not verified" cases written into the file | Must |

### 6.6 Courses and series (COURSE)

| ID | Requirement | Priority |
| --- | --- | --- |
| COURSE-1 | Create a course: name, semester, number of classes | Must |
| COURSE-2 | Plan from a syllabus upload, a pasted list of topics, or empty | Must |
| COURSE-3 | Reorder, rename and delete planned lectures | Must |
| COURSE-4 | Course memory: summaries, terms taught, cases used, running example, open threads | Must |
| COURSE-5 | New lectures open with a recap and end with a link to the next | Must |
| COURSE-6 | Series checks for repeats, gaps and wrong order; suggestions only, never automatic changes | Must |
| COURSE-7 | Mark lecture taught; course memory updates only then | Must |
| COURSE-8 | Add a one-off lecture to a course: choose position, review fit checks, confirm | Should |
| COURSE-9 | Merge and split planned lectures; course memory follows the change | Should |

### 6.7 Explore (EXP)

| ID | Requirement | Priority |
| --- | --- | --- |
| EXP-1 | Topic map from an expert-curated concept list: key laws, leading cases, open questions, link to the teacher's courses | Must |
| EXP-2 | Follow-up questions with sources; "Not found" when the library lacks it | Must |
| EXP-3 | What's new: recent judgments and amendments with source and checked date | Should |
| EXP-4 | Compare two items side by side (old vs new law, two judgments) | Could |
| EXP-5 | Reading list: save sources; upload private readings; export | Should |
| EXP-6 | Turn research into a lecture | Must |
| EXP-7 | Turn research into a topic brief or tutorial problems; model answers pass the full check, fact patterns labelled "Hypothetical" | Should |

### 6.8 Updates and web search (WEB)

| ID | Requirement | Priority |
| --- | --- | --- |
| WEB-1 | Nightly job checks official sources for new judgments and amendments on topics in teachers' courses | Should |
| WEB-2 | Live web search (Perplexity Search API) only for updates, library gaps and recent questions (from week 2) | Should |
| WEB-3 | Every web link is opened and checked before showing; labelled "From the web" with date (applies whenever web results are used) | Must |
| WEB-4 | News reports never become law in a lecture until the judgment or notification is found | Must |

### 6.9 Personalisation and admin (PERS / ADM)

| ID | Requirement | Priority |
| --- | --- | --- |
| PERS-1 | Learn from edits: after 3 similar edits, update style and tell the teacher, with Undo | Should |
| PERS-2 | One-lecture style choice asks "Use this style again?" at the end | Should |
| PERS-3 | Example bank: teacher's examples saved privately and reusable | Must |
| ADM-1 | Admin usage view: teachers active, lectures prepared, errors reported | Should |
| ADM-2 | Teachers can report a wrong fact from any slide in one click | Must |

### 6.10 Research mode (RES)

| ID | Requirement | Priority |
| --- | --- | --- |
| RES-1 | A research question with scope chips: India only or comparative, time range, quick or thorough (thorough from weeks 2–4) | Must |
| RES-2 | The teacher sees and can edit the sub-questions before the run starts | Should |
| RES-3 | Evidence table: one row per source with what it says (exact paragraph), how it relates, status, court and date | Must |
| RES-4 | Cited brief: short answer, key points, conflicts, open questions, gaps marked "Not found in sources"; every line passes the full check | Must |
| RES-5 | Save under "My research", export to Word or PDF | Should |
| RES-6 | A quick run finishes in about 2 minutes | Must |

### 6.11 Library quality (LIB)

| ID | Requirement | Priority |
| --- | --- | --- |
| LIB-1 | A Library editor role reviews wrong-fact reports, new and live-lookup sources, case status suggestions and mapping rows, in one queue | Must |
| LIB-2 | A case shows "Status not verified" until a law expert confirms it; the app never claims "good law" by itself | Must |
| LIB-3 | Teachers can share their own material with colleagues after Library editor review | Could |

## 7. Non-functional requirements

Accuracy comes first, then privacy, then speed; when they conflict, the app should be slower rather than wrong.

| ID | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Accuracy | 0 fake or wrong citations in the 30-question test set before every release; any wrong citation found in use is a top-priority bug |
| NFR-2 | Accuracy | 100% of claims in a finished lecture carry a valid source or a "please verify" mark |
| NFR-3 | Speed | Home page loads in under 2 seconds; suggestions appear within 0.5 seconds of a pause in typing |
| NFR-4 | Speed | Lecture outline within about 20 seconds; full draft within 5 minutes; .pptx download within 10 seconds |
| NFR-5 | Capacity | 50 teachers preparing lectures at the same time without failures (load-tested before Phase 3) |
| NFR-6 | Availability | 99% uptime during the pilot (about 7 hours of downtime a month at most), mainly in teaching hours |
| NFR-7 | Privacy | Production data stored in India (AWS Mumbai). The pilot may run outside India only under a written CNLU exception signed before real teacher data is loaded; AI providers that process content outside India are named on the consent screen and covered by that sign-off. Each teacher's uploads, notes and examples are visible only to her. |
| NFR-8 | Privacy | Consent screen at sign-up listing every outside processor and what it receives; "delete my data" removes everything about the teacher (files, text, search data, lectures, AI logs), in line with the DPDP Act, 2023 |
| NFR-9 | Security | Sign-in only through Google with the CNLU domain; secure cookies; API keys in AWS Secrets Manager; role checks on every request |
| NFR-10 | Security | Rate limits per teacher and a monthly AI budget per account; a build already running finishes when the budget runs out |
| NFR-11 | Backup | Daily database backups kept 7 days; lose at most 24 hours of data and restore within 4 hours; a restore tested at least once before Phase 3 |
| NFR-12 | Usability | A new teacher finishes setup and a first lecture without training; no AI terms (prompt, model, tokens) anywhere |
| NFR-13 | Usability | Works on a laptop for full editing and on a phone for review |
| NFR-14 | Reliability | Every outside service (Claude, Voyage embeddings and reranker, Cohere as reranker fallback, Perplexity, Indian Kanoon) has retry and a clear fallback message |
| NFR-15 | Transparency | Every web or news item shows its source and the date it was checked; news never supports a statement of law |
| NFR-16 | Accuracy | The fact-checker catches 100% of planted errors in its test set and flags no more than 10% of correct claims; no more than 5 yellow points in a typical 50-minute lecture (grey "Status not verified" flags and grouped coverage notes are counted separately) |
| NFR-17 | Measurement | The app records the events needed for objectives O1 to O8 and shows them on a weekly dashboard |

## 8. Data and content requirements

The law library is filled before launch, grows with use, and is checked for updates every night; nothing in it comes from AI memory.

### Where the content comes from

| Source | What it gives | How we get it | Status |
| --- | --- | --- | --- |
| India Code (Government of India) | Bare acts and sections | Official site; method to follow its terms of use | Terms to confirm before Day 1 |
| Indian Kanoon API | Judgments with citations | Paid official API (not scraping the website) | Account and plan to set up |
| e-Gazette of India | Amendments and notifications | Official site, checked by the nightly job | Terms to confirm |
| Teacher uploads | Old slides, notes, readings | Upload in setup, Explore and Studio | Private to each teacher |
| Perplexity Search API | Recent changes and news links | Live search, every link opened and checked | Labelled "From the web" |

### Library rules

- **DATA-1** Before launch, load the acts and leading cases for every pilot course, plus an expert-curated concept list linking everyday topic names to sections and cases.
- **DATA-2** Every stored paragraph keeps its address: act, section, case name, citation, paragraph number, URL, date added. Judgment paragraphs also record majority, concurring or dissent, the judge, and whether the paragraph is facts, arguments or the court's reasoning.
- **DATA-3** When a teacher uploads a syllabus, sources for every planned lecture are fetched in the background.
- **DATA-4** A search the library cannot answer triggers a live official lookup. Results can be used at once, labelled "not yet reviewed", and become part of the reviewed library after the Library editor checks them (except private uploads).
- **DATA-5** Teacher uploads are stored in her private space and never shared or used for other teachers.
- **DATA-6** Old-to-new criminal law mapping (IPC/BNS, CrPC/BNSS, Evidence Act/BSA) is a reviewed table that allows one old section to map to several new ones and records "substantively changed" and "no direct equivalent". A named criminal-law expert signs off every row.
- **DATA-7** Official law (acts, gazette) and judgments from official court websites are kept permanently with dates; leading cases are taken from court websites first. Indian Kanoon is used only for gaps, and kept as long as its terms allow (an answer is needed before Day 1; until then 30 days). Each claim's short supporting words are stored with the lecture or brief permanently, so sources never vanish from saved work. Lectures and research briefs are kept until the teacher deletes them.
- **DATA-8** Case status (overruled, reversed, followed) is suggested by the app from later judgments and confirmed by a law expert; until then it shows "Status not verified".

### What the app stores (main tables)

People and courses: `users`, `teacher_profiles`, `consents`, `courses`, `course_units`, `lectures`, `slides`. Evidence: `citations`, `coverage_items`, `research_runs`, `evidence_items`. Library: `sources`, `chunks` (text + vector + legal labels), `legal_concepts`, `law_mappings`, `case_treatments`. Teacher material: `uploads`, `examples`, `templates`, `reading_list_items`. Quality and operations: `feedback`, `reports`, `review_queue`, `eval_runs`, `product_events`, `jobs`, `deletion_log`. The full list is in the HLD, Section 6.

## 9. Cost estimate

One finished lecture costs about US$0.59 in AI and data services; the extra accuracy checks (search per lecture part, exact-words check, second check on high-risk claims) account for about US$0.12 of that. A quick research run costs about US$0.30 and a thorough one about US$0.90. A teacher preparing 3 lectures a week and about 5 research runs a month costs about US$10 a month; budget US$12 per teacher per month for safety. For a 5-teacher pilot that is about US$60 a month for AI, plus hosting and law-expert time. These are estimates from list prices checked on 19 Nov 2026; usage numbers are assumptions to be replaced with real pilot data in week 2. In particular, if most claims turn out to be high-risk, the second-check line will rise.

### Price list used

| Service | List price |
| --- | --- |
| [Claude Sonnet 5.5](https://apidog.com/blog/claude-sonnet-5-5-pricing/) (main writer, second check on high-risk claims) | US$2 per 1M input tokens, US$10 per 1M output tokens |
| [Claude Haiku 5.5](https://www.vktr.com/ai-platforms/anthropic-cuts-smallmodel-pricing-90-with-claude-haiku-55/) (checks, summaries) | US$0.10 input, US$0.50 output per 1M tokens (prompts up to 100K tokens) |
| [Voyage voyage-law-2](https://docs.voyageai.com/docs/pricing) (embeddings) | US$0.12 per 1M tokens; first 50M tokens free |
| [Voyage rerank-2.5](https://docs.voyageai.com/docs/pricing) (reranker) | About US$0.05 per 1M tokens |
| [Cohere Rerank](https://developer.puter.com/tutorials/cohere-api-pricing/) (reranker fallback only) | About US$2 per 1,000 searches (Rerank 4); newer per-token pricing is lower |
| [Perplexity Search API](https://docs.perplexity.ai/getting-started/pricing) | US$5 per 1,000 requests |
| [Indian Kanoon API](https://indiankanoon.org/members/pricing) | ₹0.50 per search, ₹0.20 per document; ₹500 free credit at sign-up |

### One lecture, step by step (assumed usage)

| Step | Service | Assumed usage | Cost (US$) |
| --- | --- | --- | --- |
| Plan, write slides and notes (with exact supporting words) | Sonnet 5.5 | 60K input, 15K output tokens | 0.27 |
| Edits and "rewrite this part" | Sonnet 5.5 | 5 rewrites: 40K input, 5K output | 0.13 |
| Teaching coach | Sonnet 5.5 | 8K input, 1K output | 0.03 |
| Claim checks and summaries | Haiku 5.5 | 80K input, 6K output | 0.01 |
| Second check on high-risk claims | Sonnet 5.5 | 30K input, 3K output | 0.09 |
| Library search, per lecture part | Voyage embeddings + rerank-2.5 | About 6 parts, about 50 candidates each | 0.02 |
| Live case lookups | Indian Kanoon API | 2 searches + 5 documents (₹2) | 0.02 |
| "What's new" check | Perplexity Search API | 3 requests | 0.02 |
| **Total per lecture** |  |  | **about 0.59** |

### Monthly view

| Item | Pilot (5 teachers) |
| --- | --- |
| AI and data, at US$12 per teacher (lectures + research runs) | About US$60 |
| Accuracy test runs (full live eval about US$10 a run; weekly and before each release, so 4–8 runs a month; nightly runs reuse recorded answers) | About US$40–80 |
| Hosting, MVP phase (Vercel, Render, Neon, Upstash free or starter tiers) | About US$0–25 |
| Hosting, AWS production phase (including self-hosted AI monitoring) | About US$150–220 (approximate, not price-checked; confirm in the AWS Pricing Calculator) |
| One-time library loading | Indian Kanoon about ₹1,000–2,000; embeddings within Voyage's free 50M tokens; case-status suggestions for about 300 leading cases, about US$15 |
| Law-expert time (Library editor, mapping reviewer, test-set authors, weekly checker) | About 10–12 hours a week in the pilot, plus one-time set-up work (HLD Section 14.2); payment to be agreed |

**Cost controls built in:** Haiku for small jobs, caching of sources and repeated searches, a monthly AI budget per teacher (NFR-10), and an AWS budget alert.

**Note on Perplexity.** Perplexity's current pricing page lists a Search API and an Agent API, not the older Sonar chat endpoint named in the roadmap. Plan WEB-2 on the Search API (raw results we check ourselves), which also fits our "open and verify every link" rule.

## 10. Phases and milestones

The pilot is built in week 1, moved to AWS by week 4, and used for 8 weeks; only a successful week-8 review opens the later phases.

[embedded content: NYAAI phases · pilot build to students, 3 gates]

The week-8 gate is the one that matters: if even one wrong citation reached a class, expansion waits until the cause is fixed.

## 11. Assumptions, constraints, risks and open questions

The biggest risk is trust: one wrong citation in class could end the pilot, so accuracy rules override speed and features everywhere.

### Assumptions

- 3 to 5 CNLU law teachers join the pilot and give feedback weekly.
- Each pilot teacher prepares about 3 lectures a week.
- Teachers have a laptop, a browser and a CNLU Google account.
- The pilot courses and their syllabi are known before Day 1, so the library can be loaded in advance.

### Constraints

- Build time: 1 week for the pilot; weeks 2 to 4 for production on AWS.
- Stack: Node.js + Express, PostgreSQL with pgvector, Redis + BullMQ, React; Claude as the main writer.
- Managed hosting (Vercel, Render, Neon, Upstash) only during the MVP; AWS Mumbai afterwards.
- Production data must stay in India; the pilot runs outside India only under a written CNLU exception. Data sources are used only within their terms of use.

### Risks

| Risk | Effect | Plan |
| --- | --- | --- |
| A wrong or made-up citation reaches class | Loss of trust; pilot stops | 8 safety layers, "please verify" marks carried into the .pptx, 0-error test set before every release, one-click error report |
| One week is too short | Pilot launches thin | Must items only in week 1, Should items in weeks 2–4 (HLD Section 14); never cut source checks |
| Not enough law-expert time | Case status, mapping and reports fall behind; accuracy slips | Name the experts before launch (a launch gate); unconfirmed items stay flagged, never assumed right |
| CNLU does not approve the pilot data exception | Pilot cannot start on managed hosting | Ask in week 1; fallback is to start directly on AWS Mumbai, adding about a week |
| Source terms limit storing or showing content | Library gaps | Confirm India Code, e-Gazette and Indian Kanoon terms before Day 1; use official APIs only; Indian Kanoon text cached 30 days until confirmed |
| Outside services change products or prices | Breakage or cost jump | Retry and fallbacks; budget alerts; review prices monthly (Perplexity already changed its API line-up) |
| Teachers find it hard or slow | Low use | 4 screens, chips not forms, sit with teachers on Day 7, fix the top 3 confusions first |
| Too many yellow marks | Teachers spend too long checking; O1 missed | Track false flags weekly; tune the checker; target 5 or fewer per lecture |
| Old vs new criminal law mixed up | Wrong teaching | Expert-signed mapping table with split, merge and "no direct equivalent" rows, always labelled |
| Teacher files leak to others | Privacy breach | Private storage per teacher, database-level row security, role checks on every request, private data never cached across teachers |

### Open questions

- [ ] Which 3 to 5 teachers and which courses form the pilot? (Keep it to about 2 courses and 8 topics for week 1.)
- [ ] Who at CNLU signs off the week-8 decision?
- [ ] Who pays running costs in the pilot and after (CNLU, sponsor, or both)?
- [ ] Will CNLU sign the pilot data-residency exception, and who signs it?
- [ ] Will Anthropic, Voyage, Perplexity and Cohere confirm in writing that they don't train on our data and keep it only briefly?
- [ ] Who are the named law experts (Library editor, criminal-law reviewer, test-set authors, weekly checker), and how is their time paid?
- [ ] Do Indian Kanoon's terms allow storing fetched judgments, and for how long? (Needed before Day 1.)
- [ ] Should teachers get a "Search the web" button in Explore (off by default)?
- [ ] Is a weekly timetable worth collecting in setup?
- [ ] Final production domain name (the videos use "nyaai.app" as a placeholder).

## 12. Acceptance criteria and sign-off

The pilot is accepted for launch when a CNLU teacher can repeat the end-to-end video on real data (the coach step follows in week 2), and the accuracy test passes with zero errors.

### Launch checklist (end of week 1)

- [ ] All Must requirements in Section 6 work on the MVP hosting
- [ ] A pilot teacher completes setup (J3) and one lecture (J1) without help
- [ ] 30-question test set: 0 fake or wrong citations; 100% of claims sourced
- [ ] Fact-checker test: 100% of planted errors caught
- [ ] Topic to .pptx under 15 minutes for 5 test topics
- [ ] Prepare stays disabled until course (or one-off), length, level and style are selected
- [ ] Teacher uploads visible only to their owner (tested with 2 accounts, including under connection pooling)
- [ ] Library loaded for every pilot course, leading judgments from official court websites; source terms confirmed (Indian Kanoon answered)
- [ ] Status of every leading case for the pilot topics confirmed by the Library editor
- [ ] Criminal-law mapping rows for pilot topics signed off by a named expert
- [ ] Named law experts in place (Library editor, test-set authors, weekly checker)
- [ ] Written CNLU data-residency exception signed, with AI providers' no-training terms attached; consent screen lists every processor

### Production checklist (end of week 4)

- [ ] Running on AWS Mumbai with staging, CI/CD, backups and alerts
- [ ] Pilot data moved; full test set re-run on AWS with the same score; pilot copy deleted after 7 days
- [ ] Restore from backup tested once
- [ ] Load test: 50 teachers at once
- [ ] Consent screen and "delete my data" live
- [ ] Product-metrics dashboard live for the week-8 decision

### Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| CNLU pilot owner |  |  |  |
| Head of department |  |  |  |
| Product lead |  |  |  |
| Tech lead |  |  |  |

## 13. Quality and accuracy (core promise)

NYAAI treats a wrong fact shown without a warning as its most serious failure. Every sentence must be backed by a real source that says the same thing; if the app cannot prove a point, it removes it, marks it yellow for the teacher, or says "Not found" — it never guesses. No AI can promise zero mistakes, so the measurable promise is: **zero unflagged errors reach a class.**

### How mistakes are prevented (8 layers)

1. **Trusted library only.** Official sources and the teacher's own notes; every paragraph keeps its act, section, case, court, year, paragraph and link. AI memory is never a source.
2. **Careful search.** Filters first (jurisdiction, court, date, status), then exact words + meaning; a reranker picks the best 5–8 paragraphs for each part of the lecture; weak results lead to "Not found".
3. **Closed-book writing.** Claude writes only from numbered paragraphs (S1, S2…) and tags every sentence.
4. **Computer checks (no AI).** Every tag exists; case names, years, courts and sections match the library; quotes match word for word; the exact supporting words must appear in the source; old/new criminal law from an expert-signed table; amended or repealed sections flagged; a coverage check makes sure exceptions, provisos and leading cases are not silently left out.
5. **Independent AI fact-check.** The lecture is split into single facts; a separate model marks each supported, partly supported or not supported; "partly" counts as "not". High-risk claims (holdings, commencement dates, punishments, old/new law) get a second, stronger check, and "the Court held" must come from the majority's reasoning, not arguments or a dissent.
6. **Freshness check.** A nightly job flags amended sections and expert-confirmed overruled cases used in lectures; a case whose status no expert has confirmed shows "Status not verified".
7. **Teacher review.** Clickable sources, yellow points must be verified or edited, "Report wrong fact" on every slide.
8. **Stop-the-line rule.** If a wrong citation ever reaches a class without a warning, rollout to new teachers pauses until the cause is fixed and tested.

### How quality is measured

- **Exam paper (gold test set):** law questions and lecture topics with answers checked by law teachers; 30 at launch, growing to about 200. Run before every release; one fake or wrong citation blocks the release.
- **Trick questions (red-team tests):** non-existent cases, repealed sections, IPC asked as BNS. The right answer is "Not found" or a correction.
- **Automatic score on every lecture:** facts checked, supported, removed, marked yellow; citation and quote checks passed. Reported weekly.
- **Weekly human check:** a law expert checks every fact in 10 random lectures by hand.
- **Teacher reports:** each one reviewed within 24 hours, root cause fixed, and the case added to the exam paper.

### Quality scorecard

| Measure | Plain meaning | Target | Measured by |
| --- | --- | --- | --- |
| Fake citations | Cases or sections that don't exist | 0 | Exam paper, trick questions, weekly human check |
| Wrong details | Wrong year, court, section or party | 0 | Computer checks, weekly human check |
| Sourced claims | Every sentence backed by a real paragraph | 100% | Automatic score per lecture |
| Unflagged errors | Mistakes reaching the teacher with no yellow mark | 0 | Weekly human check, teacher reports |
| Exact quotes | Quotes match the source word for word | 100% | Computer check |
| Honest "Not found" | Admits when the library lacks the answer | 100% on trick questions | Red-team tests |
| Freshness | Amended laws and confirmed overruled cases flagged | 100% of known changes | Nightly checker, exam paper |
| Case status | Leading cases for pilot topics with an expert-confirmed status | 100% before launch; others shown grey | Library editor log |
| Coverage | Exceptions, provisos and leading cases present or ticked "left out" by the teacher | 100% of the must-cover list | Coverage check per lecture, weekly human check |
| Checker strength | Planted errors caught; correct claims wrongly flagged | 100% caught; 10% or fewer false flags | Labelled test set, every release |
| Second-check agreement | How often the two checks disagree on planted errors | Measured in week 2; switch model if it misses errors | Labelled test set |
| Flags per lecture | Yellow points in a typical 50-minute lecture (grey flags and coverage notes counted separately) | 5 or fewer | Automatic score per lecture |
| Report response | Teacher-reported errors reviewed | Within 24 hours | Report log |

## Sources

- [Claude Sonnet 5.5 API pricing (Apidog)](https://apidog.com/blog/claude-sonnet-5-5-pricing/)
- [Claude Haiku 5.5 pricing (VKTR)](https://www.vktr.com/ai-platforms/anthropic-cuts-smallmodel-pricing-90-with-claude-haiku-55/)
- [Voyage AI pricing](https://docs.voyageai.com/docs/pricing)
- [Cohere API pricing breakdown (Puter)](https://developer.puter.com/tutorials/cohere-api-pricing/)
- [Perplexity API pricing](https://docs.perplexity.ai/getting-started/pricing)
- [Indian Kanoon API pricing](https://indiankanoon.org/members/pricing)
- [Indian Kanoon API terms](https://api.indiankanoon.org/terms/)
