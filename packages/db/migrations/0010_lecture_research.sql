-- 0010: the research notes of a lecture build (research stage, decision 2026-11-24 in docs/memory.md).
-- Before any part is written, the build searches the library for every part at once, merges and de-duplicates what it
-- found, adds the key sections and leading cases the topic must cover, and asks for what is still missing (at most two
-- rounds). The result is saved here, so a retried build reuses it and the writers all work from one set of notes.
alter table lectures add column research jsonb;
