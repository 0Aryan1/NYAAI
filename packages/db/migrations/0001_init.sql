-- 0001: full schema (LLD §3.1–3.7). 41 tables, enums, helper functions, indexes and row-level security.
-- Applied by nyaai_owner. Runtime roles get CRUD through default privileges (infra/postgres/init/00-roles.sql)
-- and are then limited by the policies at the end of this file.

------------------------------------------------------------------------------------------------------------
-- 3.1 Enums and identity helpers
------------------------------------------------------------------------------------------------------------
create type user_role        as enum ('teacher','admin','library_editor');
create type visibility       as enum ('private','shared');
create type source_type      as enum ('act','rule','constitution','judgment','notification','teacher_note','teacher_slides','reading','news','web');
create type source_origin    as enum ('india_code','egazette','court_site','indian_kanoon','perplexity','upload','admin');
create type lib_status       as enum ('processing','provisional','live','needs_review','retired');
create type law_status       as enum ('in_force','amended','repealed','not_applicable');
create type opinion_type     as enum ('majority','concurring','dissent','separate_no_majority','unknown');
create type para_role        as enum ('facts','arguments','lower_court_summary','discussion','holding','headnote','unknown');
create type treatment        as enum ('overruled','reversed','doubted','distinguished','followed');
create type lecture_status   as enum ('draft','building','ready','taught','failed');
create type check_status     as enum ('supported','your_example','verified_by_you','open','removed');
create type flag_kind        as enum ('yellow','grey','coverage');
create type risk_level       as enum ('normal','high');
create type mapping_relation as enum ('same','renumbered','merged','split','substantively_changed','no_direct_equivalent');
create type review_kind      as enum ('wrong_fact','provisional_source','case_status','mapping_row','share','role_sample');
create type review_state     as enum ('open','in_progress','resolved','rejected');

-- Set by the tenant middleware inside every transaction: SET LOCAL via set_config(..., true).
create function app_user()    returns uuid language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app_college() returns uuid language sql stable as $$ select nullif(current_setting('app.college_id', true), '')::uuid $$;
create function app_role()    returns text language sql stable as $$ select coalesce(current_setting('app.role', true), '') $$;

------------------------------------------------------------------------------------------------------------
-- 3.2 People, consent and courses
------------------------------------------------------------------------------------------------------------
create table colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text unique not null,
  is_global boolean not null default false          -- one GLOBAL row owns the shared library
);
create unique index colleges_one_global on colleges (is_global) where is_global;

create table users (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null references colleges(id),
  email citext unique not null, name text not null, google_sub text unique,
  role user_role not null default 'teacher',
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(), last_seen_at timestamptz
);

create table invite_allowlist (
  id uuid primary key default gen_random_uuid(), college_id uuid not null references colleges(id),
  email citext not null, role user_role not null default 'teacher',
  invited_by uuid references users(id), created_at timestamptz default now(), accepted_at timestamptz,
  unique (college_id, email)
);

create table consents (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null references users(id),
  version text not null, processors jsonb not null,  -- list shown on screen: name, purpose, data sent, region
  accepted_at timestamptz not null default now(), withdrawn_at timestamptz
);

create table templates (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid references users(id),  -- null = ready CNLU template
  name text not null, kind text not null check (kind in ('own','derived','ready')),
  storage_key text not null, layout_map jsonb not null,  -- our layout name -> her slide layout + placeholder ids
  approved_at timestamptz
);

create table teacher_profiles (
  owner_id uuid primary key references users(id) on delete cascade, college_id uuid not null,
  department text,                          -- NYAAI addition: ACC-3 asks for it; LLD §3.2 has no column
  subjects text[] not null default '{}', teaching_language text not null default 'en',
  style jsonb not null default '{}',        -- density, case_first, structure, language_mix, example_kind
  writing_guide text,                        -- <= 200 words, editable in My Style (HLD 4.1 ACC-5)
  sample_slide_refs jsonb not null default '[]',
  template_id uuid references templates(id),
  switches jsonb not null default '{}',
  setup_step smallint not null default 1, setup_done_at timestamptz,
  monthly_budget_micro_usd bigint not null default 12000000,   -- US$12 (BRD Section 9)
  updated_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null references users(id),
  name text not null, semester text, class_count smallint, jurisdiction text not null default 'IN',
  created_at timestamptz not null default now(), archived_at timestamptz
);

create table course_units (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,
  course_id uuid not null references courses(id) on delete cascade,
  position int not null, title text not null,
  prerequisites uuid[] not null default '{}', concept_ids uuid[] not null default '{}',
  status text not null default 'planned' check (status in ('planned','taught','skipped')),
  taught_on date, lecture_id uuid,
  memory jsonb not null default '{}',   -- summary, terms[], cases[], running_example, open_threads[]
  unique (course_id, position) deferrable initially deferred   -- reorder in one transaction
);

------------------------------------------------------------------------------------------------------------
-- 3.3 Lectures, slides and evidence
------------------------------------------------------------------------------------------------------------
create table lectures (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null references users(id),
  course_id uuid references courses(id), unit_id uuid references course_units(id),   -- both null = one-off
  topic text not null, length_min smallint not null, level text not null, style_key text not null,
  status lecture_status not null default 'draft',
  plan jsonb,                       -- parts: title, minutes, questions, must_include_part
  prompt_versions jsonb not null default '{}',
  yellow_open int not null default 0, grey_open int not null default 0, coverage_open int not null default 0,
  coverage_score numeric(4,3), cost_micro_usd bigint not null default 0,
  version int not null default 1,   -- optimistic locking for Studio saves
  created_at timestamptz not null default now(), ready_at timestamptz, taught_on date
);

create table lecture_inputs (
  lecture_id uuid primary key references lectures(id) on delete cascade, college_id uuid not null, owner_id uuid not null,
  must_include_text text, example_id uuid,
  anything_special text check (char_length(anything_special) <= 500),
  filters jsonb not null default '{}',     -- jurisdiction, as_on date, courts, comparative
  ambiguity_choice uuid                    -- chosen legal_concepts.id (HOME-9)
);

create table slides (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,
  lecture_id uuid not null references lectures(id) on delete cascade,
  position int not null, part_index smallint not null, layout text not null,
  title text not null, body jsonb not null, notes jsonb not null,   -- Tiptap JSON; every line node carries a stable line_key
  current_version int not null default 1
);

create table slide_versions (
  id uuid primary key default gen_random_uuid(), slide_id uuid not null references slides(id) on delete cascade,
  college_id uuid not null, owner_id uuid not null,
  version int not null, title text not null, body jsonb not null, notes jsonb not null,
  reason text not null check (reason in ('build','edit','rewrite','add_example','coach','restore','remove_unverified')),
  created_by uuid not null, created_at timestamptz not null default now(),
  unique (slide_id, version)
);

create table citations (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,
  lecture_id uuid references lectures(id) on delete cascade, research_run_id uuid, slide_id uuid, line_key text not null,
  claim_text text not null,
  claim_type text not null check (claim_type in ('rule','holding','date','punishment','time_limit','mapping','quote','fact','example','news_report')),
  risk risk_level not null default 'normal',
  source_id uuid, chunk_id uuid,                 -- chunk may later expire (Indian Kanoon); span below never does
  span_text text not null, span_start int, span_end int,   -- exact supporting words, kept permanently (HLD D25)
  check_status check_status not null, checks jsonb not null,  -- one entry per check: name, result, detail, model, prompt_version
  flag_kind flag_kind, flag_reason text,
  verified_by uuid, verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table coverage_items (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,
  lecture_id uuid not null references lectures(id) on delete cascade,
  section_key text not null,                     -- e.g. 'ICA-1872:s56' or 'CONST:a19'
  item_kind text not null check (item_kind in ('proviso','exception','explanation','illustration','clause','leading_case')),
  item_ref uuid not null,                        -- chunk id or source id
  state text not null check (state in ('covered','missing','left_out_by_teacher')),
  covered_by uuid references citations(id), ticked_by uuid, ticked_at timestamptz
);

------------------------------------------------------------------------------------------------------------
-- 3.4 Research, library and law data
------------------------------------------------------------------------------------------------------------
create table research_runs (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,
  question text not null, scope jsonb not null, mode text not null check (mode in ('quick','thorough')),
  status text not null default 'planning' check (status in ('planning','awaiting_edit','gathering','writing','checking','ready','failed')),
  brief jsonb, yellow_open int not null default 0, grey_open int not null default 0,
  cost_micro_usd bigint not null default 0, created_at timestamptz not null default now(), finished_at timestamptz
);
create table research_questions (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, run_id uuid not null references research_runs(id) on delete cascade, position smallint not null, text text not null, status text not null default 'pending');
create table evidence_items (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references research_runs(id) on delete cascade,
  college_id uuid not null, owner_id uuid not null, question_id uuid not null references research_questions(id) on delete cascade,
  source_id uuid not null, chunk_id uuid, span_text text not null,
  relation text not null check (relation in ('supports','limits','conflicts')),
  status_label text not null,   -- law status, or confirmed case treatment, or 'Status not verified'
  court text, decided_on date, position smallint not null
);
create table reading_list_items (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, course_id uuid, lecture_id uuid, source_id uuid not null, note text, position int not null);

create table sources (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null,              -- GLOBAL college for shared library rows
  owner_id uuid references users(id),    -- null for shared library
  visibility visibility not null, type source_type not null, origin source_origin not null,
  title text not null, citation text, court text,
  court_level text check (court_level in ('supreme_court','high_court','tribunal','district','foreign')),
  bench_size smallint, decided_on date, act_name text, act_year smallint,
  jurisdiction text not null default 'IN', language text not null default 'en',
  url text, storage_key text, content_hash text not null,
  status lib_status not null default 'processing',
  roles_sampled boolean not null default false,    -- library editor sampled paragraph roles (HLD 5.2 b)
  holding_note text,                              -- editor's note for separate opinions with no majority
  fetched_at timestamptz, expires_at timestamptz, -- Indian Kanoon cache limit (HLD D25)
  created_at timestamptz not null default now(),
  unique (origin, content_hash)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  college_id uuid not null, owner_id uuid, visibility visibility not null,
  source_id uuid not null references sources(id) on delete cascade,
  parent_id uuid references chunks(id),   -- sub-section -> section; paragraph -> judgment root
  seq int not null,
  kind text not null check (kind in ('section','subsection','article','clause','paragraph','paragraph_block','heading_block','slide','headnote')),
  header text,                            -- 'Indian Contract Act, 1872 › Chapter III › s. 56 Agreement to do impossible act'
  act_name text, act_year smallint, chapter text, section text, article text,
  para_no text, para_no_source text check (para_no_source in ('court','nyaai')), page_no int,
  opinion opinion_type, judge text, para_role para_role,
  court text, court_level text, decided_on date, jurisdiction text not null default 'IN',
  law_status law_status, valid_from date, valid_to date,
  amendments jsonb not null default '[]',  -- NYAAI addition: amending Act + w.e.f. per footnote (LLD §6.3 metadata)
  source_type source_type not null, language text not null default 'en',
  text text not null,
  tsv tsvector generated always as (to_tsvector('english', coalesce(header, '') || ' ' || text)) stored,
  embedding vector(1024), embed_model text,
  content_hash text not null, status lib_status not null default 'processing',
  created_at timestamptz not null default now(),
  unique (source_id, content_hash)
);

create table legal_concepts (
  id uuid primary key default gen_random_uuid(), college_id uuid not null,
  name text not null, aliases text[] not null default '{}', parent_id uuid references legal_concepts(id),
  subject text not null, curated_by uuid, updated_at timestamptz not null default now()
);
create table concept_links (
  concept_id uuid not null references legal_concepts(id) on delete cascade, source_id uuid not null references sources(id),
  chunk_id uuid, kind text not null check (kind in ('key_section','leading_case','related')),
  confirmed_by uuid, confirmed_at timestamptz,
  primary key (concept_id, source_id, kind)
);

create table law_mappings (
  id uuid primary key default gen_random_uuid(), old_act text not null, new_act text not null,
  relation mapping_relation not null, note text not null, source_url text not null,
  reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table law_mapping_items (   -- many-to-many: one row per section on each side
  mapping_id uuid not null references law_mappings(id) on delete cascade,
  side text not null check (side in ('old','new')), section text not null,
  primary key (mapping_id, side, section)
);

create table case_treatments (
  id uuid primary key default gen_random_uuid(),
  cited_source_id uuid not null references sources(id), citing_source_id uuid not null references sources(id),
  citing_chunk_id uuid, treatment treatment not null,
  suggested_by text not null check (suggested_by in ('ai','editor')), suggestion_model text,
  confirmed_by uuid, confirmed_at timestamptz, rejected_at timestamptz, note text
);
-- What the app shows: latest confirmed treatment per case, else 'Status not verified'.
-- security_invoker so the caller's row-level security applies to sources and case_treatments.
create view case_status_v with (security_invoker = true) as
select s.id as source_id,
       coalesce((select t.treatment::text from case_treatments t
                 where t.cited_source_id = s.id and t.confirmed_at is not null and t.rejected_at is null
                 order by t.confirmed_at desc limit 1), 'not_verified') as status
from sources s where s.type = 'judgment';

------------------------------------------------------------------------------------------------------------
-- 3.5 Teacher material, learning, quality and operations
------------------------------------------------------------------------------------------------------------
create table uploads (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, file_name text not null, mime text not null, size_bytes bigint not null, storage_key text not null, source_id uuid, status text not null default 'queued', created_at timestamptz not null default now());
create table examples (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, text text not null, tags text[] not null default '{}', used_count int not null default 0, created_at timestamptz not null default now());
create table share_requests (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, upload_id uuid, example_id uuid, status review_state not null default 'open', reviewer_id uuid, reason text, created_at timestamptz not null default now(), decided_at timestamptz);

create table edit_events (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, lecture_id uuid not null, slide_id uuid, kind text not null, before jsonb, after jsonb, tryout boolean not null default false, created_at timestamptz not null default now());
create table style_changes (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, field text not null, old_value jsonb, new_value jsonb, evidence_event_ids uuid[] not null, undone_at timestamptz, created_at timestamptz not null default now());
create table coach_suggestions (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, lecture_id uuid not null, kind text not null, text text not null, slide_draft jsonb, status text not null default 'shown' check (status in ('shown','accepted','rejected')), created_at timestamptz not null default now(), decided_at timestamptz);

create table feedback (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, lecture_id uuid not null, sounds_like_me smallint check (sounds_like_me between 1 and 5), comment text, created_at timestamptz not null default now());
create table reports (
  id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null,   -- reporter
  lecture_id uuid, citation_id uuid, chunk_id uuid,
  line_copy text not null, span_copy text not null, note text,   -- copies, so the editor never needs access to her lecture
  status review_state not null default 'open',
  outcome text check (outcome in ('fixed_chunk','fixed_label','fixed_mapping','was_correct')),
  resolved_by uuid, resolved_at timestamptz, eval_item_id uuid, created_at timestamptz not null default now()
);
create table review_queue (id uuid primary key default gen_random_uuid(), college_id uuid not null, kind review_kind not null, ref_id uuid not null, priority smallint not null default 3, state review_state not null default 'open', assignee_id uuid, due_at timestamptz, resolution jsonb, created_at timestamptz not null default now(), resolved_at timestamptz);
create table eval_items (id uuid primary key default gen_random_uuid(), set_name text not null check (set_name in ('gold','redteam','planted','research','retrieval')), question text not null, expected jsonb not null, source_refs uuid[] not null default '{}', from_report uuid, active boolean not null default true);
create table eval_runs (id uuid primary key default gen_random_uuid(), set_name text not null, git_sha text not null, prompt_versions jsonb not null, model_ids jsonb not null, results jsonb not null, passed boolean not null, created_at timestamptz not null default now());

create table jobs_log (id uuid primary key default gen_random_uuid(), college_id uuid, owner_id uuid, queue text not null, job_id text not null, kind text not null, state text not null, attempts smallint not null default 0, error_code text, trace_id text, started_at timestamptz, finished_at timestamptz);
create table usage (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid, lecture_id uuid, research_run_id uuid, provider text not null, model text, purpose text not null, prompt_id text, prompt_version text, input_tokens int, output_tokens int, cache_write_tokens int, cache_read_tokens int, tier text, escalated boolean not null default false, units int, cost_micro_usd bigint not null, trace_id text, created_at timestamptz not null default now());
create table notifications (id uuid primary key default gen_random_uuid(), college_id uuid not null, owner_id uuid not null, kind text not null, payload jsonb not null, read_at timestamptz, created_at timestamptz not null default now());
create table product_events (id bigint generated always as identity primary key, college_id uuid not null, user_id uuid, name text not null, props jsonb not null default '{}', created_at timestamptz not null default now());
create table deletion_log (id uuid primary key default gen_random_uuid(), college_id uuid not null, subject_user_id uuid not null, requested_by uuid not null, scope jsonb not null, counts jsonb, started_at timestamptz not null default now(), finished_at timestamptz);

------------------------------------------------------------------------------------------------------------
-- 3.6 Indexes
------------------------------------------------------------------------------------------------------------
create index chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index chunks_tsv_gin        on chunks using gin (tsv);
create index chunks_privacy        on chunks (college_id, visibility, owner_id, status);
create index chunks_act_section    on chunks (act_name, section);
create index chunks_court_date     on chunks (court_level, court, decided_on);
create index chunks_validity       on chunks (law_status, valid_from, valid_to);
create index chunks_parent         on chunks (parent_id);
create index chunks_source_seq     on chunks (source_id, seq);
create index sources_title_trgm    on sources using gin (title gin_trgm_ops);
create index concepts_name_trgm    on legal_concepts using gin (name gin_trgm_ops);
create index concepts_aliases      on legal_concepts using gin (aliases);
create index citations_lecture     on citations (lecture_id);
create index citations_chunk       on citations (chunk_id);       -- re-check lectures when a chunk is fixed
create index slides_lecture_pos    on slides (lecture_id, position);
create index units_course_pos      on course_units (course_id, position);
create index review_open           on review_queue (college_id, state, kind, priority);
create index usage_owner_month     on usage (owner_id, created_at);
create index events_name_time      on product_events (name, created_at);
-- Added for policy and lookup paths (not in LLD §3.6):
create index lectures_owner        on lectures (owner_id, created_at desc);
create index courses_owner         on courses (owner_id);
create index sources_privacy       on sources (college_id, visibility, owner_id, status);

------------------------------------------------------------------------------------------------------------
-- 3.7 Narrow security-definer helpers (run as nyaai_owner; search_path pinned)
------------------------------------------------------------------------------------------------------------
-- GLOBAL college id, used by library policies.
create function global_college() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from colleges where is_global
$$;

-- Sign-in lookup before the teacher's identity is set. Returns only what the session needs.
create function auth_find_user(p_email citext)
returns table (id uuid, college_id uuid, role user_role, status text, name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.college_id, u.role, u.status, u.name from users u where u.email = p_email
$$;

-- First sign-in: turn an open invite into a user (NYAAI addition; the LLD has no pre-identity insert path).
-- Returns nothing when there is no invite for this email.
create function auth_accept_invite(p_email citext, p_name text, p_google_sub text)
returns table (id uuid, college_id uuid, role user_role, status text, name text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare inv invite_allowlist%rowtype;
begin
  select * into inv from invite_allowlist a where a.email = p_email order by a.created_at limit 1;
  if not found then return; end if;
  insert into users (college_id, email, name, google_sub, role)
    values (inv.college_id, p_email, p_name, p_google_sub, inv.role)
    on conflict (email) do nothing;
  update invite_allowlist set accepted_at = coalesce(accepted_at, now()) where invite_allowlist.id = inv.id;
  insert into teacher_profiles (owner_id, college_id)
    select u.id, u.college_id from users u where u.email = p_email
    on conflict (owner_id) do nothing;
  return query select u.id, u.college_id, u.role, u.status, u.name from users u where u.email = p_email;
end $$;

-- Default privileges grant execute to every runtime role; sign-in helpers belong to the API role only.
revoke execute on function auth_find_user(citext), auth_accept_invite(citext, text, text) from public, nyaai_worker, nyaai_library;
grant  execute on function auth_find_user(citext), auth_accept_invite(citext, text, text) to nyaai_app;

-- Only an admin of the same college may change a user's role or status; nobody changes their own.
create function users_guard() returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status or new.college_id is distinct from old.college_id)
     and current_user <> 'nyaai_owner'
     and not (app_role() = 'admin' and old.college_id = app_college() and old.id <> app_user()
              and new.college_id = old.college_id) then
    raise exception 'only an admin of this college can change role or status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger users_guard before update on users for each row execute function users_guard();

------------------------------------------------------------------------------------------------------------
-- 3.7 Row-level security: ENABLE + FORCE on every table, then policies
------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- FORCE applies to the owner too; nyaai_owner is used only by migrations, seeds and the
    -- security-definer helpers above, never by the API or worker.
    execute format('create policy owner_all on %I to nyaai_owner using (true) with check (true)', t);
  end loop;
end $$;

-- Teacher-owned tables: a teacher (and a worker job acting for her) touches only her own rows.
do $$
declare t text;
begin
  foreach t in array array[
    'courses','course_units','lectures','lecture_inputs','slides','slide_versions','citations','coverage_items',
    'research_runs','research_questions','evidence_items','reading_list_items','uploads','examples',
    'share_requests','edit_events','style_changes','coach_suggestions','feedback','notifications',
    'consents','teacher_profiles'] loop
    execute format(
      'create policy own_rows on %I for all to nyaai_app, nyaai_worker
         using (college_id = app_college() and owner_id = app_user())
         with check (college_id = app_college() and owner_id = app_user())', t);
  end loop;
end $$;

-- Templates: her own, plus read-only ready templates of her college or the GLOBAL college; admins manage ready ones.
create policy templates_own on templates for all to nyaai_app, nyaai_worker
  using (owner_id is not null and college_id = app_college() and owner_id = app_user())
  with check (owner_id is not null and college_id = app_college() and owner_id = app_user());
create policy templates_ready_read on templates for select to nyaai_app, nyaai_worker
  using (owner_id is null and (college_id = app_college() or college_id = global_college()));
create policy templates_ready_admin on templates for all to nyaai_app
  using (owner_id is null and college_id = app_college() and app_role() = 'admin')
  with check (owner_id is null and college_id = app_college() and app_role() = 'admin');

-- People.
create policy colleges_read on colleges for select to nyaai_app, nyaai_worker, nyaai_library
  using (id = app_college() or is_global);
create policy admin_users on users for select to nyaai_app, nyaai_worker
  using (college_id = app_college() and app_role() in ('admin','library_editor') or id = app_user());
create policy users_self_update on users for update to nyaai_app
  using (id = app_user()) with check (id = app_user());
create policy users_admin_update on users for update to nyaai_app
  using (college_id = app_college() and app_role() = 'admin')
  with check (college_id = app_college() and app_role() = 'admin');
create policy invites_admin on invite_allowlist for all to nyaai_app
  using (college_id = app_college() and app_role() = 'admin')
  with check (college_id = app_college() and app_role() = 'admin');

-- Library (LLD §3.7): shared rows of GLOBAL or her college, plus her own private rows.
create policy chunks_read on chunks for select to nyaai_app, nyaai_worker using (
  (visibility = 'shared' and (college_id = app_college() or college_id = global_college()))
  or (visibility = 'private' and owner_id = app_user()));
create policy chunks_own_write on chunks for all to nyaai_worker
  using (visibility = 'private' and owner_id = app_user())
  with check (visibility = 'private' and owner_id = app_user());
create policy chunks_shared_write on chunks for all to nyaai_library
  using (visibility = 'shared') with check (visibility = 'shared');

create policy sources_read on sources for select to nyaai_app, nyaai_worker using (
  (visibility = 'shared' and (college_id = app_college() or college_id = global_college()))
  or (visibility = 'private' and owner_id = app_user()));
create policy sources_own_write on sources for all to nyaai_worker
  using (visibility = 'private' and owner_id = app_user())
  with check (visibility = 'private' and owner_id = app_user());
create policy sources_shared_write on sources for all to nyaai_library
  using (visibility = 'shared') with check (visibility = 'shared');
-- Admins and library editors add shared sources (POST /library/sources); ingestion then runs as nyaai_library.
create policy sources_editor_write on sources for all to nyaai_app
  using (visibility = 'shared' and app_role() in ('admin','library_editor')
         and (college_id = app_college() or college_id = global_college()))
  with check (visibility = 'shared' and app_role() in ('admin','library_editor')
              and (college_id = app_college() or college_id = global_college()));

-- Library data: everyone signed in reads; nyaai_library and library editors write.
create policy concepts_read on legal_concepts for select to nyaai_app, nyaai_worker
  using (college_id = app_college() or college_id = global_college());
create policy concepts_editor on legal_concepts for all to nyaai_app
  using (app_role() = 'library_editor' and (college_id = app_college() or college_id = global_college()))
  with check (app_role() = 'library_editor' and (college_id = app_college() or college_id = global_college()));
create policy concepts_library on legal_concepts for all to nyaai_library using (true) with check (true);
do $$
declare t text;
begin
  foreach t in array array['concept_links','law_mappings','law_mapping_items','case_treatments'] loop
    execute format('create policy lib_read on %I for select to nyaai_app, nyaai_worker using (app_user() is not null)', t);
    execute format('create policy lib_editor on %I for all to nyaai_app using (app_role() = ''library_editor'') with check (app_role() = ''library_editor'')', t);
    execute format('create policy lib_library on %I for all to nyaai_library using (true) with check (true)', t);
  end loop;
end $$;
-- Case-status suggestions are written by worker jobs (status.suggest), never confirmed by them.
create policy treatments_worker_suggest on case_treatments for insert to nyaai_worker
  with check (suggested_by = 'ai' and confirmed_by is null and confirmed_at is null);

-- Reports and review (LLD §3.7: editor works her college's queue, never lectures).
create policy reports_own_read on reports for select to nyaai_app
  using (college_id = app_college() and owner_id = app_user());
create policy reports_own_insert on reports for insert to nyaai_app
  with check (college_id = app_college() and owner_id = app_user());
create policy reports_editor on reports for all to nyaai_app
  using (college_id = app_college() and app_role() = 'library_editor')
  with check (college_id = app_college() and app_role() = 'library_editor');
create policy reports_worker on reports for all to nyaai_worker
  using (college_id = app_college()) with check (college_id = app_college());
create policy editor_queue on review_queue for all to nyaai_app
  using (college_id = app_college() and app_role() = 'library_editor')
  with check (college_id = app_college() and app_role() = 'library_editor');
create policy queue_worker on review_queue for all to nyaai_worker
  using (college_id = app_college()) with check (college_id = app_college());

-- Operations.
create policy usage_read on usage for select to nyaai_app
  using (owner_id = app_user() or (college_id = app_college() and app_role() = 'admin'));
create policy usage_worker on usage for all to nyaai_worker
  using (college_id = app_college()) with check (college_id = app_college());
create policy jobs_read on jobs_log for select to nyaai_app
  using (owner_id = app_user() or (college_id = app_college() and app_role() = 'admin'));
create policy jobs_write on jobs_log for all to nyaai_worker, nyaai_library using (true) with check (true);
create policy events_insert on product_events for insert to nyaai_app, nyaai_worker
  with check (college_id = app_college() and (user_id is null or user_id = app_user()));
create policy events_admin on product_events for select to nyaai_app
  using (college_id = app_college() and app_role() = 'admin');
create policy deletion_read on deletion_log for select to nyaai_app
  using (subject_user_id = app_user() or (college_id = app_college() and app_role() = 'admin'));
create policy deletion_worker on deletion_log for all to nyaai_worker
  using (college_id = app_college()) with check (college_id = app_college());

-- eval_items and eval_runs: no app or worker policy (deny); the eval runner uses nyaai_library.
create policy eval_items_library on eval_items for all to nyaai_library using (true) with check (true);
create policy eval_runs_library on eval_runs for all to nyaai_library using (true) with check (true);

-- Column limits that row-level security can't express: a teacher may not change her own email, Google id,
-- college or budget. Role and status changes are further limited by users_guard. Budgets change only through
-- an admin path (week 1: an admin-only function, added with the admin screens).
revoke update on users from nyaai_app, nyaai_worker, nyaai_library;
grant  update (name, last_seen_at, role, status) on users to nyaai_app;
revoke insert, update on teacher_profiles from nyaai_app, nyaai_worker, nyaai_library;  -- created by auth_accept_invite
grant  update (department, subjects, teaching_language, style, writing_guide, sample_slide_refs, template_id, switches,
               setup_step, setup_done_at, updated_at) on teacher_profiles to nyaai_app, nyaai_worker;
