-- 0004: library gaps — questions the library could not answer well (search outcome `thin` or `not_found`).
-- Each gap is written to one list per college for the library editor, with how many teachers hit it, what the
-- automatic lookup tried (India Code for Acts, Indian Kanoon for judgments) and links from allowlisted official
-- sites. The editor loads the missing official source, or closes the gap. Not in LLD §3 (decision 2026-11-20,
-- docs/memory.md): without it a "Not found" was shown once and then forgotten.

alter type review_kind add value if not exists 'library_gap';

create type gap_kind  as enum ('act', 'case', 'topic');
-- open: nothing usable found yet · looking: a lookup is running · loaded: the lookup added sources, not yet re-checked
-- answered: a search after loading came back ok · resolved / wont_fill: closed by the library editor
create type gap_state as enum ('open', 'looking', 'loaded', 'answered', 'resolved', 'wont_fill');

create table library_gaps (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id),
  question_key text not null,              -- normalised question, for counting repeats
  question text not null,                  -- the teacher's own words (never text from a document)
  kind gap_kind not null,
  act_name text, act_year smallint, case_name text,
  asks int not null default 1,             -- every time it was hit
  teachers int not null default 1,         -- distinct teachers (counted in library_gap_askers)
  state gap_state not null default 'open',
  attempts jsonb not null default '[]',    -- what each trusted source returned, newest last
  leads jsonb not null default '[]',       -- links on allowlisted official sites, for the editor only
  loaded_source_ids uuid[] not null default '{}',
  note text,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_lookup_at timestamptz,
  unique (college_id, question_key)
);
create index library_gaps_open on library_gaps (college_id, state, teachers desc, last_seen_at desc);

-- Who asked, only to count distinct teachers. The editor never sees it; "delete my data" removes it by cascade.
create table library_gap_askers (
  gap_id uuid not null references library_gaps(id) on delete cascade,
  owner_id uuid not null references users(id) on delete cascade,
  college_id uuid not null,
  first_asked_at timestamptz not null default now(),
  primary key (gap_id, owner_id)
);

alter table library_gaps enable row level security;
alter table library_gaps force row level security;
alter table library_gap_askers enable row level security;
alter table library_gap_askers force row level security;
-- As in 0001: FORCE applies to the owner too, and record_library_gap() runs as the owner.
create policy owner_all on library_gaps to nyaai_owner using (true) with check (true);
create policy owner_all on library_gap_askers to nyaai_owner using (true) with check (true);

-- Library editors and admins of the college (or of GLOBAL) work the list; ingestion (nyaai_library) runs lookups.
-- Teachers have no direct access: they record a gap only through record_library_gap(). Askers: no policy at all.
create policy gaps_editor on library_gaps for all to nyaai_app
  using ((college_id = app_college() or college_id = global_college()) and app_role() in ('library_editor', 'admin'))
  with check ((college_id = app_college() or college_id = global_college()) and app_role() in ('library_editor', 'admin'));
create policy gaps_library on library_gaps for all to nyaai_library using (true) with check (true);

-- Records one thin or not-found search for the signed-in teacher (identity from SET LOCAL), counts distinct
-- teachers, reopens a gap that was answered or resolved before, and keeps one open review item per gap whose
-- priority rises with the number of teachers (1 teacher → 3, 2–4 → 2, 5+ → 1). Returns the gap id.
create function record_library_gap(p_question text, p_key text, p_kind gap_kind, p_act text, p_year smallint, p_case text)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_college uuid := app_college();
  v_user uuid := app_user();
  v_gap uuid;
  v_teachers int;
  v_priority smallint;
begin
  if v_college is null or v_user is null then
    raise exception 'record_library_gap needs the teacher identity (SET LOCAL app.user_id and app.college_id)';
  end if;
  if length(p_question) not between 2 and 500 or length(p_key) not between 1 and 500 then
    raise exception 'record_library_gap: question must be 2–500 characters';
  end if;

  insert into library_gaps (college_id, question_key, question, kind, act_name, act_year, case_name)
  values (v_college, p_key, p_question, p_kind, p_act, p_year, p_case)
  on conflict (college_id, question_key) do update
     set asks = library_gaps.asks + 1,
         last_seen_at = now(),
         state = case when library_gaps.state in ('answered', 'resolved') then 'open'::gap_state else library_gaps.state end
  returning id into v_gap;

  insert into library_gap_askers (gap_id, owner_id, college_id) values (v_gap, v_user, v_college)
  on conflict do nothing;
  select count(*) into v_teachers from library_gap_askers where gap_id = v_gap;
  update library_gaps set teachers = v_teachers where id = v_gap;

  v_priority := case when v_teachers >= 5 then 1 when v_teachers >= 2 then 2 else 3 end;
  update review_queue set priority = least(priority, v_priority)
   where ref_id = v_gap and kind = 'library_gap' and state in ('open', 'in_progress');
  if not found then
    insert into review_queue (college_id, kind, ref_id, priority) values (v_college, 'library_gap', v_gap, v_priority);
  end if;
  return v_gap;
end $$;

revoke execute on function record_library_gap(text, text, gap_kind, text, smallint, text) from public, nyaai_library;
grant  execute on function record_library_gap(text, text, gap_kind, text, smallint, text) to nyaai_app, nyaai_worker;
