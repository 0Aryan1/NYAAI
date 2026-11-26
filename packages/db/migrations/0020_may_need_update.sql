-- "May need update" (HLD F8.6): a later lecture of a course reads what the earlier taught lectures left in course
-- memory (recap of the last two, terms, cases, running example). When a taught lecture is edited, every later
-- lecture of the course prepared after it was taught may now repeat or contradict it: it gets a badge, which a
-- rebuild clears, or the teacher clears with "It's still right". `may_need_update_from` lists the edited lectures.
alter table lectures
  add column may_need_update_since timestamptz,
  add column may_need_update_from uuid[] not null default '{}';
