-- 0012: one case, one source (decision 2026-11-24 in docs/memory.md).
--
-- When an official copy replaces a Kanoon text, the Kanoon copy is now kept in source_copies (in_use = false), so its
-- link still says "we hold this case". Before a Kanoon download, the lookup checks every link the library holds, and
-- then the case itself (parties, decision date, court). A judgment that may be the same case as one already held is
-- still loaded (when unsure, never skip), and sources.maybe_same_as asks the library editor.
--
-- The editor answers on the review screen: "a different case" clears the question; "the same case" retires the new
-- copy and keeps its Kanoon link on the case that stays, so the lookup never loads it again.

alter table sources add column maybe_same_as uuid references sources(id) on delete set null;

grant insert on source_copies to nyaai_app;
create policy copies_editor on source_copies for insert to nyaai_app
  with check (app_role() = 'library_editor' and in_use = false);
