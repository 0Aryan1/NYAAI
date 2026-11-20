/**
 * `build.lecture` (LLD §5.2): load inputs → budget gate → plan (Sonnet) → parts in parallel (retrieve, write, ten
 * checks, repair, save) → finalise (coverage, counts, cost) → ready. Progress goes out as live events.
 *
 * Resumable instead of a BullMQ flow (decision 2026-11-20, docs/memory.md): the plan and every finished part are
 * saved as they complete (`lectures.plan`, `parts_done`), so a retried job skips them and a failed part reruns alone.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { withTenant } from '@nyaai/db';
import type { MappingRow } from '@nyaai/checker-rules';
import { PROMPTS } from '@nyaai/prompts';
import { LecturePlan, type LiveEvent } from '@nyaai/shared';
import { publishEvent } from '../events.ts';
import type { Gateway } from '../llm-gateway/index.ts';
import type { GapLookup, TenantRunner } from '../lookup/index.ts';
import { conceptHints, type SearchDeps } from '../search/index.ts';
import { usageSink, type UsageSink } from '../usage.ts';
import type { Voyage } from '../voyage/index.ts';
import { runPart, type PartContext, type PartOutput } from './part.ts';
import { finaliseLecture, savePart, type FinalCounts } from './save.ts';

export interface BuildDeps {
  /** nyaai_worker pool; every query runs under the teacher's identity. */
  worker: pg.Pool;
  gateway: Gateway;
  voyageFor: (usage: UsageSink) => Voyage;
  lookup: GapLookup | null;
  publisher: Redis | null;
  minScore: number;
  /** Parts written at the same time (LLD §5: 6 parts per worker across builds). */
  partConcurrency?: number;
}

export interface BuildJob {
  lectureId: string;
  ownerId: string;
  collegeId: string;
}

export class BuildError extends Error {
  constructor(
    readonly code: 'BUDGET_EXHAUSTED' | 'NOT_FOUND' | 'NO_GATEWAY',
    message: string,
  ) {
    super(message);
    this.name = 'BuildError';
  }
}

interface LectureRow {
  topic: string;
  length_min: number;
  level: string;
  style_key: string;
  course_id: string | null;
  plan: (LecturePlan & { notFound?: { partIndex: number; question: string }[]; partLeftOut?: Record<string, { item: string; reason: string }[]> }) | null;
  parts_done: number[];
  must_include_text: string | null;
  anything_special: string | null;
  filters: { jurisdiction?: string; asOn?: string };
  concept_id: string | null;
  style: Record<string, string>;
  writing_guide: string | null;
  teaching_language: string;
  budget: string;
  spent: string | null;
}

const STYLE_WORDS: Record<string, Record<string, string>> = {
  density: { light: 'a few key points per slide', balanced: 'balanced slides', dense: 'detailed slides' },
  case_first: { rule_first: 'state the rule first, then the cases', case_first: 'open with the case story, then the rule' },
  structure: { irac: 'issue, rule, application, conclusion', story: 'tell it as a story', questions: 'lead with questions to the class' },
  language_mix: { english: 'English only', english_hindi_terms: 'English, with Hindi terms where students use them', bilingual: 'English and Hindi' },
  example_kind: { indian_cases: 'Indian case examples', everyday: 'everyday examples', hypotheticals: 'hypotheticals' },
};
const STYLE_KEY: Record<string, string> = {
  usual: 'her usual teaching style',
  exam: 'exam revision: crisp rules, conditions, exceptions and leading cases, with likely exam questions',
  discussion: 'a discussion class: questions to the class, case stories, fewer bullet points',
};

export function teacherBlock(row: Pick<LectureRow, 'style' | 'writing_guide' | 'teaching_language' | 'style_key' | 'level'>): string {
  const style = Object.entries(row.style)
    .map(([k, v]) => STYLE_WORDS[k]?.[v])
    .filter(Boolean);
  return [
    'TEACHER',
    `This lecture: ${STYLE_KEY[row.style_key] ?? STYLE_KEY.usual}; level ${row.level}.`,
    style.length ? `Her style: ${style.join('; ')}.` : 'Her style: not set yet; write clear, balanced slides.',
    row.writing_guide ? `Her writing guide: ${row.writing_guide}` : '',
    `Teaching language: ${row.teaching_language}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Runs `fn` for each item with at most `limit` at once; the first failure rejects after the others settle. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const errors: unknown[] = [];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        try {
          await fn(next);
        } catch (err) {
          errors.push(err);
        }
      }
    }),
  );
  if (errors.length) throw errors[0];
}

export async function buildLecture(job: BuildJob, deps: BuildDeps): Promise<FinalCounts> {
  const who = { userId: job.ownerId, collegeId: job.collegeId, role: 'teacher' as const };
  const tenant: TenantRunner = (fn) => withTenant(deps.worker, who, fn);
  const traceId = randomUUID();
  const emit = async (e: LiveEvent) => {
    if (deps.publisher) await publishEvent(deps.publisher, job.ownerId, e);
  };
  // Every AI and search cost of this build is logged inside her own transaction, tagged with the lecture.
  const usage: UsageSink = (row) => tenant((c) => usageSink(c, { collegeId: job.collegeId, ownerId: job.ownerId })({ ...row, lectureId: job.lectureId, traceId }));

  const row = await tenant(async (c) => {
    const r = (
      await c.query<LectureRow>(
        `select l.topic, l.length_min, l.level, l.style_key, l.course_id, l.plan, l.parts_done,
                i.must_include_text, i.anything_special, i.filters, i.ambiguity_choice as concept_id,
                p.style, p.writing_guide, p.teaching_language, p.monthly_budget_micro_usd::text as budget,
                (select sum(cost_micro_usd)::text from usage u where u.owner_id = l.owner_id and u.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as spent
           from lectures l join lecture_inputs i on i.lecture_id = l.id join teacher_profiles p on p.owner_id = l.owner_id
          where l.id = $1`,
        [job.lectureId],
      )
    ).rows[0];
    if (!r) throw new BuildError('NOT_FOUND', 'lecture not found');
    // Budget gate (LLD §5.1): refused before any AI call; a build already past planning finishes.
    if (!r.plan && Number(r.spent ?? 0) >= Number(r.budget)) throw new BuildError('BUDGET_EXHAUSTED', 'monthly limit reached');
    await c.query("update lectures set status = 'building', error_code = null where id = $1", [job.lectureId]);
    return r;
  });

  await emit({ type: 'build.step', lectureId: job.lectureId, step: 'sources' });
  const { concept, mappings } = await tenant(async (c) => {
    const concept = row.concept_id ? await conceptHints(c, row.concept_id) : null;
    const mappings = (
      await c.query<{ old_act: string; new_act: string; relation: MappingRow['relation']; old: string[] | null; new: string[] | null; signed: boolean }>(
        `select m.old_act, m.new_act, m.relation, m.reviewed_at is not null as signed,
                array_agg(i.section) filter (where i.side = 'old') as old, array_agg(i.section) filter (where i.side = 'new') as new
           from law_mappings m left join law_mapping_items i on i.mapping_id = m.id group by m.id`,
      )
    ).rows.map((m) => ({ oldAct: m.old_act, newAct: m.new_act, relation: m.relation, oldSections: m.old ?? [], newSections: m.new ?? [], signed: m.signed }));
    return { concept, mappings };
  });

  // Plan (kept across retries).
  await emit({ type: 'build.step', lectureId: job.lectureId, step: 'planning' });
  let plan = row.plan;
  if (!plan) {
    const task = [
      `TOPIC: ${row.topic}`,
      `CLASS LENGTH: ${row.length_min} minutes`,
      `LEVEL: ${row.level}`,
      `IN A COURSE: ${row.course_id ? 'yes' : 'no (one-off lecture)'}`,
      concept?.sections?.length ? `KEY SECTIONS FOR THIS TOPIC (from the library): ${concept.sections.join('; ')}` : '',
      concept?.cases?.length ? `LEADING CASES FOR THIS TOPIC (from the library): ${concept.cases.join('; ')}` : '',
      row.must_include_text ? `MUST-INCLUDE EXAMPLE (the teacher's own): ${row.must_include_text}` : '',
      row.anything_special ? `ANYTHING SPECIAL (the teacher's request): ${row.anything_special}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const teacher = teacherBlock(row);
    plan = (await deps.gateway.run({ prompt: PROMPTS['planner.lecture'], schema: LecturePlan, context: [teacher], task, traceId }, usage)).data;
    const p = plan;
    await tenant((c) => c.query('update lectures set plan = $2, prompt_versions = $3 where id = $1', [job.lectureId, p, promptVersions()]));
  }
  await emit({ type: 'build.outline', lectureId: job.lectureId });

  // Parts, in parallel, each saved as it finishes.
  const ctx: PartContext = {
    topic: row.topic,
    level: row.level,
    filters: row.filters ?? {},
    teacherBlock: teacherBlock(row),
    mustIncludeText: row.must_include_text,
    mappings,
  };
  const searchDeps = (c: pg.PoolClient): SearchDeps => {
    const u = usageSink(c, { collegeId: job.collegeId, ownerId: job.ownerId });
    const tagged: UsageSink = (r) => u({ ...r, lectureId: job.lectureId, traceId });
    return { voyage: deps.voyageFor(tagged), gateway: deps.gateway, usage: tagged, minScore: deps.minScore };
  };
  const todo = plan.parts.map((p, i) => ({ p, i })).filter(({ i }) => !row.parts_done.includes(i));
  await emit({ type: 'build.step', lectureId: job.lectureId, step: 'writing', partsTotal: plan.parts.length });
  const outputs: PartOutput[] = [];
  await pool(todo, deps.partConcurrency ?? 3, async ({ p, i }) => {
    const out = await runPart(i, p, ctx, { tenant, searchDeps, lookup: deps.lookup, gateway: deps.gateway, usage, traceId });
    await tenant(async (c) => {
      await savePart(c, job.lectureId, { ownerId: job.ownerId, collegeId: job.collegeId }, out);
      await c.query(
        `update lectures set parts_done = array(select distinct p from unnest(parts_done || $2::smallint) p order by p),
                plan = jsonb_set(jsonb_set(coalesce(plan, '{}'), '{notFound}', coalesce(plan->'notFound', '[]') || $3::jsonb),
                                 array['partLeftOut', $2::text], $4::jsonb)
          where id = $1`,
        [job.lectureId, i, JSON.stringify(out.notFound.map((q) => ({ partIndex: i, question: q }))), JSON.stringify(out.leftOut)],
      );
    });
    outputs.push(out);
    await emit({ type: 'build.part_ready', lectureId: job.lectureId, partIndex: i });
  });

  // Finalise: coverage and counts across all parts.
  await emit({ type: 'build.step', lectureId: job.lectureId, step: 'checking' });
  const finalPlan = await tenant(async (c) => (await c.query<{ plan: LectureRow['plan'] }>('select plan from lectures where id = $1', [job.lectureId])).rows[0]!.plan);
  const leftOut = [...(finalPlan?.leftOut ?? []), ...Object.values(finalPlan?.partLeftOut ?? {}).flat()];
  const counts = await tenant((c) => finaliseLecture(c, job.lectureId, { ownerId: job.ownerId, collegeId: job.collegeId }, { conceptId: row.concept_id, leftOut }));
  await emit({ type: 'build.done', lectureId: job.lectureId });
  return counts;
}

/** Prompt versions this build used (stored on the lecture; each citation's checks carry their own). */
function promptVersions() {
  return Object.fromEntries((['planner.lecture', 'writer.part', 'writer.repair', 'checker.support', 'checker.second'] as const).map((id) => [id, PROMPTS[id].version]));
}

/** Marks the lecture failed with a plain error code and tells her stream (called on the last attempt). */
export async function markFailed(job: BuildJob, deps: Pick<BuildDeps, 'worker' | 'publisher'>, code: string): Promise<void> {
  await withTenant(deps.worker, { userId: job.ownerId, collegeId: job.collegeId, role: 'teacher' }, (c) =>
    c.query("update lectures set status = 'failed', error_code = $2 where id = $1", [job.lectureId, code]),
  );
  if (deps.publisher) await publishEvent(deps.publisher, job.ownerId, { type: 'build.failed', lectureId: job.lectureId, errorCode: code });
}
