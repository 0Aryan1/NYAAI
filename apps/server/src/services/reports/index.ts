/**
 * Wrong-fact reports (BRD ADM-2, LIB-1; HLD F12; migration 0017). Two security-definer functions cross the row
 * security lines on purpose, and check the caller: `file_wrong_fact_report` (only the lecture's teacher; the editor
 * gets copies of the line and its source words, never the lecture) and `resolve_wrong_fact_report` (only a library
 * editor; a fixed source re-flags every line citing it, of every teacher, and the case joins the gold set).
 */
import type pg from 'pg';
import type { LectureReports, LineReport, QueueReport, ReportLine, ReportQueue, ResolveReport } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { loadStudioSlides } from '../studio/index.ts';
import { pageOf, pageSql, type Page } from '../../lib/page.ts';

/** She reports a line. The server copies the line and its first source's words from her slide. Returns the report id. */
export async function fileReport(c: pg.PoolClient, lectureId: string, body: ReportLine): Promise<string> {
  const [slide] = await loadStudioSlides(c, lectureId, body.slideId);
  const line = slide && [...slide.lines, ...slide.notes].find((l) => l.lineKey === body.lineKey);
  if (!line) throw new AppError('NOT_FOUND', 'We could not find that line.');
  const cit = line.sources[0]
    ? (
        await c.query<{ id: string; chunk_id: string | null; span_text: string; source_label: string | null }>(
          'select id, chunk_id, span_text, source_label from citations where id = $1',
          [line.sources[0].citationId],
        )
      ).rows[0]
    : undefined;
  return (
    await c.query<{ id: string }>('select file_wrong_fact_report($1, $2, $3, $4, $5, $6, $7, $8, $9) as id', [
      lectureId,
      body.slideId,
      body.lineKey,
      cit?.id ?? null,
      cit?.chunk_id ?? null,
      line.text,
      cit?.span_text ?? '',
      cit?.source_label ?? line.sources[0]?.label ?? null,
      body.note ?? null,
    ])
  ).rows[0]!.id;
}

/** Her reports on one lecture, with the library's answers. */
export async function lectureReports(c: pg.PoolClient, lectureId: string): Promise<LectureReports> {
  const rows = (
    await c.query<{
      id: string;
      slide_id: string | null;
      line_key: string | null;
      status: LineReport['status'];
      outcome: LineReport['outcome'];
      resolution_note: string | null;
      created_at: Date;
    }>(
      'select id, slide_id, line_key, status, outcome, resolution_note, created_at from reports where lecture_id = $1 and owner_id = app_user() order by created_at',
      [lectureId],
    )
  ).rows;
  return {
    reports: rows.map((x) => ({
      id: x.id,
      slideId: x.slide_id,
      lineKey: x.line_key,
      status: x.status,
      outcome: x.outcome,
      resolutionNote: x.resolution_note,
      createdAt: x.created_at.toISOString(),
    })),
  };
}

/** The editor's queue: open ones oldest first (each due within a day), or the answered ones newest first. */
export async function reportQueue(c: pg.PoolClient, state: 'open' | 'resolved', page: Page): Promise<ReportQueue> {
  const tail = pageSql(page, 2);
  const rows = (
    await c.query<{
      id: string;
      line_copy: string;
      span_copy: string;
      source_label: string | null;
      source_title: string | null;
      source_header: string | null;
      judgment_id: string | null;
      note: string | null;
      status: QueueReport['status'];
      outcome: QueueReport['outcome'];
      resolution_note: string | null;
      created_at: Date;
      due_at: Date | null;
    }>(
      `select r.id, r.line_copy, r.span_copy, r.source_label, s.title as source_title, k.header as source_header,
              case when s.type = 'judgment' then s.id end as judgment_id, r.note, r.status, r.outcome, r.resolution_note, r.created_at,
              (select q.due_at from review_queue q where q.ref_id = r.id and q.kind = 'wrong_fact' order by q.created_at desc limit 1) as due_at
         from reports r left join chunks k on k.id = r.chunk_id left join sources s on s.id = k.source_id
        where ($1 = 'open' and r.status in ('open', 'in_progress')) or ($1 = 'resolved' and r.status in ('resolved', 'rejected'))
        order by r.created_at ${state === 'open' ? 'asc' : 'desc'}, r.id${tail.sql}`,
      [state, ...tail.params],
    )
  ).rows;
  const { rows: shown, nextCursor } = pageOf(rows, page);
  const open = (
    await c.query<{ n: number }>("select count(*)::int n from reports where status in ('open', 'in_progress')")
  ).rows[0]!.n;
  return {
    open,
    nextCursor,
    reports: shown.map((x) => ({
      id: x.id,
      lineCopy: x.line_copy,
      spanCopy: x.span_copy,
      sourceLabel: x.source_label,
      sourceTitle: x.source_title,
      sourceHeader: x.source_header,
      judgmentId: x.judgment_id,
      note: x.note,
      status: x.status,
      outcome: x.outcome,
      resolutionNote: x.resolution_note,
      createdAt: x.created_at.toISOString(),
      dueAt: x.due_at?.toISOString() ?? null,
    })),
  };
}

/** The editor's answer. Returns how many lecture lines turned yellow for their teachers. */
export async function resolveReport(c: pg.PoolClient, id: string, body: ResolveReport): Promise<number> {
  const r = (
    await c.query<{ r: { linesFlagged: number } | null }>('select resolve_wrong_fact_report($1, $2, $3) as r', [
      id,
      body.outcome,
      body.note ?? null,
    ])
  ).rows[0]!.r;
  if (!r) throw new AppError('NOT_FOUND', 'That report is not open any more.');
  return r.linesFlagged;
}
