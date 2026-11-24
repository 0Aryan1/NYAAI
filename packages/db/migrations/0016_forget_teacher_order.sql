-- 0016: "Delete my data" failed for a teacher whose lecture had coverage notes: forget_teacher deleted citations
-- before coverage_items, whose covered_by points at a citation. Found by the browser journey (J1), whose teacher has
-- a built lecture; the integration test's teacher had none. Same function, coverage notes first.

create or replace function forget_teacher(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  counts jsonb := '{}';
  n int;
  t text;
  v_college uuid;
  v_email citext;
begin
  if app_user() is distinct from p_user then
    raise exception 'only the teacher herself can ask for her data to be deleted' using errcode = '42501';
  end if;
  select college_id, email into v_college, v_email from users where id = p_user;
  if v_college is null then
    return counts;
  end if;

  -- Order matters where rows point at each other: coverage notes before the citations that cover them, slide
  -- versions before slides, lectures before course units, research evidence before its questions and runs.
  foreach t in array array[
    'coverage_items', 'citations', 'slide_versions', 'slides', 'coach_suggestions', 'feedback', 'edit_events',
    'lecture_inputs', 'lectures', 'course_units', 'courses',
    'evidence_items', 'research_questions', 'research_runs', 'reading_list_items',
    'share_requests', 'uploads', 'examples', 'style_changes', 'notifications', 'templates', 'consents',
    'reports', 'usage', 'jobs_log', 'library_gap_askers', 'teacher_profiles'] loop
    execute format('delete from %I where owner_id = $1', t) using p_user;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  -- Her private notes: their search text and vectors go with the source.
  delete from chunks where owner_id = p_user and visibility = 'private';
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('chunks', n);
  delete from sources where owner_id = p_user and visibility = 'private';
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('sources', n);

  delete from product_events where user_id = p_user;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('product_events', n);
  delete from invite_allowlist where college_id = v_college and email = v_email;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('invite_allowlist', n);

  update users
     set email = 'removed-' || p_user::text || '@removed.invalid', name = 'Removed teacher', google_sub = null,
         status = 'removed', last_seen_at = null
   where id = p_user;
  return counts;
end $$;

