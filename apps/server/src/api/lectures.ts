/**
 * Lectures and the read-only Studio (F3, F7 reading; LLD §4.2–4.3). Prepare queues `build.lecture` and returns 202;
 * the Studio reads slides with each line's status, its source chips, the source drawer and the coverage list.
 * Editing (PATCH /slides/:id) arrives on Day 4.
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import {
  CitationSource,
  CoverageResponse,
  LectureSummary,
  PrepareLecture,
  PrepareResponse,
  StudioSlides,
} from '@nyaai/shared';
import { coverageScore, openGroups } from '@nyaai/checker-rules';
import { courseContext, lectureNo, standingOf } from '@nyaai/legal';
import { MarkTaught, MarkTaughtResponse } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { BUILD_JOB_OPTIONS, LEARN_JOB_OPTIONS, type BuildJobData, type LearnJobData } from '../jobs/queues.ts';
import { loadUnits } from '../services/course/index.ts';
import { loadStudioSlides } from '../services/studio/index.ts';
import { chunkForDrawer } from '../services/search/index.ts';
import { resolveConcept } from '../services/topics.ts';

const Id = z.uuid();

export function lecturesRouter(buildQueue: Queue<BuildJobData> | undefined, learnQueue?: Queue<LearnJobData>) {
  const r = express.Router();

  r.post('/lectures', requireConsent, async (req, res) => {
    if (!buildQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Preparing lectures is not available right now.');
    const body = PrepareLecture.parse(req.body);
    const who = req.identity!;
    const lectureId = await req.db!(async (c) => {
      const conceptId = await resolveConcept(c, body.topic, body.ambiguityChoice);
      const budget = (
        await c.query<{ budget: string; spent: string | null }>(
          `select p.monthly_budget_micro_usd::text budget,
                  (select sum(cost_micro_usd)::text from usage u where u.owner_id = p.owner_id
                     and u.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') spent
             from teacher_profiles p where p.owner_id = $1`,
          [who.userId],
        )
      ).rows[0];
      if (budget && Number(budget.spent ?? 0) >= Number(budget.budget)) {
        throw new AppError('BUDGET_EXHAUSTED', 'Your monthly limit is reached; your administrator can raise it.');
      }
      if (body.course.kind === 'course') {
        const ok = (await c.query('select 1 from courses where id = $1 and archived_at is null', [body.course.courseId])).rowCount;
        if (!ok) throw new AppError('NOT_FOUND', 'We could not find that course.');
        const unitId = body.course.unitId;
        if (unitId) {
          const units = await loadUnits(c, body.course.courseId);
          if (!units.some((u) => u.id === unitId)) throw new AppError('NOT_FOUND', 'That lecture is not in the course plan.');
          // HOME-10: lectures this one builds on, not taught yet. She may go ahead; the recap will not assume them.
          const untaught = courseContext(units, unitId).untaughtPrerequisites;
          if (untaught.length && !body.prereqAck) {
            throw new AppError('PREREQ_WARNING_UNACKED', `This lecture builds on ${untaught.map((u) => `${lectureNo(u.position)} ${u.title}`).join(', ')}, not marked taught yet. You can still go ahead.`, { untaught });
          }
        }
      }
      // Her notes for this lecture: hers, and read (row security already hides other teachers' uploads).
      if (body.notes.length) {
        const notes = (await c.query<{ id: string; status: string; title: string }>("select id, status, coalesce(title, file_name) as title from uploads where id = any($1::uuid[]) and status not in ('deleted', 'replaced')", [body.notes])).rows;
        if (notes.length !== new Set(body.notes).size) throw new AppError('NOT_FOUND', 'One of the documents you chose is no longer in your notes.');
        const waiting = notes.filter((n) => n.status !== 'ready');
        if (waiting.length) {
          throw new AppError('NOTES_NOT_READY', waiting.some((n) => n.status === 'failed') ? `We could not read ${waiting.map((n) => n.title).join(', ')}. Remove it or upload it again.` : `Your notes are still being read: ${waiting.map((n) => n.title).join(', ')}. Try again in a moment.`);
        }
      }
      const id = (
        await c.query<{ id: string }>(
          `insert into lectures (college_id, owner_id, course_id, unit_id, topic, length_min, level, style_key, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'building') returning id`,
          [who.collegeId, who.userId, body.course.kind === 'course' ? body.course.courseId : null, body.course.kind === 'course' ? (body.course.unitId ?? null) : null, body.topic, body.lengthMin, body.level, body.styleKey],
        )
      ).rows[0]!.id;
      await c.query(
        `insert into lecture_inputs (lecture_id, college_id, owner_id, must_include_text, example_id, anything_special, filters, ambiguity_choice, note_upload_ids)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, who.collegeId, who.userId, body.mustInclude?.text || null, body.mustInclude?.exampleId ?? null, body.anythingSpecial || null, body.filters, conceptId, [...new Set(body.notes)]],
      );
      // The plan points at the unit's latest lecture (a taught unit keeps the lecture it was taught from).
      if (body.course.kind === 'course' && body.course.unitId) {
        await c.query("update course_units set lecture_id = $2 where id = $1 and status <> 'taught'", [body.course.unitId, id]);
      }
      return id;
    });
    const job = await buildQueue.add('build.lecture', { lectureId, ownerId: who.userId, collegeId: who.collegeId }, { ...BUILD_JOB_OPTIONS, jobId: `build.lecture-${lectureId}` });
    res.status(202).json(PrepareResponse.parse({ lectureId, jobId: job.id }));
  });

  r.post('/lectures/:id/retry', requireConsent, async (req, res) => {
    if (!buildQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Preparing lectures is not available right now.');
    const id = Id.parse(req.params.id);
    const status = await req.db!(async (c) => (await c.query<{ status: string }>("update lectures set status = 'building', error_code = null where id = $1 and status = 'failed' returning status", [id])).rows[0]);
    if (!status) throw new AppError('NOT_FOUND', 'There is no failed build to retry for this lecture.');
    const who = req.identity!;
    const job = await buildQueue.add('build.lecture', { lectureId: id, ownerId: who.userId, collegeId: who.collegeId }, { ...BUILD_JOB_OPTIONS, jobId: `build.lecture-${id}-${Date.now()}` });
    res.status(202).json(PrepareResponse.parse({ lectureId: id, jobId: job.id }));
  });

  r.get('/lectures/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const row = await req.db!(async (c) =>
      (
        await c.query<{
          id: string; topic: string; status: LectureSummary['status']; length_min: number; level: string; plan: LectureSummary['plan'];
          yellow_open: number; grey_open: number; coverage_open: number; coverage_score: string | null; parts_done: number[]; error_code: string | null; created_at: Date; ready_at: Date | null;
          taught: string | null; course_id: string | null; course_name: string | null; unit_id: string | null; position: number | null;
          live_yellow: number; live_grey: number;
        }>(
          // Yellow and grey per line, with case status read live (see lineFrom).
          `with lines as (
             select ci.slide_id, ci.line_key,
                    bool_or(ci.check_status = 'open' or cs.status in ('overruled', 'reversed')) as yellow,
                    bool_or(ci.flag_kind = 'grey' and coalesce(cs.status, 'not_verified') = 'not_verified') as grey
               from citations ci left join case_status_v cs on cs.source_id = ci.source_id
              where ci.lecture_id = $1 and ci.check_status <> 'removed'
              group by ci.slide_id, ci.line_key)
           select l.*, to_char(l.taught_on, 'YYYY-MM-DD') taught, c.name course_name, u.position,
                  (select count(*)::int from lines where yellow) live_yellow,
                  (select count(*)::int from lines where grey and not yellow) live_grey
             from lectures l left join courses c on c.id = l.course_id left join course_units u on u.id = l.unit_id
            where l.id = $1`,
          [id],
        )
      ).rows[0],
    );
    if (!row) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
    res.json(
      LectureSummary.parse({
        id: row.id,
        topic: row.topic,
        status: row.status,
        lengthMin: row.length_min,
        level: row.level,
        plan: row.plan ? { parts: row.plan.parts, leftOut: row.plan.leftOut } : null,
        counts: { yellow: row.status === 'building' ? row.yellow_open : row.live_yellow, grey: row.status === 'building' ? row.grey_open : row.live_grey, coverage: row.coverage_open },
        coverageScore: row.coverage_score === null ? null : Number(row.coverage_score),
        partsDone: row.parts_done,
        errorCode: row.error_code,
        createdAt: row.created_at.toISOString(),
        readyAt: row.ready_at?.toISOString() ?? null,
        taughtOn: row.taught,
        course: row.course_id ? { id: row.course_id, name: row.course_name ?? '', unitId: row.unit_id, position: row.position } : null,
      }),
    );
  });

  /**
   * COURSE-7: mark taught. Course memory is written only now, by `learn.summary` from her slides as they stand. A
   * lecture in a course with no planned slot gets one at the end of the plan, so later lectures can recap it.
   */
  r.post('/lectures/:id/taught', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = MarkTaught.parse(req.body);
    const who = req.identity!;
    const unitId = await req.db!(async (c) => {
      const l = (await c.query<{ status: string; course_id: string | null; unit_id: string | null; topic: string }>('select status, course_id, unit_id, topic from lectures where id = $1 for update', [id])).rows[0];
      if (!l) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
      if (l.status !== 'ready' && l.status !== 'taught') throw new AppError('VALIDATION_FAILED', 'Only a finished lecture can be marked taught.');
      let unit = l.unit_id;
      if (l.course_id && unit) {
        // Another lecture already taught in this slot keeps it; this one takes a new slot right after.
        const other = (await c.query<{ lecture_id: string | null; status: string }>('select lecture_id, status from course_units where id = $1', [unit])).rows[0];
        if (other?.status === 'taught' && other.lecture_id !== id) unit = null;
      }
      if (l.course_id && !unit) {
        const pos = (await c.query<{ n: number }>('select coalesce(max(position), 0)::int + 1 n from course_units where course_id = $1', [l.course_id])).rows[0]!.n;
        unit = (
          await c.query<{ id: string }>('insert into course_units (college_id, owner_id, course_id, position, title) values ($1, $2, $3, $4, $5) returning id', [who.collegeId, who.userId, l.course_id, pos, l.topic])
        ).rows[0]!.id;
      }
      await c.query("update lectures set status = 'taught', taught_on = $2, unit_id = coalesce($3, unit_id) where id = $1", [id, body.taughtOn, unit]);
      if (unit) await c.query("update course_units set status = 'taught', taught_on = $2, lecture_id = $3 where id = $1", [unit, body.taughtOn, id]);
      return unit;
    });
    let memoryJob: string | null = null;
    if (unitId && learnQueue) {
      const job = await learnQueue.add('learn.summary', { lectureId: id, ownerId: who.userId, collegeId: who.collegeId }, { ...LEARN_JOB_OPTIONS, jobId: `learn.summary-${id}-${Date.now()}` });
      memoryJob = job.id ?? null;
    }
    res.json(MarkTaughtResponse.parse({ unitId, memoryJob }));
  });

  /** Undo "taught": the lecture is ready again and its course memory is cleared (COURSE-7: memory only for taught). */
  r.delete('/lectures/:id/taught', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!(async (c) => {
      const l = (await c.query<{ unit_id: string | null }>("update lectures set status = 'ready', taught_on = null where id = $1 and status = 'taught' returning unit_id", [id])).rows[0];
      if (!l) throw new AppError('NOT_FOUND', 'This lecture is not marked taught.');
      if (l.unit_id) await c.query("update course_units set status = 'planned', taught_on = null, memory = '{}' where id = $1 and lecture_id = $2", [l.unit_id, id]);
    });
    res.status(204).end();
  });

  r.get('/lectures/:id/slides', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(StudioSlides.parse({ slides: await req.db!((c) => loadStudioSlides(c, id)) }));
  });

  // Click-to-source (STUDIO-3): the stored span always; the paragraph or section while the library still holds it.
  r.get('/citations/:id/source', async (req, res) => {
    const id = Id.parse(req.params.id);
    const out = await req.db!(async (c) => {
      const row = (
        await c.query<{ id: string; claim_text: string; span_text: string; source_label: string | null; chunk_id: string | null; checks: { name: string; result: string; detail: string | null }[]; title: string | null; url: string | null; source_type: string | null; source_status: string | null; case_status: string | null; court_level: string | null; bench_size: number | null; origin: string | null; para_role: string | null; kind: string | null; source_relevance: string | null }>(
          `select c.id, c.claim_text, c.span_text, c.source_label, c.chunk_id, c.checks, s.title, s.url, s.type::text source_type, s.status::text source_status, cs.status case_status,
                  s.court_level, s.bench_size, s.origin::text origin, k.para_role, k.kind::text kind, c.source_relevance
             from citations c left join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id
             left join chunks k on k.id = c.chunk_id where c.id = $1`,
          [id],
        )
      ).rows[0];
      if (!row) return null;
      const chunk = row.chunk_id ? await chunkForDrawer(c, row.chunk_id) : null;
      return { row, chunk };
    });
    if (!out) throw new AppError('NOT_FOUND', 'We could not find that source.');
    const { row, chunk } = out;
    res.json(
      CitationSource.parse({
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
        // Relevance was the question's (saved at build time); the authority reasons are read fresh from the source.
        whyChosen:
          row.source_type && row.origin
            ? {
                relevance: row.source_relevance === null ? null : Number(row.source_relevance),
                reasons: standingOf({ sourceType: row.source_type, courtLevel: row.court_level, benchSize: row.bench_size, origin: row.origin, provisional: row.source_status === 'provisional', caseStatus: null, paraRole: row.para_role, kind: row.kind }).reasons,
              }
            : null,
      }),
    );
  });

  r.get('/lectures/:id/coverage', async (req, res) => {
    const id = Id.parse(req.params.id);
    const { items, plan } = await req.db!(async (c) => ({
      items: (
        await c.query<{ id: string; section_key: string; item_kind: string; item_label: string | null; state: 'covered' | 'missing' | 'left_out_by_teacher'; reason: string | null; item_text: string | null }>(
          'select id, section_key, item_kind, item_label, state, reason, item_text from coverage_items where lecture_id = $1 order by section_key, item_label',
          [id],
        )
      ).rows,
      plan: (await c.query<{ plan: { notFound?: { partIndex: number; question: string }[] } | null; coverage_score: string | null }>('select plan, coverage_score from lectures where id = $1', [id])).rows[0],
    }));
    if (!plan) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
    const toItem = (i: (typeof items)[number]) => ({ id: i.id, sectionKey: i.section_key, kind: i.item_kind as 'clause', label: i.item_label ?? i.section_key, state: i.state, reason: i.reason, text: i.item_text });
    const groups = new Map<string, typeof items>();
    for (const i of items.filter((x) => x.item_kind !== 'left_out')) groups.set(i.section_key, [...(groups.get(i.section_key) ?? []), i]);
    res.json(
      CoverageResponse.parse({
        score: plan.coverage_score === null ? null : Number(plan.coverage_score),
        groups: [...groups].map(([key, list]) => ({
          sectionKey: key,
          title: key.includes(':') ? key.replace(/^(.*):([sa])(.*)$/, (_m, act: string, k: string, n: string) => (k === 'a' ? `Article ${n}` : `s. ${n} ${act}`)) : key,
          missing: list.filter((x) => x.state === 'missing').length,
          total: list.length,
          items: list.map(toItem),
        })),
        leftOut: items.filter((x) => x.item_kind === 'left_out').map(toItem),
        notFound: plan.plan?.notFound ?? [],
      }),
    );
  });

  // Only the teacher clears a coverage note or a left-out item (HLD 5.2 d).
  r.post('/coverage/:id/leave-out', async (req, res) => {
    const id = Id.parse(req.params.id);
    const ok = await req.db!(async (c) => {
      const item = (
        await c.query<{ lecture_id: string }>(
          "update coverage_items set state = 'left_out_by_teacher', ticked_by = app_user(), ticked_at = now() where id = $1 and state = 'missing' returning lecture_id",
          [id],
        )
      ).rows[0];
      if (!item) return false;
      const all = (await c.query<{ section_key: string; state: 'covered' | 'missing' | 'left_out_by_teacher'; item_kind: string }>('select section_key, state, item_kind from coverage_items where lecture_id = $1', [item.lecture_id])).rows;
      const counted = all.filter((a) => a.item_kind !== 'left_out');
      await c.query('update lectures set coverage_open = $2, coverage_score = $3 where id = $1', [item.lecture_id, openGroups(counted.map((a) => ({ sectionKey: a.section_key, state: a.state }))), coverageScore(counted.map((a) => a.state))]);
      return true;
    });
    if (!ok) throw new AppError('NOT_FOUND', 'That item is not open.');
    res.status(204).end();
  });

  return r;
}
