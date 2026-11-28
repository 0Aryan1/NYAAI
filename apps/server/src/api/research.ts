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
import type pg from 'pg';
import {
  ExportBrief,
  ResearchBrief,
  ResearchList,
  ResearchRunView,
  StartResearch,
  type ResearchScope,
} from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { RESEARCH_JOB_OPTIONS, type ResearchJobData } from '../jobs/queues.ts';
import { briefFileName, planBrief, renderDocx, renderPdf } from '../services/export/brief.ts';

const Id = z.uuid();

export function researchRouter(queue: Queue<ResearchJobData> | undefined) {
  const r = express.Router();

  r.post('/research', requireConsent, async (req, res) => {
    if (!queue) throw new AppError('SERVICE_UNAVAILABLE', 'Research is not available right now. Try again later.');
    const body = StartResearch.parse(req.body);
    if (body.scope.fromYear && body.scope.toYear && body.scope.fromYear > body.scope.toYear)
      throw new AppError('VALIDATION_FAILED', 'The first year comes after the last year.');
    const who = req.identity!;
    const id = await req.db!(async (c) => {
      const b = (
        await c.query<{ budget: string; spent: string | null }>(
          `select p.monthly_budget_micro_usd::text budget,
                  (select sum(cost_micro_usd)::text from usage u where u.owner_id = p.owner_id
                     and u.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') spent
             from teacher_profiles p where p.owner_id = app_user()`,
        )
      ).rows[0];
      if (b && Number(b.spent ?? 0) >= Number(b.budget))
        throw new AppError('BUDGET_EXHAUSTED', 'Your monthly limit is reached; your administrator can raise it.');
      return (
        await c.query<{ id: string }>(
          "insert into research_runs (college_id, owner_id, question, scope, mode, status) values ($1, $2, $3, $4, 'quick', 'planning') returning id",
          [who.collegeId, who.userId, body.question, body.scope],
        )
      ).rows[0]!.id;
    });
    await queue.add(
      'research.run',
      { runId: id, ownerId: who.userId, collegeId: who.collegeId },
      { ...RESEARCH_JOB_OPTIONS, jobId: `research.run-${id}` },
    );
    res.status(202).json({ id });
  });

  r.get('/research', async (req, res) => {
    const rows = await req.db!(
      async (c) =>
        (
          await c.query<{
            id: string;
            question: string;
            status: ResearchRunView['status'];
            created_at: Date;
            yellow_open: number;
          }>(
            'select id, question, status, created_at, yellow_open from research_runs where owner_id = app_user() order by created_at desc limit 100',
          )
        ).rows,
    );
    res.json(
      ResearchList.parse({
        runs: rows.map((x) => ({
          id: x.id,
          question: x.question,
          status: x.status,
          createdAt: x.created_at.toISOString(),
          yellow: x.yellow_open,
        })),
      }),
    );
  });

  r.get('/research/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const run = await req.db!((c) => loadRun(c, id));
    if (!run) throw new AppError('NOT_FOUND', 'We could not find that research.');
    res.json(run);
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
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const plan = planBrief(run, today);
    const file = format === 'docx' ? await renderDocx(plan) : await renderPdf(plan);
    await req.db!((c) =>
      c.query("insert into product_events (college_id, user_id, name, props) values ($1, $2, 'research.export', $3)", [
        req.identity!.collegeId,
        req.identity!.userId,
        { runId: id, format, toVerify: plan.notes.length },
      ]),
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

/** The run as "My research" shows it (RLS: her own runs only). */
async function loadRun(c: pg.PoolClient, id: string): Promise<ResearchRunView | null> {
  const run = (
    await c.query<{
      id: string;
      question: string;
      scope: ResearchScope;
      status: ResearchRunView['status'];
      brief: unknown;
      yellow_open: number;
      grey_open: number;
      error_code: string | null;
      created_at: Date;
      finished_at: Date | null;
    }>(
      'select id, question, scope, status, brief, yellow_open, grey_open, error_code, created_at, finished_at from research_runs where id = $1',
      [id],
    )
  ).rows[0];
  if (!run) return null;
  const subs = (
    await c.query<{ position: number; text: string; status: string }>(
      'select position, text, status from research_questions where run_id = $1 order by position',
      [id],
    )
  ).rows;
  return ResearchRunView.parse({
    id: run.id,
    question: run.question,
    scope: run.scope,
    status: run.status,
    subQuestions: subs,
    brief: run.brief ? ResearchBrief.parse(run.brief) : null,
    counts: { yellow: run.yellow_open, grey: run.grey_open },
    errorCode: run.error_code,
    createdAt: run.created_at.toISOString(),
    finishedAt: run.finished_at?.toISOString() ?? null,
  });
}
