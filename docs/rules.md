# Rules: read before writing any code

The non-negotiables for NYAAI. Full detail lives in `docs/specs/`. When documents disagree, BRD §6 beats the videos, the HLD beats the LLD, and every spec beats this summary.

## 1. Accuracy (the product's promise: zero unflagged errors reach a class)
- **Closed-book writing.** Claude writes only from supplied sources S1–S8. AI memory is never a source. (HLD §5, LLD §8–9)
- **Every claim carries** a source tag plus the exact supporting span, and the span is stored permanently in `citations.span_text`.
- **The ten checks run in a fixed order, C1–C10** (LLD §8.3): tag, span, details, quotes, mapping, source type, paragraph role, case status, support (Haiku), second check (Sonnet, high-risk claims only). "Partly" counts as "no".
- **Never skip a check.** If Claude is down, wait and retry; never save an unchecked line. Heavy-tier calls never downgrade to light.
- **Nothing unchecked reaches any export without a flag.** Downloads with open points write those points into the file (PPT-4, PPT-5, LLD §10.3).
- **"Held" requires a majority holding or discussion paragraph.** For high-risk claims, the source's paragraph roles must also be sampled by an expert.
- **Case status defaults to "Status not verified"** (grey). Never show "good law" unless an expert confirmed it.
- **News and web items never support a legal claim.** Law mappings are many-to-many and expert-signed.
- **The coverage check runs on every lecture.** Only the teacher can clear a left-out item.
- **Chunk by legal structure only** (section, Article, sub-section, judgment paragraph), never by character count. Provisos and exceptions stay with their rule.

## 2. Privacy and security
- Every teacher-owned row carries `college_id` and `owner_id`.
- RLS is `ENABLE` + `FORCE` on every table. Identity is set per transaction with `set_config(..., true)` (SET LOCAL), never per connection. Worker jobs set the owner id of the teacher they act for. (LLD §3.7)
- Job payloads hold ids only; no private text goes into Redis.
- Never cache results that touch private chunks across teachers.
- Signed links last minutes only. Buckets are private.
- Secrets live only in `.env` or Secrets Manager. Never log them or write them to docs.
- No AI call holds all three trifecta legs: no model tools, outgoing queries only from clean context, plain-text output, strict CSP. (LLD §17.6)

## 3. Code
- TypeScript strict everywhere. Zod validates every request, every response, the env and every AI output.
- **One door per concern.** Only `services/llm-gateway` imports `@anthropic-ai/sdk`; only `services/storage` imports `@aws-sdk/*`; only `services/search` queries chunks. A lint rule enforces this.
- Pure legal logic lives in `packages/legal` and `packages/checker-rules`: no database, no network, heavily tested.
- Prompts live in `packages/prompts` with an id and version. The version is stored on every AI call and every citation.
- Every data-returning AI call uses JSON-schema structured output. Prompts are ordered stable-to-variable with cache breakpoints.
- Error format: `{ error: { code, message, details, traceId } }`. `code` is UPPER_SNAKE; `message` is plain teacher English. Status codes follow LLD §2.
- Long work → `202` + jobId, with progress over SSE. Jobs must be idempotent.

## 4. Conventions
- UUIDs from `gen_random_uuid()`. `timestamptz` stored in UTC and shown in IST.
- `snake_case` in SQL, `camelCase` in TS/JSON.
- Money is an integer `cost_micro_usd`, never a float.
- **UI text never uses AI terms** (prompt, model, tokens, hallucination). See the microcopy rules in LLD §12.8.
- Home chips start empty and the app never selects the course (HOME-4, HOME-5, D8).

## 5. Decisions (one line each; reasons are in HLD §13 and LLD §17.7)
D1 Node+Express only · D2 Sonnet writes, Haiku checks, Sonnet second-checks · D3 Postgres+pgvector single DB · D4 Redis only for queue/progress/cache · D5 S3 API (R2 → S3 Mumbai) · D6 voyage-law-2, 1024 dims · D7 closed-book + code checks + AI check + teacher review · D8 app never picks the course · D9 Perplexity Search API, links verified · D10 managed hosting for the MVP, AWS Mumbai for production · D11 Qdrant later via the search service · D12 research = cited brief + evidence table · D13 every edit re-checked · D14 structure-aware chunking + parent expansion · D15 filters before vector search, iterative scans · D16 ~50 → rerank-2.5 → top 5–8 · D17 case status: AI suggests, expert confirms · D18 paragraph roles; "held" needs a majority · D19 per-part retrieval, exact spans · D20 coverage check; only the teacher clears · D21 export with flags allowed · D22 CNLU data exception for the pilot · D23 news ≠ law; mappings expert-signed · D24 `college_id` everywhere + RLS per transaction · D25 official judgments kept permanently; spans stored; Kanoon only for gaps · D26 coach, merge/split and web search in weeks 2–4 · D27 second check stays on Sonnet in week 1 · D28 leading-case status confirmed before launch; grey counted apart from yellow · D29/L1 Claude only, light/heavy gateway · D30/L2 Postgres FTS now, BM25 later · D31/L3 RAGAS-style evals in TS · D32/L4 structured output + prompt caching · D33/L5 trifecta defence.

## 6. Working agreement
- Read `docs/tasks.md` at the start of a session. Tick items when they are done.
- Log every non-obvious decision or deviation from the specs in `docs/memory.md`, with its reason.
