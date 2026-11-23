-- 0009: editing in the Studio (F7, STUDIO-2/4/6/7; LLD §8.6). A line's citations are never deleted when she edits or
-- removes the line: they are marked removed, with the status they had, so restoring an earlier version of the slide
-- brings back the line together with its checked sources. Reasons in docs/memory.md (2026-11-22).
alter table citations
  add column removed_at timestamptz,
  add column prev_status check_status;

create index if not exists citations_slide_line on citations (slide_id, line_key);
