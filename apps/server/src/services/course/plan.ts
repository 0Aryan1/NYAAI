/**
 * A course and its plan of lectures (BRD COURSE-1 to COURSE-7, HLD F8). Each unit is one planned lecture and keeps
 * the memory of its taught lecture. Series checks are suggestions only: nothing changes the plan unless she asks.
 * Runs in her transaction (RLS).
 */
import type pg from 'pg';
import { seriesChecks } from '@nyaai/legal';
import {
  UnitSources,
  type CourseDetail,
  type CourseList,
  type CourseUnitView,
  type CreateCourse,
  type HomeResponse,
  type UpdateCourse,
  type UpdateUnits,
} from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { consentMessage } from '../../middleware/consent.ts';
import { hasConsent } from '../setup/index.ts';
import { loadUnits, seriesUnits } from './index.ts';

interface Who {
  userId: string;
  collegeId: string;
  role: string;
}

async function courseRow(c: pg.PoolClient, id: string) {
  const row = (
    await c.query<{ id: string; name: string; semester: string | null; class_count: number | null }>(
      'select id, name, semester, class_count from courses where id = $1 and archived_at is null',
      [id],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'We could not find that course.');
  return row;
}

/** The course plan as the Courses screen shows it: every unit, its lecture, sources found, memory, and the checks. */
export async function courseDetail(c: pg.PoolClient, id: string): Promise<CourseDetail> {
  const course = await courseRow(c, id);
  const units = await seriesUnits(c, id);
  const sources = new Map(
    (
      await c.query<{ id: string; sources: unknown }>(
        'select id, sources from course_units where course_id = $1 and sources is not null',
        [id],
      )
    ).rows.map((r) => [r.id, UnitSources.safeParse(r.sources).data ?? null]),
  );
  const lectures = new Map(
    (
      await c.query<{ id: string; status: string; topic: string; mayNeedUpdate: boolean }>(
        'select id, status, topic, may_need_update_since is not null as "mayNeedUpdate" from lectures where id = any($1::uuid[])',
        [units.map((u) => u.lectureId).filter(Boolean)],
      )
    ).rows.map((l) => [l.id, l]),
  );
  const view: CourseUnitView[] = units.map((u) => {
    const lectureId = u.lectureId;
    const m = u.memory;
    return {
      id: u.id,
      position: u.position,
      title: u.title,
      status: u.status,
      taughtOn: u.taughtOn,
      prerequisites: u.prerequisites,
      lecture: lectureId && lectures.get(lectureId) ? lectures.get(lectureId)! : null,
      sources: sources.get(u.id) ?? null,
      memory:
        u.status === 'taught' && (m.summary || m.terms?.length || m.cases?.length)
          ? {
              summary: m.summary ?? null,
              terms: m.terms ?? [],
              cases: (m.cases ?? []).map((x) => x.name),
              runningExample: m.runningExample ?? null,
              openThreads: m.openThreads ?? [],
            }
          : null,
    };
  });
  return {
    id: course.id,
    name: course.name,
    semester: course.semester,
    classCount: course.class_count,
    units: view,
    checks: seriesChecks(units, course.class_count),
  };
}

/** Her courses (not archived), with how many lectures are planned and taught. */
export async function listCourses(c: pg.PoolClient): Promise<CourseList> {
  const rows = (
    await c.query<{
      id: string;
      name: string;
      semester: string | null;
      class_count: number | null;
      lectures: number;
      taught: number;
    }>(
      `select c.id, c.name, c.semester, c.class_count,
              (select count(*)::int from course_units u where u.course_id = c.id and u.status <> 'skipped') lectures,
              (select count(*)::int from course_units u where u.course_id = c.id and u.status = 'taught') taught
         from courses c where c.archived_at is null order by c.created_at`,
    )
  ).rows;
  return {
    courses: rows.map((x) => ({
      id: x.id,
      name: x.name,
      semester: x.semester,
      classCount: x.class_count,
      lectures: x.lectures,
      taught: x.taught,
    })),
  };
}

/**
 * COURSE-1, COURSE-2: a new course from a list of topics (or empty). With `findSources` (and a worker to do it), each
 * lecture waits for the background source check (DATA-3); its searches use outside services, so consent comes first.
 * Returns the course and whether the caller should queue `ingest.syllabus`.
 */
export async function createCourse(
  c: pg.PoolClient,
  who: Who,
  body: CreateCourse,
  canFindSources: boolean,
): Promise<{ course: CourseDetail; waiting: boolean }> {
  const id = (
    await c.query<{ id: string }>(
      'insert into courses (college_id, owner_id, name, semester, class_count) values ($1, $2, $3, $4, $5) returning id',
      [who.collegeId, who.userId, body.name, body.semester || null, body.classCount ?? null],
    )
  ).rows[0]!.id;
  const waiting = body.findSources && canFindSources && body.topics.length > 0;
  if (waiting && who.role === 'teacher' && !(await hasConsent(c)))
    throw new AppError('CONSENT_REQUIRED', consentMessage);
  for (const [i, title] of body.topics.entries()) {
    await c.query(
      'insert into course_units (college_id, owner_id, course_id, position, title, sources) values ($1, $2, $3, $4, $5, $6)',
      [
        who.collegeId,
        who.userId,
        id,
        i + 1,
        title,
        waiting ? { state: 'waiting', found: null, loaded: null, checkedAt: null } : null,
      ],
    );
  }
  return { course: await courseDetail(c, id), waiting };
}

export async function updateCourse(c: pg.PoolClient, id: string, body: UpdateCourse): Promise<CourseDetail> {
  await courseRow(c, id);
  await c.query(
    `update courses set name = coalesce($2, name),
            semester = case when $3::boolean then $4 else semester end,
            class_count = case when $5::boolean then $6::smallint else class_count end
      where id = $1`,
    [
      id,
      body.name ?? null,
      body.semester !== undefined,
      body.semester ?? null,
      body.classCount !== undefined,
      body.classCount ?? null,
    ],
  );
  return courseDetail(c, id);
}

/** Archive, not delete: her taught lectures and their memory stay (they may be in other exports). */
export async function archiveCourse(c: pg.PoolClient, id: string): Promise<void> {
  await courseRow(c, id);
  await c.query('update courses set archived_at = now() where id = $1', [id]);
}

/** COURSE-3: add, rename, delete, reorder; prerequisites; skip. All in her one transaction. */
export async function updateUnits(c: pg.PoolClient, who: Who, id: string, body: UpdateUnits): Promise<CourseDetail> {
  await courseRow(c, id);
  const units = await loadUnits(c, id);
  const mine = new Map(units.map((u) => [u.id, u]));
  const known = (ids: string[]) => {
    if (ids.some((x) => !mine.has(x))) throw new AppError('NOT_FOUND', 'One of those lectures is not in this course.');
  };
  let last = units.reduce((n, u) => Math.max(n, u.position), 0);
  for (const a of body.add ?? []) {
    last += 1;
    const u = (
      await c.query<{ id: string }>(
        'insert into course_units (college_id, owner_id, course_id, position, title) values ($1, $2, $3, $4, $5) returning id',
        [who.collegeId, who.userId, id, last, a.title],
      )
    ).rows[0]!;
    mine.set(u.id, {
      id: u.id,
      position: last,
      title: a.title,
      status: 'planned',
      taughtOn: null,
      prerequisites: [],
      memory: {},
      lectureId: null,
    });
  }
  for (const x of body.rename ?? []) {
    known([x.id]);
    await c.query('update course_units set title = $2 where id = $1', [x.id, x.title]);
  }
  if (body.remove?.length) {
    known(body.remove);
    const taught = body.remove.filter((x) => mine.get(x)!.status === 'taught');
    if (taught.length)
      throw new AppError(
        'VALIDATION_FAILED',
        'A taught lecture cannot be deleted from the plan: later lectures recap it. Move it instead.',
      );
    // Her lectures stay (one-off from now on); only the slot in the plan goes.
    await c.query('update lectures set unit_id = null where unit_id = any($1::uuid[])', [body.remove]);
    await c.query(
      'update course_units set prerequisites = array(select p from unnest(prerequisites) p where p <> all($2::uuid[])) where course_id = $1',
      [id, body.remove],
    );
    await c.query('delete from course_units where id = any($1::uuid[])', [body.remove]);
    for (const x of body.remove) mine.delete(x);
  }
  // Positions 1…n in the order given (units not listed keep their relative order after those listed).
  const rest = [...mine.values()].sort((a, b) => a.position - b.position).map((u) => u.id);
  if (body.order) known(body.order);
  const order = [...new Set([...(body.order ?? []), ...rest])].filter((x) => mine.has(x));
  for (const [i, uid] of order.entries())
    await c.query('update course_units set position = $2 where id = $1 and position <> $2', [uid, i + 1]);
  for (const p of body.prerequisites ?? []) {
    known([p.id, ...p.prerequisites]);
    await c.query('update course_units set prerequisites = $2 where id = $1', [
      p.id,
      p.prerequisites.filter((x) => x !== p.id),
    ]);
  }
  for (const s of body.status ?? []) {
    known([s.id]);
    if (mine.get(s.id)!.status === 'taught')
      throw new AppError('VALIDATION_FAILED', 'This lecture is marked taught; undo that from the lecture first.');
    await c.query('update course_units set status = $2 where id = $1', [s.id, s.status]);
  }
  return courseDetail(c, id);
}

/** Home (HOME-3): her courses, each with its next untaught lecture. The app never picks one for her (HOME-4). */
export async function homeCourses(c: pg.PoolClient): Promise<HomeResponse> {
  const rows = (
    await c.query<{ id: string; name: string; next_unit: { id: string; position: number; title: string } | null }>(
      `select c.id, c.name,
              (select json_build_object('id', u.id, 'position', u.position, 'title', u.title)
                 from course_units u where u.course_id = c.id and u.status = 'planned'
                order by u.position limit 1) as next_unit
         from courses c where c.archived_at is null order by c.created_at`,
    )
  ).rows;
  return { courses: rows.map((r) => ({ id: r.id, name: r.name, nextUnit: r.next_unit })) };
}
