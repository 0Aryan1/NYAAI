-- 0011: why a source was chosen (decision 2026-11-24 in docs/memory.md). Sources are now ordered by standing:
-- relevance first, then authority (court, bench, official copy, the court's own reasoning). Relevance depends on the
-- question the part asked, so it is kept with the citation; the authority reasons are facts about the source and are
-- read fresh when the Studio shows them.
alter table citations add column source_relevance numeric(4,3);
