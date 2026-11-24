-- 0014: sources for every planned lecture, fetched in the background after a syllabus upload (BRD DATA-3,
-- decision 2026-11-25 in docs/memory.md).
--
-- course_units.sources: what the background check found for the lecture, so the course plan can say "sources
-- ready", "few sources" or "none found yet (the library team is told)" before she prepares it.
--   { "state": "waiting" | "ok" | "thin" | "not_found" | "not_checked", "found": int, "loaded": int, "checkedAt": iso }
-- null: never checked (a course typed by hand, or a lecture added later).
alter table course_units add column sources jsonb;
