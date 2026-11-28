/**
 * Lectures (F3, F7 reading, COURSE-7; LLD §4.2–4.3): preparing one (the checks before the build job is queued), the
 * Studio header, marking taught, the source drawer, and "it's still right". Runs in her transaction (RLS).
 */
import type pg from 'pg';
import { courseContext, lectureNo, standingOf } from '@nyaai/legal';
import type { CitationSource, LectureSummary, PrepareLecture } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { assertWithinBudget } from '../budget/index.ts';
import { lineCounts } from '../counts/index.ts';
import { loadUnits } from '../course/index.ts';
import { chunkForDrawer } from '../search/index.ts';
import { resolveConcept } from '../topics/index.ts';

interface Who {
  userId: string;
  collegeId: string;
}

/**
 * Checks a Prepare request and saves the lecture as "building", ready for the build job: the topic is understood,
 * her budget allows it, the course slot is hers (and any untaught prerequisite acknowledged, HOME-10), and every
 * note she attached is read. Returns the new lecture's id.
 */
export async function prepareLecture(c: pg.PoolClient, who: Who, body: PrepareLecture): Promise<string> {
  const conceptId = await resolveConcept(c, body.topic, body.ambiguityChoice);
  await assertWithinBudget(c, who.userId);
  if (body.course.kind === 'course') {
    const ok = (await c.query('select 1 from courses where id = $1 and archived_at is null', [body.course.courseId]))
      .rowCount;
    if (!ok) throw new AppError('NOT_FOUND', 'We could not find that course.');
    const unitId = body.course.unitId;
    if (unitId) {
      const units = await loadUnits(c, body.course.courseId);
      if (!units.some((u) => u.id === unitId))
        throw new AppError('NOT_FOUND', 'That lecture is not in the course plan.');
      // Lectures this one builds on, not taught yet. She may go ahead; the recap will not assume them.
      const untaught = courseContext(units, unitId).untaughtPrerequisites;
      if (untaught.length && !body.prereqAck) {
        throw new AppError(
          'PREREQ_WARNING_UNACKED',
          `This lecture builds on ${untaught.map((u) => `${lectureNo(u.position)} ${u.title}`).join(', ')}, not marked taught yet. You can still go ahead.`,
          { untaught },
        );
      }
    }
  }
  if (body.notes.length) await assertNotesReady(c, body.notes);

  const course = body.course.kind === 'course' ? body.course : null;
  const id = (
    await c.query<{ id: string }>(
      `insert into lectures (college_id, owner_id, course_id, unit_id, topic, length_min, level, style_key, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'building') returning id`,
      [
        who.collegeId,
        who.userId,
        course?.courseId ?? null,
        course?.unitId ?? null,
        body.topic,
        body.lengthMin,
        body.level,
        body.styleKey,
      ],
    )
  ).rows[0]!.id;
  await c.query(
    `insert into lecture_inputs (lecture_id, college_id, owner_id, must_include_text, example_id, anything_special, filters, ambiguity_choice, note_upload_ids)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      who.collegeId,
      who.userId,
      body.mustInclude?.text || null,
      body.mustInclude?.exampleId ?? null,
      body.anythingSpecial || null,
      body.filters,
      conceptId,
      [...new Set(body.notes)],
    ],
  );
  // The plan points at the unit's latest lecture (a taught unit keeps the lecture it was taught from).
  if (course?.unitId) {
    await c.query("update course_units set lecture_id = $2 where id = $1 and status <> 'taught'", [course.unitId, id]);
  }
  return id;
}

/** Her notes for a lecture: hers (row security hides others'), not removed, and read. */
async function assertNotesReady(c: pg.PoolClient, ids: string[]): Promise<void> {
  const notes = (
    await c.query<{ id: string; status: string; title: string }>(
      "select id, status, coalesce(title, file_name) as title from uploads where id = any($1::uuid[]) and status not in ('deleted', 'replaced')",
      [ids],
    )
  ).rows;
  if (notes.length !== new Set(ids).size)
    throw new AppError('NOT_FOUND', 'One of the documents you chose is no longer in your notes.');
  const waiting = notes.filter((n) => n.status !== 'ready');
  if (waiting.length) {
    throw new AppError(
      'NOTES_NOT_READY',
      waiting.some((n) => n.status === 'failed')
        ? `We could not read ${waiting.map((n) => n.title).join(', ')}. Remove it or upload it again.`
        : `Your notes are still being read: ${waiting.map((n) => n.title).join(', ')}. Try again in a moment.`,
    );
  }
}

/** A failed build goes back to "building" so the job can run again. */
export async function markForRetry(c: pg.PoolClient, lectureId: string): Promise<void> {
  const r = await c.query(
    "update lectures set status = 'building', error_code = null where id = $1 and status = 'failed'",
    [lectureId],
  );
  if (!r.rowCount) throw new AppError('NOT_FOUND', 'There is no failed build to retry for this lecture.');
}

/** The Studio header: status, plan, counts (live once built), coverage, the course slot and "may need update". */
export async function lectureSummary(c: pg.PoolClient, lectureId: string): Promise<LectureSummary | null> {
  const row = (
    await c.query<{
      id: string;
      topic: string;
      status: LectureSummary['status'];
      length_min: number;
      level: string;
      plan: LectureSummary['plan'];
      yellow_open: number;
      grey_open: number;
      coverage_open: number;
      coverage_score: string | null;
      parts_done: number[];
      error_code: string | null;
      created_at: Date;
      ready_at: Date | null;
      taught: string | null;
      course_id: string | null;
      course_name: string | null;
      unit_id: string | null;
      position: number | null;
      cov_covered: number;
      cov_counted: number;
      may_need_update_since: Date | null;
      update_from: { id: string; position: number | null; topic: string }[] | null;
    }>(
      `select l.*, to_char(l.taught_on, 'YYYY-MM-DD') taught, c.name course_name, u.position,
              (select count(*)::int from coverage_items ci where ci.lecture_id = l.id and ci.item_kind <> 'left_out' and ci.state = 'covered') cov_covered,
              (select count(*)::int from coverage_items ci where ci.lecture_id = l.id and ci.item_kind <> 'left_out' and ci.state <> 'left_out_by_teacher') cov_counted,
              (select json_agg(json_build_object('id', e.id, 'position', eu.position, 'topic', e.topic) order by eu.position)
                 from lectures e left join course_units eu on eu.id = e.unit_id where e.id = any(l.may_need_update_from)) update_from
         from lectures l left join courses c on c.id = l.course_id left join course_units u on u.id = l.unit_id
        where l.id = $1`,
      [lectureId],
    )
  ).rows[0];
  if (!row) return null;
  // While building, the build keeps the stored counts current; afterwards they are read live (case status can change).
  const counts =
    row.status === 'building' ? { yellow: row.yellow_open, grey: row.grey_open } : await lineCounts(c, lectureId);
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    lengthMin: row.length_min,
    level: row.level,
    plan: row.plan ? { parts: row.plan.parts, leftOut: row.plan.leftOut } : null,
    counts: { ...counts, coverage: row.coverage_open },
    coverageScore: row.coverage_score === null ? null : Number(row.coverage_score),
    coverageCounts: row.coverage_score === null ? null : { covered: row.cov_covered, counted: row.cov_counted },
    mayNeedUpdate: row.may_need_update_since
      ? {
          since: row.may_need_update_since.toISOString(),
          from: (row.update_from ?? []).map((e) => ({
            lectureId: e.id,
            label: `${e.position ? `${lectureNo(e.position)} ` : ''}${e.topic}`,
          })),
        }
      : null,
    partsDone: row.parts_done,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    readyAt: row.ready_at?.toISOString() ?? null,
    taughtOn: row.taught,
    course: row.course_id
      ? { id: row.course_id, name: row.course_name ?? '', unitId: row.unit_id, position: row.position }
      : null,
  };
}

/**
 * COURSE-7: mark taught. A lecture in a course with no free planned slot gets a new one at the end of the plan, so
 * later lectures can recap it. Returns the unit taught (null for a one-off); the caller queues `learn.summary`.
 */
export async function markTaught(
  c: pg.PoolClient,
  who: Who,
  lectureId: string,
  taughtOn: string,
): Promise<string | null> {
  const l = (
    await c.query<{ status: string; course_id: string | null; unit_id: string | null; topic: string }>(
      'select status, course_id, unit_id, topic from lectures where id = $1 for update',
      [lectureId],
    )
  ).rows[0];
  if (!l) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
  if (l.status !== 'ready' && l.status !== 'taught')
    throw new AppError('VALIDATION_FAILED', 'Only a finished lecture can be marked taught.');
  let unit = l.unit_id;
  if (l.course_id && unit) {
    // Another lecture already taught in this slot keeps it; this one takes a new slot right after.
    const other = (
      await c.query<{ lecture_id: string | null; status: string }>(
        'select lecture_id, status from course_units where id = $1',
        [unit],
      )
    ).rows[0];
    if (other?.status === 'taught' && other.lecture_id !== lectureId) unit = null;
  }
  if (l.course_id && !unit) {
    const pos = (
      await c.query<{ n: number }>(
        'select coalesce(max(position), 0)::int + 1 n from course_units where course_id = $1',
        [l.course_id],
      )
    ).rows[0]!.n;
    unit = (
      await c.query<{ id: string }>(
        'insert into course_units (college_id, owner_id, course_id, position, title) values ($1, $2, $3, $4, $5) returning id',
        [who.collegeId, who.userId, l.course_id, pos, l.topic],
      )
    ).rows[0]!.id;
  }
  await c.query(
    "update lectures set status = 'taught', taught_on = $2, unit_id = coalesce($3, unit_id) where id = $1",
    [lectureId, taughtOn, unit],
  );
  if (unit)
    await c.query("update course_units set status = 'taught', taught_on = $2, lecture_id = $3 where id = $1", [
      unit,
      taughtOn,
      lectureId,
    ]);
  return unit;
}

/** Undo "taught": the lecture is ready again and its course memory is cleared (memory only for taught lectures). */
export async function undoTaught(c: pg.PoolClient, lectureId: string): Promise<void> {
  const l = (
    await c.query<{ unit_id: string | null }>(
      "update lectures set status = 'ready', taught_on = null where id = $1 and status = 'taught' returning unit_id",
      [lectureId],
    )
  ).rows[0];
  if (!l) throw new AppError('NOT_FOUND', 'This lecture is not marked taught.');
  if (l.unit_id)
    await c.query(
      "update course_units set status = 'planned', taught_on = null, memory = '{}' where id = $1 and lecture_id = $2",
      [l.unit_id, lectureId],
    );
}

/** "It's still right": she has looked, and the lecture needs no change after an earlier one was edited (F8.6). */
export async function clearMayNeedUpdate(c: pg.PoolClient, lectureId: string): Promise<void> {
  const r = await c.query(
    "update lectures set may_need_update_since = null, may_need_update_from = '{}' where id = $1",
    [lectureId],
  );
  if (!r.rowCount) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
}

/**
 * Click-to-source (STUDIO-3): the stored span always; the paragraph or section while the library still holds it;
 * every check's result; and why this source was chosen (relevance saved at build time, authority read fresh).
 */
export async function citationSource(c: pg.PoolClient, citationId: string): Promise<CitationSource | null> {
  const row = (
    await c.query<{
      id: string;
      claim_text: string;
      span_text: string;
      source_label: string | null;
      chunk_id: string | null;
      checks: { name: string; result: string; detail: string | null }[];
      title: string | null;
      url: string | null;
      source_type: string | null;
      source_status: string | null;
      case_status: string | null;
      court_level: string | null;
      bench_size: number | null;
      origin: string | null;
      para_role: string | null;
      kind: string | null;
      source_relevance: string | null;
    }>(
      `select c.id, c.claim_text, c.span_text, c.source_label, c.chunk_id, c.checks, s.title, s.url, s.type::text source_type, s.status::text source_status, cs.status case_status,
              s.court_level, s.bench_size, s.origin::text origin, k.para_role, k.kind::text kind, c.source_relevance
         from citations c left join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id
         left join chunks k on k.id = c.chunk_id where c.id = $1`,
      [citationId],
    )
  ).rows[0];
  if (!row) return null;
  const chunk = row.chunk_id ? await chunkForDrawer(c, row.chunk_id) : null;
  return {
    citationId: row.id,
    claim: row.claim_text,
    span: row.span_text,
    label: row.source_label ?? '',
    title: row.title,
    header: chunk?.header ?? null,
    // A statute sub-section shows its whole section; a judgment shows its paragraph.
    text: chunk ? (row.source_type === 'judgment' ? chunk.text : (chunk.parentText ?? chunk.text)) : null,
    url: row.url,
    provisional: row.source_status === 'provisional',
    caseStatus: row.case_status,
    checks: row.checks.map((k) => ({ name: k.name, result: k.result as 'pass', detail: k.detail ?? null })),
    whyChosen:
      row.source_type && row.origin
        ? {
            relevance: row.source_relevance === null ? null : Number(row.source_relevance),
            reasons: standingOf({
              sourceType: row.source_type,
              courtLevel: row.court_level,
              benchSize: row.bench_size,
              origin: row.origin,
              provisional: row.source_status === 'provisional',
              caseStatus: null,
              paraRole: row.para_role,
              kind: row.kind,
            }).reasons,
          }
        : null,
  } as CitationSource;
}
