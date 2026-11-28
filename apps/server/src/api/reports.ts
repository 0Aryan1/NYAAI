/**
 * Wrong-fact reports (BRD ADM-2, LIB-1; HLD F12; migration 0017).
 *   POST /lectures/:id/reports          she reports a line (one click, an optional note)
 *   GET  /lectures/:id/reports          her reports on this lecture, with the answers
 *   GET  /library/reports?state=        the editor's queue (copies of the line and the source words only)
 *   POST /library/reports/:id/resolve   the outcome; a fixed source re-flags every line citing it; gold set
 */
import express from 'express';
import { z } from 'zod';
import { Created, LectureReports, ReportLine, ReportQueue, ResolveReport, ResolveReportResponse } from '@nyaai/shared';
import { requireRole } from '../middleware/auth.ts';
import { fileReport, lectureReports, reportQueue, resolveReport } from '../services/reports/index.ts';
import { pageFrom } from '../lib/page.ts';

const Id = z.uuid();

export function reportsRouter() {
  const r = express.Router();

  r.post('/lectures/:id/reports', async (req, res) => {
    const lectureId = Id.parse(req.params.id);
    const body = ReportLine.parse(req.body);
    const id = await req.db!((c) => fileReport(c, lectureId, body));
    res.status(201).json(Created.parse({ id }));
  });

  r.get('/lectures/:id/reports', async (req, res) => {
    const lectureId = Id.parse(req.params.id);
    res.json(LectureReports.parse(await req.db!((c) => lectureReports(c, lectureId))));
  });

  r.get('/library/reports', requireRole('library_editor'), async (req, res) => {
    const state = z.enum(['open', 'resolved']).catch('open').parse(req.query.state);
    const page = pageFrom(req.query, { default: 200, max: 500 });
    res.json(ReportQueue.parse(await req.db!((c) => reportQueue(c, state, page))));
  });

  r.post('/library/reports/:id/resolve', requireRole('library_editor'), async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = ResolveReport.parse(req.body);
    const linesFlagged = await req.db!((c) => resolveReport(c, id, body));
    res.json(ResolveReportResponse.parse({ linesFlagged }));
  });

  return r;
}
