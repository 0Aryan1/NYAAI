-- 0005: what the lecture build (Day 3) stores beyond LLD §3.3. Reasons in docs/memory.md (2026-11-20, Day 3).

-- Coverage items need their own words: one section can have several provisos, so (section, kind, chunk) does not
-- identify an item, and "covered" means a citation's span lies inside the item's text (LLD §8.5 step 2).
-- `left_out` rows hold the planner's and writer's "Left out of this lecture" items (free text, no chunk), which
-- only the teacher's tick clears (HLD 5.2 d).
alter table coverage_items alter column item_ref drop not null;
alter table coverage_items add column item_label text, add column item_text text, add column reason text;
alter table coverage_items drop constraint coverage_items_item_kind_check;
alter table coverage_items add constraint coverage_items_item_kind_check
  check (item_kind in ('proviso','exception','explanation','illustration','clause','leading_case','left_out'));
alter table coverage_items add constraint coverage_items_ref_needed check (item_kind = 'left_out' or item_ref is not null);

-- The source chip a citation shows ("S3 · s. 56 ICA") and the part it belongs to, so a part can be rebuilt on its
-- own. The label is fixed at build time, so the Studio never needs the (possibly expired) chunk to draw a chip.
alter table citations add column tag text, add column source_label text, add column part_index smallint;

-- Why a build failed (shown as plain words with Retry), and per-part progress so a retry resumes.
alter table lectures add column error_code text, add column parts_done smallint[] not null default '{}';

create index coverage_lecture on coverage_items (lecture_id, state);
