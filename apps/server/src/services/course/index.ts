/**
 * Course series on the server (HLD F8): reading a course's plan and memory, the judgments a lecture teaches from,
 * and `learn.summary`, which writes course memory when a lecture is marked taught (COURSE-7). Every query runs
 * inside the teacher's own transaction (RLS), as the API or as a worker job acting for her.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  exampleOnSlides,
  termsOnSlides,
  type CourseCase,
  type CourseUnit,
  type SeriesUnit,
  type UnitMemory,
} from '@nyaai/legal';
import { PROMPTS, fence } from '@nyaai/prompts';
import { LearnSummary } from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import type { UsageSink } from '../usage.ts';

interface UnitRow {
  id: string;
  position: number;
  title: string;
  status: CourseUnit['status'];
  taught_on: string | null;
  prerequisites: string[];
  memory: UnitMemory | null;
  lecture_id: string | null;
}

export async function loadUnits(
  c: pg.PoolClient,
  courseId: string,
): Promise<(CourseUnit & { lectureId: string | null })[]> {
  const rows = (
    await c.query<UnitRow>(
      `select id, position, title, status, to_char(taught_on, 'YYYY-MM-DD') taught_on, prerequisites, memory, lecture_id
         from course_units where course_id = $1 order by position`,
      [courseId],
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    position: r.position,
    title: r.title,
    status: r.status,
    taughtOn: r.taught_on,
    prerequisites: r.prerequisites ?? [],
    memory: r.memory ?? {},
    lectureId: r.lecture_id,
  }));
}

/**
 * The judgments each lecture teaches from: cited on a line that was not removed, outside its recap and bridge (a
 * recap naming last week's case is not a repeat).
 */
export async function lectureCases(c: pg.PoolClient, lectureIds: string[]): Promise<Map<string, CourseCase[]>> {
  const out = new Map<string, CourseCase[]>();
  if (!lectureIds.length) return out;
  const rows = (
    await c.query<{ lecture_id: string; source_id: string; title: string }>(
      `select distinct ci.lecture_id, s.id source_id, s.title
         from citations ci join sources s on s.id = ci.source_id join lectures l on l.id = ci.lecture_id
        where ci.lecture_id = any($1::uuid[]) and s.type = 'judgment' and ci.check_status <> 'removed'
          and coalesce(l.plan->'parts'->ci.part_index->>'kind', 'content') not in ('recap', 'bridge')
        order by ci.lecture_id, title`,
      [lectureIds],
    )
  ).rows;
  for (const r of rows)
    out.set(r.lecture_id, [...(out.get(r.lecture_id) ?? []), { sourceId: r.source_id, name: r.title }]);
  return out;
}

/** Units with what their current lecture teaches, for the series checks. */
export async function seriesUnits(
  c: pg.PoolClient,
  courseId: string,
): Promise<(SeriesUnit & { lectureId: string | null })[]> {
  const units = await loadUnits(c, courseId);
  const cases = await lectureCases(
    c,
    units.map((u) => u.lectureId).filter((x): x is string => !!x),
  );
  return units.map((u) => ({
    ...u,
    lectureCases: u.lectureId ? (cases.get(u.lectureId) ?? []) : [],
    hasLecture: !!u.lectureId,
  }));
}

/** Slide text of a lecture as students saw it: titles and lines, in order (speaker notes are hers, not the class's). */
export async function slideText(c: pg.PoolClient, lectureId: string): Promise<string> {
  const rows = (
    await c.query<{ title: string; body: { content?: { content?: { text?: string }[] }[] } }>(
      'select title, body from slides where lecture_id = $1 order by position',
      [lectureId],
    )
  ).rows;
  return rows
    .map((s) =>
      [
        `# ${s.title}`,
        ...(s.body.content ?? []).map((n) => `- ${(n.content ?? []).map((t) => t.text ?? '').join('')}`),
      ].join('\n'),
    )
    .join('\n\n');
}

export interface LearnJob {
  lectureId: string;
  ownerId: string;
  collegeId: string;
}

export type TenantTx = <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>;

/**
 * learn.summary (LLD §5, §9): course memory from a taught lecture. Terms and the running example are kept only if
 * they are on the slides; cases come from the lecture's citations, not from the summariser. Written only while the
 * lecture is still marked taught (she may have undone it while the job waited).
 */
export async function summariseTaught(
  job: LearnJob,
  deps: { tenant: TenantTx; gateway: Gateway; usage: UsageSink },
): Promise<UnitMemory | null> {
  const loaded = await deps.tenant(async (c) => {
    const l = (
      await c.query<{ unit_id: string | null; status: string; topic: string }>(
        'select unit_id, status, topic from lectures where id = $1',
        [job.lectureId],
      )
    ).rows[0];
    if (!l || l.status !== 'taught' || !l.unit_id) return null;
    const text = await slideText(c, job.lectureId);
    const cases = (await lectureCases(c, [job.lectureId])).get(job.lectureId) ?? [];
    return { unitId: l.unit_id, topic: l.topic, text, cases };
  });
  if (!loaded || !loaded.text.trim()) return null;

  const boundary = randomBytes(6).toString('hex');
  const task = [
    `LECTURE: ${loaded.topic}`,
    fence('slides of the taught lecture', loaded.text.slice(0, 60_000), boundary),
  ].join('\n\n');
  const data = (await deps.gateway.run({ prompt: PROMPTS['learn.summary'], schema: LearnSummary, task }, deps.usage))
    .data;
  const memory: UnitMemory = {
    summary: data.summary.trim(),
    terms: termsOnSlides(data.terms, loaded.text),
    cases: loaded.cases,
    runningExample: exampleOnSlides(data.runningExample, loaded.text),
    openThreads: data.openThreads.map((t) => t.trim()).filter(Boolean),
    lectureId: job.lectureId,
    updatedAt: new Date().toISOString(),
  };
  const saved = await deps.tenant(
    async (c) =>
      (
        await c.query(
          `update course_units u set memory = $3
           from lectures l where u.id = $2 and l.id = $1 and l.status = 'taught' and l.unit_id = u.id and u.status = 'taught'`,
          [job.lectureId, loaded.unitId, memory],
        )
      ).rowCount,
  );
  return saved ? memory : null;
}
