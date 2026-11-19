# Accuracy exams (LLD §16, §17.5)

Sets, stored as `eval_items` rows and as fixture JSON here:
- `gold/`: law questions with answers and source paragraphs (30 at launch, 200 by week 8). Gate: 0 fake or wrong citations.
- `redteam/`: non-existent cases, repealed sections, IPC asked as BNS, and injection documents. Gate: "Not found", a correction, or no outgoing request.
- `planted/`: claim–paragraph pairs with planted errors (format in LLD §16.2). Gate: 100% caught; ≤ 10% false flags.
- `retrieval/`: the gold paragraph must be in the final top 8 (hit@8 ≥ 0.95).
- `research/`: 10 research topics.

The runner (`ragas-ts/`) and the first fixtures land on Days 2–5. Gold items are written by the named law experts.
