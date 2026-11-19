# Architecture summary

Full detail: [HLD §2–9](specs/HLD.md), [LLD §2–8, §15, §17](specs/LLD.md).

## System picture
```
Browser (React SPA) ──HTTPS/SSE──▶ API (Express 5) ──enqueue──▶ Redis (BullMQ) ──▶ Worker (same image)
                                     │                                               │
                                     └──────────── PostgreSQL + pgvector ◀───────────┘   (source of truth)
                                                   Object storage (MinIO/R2/S3)
Outside services are called only by the worker: Claude (Sonnet/Haiku), Voyage (embeddings + rerank),
Indian Kanoon, Perplexity (week 2), official law sites.
```
- **4 runtime parts:** web, API, worker, scheduler (BullMQ repeatable jobs inside the worker).
- **3 stores:** Postgres holds the truth. Redis and object storage can be rebuilt or re-fetched.
- **One door per concern:** `services/search`, `services/llm-gateway` and `services/storage` (LLD §2).

## Monorepo layout (LLD §2)
```
apps/web            React 19 + Vite + Tailwind v4 + shadcn/ui
apps/site           landing page (later)
apps/server         src/{api,middleware,jobs,services}, main.api.ts, main.worker.ts
packages/shared     Zod schemas = API contract
packages/db         Drizzle, SQL migrations, RLS, seeds
packages/prompts    versioned prompts
packages/legal      chunker, metadata, opinion/role rules (pure)
packages/checker-rules  C1–C8 code checks, coverage (pure)
packages/ui         tokens + components
eval/               gold / redteam / planted / retrieval / research sets + runner
infra/              docker-compose (local), Terraform (AWS, later)
```

## Environments
| Env | Web | API + worker | Postgres | Redis | Files |
|---|---|---|---|---|---|
| Local | Vite dev :5173 | tsx watch :4000 | docker `pgvector/pgvector:pg17` :54329 | docker `redis:7` :63799 | docker SeaweedFS S3 :19000 |
| Pilot | Vercel | Render | Neon | Upstash | R2 |
| Production (weeks 2–4) | CloudFront | ECS Fargate | RDS | ElastiCache | S3 ap-south-1 |

## Core flows (HLD §4)
F1 sign-in + setup · F2 ingestion · **F3 lecture build** (plan → per-part retrieve → write → C1–C10 → coverage) · F4 Explore · F5 nightly · **F6 Research** · F7 Studio edits · F8 course series · F9 add one-off · F10 style learning · F11 sharing · F12 wrong-fact reports · F13 admin.

## Data (LLD §3)
41 tables in 5 groups. The executable schema will be `packages/db/migrations/0001_init.sql` (Day 1). Key tables: `chunks` (text, tsv, `embedding vector(1024)`, legal labels), `citations` (claim → span → checks), `coverage_items`, `law_mappings` (+ items), `case_treatments` + view `case_status_v`.

DB roles: `nyaai_owner` (migrations), `nyaai_app` (API), `nyaai_worker` (jobs), `nyaai_library` (shared library writes).

## Jobs (LLD §5)
Queues: ingest · build (flow: lecture → parts → finalise) · check · export · research · nightly · status · learn · ops.

## Search (LLD §7)
Exact refs + concept match → filtered vector top 50 + FTS top 50 → RRF (k=60) → Voyage rerank-2.5 → top 8 above `RERANK_MIN_SCORE` → parent expansion → S1–S8. Outcomes: `ok`, `thin` (Kanoon lookup), `not_found`.
