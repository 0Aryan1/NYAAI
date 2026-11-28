/**
 * Wrong-fact reports (BRD ADM-2, LIB-1; HLD F12; migration 0017).
 *   POST /lectures/:id/reports          she reports a line (one click, an optional note)
 *   GET  /lectures/:id/reports          her reports on this lecture, with the answers
 *   GET  /library/reports?state=        the editor's queue (copies of the line and the source words only)
 *   POST /library/reports/:id/resolve   the outcome; a fixed source re-flags every line citing it; gold set
 */
import express from 'express';
import { z } from 'zod';
import {
  LectureReports,
  ReportLine,
  ReportQueue,
  ResolveReport,
  ResolveReportResponse,
  type LineReport,
  type QueueReport,
} from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { loadStudioSlides } from '../services/studio/index.ts';

const Id = z.uuid();
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function reportsRouter() {
  const r = express.Router();

  r.post('/lectures/:id/reports', async (req, res) => {
    const lectureId = Id.parse(req.params.id);
    const body = ReportLine.parse(req.body);
    const id = await req.db!(async (c) => {
      const [slide] = await loadStudioSlides(c, lectureId, body.slideId);
      const line = slide && [...slide.lines, ...slide.notes].find((l) => l.lineKey === body.lineKey);
      if (!line) throw new AppError('NOT_FOUND', 'We could not find that line.');
      // The source words it rests on (its first source), copied with the report.
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
    });
    res.status(201).json({ id });
  });

  r.get('/lectures/:id/reports', async (req, res) => {
    const lectureId = Id.parse(req.params.id);
    const rows = await req.db!(
      async (c) =>
        (
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
        ).rows,
    );
    res.json(
      LectureReports.parse({
        reports: rows.map((x) => ({
          id: x.id,
          slideId: x.slide_id,
          lineKey: x.line_key,
          status: x.status,
          outcome: x.outcome,
          resolutionNote: x.resolution_note,
          createdAt: x.created_at.toISOString(),
        })),
      }),
    );
  });

  r.get('/library/reports', requireRole('library_editor'), async (req, res) => {
    const state = z.enum(['open', 'resolved']).catch('open').parse(req.query.state);
    const out = await req.db!(async (c) => {
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
            order by r.created_at ${state === 'open' ? 'asc' : 'desc'} limit 200`,
          [state],
        )
      ).rows;
      const open = (
        await c.query<{ n: number }>("select count(*)::int n from reports where status in ('open', 'in_progress')")
      ).rows[0]!.n;
      return { rows, open };
    });
    res.json(
      ReportQueue.parse({
        open: out.open,
        reports: out.rows.map((x) => ({
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
          dueAt: iso(x.due_at),
        })),
      }),
    );
  });

  r.post('/library/reports/:id/resolve', requireRole('library_editor'), async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = ResolveReport.parse(req.body);
    const result = await req.db!(
      async (c) =>
        (
          await c.query<{ r: { linesFlagged: number } | null }>('select resolve_wrong_fact_report($1, $2, $3) as r', [
            id,
            body.outcome,
            body.note ?? null,
          ])
        ).rows[0]!.r,
    );
    if (!result) throw new AppError('NOT_FOUND', 'That report is not open any more.');
    res.json(ResolveReportResponse.parse({ linesFlagged: result.linesFlagged }));
  });

  return r;
}
