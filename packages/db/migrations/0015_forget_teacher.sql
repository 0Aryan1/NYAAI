-- 0015: "Delete my data" (BRD NFR-8, HLD §8 DPDP Act, 2023; decision 2026-11-25 in docs/memory.md).
--
-- forget_teacher(p_user) removes everything about one teacher, in one transaction: lectures, slides, citations,
-- coverage, courses and their memory, her uploads and private notes (sources, chunks, search vectors), examples,
-- edit events, style changes, consents, reports, AI usage logs, job logs, product events, notifications, her library
-- gap asks, her profile and her invite. Her user row is kept only as an anonymous, removed shell ("Removed teacher",
-- no email, no Google id), so library records an editor signed (case status, links) still point somewhere.
--
-- Questions she asked that the library could not answer stay as library questions, without her name (the asker
-- link is removed): they are about the law, not about her, and some already brought sources into the library.
--
-- Security definer (owner), so it reaches every row whatever the row policies, but it runs only for the teacher the
-- caller is acting for (app.user_id): the worker's `ops.delete_user_data` job, started by her own request. Files in
-- storage are removed by the job after this commits. Counts go to deletion_log.

create function forget_teacher(p_user uuid) returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- Lectures before course units (a lecture points at its unit); the rest has no order.
  foreach t in array array[
    'citations', 'coverage_items', 'slide_versions', 'slides', 'coach_suggestions', 'feedback', 'edit_events',
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

revoke all on function forget_teacher(uuid) from public;
grant execute on function forget_teacher(uuid) to nyaai_worker;
