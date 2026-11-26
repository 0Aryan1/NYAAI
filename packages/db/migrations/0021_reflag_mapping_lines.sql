-- 0021: a changed or removed law-mapping row re-flags the lines that relied on it (HLD 5.2 g; gap noted 2026-11-27).
-- A lecture line linking an old and a new criminal-law section passed C5 because a signed row matched it. When the
-- expert changes that row (which removes the signature), takes the signature back, or removes the row, those lines
-- no longer rest on a signed row: each turns yellow for its teacher, with the reason, like a corrected source (0017).
-- Run by the `ops.mapping_changed` job as the library editor who made the change. Security definer, because the
-- lines belong to every teacher; it takes section numbers only and returns counts, so no teacher's words leave
-- Postgres. The line's sections are read with the same pattern as the C5 check (packages/checker-rules).

create function reflag_mapping_lines(p_old text[], p_new text[], p_relation mapping_relation, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lines int := 0;
  v_lectures uuid[];
begin
  if app_role() is distinct from 'library_editor' then
    raise exception 'only a library editor can re-flag mapping lines' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' or coalesce(array_length(p_old, 1), 0) = 0 then
    raise exception 'a reason and the old sections are needed' using errcode = '22023';
  end if;

  with relied as (
    select ci.id
      from citations ci
     where ci.check_status in ('supported', 'verified_by_you')
       and ci.checks @> '[{"name": "C5", "result": "pass"}]'::jsonb
  ), named as (
    select r.id,
           array(select upper(m[1]) from regexp_matches(ci.claim_text, '\m(?:s|ss|sec|secs|section|sections)\.?\s*(\d{1,4}[a-z]{0,3})\M', 'gi') m) as secs
      from relied r join citations ci on ci.id = r.id
  ), hit as (
    -- Matched as C5 matched: a section on each side, or the old section alone for "no direct equivalent".
    select n.id from named n
     where n.secs && p_old and (n.secs && p_new or p_relation = 'no_direct_equivalent')
  ), flagged as (
    update citations ci
       set check_status = 'open', flag_kind = 'yellow', flag_reason = p_reason, verified_by = null, verified_at = null,
           checks = (select jsonb_agg(case when e->>'name' = 'C5' then jsonb_build_object('name', 'C5', 'result', 'fail', 'detail', p_reason) else e end)
                       from jsonb_array_elements(ci.checks) e)
      from hit where ci.id = hit.id
    returning ci.lecture_id, ci.slide_id, ci.line_key
  )
  select count(distinct (slide_id, line_key)), array_agg(distinct lecture_id) filter (where lecture_id is not null)
    into v_lines, v_lectures from flagged;

  -- The stored counts for lists (the Studio counts live): one yellow point per line with an open claim.
  update lectures l
     set yellow_open = (select count(*) from (select 1 from citations ci where ci.lecture_id = l.id and ci.check_status <> 'removed'
                                                group by ci.slide_id, ci.line_key having bool_or(ci.check_status = 'open')) x)
   where l.id = any(coalesce(v_lectures, '{}'));

  return jsonb_build_object('linesFlagged', v_lines, 'lectures', coalesce(array_length(v_lectures, 1), 0));
end $$;
revoke all on function reflag_mapping_lines(text[], text[], mapping_relation, text) from public;
grant execute on function reflag_mapping_lines(text[], text[], mapping_relation, text) to nyaai_worker;
