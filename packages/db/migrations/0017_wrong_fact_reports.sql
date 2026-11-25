-- 0017: wrong-fact reports (BRD ADM-2, LIB-1; HLD F12; decision 2026-11-26 in docs/memory.md).
--
-- A teacher reports a line from her slide. The report keeps copies of the line and of the source words it rests
-- on, so the library editor never needs to open her lecture. It joins the editor's queue (due within 24 hours).
-- The editor's outcome: the source was right ("was correct"), or she fixed the source text, a paragraph label or a
-- law mapping. Then (F12.3) every lecture line, of any teacher, that cites that source piece turns yellow again
-- ("check this line again"), and (F12.4) the case joins the gold set before the report closes. The reporter sees the
-- outcome on her line.
--
-- Both steps cross row-security lines on purpose (a teacher adds to the editor's queue; an editor re-flags other
-- teachers' lines), so each is one security-definer function that does exactly that and checks who is calling.

alter table reports
  add column slide_id uuid,
  add column line_key text,
  add column source_label text,
  add column resolution_note text;

create index reports_lecture on reports (lecture_id, line_key);

create function file_wrong_fact_report(p_lecture uuid, p_slide uuid, p_line_key text, p_citation uuid, p_chunk uuid,
                                       p_line text, p_span text, p_source_label text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from lectures where id = p_lecture and owner_id = app_user() and college_id = app_college()) then
    raise exception 'only the teacher of this lecture can report its lines' using errcode = '42501';
  end if;
  insert into reports (college_id, owner_id, lecture_id, slide_id, line_key, citation_id, chunk_id, line_copy, span_copy, source_label, note)
  values (app_college(), app_user(), p_lecture, p_slide, p_line_key, p_citation, p_chunk, p_line, coalesce(p_span, ''), p_source_label, nullif(trim(p_note), ''))
  returning id into v_id;
  -- The shared library's queue lives in the GLOBAL college: editors of any college work it.
  insert into review_queue (college_id, kind, ref_id, priority, due_at) values (global_college(), 'wrong_fact', v_id, 1, now() + interval '24 hours');
  return v_id;
end $$;
revoke all on function file_wrong_fact_report(uuid, uuid, text, uuid, uuid, text, text, text, text) from public;
grant execute on function file_wrong_fact_report(uuid, uuid, text, uuid, uuid, text, text, text, text) to nyaai_app;

create function resolve_wrong_fact_report(p_report uuid, p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r reports%rowtype;
  v_eval uuid;
  v_source uuid;
  v_flagged int := 0;
begin
  if app_role() is distinct from 'library_editor' then
    raise exception 'only a library editor can resolve a report' using errcode = '42501';
  end if;
  if p_outcome not in ('fixed_chunk', 'fixed_label', 'fixed_mapping', 'was_correct') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  update reports set status = 'resolved', outcome = p_outcome, resolution_note = nullif(trim(p_note), ''),
                     resolved_by = app_user(), resolved_at = now()
   where id = p_report and status in ('open', 'in_progress')
  returning * into r;
  if not found then
    return null;
  end if;

  -- F12.4: the case joins the gold set before the report closes.
  select source_id into v_source from chunks where id = r.chunk_id;
  insert into eval_items (set_name, question, expected, source_refs, from_report)
  values ('gold', r.line_copy,
          jsonb_build_object('outcome', p_outcome, 'span', r.span_copy, 'source', r.source_label, 'reporterNote', r.note, 'editorNote', nullif(trim(p_note), '')),
          case when v_source is null then '{}'::uuid[] else array[v_source] end, r.id)
  returning id into v_eval;
  update reports set eval_item_id = v_eval where id = r.id;

  update review_queue set state = 'resolved', resolved_at = now(), assignee_id = app_user(),
                          resolution = jsonb_build_object('outcome', p_outcome, 'note', nullif(trim(p_note), ''))
   where ref_id = r.id and kind = 'wrong_fact' and state in ('open', 'in_progress');

  -- F12.3: the source piece changed, so every line resting on it is checked again by its teacher.
  if p_outcome <> 'was_correct' and r.chunk_id is not null then
    update citations
       set check_status = 'open', flag_kind = 'yellow',
           flag_reason = 'The library corrected this source after a report; check this line again',
           verified_by = null, verified_at = null
     where chunk_id = r.chunk_id and check_status <> 'removed';
    get diagnostics v_flagged = row_count;
  end if;
  return jsonb_build_object('linesFlagged', v_flagged, 'evalItemId', v_eval);
end $$;
revoke all on function resolve_wrong_fact_report(uuid, text, text) from public;
grant execute on function resolve_wrong_fact_report(uuid, text, text) to nyaai_app;
