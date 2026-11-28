# NYAAI API

All endpoints live under `/api/v1`. Request and response shapes are zod schemas in `packages/shared`. The server parses every request body and every response against them, so the web app and the server cannot disagree on a shape. The full contract, with fields, is in [LLD §4](specs/LLD.md). This page covers the conventions and lists every endpoint.

## Conventions

**Layers.** A route file (`apps/server/src/api/*.ts`) only:

1. parses the request (zod);
2. calls a service (`apps/server/src/services/<domain>/`) inside the user's transaction (`req.db`, with row-level security);
3. parses the response with a shared schema.

There is no SQL in route files. The only exceptions are sign-in (`src/auth`) and the health check. Services throw `AppError` (`src/errors.ts`) with a stable code and a plain message for the teacher.

**Who may call.**

- **Health and sign-in** (`/health`, `/auth/*`) are public.
- **Signed-in user:** every other path needs one. This is one gate in `app.ts`, so a new router is protected without being listed anywhere. An unknown path gives 401 to a signed-out caller, and 404 once signed in.
- **Changes:** every change (POST, PATCH, DELETE) needs the CSRF token header (`x-csrf-token`, double-submit).
- **Rate limit:** each user is limited per minute (`RATE_LIMIT_PER_MIN`).
- **`/library/*`:** editors and admins only, again one gate in `app.ts`. Routers narrow this to editors only where only an editor may act: review, topics, mappings, reports.
- **Consent:** teachers who have withdrawn consent are refused anything that sends their work to an outside service (`requireConsent`, `CONSENT_REQUIRED`).

**Paths.** Resources are plural nouns (`/lectures/:id`). An action that is not a plain create or update is a named sub-resource, and these are the only ones: `/retry`, `/taught`, `/verify`, `/restore`, `/download`, `/export`, `/add`, `/leave-out`, `/lookup`, `/sign`, `/resolve`, `/roles-checked`, `/approve`, `/same-case`, `/status`, `/confirm`, `/withdraw`, `/finish`, `/delete-data`, `/export-data`.

**Status codes.**

| Code      | When                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------- |
| 200       | A read, or a change that returns the updated resource                                                     |
| 201       | A new resource with its own id (`Created` = `{ id }`, or the resource itself)                             |
| 202       | Work was queued (`{ jobId }`, or the new id to follow)                                                    |
| 204       | An action with nothing to return                                                                          |
| 400       | `VALIDATION_FAILED`: the request was malformed, with `details.issues`                                     |
| 401 / 403 | Not signed in, or not allowed (wrong role, no CSRF token, consent withdrawn)                              |
| 404       | `NOT_FOUND`, also for rows the caller may not see (row security never reveals that a row exists)          |
| 409       | A conflict: `VERSION_CONFLICT`, `COVERAGE_CHANGED`, `ALREADY_IN_LIBRARY`, `NOTES_NOT_READY`, `GAP_CLOSED` |
| 422       | Allowed but refused for now: `BUDGET_EXHAUSTED`, `PREREQ_WARNING_UNACKED`                                 |
| 429       | `RATE_LIMITED`                                                                                            |
| 503       | `SERVICE_UNAVAILABLE`: a queue or an outside service is not available                                     |

Every error has the same shape: `{ error: { code, message, details?, traceId } }` (`ApiError` in `packages/shared/src/errors.ts`).

**Paging.** These lists grow, so they are paged with `?cursor=&limit=`:

- `/library/judgments`
- `/library/gaps`
- `/library/reports`
- `/research`
- `/notes`

Each answer carries `nextCursor`, which is null on the last page. The cursor is opaque. A first request without a cursor returns the first page: 200 rows by default (100 for research), at most 500.

**Long work** (building a lecture, research, reading a file, lookups) is a background job. The endpoint answers 202 and the page follows progress:

- by polling the resource;
- or through the event stream `GET /events/stream` (server-sent events).

## Endpoints

### Sign-in and account

| Method | Path                                | What                                                   |
| ------ | ----------------------------------- | ------------------------------------------------------ |
| GET    | /health                             | API, database and Redis are up (public)                |
| GET    | /auth/options                       | Which sign-in methods are on                           |
| POST   | /auth/dev-login                     | Development only: sign in by email                     |
| GET    | /auth/google, /auth/google/callback | Google sign-in                                         |
| POST   | /auth/logout                        | Sign out                                               |
| GET    | /me                                 | Who she is, setup step, consent, budget, feature flags |
| GET    | /me/export-data                     | Everything she owns, as one zip                        |
| POST   | /me/delete-data                     | Delete her data (she types her email; 202)             |

### Setup and consent

| Method | Path                                            | What                                                     |
| ------ | ----------------------------------------------- | -------------------------------------------------------- |
| GET    | /consents/current                               | The services her work is sent to, and whether she agreed |
| POST   | /consents · /consents/withdraw                  | Agree · withdraw                                         |
| PATCH  | /setup/profile · /setup/style · /setup/progress | Setup steps                                              |
| POST   | /setup/finish                                   | All required answers given                               |

### Home, topics and search

| Method | Path            | What                                    |
| ------ | --------------- | --------------------------------------- |
| GET    | /home           | Her courses, each with its next lecture |
| GET    | /suggest?q=     | Suggestions as she types (no AI)        |
| POST   | /topics/resolve | Which topic she means                   |
| GET    | /events/stream  | Live events (server-sent)               |

### Lectures and the Studio

| Method        | Path                                        | What                                                |
| ------------- | ------------------------------------------- | --------------------------------------------------- |
| POST          | /lectures                                   | Prepare (202, the build job)                        |
| POST          | /lectures/:id/retry                         | Build again after a failure (202)                   |
| GET           | /lectures/:id                               | The Studio header                                   |
| GET           | /lectures/:id/slides                        | Every slide, line status and sources                |
| GET           | /lectures/:id/coverage                      | The Coverage tab                                    |
| POST · DELETE | /lectures/:id/taught                        | Mark taught · undo                                  |
| DELETE        | /lectures/:id/may-need-update               | "It's still right"                                  |
| POST          | /lectures/:id/download                      | The .pptx file                                      |
| GET           | /citations/:id/source                       | The source drawer                                   |
| POST          | /coverage/:id/add · /coverage/:id/leave-out | "Add this for me" (201) · leave out                 |
| PATCH         | /slides/:id                                 | Save an edit (checks run; 409 on a stale version)   |
| POST          | /slides/:id/verify · /examples · /restore   | Mark verified · her example · undo to a version     |
| GET           | /slides/:id/versions                        | Saved versions                                      |
| POST · GET    | /lectures/:id/reports                       | Report a wrong fact (201) · her reports and answers |

### Courses

| Method               | Path                       | What                                                   |
| -------------------- | -------------------------- | ------------------------------------------------------ |
| POST                 | /courses/syllabus          | Her syllabus read into units and topics (nothing kept) |
| GET · POST           | /courses                   | Her courses · a new one (201)                          |
| GET · PATCH · DELETE | /courses/:id               | The plan · rename · archive                            |
| PATCH                | /courses/:id/units         | Add, rename, delete, reorder, prerequisites, skip      |
| GET                  | /courses/:id/series-checks | Suggestions only                                       |

### Notes, Explore and Research

| Method     | Path                                          | What                                           |
| ---------- | --------------------------------------------- | ---------------------------------------------- |
| GET · POST | /notes                                        | Her documents (paged) · upload one (202)       |
| DELETE     | /notes/:id                                    | Remove one                                     |
| GET        | /explore/concepts · /explore/topic/:conceptId | Topic list · topic map                         |
| POST       | /explore/ask                                  | A follow-up answered from the library, checked |
| POST · GET | /research                                     | Start a run (202) · "My research" (paged)      |
| GET        | /research/:id                                 | One run: progress, brief, evidence             |
| POST       | /research/:id/export                          | The brief as Word or PDF                       |

### Library team (`/library/*`)

| Method         | Path                                                                   | What                                       |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| POST           | /library/sources                                                       | Load a source (202)                        |
| GET            | /library/sources/:id                                                   | Its loading status                         |
| POST           | /library/uploads/judgment · GET /library/uploads/:jobId                | Upload a judgment PDF (202) · its progress |
| GET            | /library/judgments (paged) · /library/judgments/:id                    | Judgments to review · one judgment         |
| PATCH          | /library/paragraphs/:id                                                | Correct a paragraph's role                 |
| POST           | /library/judgments/:id/roles-checked · /approve · /same-case · /status | The review checks                          |
| GET            | /library/topics                                                        | Leading cases of each topic                |
| POST · DELETE  | /library/topics/:conceptId/cases/:sourceId[/confirm]                   | Confirm · undo · put back · remove         |
| GET            | /library/gaps (paged)                                                  | What the library could not answer          |
| PATCH          | /library/gaps/:id                                                      | Close or reopen                            |
| POST           | /library/gaps/:id/lookup                                               | Look again (202)                           |
| GET · POST     | /library/mappings                                                      | Old ↔ new law rows · a new row (201)       |
| PATCH · DELETE | /library/mappings/:id                                                  | Change (removes the signature) · remove    |
| POST · DELETE  | /library/mappings/:id/sign                                             | Sign · undo the signature                  |
| GET            | /library/reports (paged)                                               | Wrong-fact reports                         |
| POST           | /library/reports/:id/resolve                                           | The editor's answer                        |
| POST           | /library/search                                                        | Check retrieval by hand                    |
