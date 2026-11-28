/**
 * Quick Research runs (BRD RES-1, RES-3, RES-4, RES-6; HLD F6). One job per run; each stage saves before the next, so a
 * retried job resumes (the sub-questions are kept once planned).
 *
 *   1. Plan     `research.plan` (heavy) splits the question into 3–5 sub-questions.
 *   2. Gather   each sub-question, a few at a time: the library search with the gap lookup (India Code, Indian Kanoon;
 *               official websites only as leads for the editor). India only unless comparative; judgments outside the
 *               years she chose are left out (Acts always count).
 *   3. Evidence the best rows across the sub-questions (each sub-question's best first), at most eight: S1…S8.
 *   4. Write    `research.write` (heavy) writes the brief from those rows only, and says how each row relates.
 *   5. Check    every line through the same ten checks as a lecture line (Explore's `checkLines`).
 * The brief and the evidence table are saved on the run; "My research" lists her runs.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { withTenant, type TenantIdentity } from '@nyaai/db';
import { PROMPTS } from '@nyaai/prompts';
import {
  ResearchPlanReply,
  ResearchWriteReply,
  type EvidenceRow,
  type ResearchBrief,
  type ResearchScope,
} from '@nyaai/shared';
import { sourcesBlock } from '../build/checking.ts';
import { checkSourcesFor } from '../build/part.ts';
import { pool } from '../build/pool.ts';
import { checkLines } from '../explore/index.ts';
import type { Gateway } from '../llm-gateway/index.ts';
import { searchWithLookup, type GapLookup } from '../lookup/index.ts';
import type { RetrievedSource, SearchDeps } from '../search/index.ts';
import { usageSink, type UsageSink } from '../usage.ts';
import type { Voyage } from '../voyage/index.ts';

export const MAX_EVIDENCE = 8;
const PER_SUB_QUESTION = 4;
const MAX_SUB_QUESTIONS = 5;

export class ResearchError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'BUDGET_EXHAUSTED',
    message: string,
  ) {
    super(message);
    this.name = 'ResearchError';
  }
}

export interface ResearchJob {
  runId: string;
  ownerId: string;
  collegeId: string;
}

export interface ResearchDeps {
  worker: pg.Pool;
  gateway: Gateway;
  voyageFor: (usage: UsageSink) => Voyage;
  lookup: GapLookup | null;
  minScore: number;
  concurrency?: number;
}

const LAW_STATUS: Record<string, string> = {
  in_force: 'In force',
  amended: 'In force (amended)',
  repealed: 'Repealed',
  not_applicable: 'Not applicable',
};
const CASE_STATUS: Record<string, string> = {
  good_law: 'Good law (confirmed)',
  followed: 'Followed (confirmed)',
  distinguished: 'Distinguished (confirmed)',
  doubted: 'Doubted (confirmed)',
  overruled: 'Overruled (confirmed)',
  reversed: 'Reversed (confirmed)',
};

/** What the evidence table says about a source's standing: never more than an expert has confirmed (C8). */
export function statusLabel(s: Pick<RetrievedSource, 'meta' | 'status'>): string {
  if (s.meta.sourceType === 'judgment') return CASE_STATUS[s.status.case ?? ''] ?? 'Status not verified';
  return (
    LAW_STATUS[s.status.law ?? ''] ??
    (s.meta.sourceType === 'act' || s.meta.sourceType === 'constitution' ? 'In force' : 'Status not verified')
  );
}

const sameRow = (a: RetrievedSource, b: RetrievedSource) =>
  a.chunkId === b.chunkId || a.coveredChunkIds.some((id) => b.coveredChunkIds.includes(id));

/** In the years she chose (judgments only; an Act always counts). */
export function inYears(s: RetrievedSource, scope: Pick<ResearchScope, 'fromYear' | 'toYear'>): boolean {
  if (s.meta.sourceType !== 'judgment' || !s.meta.decidedOn) return true;
  const y = Number(s.meta.decidedOn.slice(0, 4));
  return (!scope.fromYear || y >= scope.fromYear) && (!scope.toYear || y <= scope.toYear);
}

/** The evidence: each sub-question's best row first, then the next best of each, until eight; no duplicates. */
export function pickEvidence(
  found: RetrievedSource[][],
  scope: Pick<ResearchScope, 'fromYear' | 'toYear'>,
): { source: RetrievedSource; subQuestion: number }[] {
  const lists = found.map((l) => l.filter((s) => inYears(s, scope)));
  const out: { source: RetrievedSource; subQuestion: number }[] = [];
  for (let rank = 0; out.length < MAX_EVIDENCE && lists.some((l) => l.length > rank); rank++) {
    for (const [i, l] of lists.entries()) {
      const s = l[rank];
      if (s && out.length < MAX_EVIDENCE && !out.some((o) => sameRow(o.source, s)))
        out.push({ source: s, subQuestion: i + 1 });
    }
  }
  return out.map((e, i) => ({ ...e, source: { ...e.source, tag: `S${i + 1}` } }));
}

export async function runResearch(
  job: ResearchJob,
  deps: ResearchDeps,
): Promise<{ yellow: number; grey: number; evidence: number }> {
  const who: TenantIdentity = { userId: job.ownerId, collegeId: job.collegeId, role: 'teacher' };
  const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
  const traceId = randomBytes(8).toString('hex');
  const usage: UsageSink = (row) =>
    tenant((c) =>
      usageSink(c, { collegeId: job.collegeId, ownerId: job.ownerId })({ ...row, researchRunId: job.runId, traceId }),
    );
  const status = (s: string) =>
    tenant((c) => c.query('update research_runs set status = $2, error_code = null where id = $1', [job.runId, s]));

  const run = await tenant(async (c) => {
    const r = (
      await c.query<{ question: string; scope: ResearchScope; status: string; budget: string; spent: string | null }>(
        `select r.question, r.scope, r.status, p.monthly_budget_micro_usd::text budget,
                (select sum(cost_micro_usd)::text from usage u where u.owner_id = r.owner_id
                   and u.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') spent
           from research_runs r join teacher_profiles p on p.owner_id = r.owner_id where r.id = $1`,
        [job.runId],
      )
    ).rows[0];
    if (!r) throw new ResearchError('NOT_FOUND', 'research run not found');
    return r;
  });
  if (run.status === 'ready') return { yellow: 0, grey: 0, evidence: 0 };
  if (Number(run.spent ?? 0) >= Number(run.budget))
    throw new ResearchError('BUDGET_EXHAUSTED', 'monthly limit reached');
  const scope = run.scope;

  // 1. Plan (kept across retries).
  await status('planning');
  let subs = await tenant(
    async (c) =>
      (
        await c.query<{ id: string; position: number; text: string }>(
          'select id, position, text from research_questions where run_id = $1 order by position',
          [job.runId],
        )
      ).rows,
  );
  if (!subs.length) {
    const scopeLine = `SCOPE: ${scope.comparative ? 'comparative (foreign courts allowed)' : 'India only'}${scope.fromYear || scope.toYear ? `; judgments from ${scope.fromYear ?? 'any year'} to ${scope.toYear ?? 'now'}` : ''}.`;
    const plan = (
      await deps.gateway.run(
        {
          prompt: PROMPTS['research.plan'],
          schema: ResearchPlanReply,
          task: `QUESTION: ${run.question}\n${scopeLine}`,
          traceId,
        },
        usage,
      )
    ).data;
    subs = await tenant(async (c) => {
      const out: { id: string; position: number; text: string }[] = [];
      for (const [i, text] of plan.subQuestions.slice(0, MAX_SUB_QUESTIONS).entries()) {
        out.push(
          (
            await c.query<{ id: string; position: number; text: string }>(
              'insert into research_questions (college_id, owner_id, run_id, position, text) values ($1, $2, $3, $4, $5) returning id, position, text',
              [job.collegeId, job.ownerId, job.runId, i + 1, text],
            )
          ).rows[0]!,
        );
      }
      return out;
    });
  }

  // 2. Gather, a few sub-questions at a time.
  await status('gathering');
  const searchDeps = (c: pg.PoolClient): SearchDeps => {
    const u = usageSink(c, { collegeId: job.collegeId, ownerId: job.ownerId });
    const tagged: UsageSink = (r) => u({ ...r, researchRunId: job.runId, traceId });
    return { voyage: deps.voyageFor(tagged), gateway: deps.gateway, usage: tagged, minScore: deps.minScore };
  };
  const found: RetrievedSource[][] = subs.map(() => []);
  await pool(
    subs.map((q, i) => ({ q, i })),
    deps.concurrency ?? 3,
    async ({ q, i }) => {
      const r = await searchWithLookup(
        tenant,
        {
          query: q.text.slice(0, 500),
          purpose: 'research',
          maxSources: PER_SUB_QUESTION,
          filters: scope.comparative ? undefined : { jurisdiction: ['IN'] },
        },
        searchDeps,
        deps.lookup,
      );
      found[i] = r.sources;
      await tenant((c) =>
        c.query('update research_questions set status = $2 where id = $1', [
          q.id,
          r.outcome === 'ok' ? 'done' : r.outcome,
        ]),
      );
    },
  );

  // 3. Evidence: at most eight rows, S1…S8.
  const picked = pickEvidence(found, scope);
  const empty: ResearchBrief = {
    shortAnswer: [],
    keyPoints: [],
    conflicts: [],
    openQuestions: [],
    notFound: [run.question],
    evidence: [],
  };
  if (!picked.length) {
    await save(empty, [], 0, 0);
    return { yellow: 0, grey: 0, evidence: 0 };
  }
  const evidence = picked.map((p) => p.source);
  const { sources, labels } = await checkSourcesFor(tenant, evidence);

  // 4. Write, from the evidence only.
  await status('writing');
  const boundary = randomBytes(6).toString('hex');
  const task = [
    `QUESTION: ${run.question}`,
    `SUB-QUESTIONS:\n${subs.map((q) => `${q.position}. ${q.text}`).join('\n')}`,
    `Evidence tags available: ${[...sources.keys()].join(', ')}.`,
  ].join('\n\n');
  const reply = (
    await deps.gateway.run(
      {
        prompt: PROMPTS['research.write'],
        schema: ResearchWriteReply,
        context: [sourcesBlock(sources, boundary).replace(/^SOURCES/, 'EVIDENCE')],
        task,
        traceId,
      },
      usage,
    )
  ).data;

  // 5. Check every line.
  await status('checking');
  const deps2 = { gateway: deps.gateway, usage };
  const shortAnswer = await checkLines(reply.shortAnswer, sources, labels, deps2);
  const keyPoints = await checkLines(reply.keyPoints, sources, labels, deps2);
  const conflicts = await checkLines(reply.conflicts, sources, labels, deps2);
  const spans = new Map<string, string[]>();
  for (const part of [shortAnswer, keyPoints, conflicts])
    for (const [t, s] of part.spans) spans.set(t, [...(spans.get(t) ?? []), ...s]);
  const relation = new Map(reply.relations.map((r) => [r.tag, r.relation]));
  const rows: EvidenceRow[] = picked.map(({ source: s, subQuestion }) => ({
    tag: s.tag,
    label: labels.get(s.tag) ?? s.tag,
    header: s.header,
    text: s.text,
    spans: spans.get(s.tag) ?? [],
    relation: relation.get(s.tag) ?? 'supports',
    statusLabel: statusLabel(s),
    caseStatus:
      s.meta.sourceType === 'judgment' ? ((s.status.case as EvidenceRow['caseStatus']) ?? 'not_verified') : null,
    court: s.meta.court ?? null,
    decidedOn: s.meta.decidedOn ?? null,
    subQuestion,
    provisional: s.provisional,
  }));
  const brief: ResearchBrief = {
    shortAnswer: shortAnswer.lines,
    keyPoints: keyPoints.lines,
    conflicts: conflicts.lines,
    openQuestions: reply.openQuestions,
    notFound: reply.notFound,
    evidence: rows,
  };
  const all = [...brief.shortAnswer, ...brief.keyPoints, ...brief.conflicts];
  const yellow = all.filter((l) => l.flag === 'yellow').length;
  const grey = all.filter((l) => l.flag === 'grey').length;
  await save(brief, picked, yellow, grey);
  return { yellow, grey, evidence: rows.length };

  async function save(b: ResearchBrief, rowsIn: typeof picked, y: number, g: number) {
    await tenant(async (c) => {
      await c.query('delete from evidence_items where run_id = $1', [job.runId]);
      for (const [i, p] of rowsIn.entries()) {
        const q = subs[p.subQuestion - 1]!;
        const row = b.evidence[i]!;
        await c.query(
          `insert into evidence_items (run_id, college_id, owner_id, question_id, source_id, chunk_id, span_text, relation, status_label, court, decided_on, position)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            job.runId,
            job.collegeId,
            job.ownerId,
            q.id,
            p.source.sourceId,
            p.source.chunkId,
            row.spans[0] ?? p.source.text.slice(0, 600),
            row.relation,
            row.statusLabel,
            row.court,
            row.decidedOn,
            i + 1,
          ],
        );
      }
      await c.query(
        `update research_runs set status = 'ready', brief = $2, yellow_open = $3, grey_open = $4, finished_at = now(), error_code = null,
                cost_micro_usd = coalesce((select sum(cost_micro_usd) from usage where research_run_id = $1), 0)
          where id = $1`,
        [job.runId, b, y, g],
      );
    });
  }
}

/** A run that cannot finish: a plain code for her screen. */
export async function markResearchFailed(job: ResearchJob, worker: pg.Pool, code: string): Promise<void> {
  await withTenant(worker, { userId: job.ownerId, collegeId: job.collegeId, role: 'teacher' }, (c) =>
    c.query("update research_runs set status = 'failed', error_code = $2 where id = $1", [job.runId, code]),
  );
}
