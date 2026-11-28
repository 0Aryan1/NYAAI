# Code conventions

How files are named and where code goes. The rules in [rules.md](rules.md) (accuracy, privacy, one door per SDK) come first; this page is about shape. Lint and Prettier enforce what they can (`pnpm lint`); the rest is checked in review.

## File names

| What                                             | Name                                                                             | Examples                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| A React component                                | `PascalCase.tsx`, named after its main export                                    | `ClaimLine.tsx`, `NewCourseForm.tsx`                 |
| A route's screen                                 | `PascalCase` ending in `Page`                                                    | `StudioPage.tsx`, `CourseListPage.tsx`               |
| A hook                                           | `useX.ts` (`.tsx` only if it renders)                                            | `useSlideEditor.ts`, `useNotes.ts`                   |
| Any other module                                 | `kebab-case.ts`                                                                  | `build-progress.ts`, `query-client.ts`               |
| A shared UI primitive (`apps/web/src/shared/ui`) | `kebab-case.tsx`: the shadcn convention, the one exception to the component rule | `button.tsx`, `confirm-inline.tsx`                   |
| A server service                                 | a folder with `index.ts` (more files beside it when it grows)                    | `services/events/index.ts`, `services/build/part.ts` |
| A server route file                              | `kebab-case.ts`, named after its path                                            | `api/topics-review.ts`                               |
| A test                                           | the file it tests, plus `.test.ts`; `.test.tsx` when it renders                  | `plan.test.ts`, `GapsPage.test.tsx`                  |
| A migration                                      | `NNNN_snake_case.sql`, never edited once applied                                 | `0021_reflag_mapping_lines.sql`                      |

Small helpers used only by one component can live in its file. When a second file needs one, it moves to a module of its own.

## Names in code

- **Types and components:** `PascalCase`. **Functions and variables:** `camelCase`. **Constants that are fixed tables or settings:** `UPPER_SNAKE` (`BUILD_STEPS`, `DOCUMENT_ACCEPT`).
- **Hooks** start with `use`. **Pure helpers** are named for what they return (`missingChoices`, `sortEvidence`), not for what they do inside.
- **Database columns and API JSON:** the database is `snake_case`; the API and the code use `camelCase` (the services map between them).
- **Words the user reads** are plain English for a law teacher: no codes, no "N/A", no AI terms (LLD §12.8). Codes stay in code and become words in one place (`shared/lib/labels.ts`, `CHECK_NAMES`, `FAILURE_TEXT`).

## Where code goes

### Web (`apps/web/src`)

```
app/                 router, frame, query client, route error page
features/<area>/     the screens of one area, their components, and their logic
shared/api/          the one way to the API: http.ts, one module per area, client.ts
shared/hooks/        hooks used by several areas
shared/lib/          pure helpers used by several areas (format, errors, labels, files)
shared/ui/           reusable components with no knowledge of any one area
```

- **A screen lays things out.** Rules, request-building and sorting go in a pure module beside it (`prepare.ts`, `review.ts`), with a test. Flows that call the API go in a hook (`usePrepareLecture`, `useDeckDownload`).
- **Server state lives in TanStack Query.** Keys come from `queryKeys` (never a literal array). Screen state is `useState`. There is no global store; the two small external stores (pending saves, rate limit) are the exception.
- **Every action and load shows its failure:** `ErrorText`, `LoadError`, or the route error page. Nothing fails without a message.
- **Features don't import from each other.** What two areas share goes to `shared/`. Two deliberate exceptions: Home uses the notes picker, Setup uses the new-course form.

### Server (`apps/server/src`)

```
api/          routes: parse the request, call a service, parse the answer with a shared schema
services/     the work, one folder per area; each outside SDK has exactly one service (the one door)
jobs/         queue workers; each job has a time limit and a job log
middleware/   sign-in, consent, rate limits, errors
lib/          small pure helpers (time, hash, page)
```

- **No SQL in route files** (sign-in and health aside). A route never reaches past its service.
- **Errors:** throw `AppError(code, message)` for a refusal the user should read, `ExternalServiceError` when an outside service fails (answered 503). The error middleware turns both into the shared error shape.
- **Settings** come from `config.ts` (checked at start-up); nothing tunable is written in code. Every variable is listed in `.env.example`.

### Shared packages (`packages/*`)

`shared` holds the zod contracts both sides use: change a request or answer there first. `db` holds migrations, the RLS helpers and the seeds. `legal`, `checker-rules` and `prompts` hold the law-specific logic, the line checks and the prompt texts, each without I/O.

## Tests

- **Next to the code** (`src/**/x.test.ts`) in the web app and the packages.
- **In `test/`** for the server (all of it) and for anything that needs a running database (`packages/db/test`). Integration tests are in `apps/server/test/integration`.
- **Browser journeys** are in `apps/web/e2e` (Playwright, with accessibility scans).
- A pure helper is tested directly; a component test checks what she sees and does (roles and labels, not class names).
