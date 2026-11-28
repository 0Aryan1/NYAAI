/**
 * Library editor review of judgments (HLD 5.2 a, b, f; LIB-1, LIB-2). The rules live in services/review.
 *   GET   /library/judgments                     every shared judgment, with what is left to check
 *   GET   /library/judgments/:id                 one judgment, its copies, status findings and paragraphs
 *   PATCH /library/paragraphs/:id                correct a paragraph's role or opinion
 *   POST  /library/judgments/:id/roles-checked   the labels are right
 *   POST  /library/judgments/:id/approve         a live lookup becomes live
 *   POST  /library/judgments/:id/same-case       answer "is this the same case as …?"
 *   POST  /library/judgments/:id/status          the expert's finding on the case's current status
 */
import express from 'express';
import { z } from 'zod';
import { ReviewJudgment, ReviewJudgmentList, SameCaseAnswer, SetCaseStatus, SetParagraphLabel } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { setParagraphLabel } from '../services/review/paragraphs.ts';
import {
  answerSameCase,
  approveJudgment,
  getJudgment,
  listJudgments,
  markRolesChecked,
  setCaseStatus,
} from '../services/review/index.ts';
import { pageFrom } from '../lib/page.ts';

const Id = z.uuid();

export function reviewRouter() {
  const r = express.Router();
  r.use(['/library/judgments', '/library/paragraphs'], requireRole('library_editor'));

  r.get('/library/judgments', async (req, res) => {
    const page = pageFrom(req.query, { default: 200, max: 500 });
    res.json(ReviewJudgmentList.parse(await req.db!((c) => listJudgments(c, page))));
  });

  r.get('/library/judgments/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const j = await req.db!((c) => getJudgment(c, id));
    if (!j) throw new AppError('NOT_FOUND', 'We could not find that judgment.');
    res.json(ReviewJudgment.parse(j));
  });

  r.patch('/library/paragraphs/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SetParagraphLabel.parse(req.body);
    const ok = await req.db!((c) => setParagraphLabel(c, id, body));
    if (!ok) throw new AppError('NOT_FOUND', 'That paragraph cannot be relabelled.');
    res.status(204).end();
  });

  r.post('/library/judgments/:id/roles-checked', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => markRolesChecked(c, id));
    res.status(204).end();
  });

  r.post('/library/judgments/:id/approve', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => approveJudgment(c, id));
    res.status(204).end();
  });

  r.post('/library/judgments/:id/same-case', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SameCaseAnswer.parse(req.body);
    await req.db!((c) => answerSameCase(c, id, body.same));
    res.status(204).end();
  });

  r.post('/library/judgments/:id/status', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SetCaseStatus.parse(req.body);
    await req.db!((c) => setCaseStatus(c, id, body));
    res.status(204).end();
  });

  return r;
}
