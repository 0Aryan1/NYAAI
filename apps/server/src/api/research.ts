/**
 * Research mode, quick runs (BRD RES-1, RES-3, RES-4, RES-6; LLD §4 /research).
 *   POST /research        start a run (consent and budget first); 202, then poll GET /research/:id
 *   GET  /research        "My research", newest first
 *   GET  /research/:id    the run: status, sub-questions, and when ready the brief and the evidence table
 *   POST /research/:id/export  the brief as Word or PDF (RES-5)
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { Created, ExportBrief, ResearchList, ResearchRunView, StartResearch } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { RESEARCH_JOB_OPTIONS, type ResearchJobData } from '../jobs/queues.ts';
import { briefFileName, planBrief, renderDocx, renderPdf } from '../services/export/brief.ts';
import { todayInIndia } from '../lib/time.ts';
import { listRuns, loadRun, startRun } from '../services/research/index.ts';
import { recordProductEvent } from '../services/product-events/index.ts';
import { pageFrom } from '../lib/page.ts';

const Id = z.uuid();

export function researchRouter(queue: Queue<ResearchJobData> | undefined) {
  const r = express.Router();

  r.post('/research', requireConsent, async (req, res) => {
    if (!queue) throw new AppError('SERVICE_UNAVAILABLE', 'Research is not available right now. Try again later.');
    const body = StartResearch.parse(req.body);
    const who = req.identity!;
    const id = await req.db!((c) => startRun(c, who, body));
    await queue.add(
      'research.run',
      { runId: id, ownerId: who.userId, collegeId: who.collegeId },
      { ...RESEARCH_JOB_OPTIONS, jobId: `research.run-${id}` },
    );
    res.status(202).json(Created.parse({ id }));
  });

  r.get('/research', async (req, res) => {
    const page = pageFrom(req.query, { default: 100, max: 500 });
    res.json(ResearchList.parse(await req.db!((c) => listRuns(c, page))));
  });

  r.get('/research/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const run = await req.db!((c) => loadRun(c, id));
    if (!run) throw new AppError('NOT_FOUND', 'We could not find that research.');
    res.json(ResearchRunView.parse(run));
  });

  /**
   * RES-5: the brief as Word or PDF, from the brief as saved and checked (flags written in: a note on each line to
   * verify, and a closing "Please verify" list). Small, so made at once, like the .pptx.
   */
  r.post('/research/:id/export', async (req, res) => {
    const id = Id.parse(req.params.id);
    const { format } = ExportBrief.parse(req.body);
    const run = await req.db!((c) => loadRun(c, id));
    if (!run) throw new AppError('NOT_FOUND', 'We could not find that research.');
    if (run.status !== 'ready' || !run.brief) throw new AppError('VALIDATION_FAILED', 'The brief is not ready yet.');
    const today = todayInIndia();
    const plan = planBrief(run, today);
    const file = format === 'docx' ? await renderDocx(plan) : await renderPdf(plan);
    await req.db!((c) =>
      recordProductEvent(c, req.identity!, 'research.export', { runId: id, format, toVerify: plan.notes.length }),
    );
    res.setHeader(
      'content-type',
      format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
    );
    res.setHeader('content-disposition', `attachment; filename="${briefFileName(run.question, today, format)}"`);
    res.setHeader('x-lines-to-verify', String(plan.notes.length));
    res.send(file);
  });

  return r;
}
