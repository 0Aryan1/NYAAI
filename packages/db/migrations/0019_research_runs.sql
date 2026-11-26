-- 0019: quick Research runs (BRD RES-1, RES-3, RES-4, RES-6; HLD F6; decision 2026-11-26 in docs/memory.md).
-- research_runs, research_questions and evidence_items exist since 0001. A run that fails keeps a plain error code
-- for her screen ("try again"), like a lecture build.
alter table research_runs add column error_code text;
