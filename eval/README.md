# Accuracy tests (LLD §16, §17.5)

Question sets that check NYAAI finds the right source, written as JSON so the law experts can review them.

## What exists

| File                                     | Set                      | Status                       | Size                            |
| ---------------------------------------- | ------------------------ | ---------------------------- | ------------------------------- |
| `sets/retrieval.draft.json`              | `retrieval`              | draft, needs expert sign-off | 15 questions, 2 red-team checks |
| `sets/retrieval.adr-property.draft.json` | `retrieval-adr-property` | draft, needs expert sign-off | 60 questions, 1 red-team check  |

Each question names what must be among the final 8 sources (an Act and section, an article, a case, or words the passage contains). Each red-team check asks something the library must not answer with a made-up source (a case that does not exist, a repealed section).

**Gate:** the expected passage is in the final 8 for at least 95% of questions (hit@8 ≥ 0.95), and every red-team check passes.

## How to run

The runner lives with the server, because it uses the server's search exactly as a lecture does:
`apps/server/scripts/eval-retrieval.ts`.

```sh
pnpm db:up
pnpm eval:retrieval                                             # the default set
pnpm eval:retrieval --set eval/sets/retrieval.adr-property.draft.json
pnpm eval:retrieval --only r-06                                 # one question
pnpm eval:retrieval --no-expand                                 # without query rewriting
```

It runs each question as the seeded Teacher A (row-level security applies), with and without the reranker, and records the run in the `eval_runs` table. It needs the Voyage key (and the Claude key unless `--no-expand`).

## Planned, not built yet

From LLD §16: `gold` (law questions with answers and source paragraphs, written by the named law experts; gate: no fake or wrong citation), `redteam` (a full set: non-existent cases, repealed sections, IPC asked as BNS, injected documents), `planted` (claim–paragraph pairs with planted errors; gate: all caught, at most 10% false flags) and `research` (10 research topics).
