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
  type SlideLine,
  type StudioSlide,
} from '@nyaai/shared';
import { coverageScore, openGroups } from '@nyaai/checker-rules';
import { AppError } from '../errors.ts';
import { BUILD_JOB_OPTIONS, type BuildJobData } from '../jobs/queues.ts';
import { chunkForDrawer } from '../services/search/index.ts';
import { resolveConcept } from '../services/topics.ts';

const Id = z.uuid();

interface LineNode {
  attrs?: { lineKey?: string; kind?: SlideLine['kind']; yourExample?: boolean };
  content?: { text?: string }[];
}
interface CitationRow {
  id: string;
  slide_id: string;
  line_key: string;
  tag: string | null;
  source_label: string | null;
  check_status: SlideLine['status'];
  flag_kind: 'yellow' | 'grey' | 'coverage' | null;
  flag_reason: string | null;
  risk: 'normal' | 'high';
  source_status: string | null;
  case_status: string | null;
}

/** One line's status from its claims (LLD §8.4): any open claim → yellow; else any grey → grey; else supported. */
function lineFrom(node: LineNode, cits: CitationRow[]): SlideLine {
  const text = (node.content ?? []).map((t) => t.text ?? '').join('');
  const open = cits.find((c) => c.check_status === 'open');
  const grey = cits.find((c) => c.flag_kind === 'grey');
  const verified = cits.length > 0 && cits.every((c) => c.check_status === 'verified_by_you');
  const status: SlideLine['status'] = open ? 'open' : verified ? 'verified_by_you' : !cits.length && node.attrs?.yourExample ? 'your_example' : 'supported';
  return {
    lineKey: node.attrs?.lineKey ?? '',
    text,
    kind: node.attrs?.kind ?? 'teaching',
    status,
    flag: open ? 'yellow' : grey ? 'grey' : null,
    flagReason: open?.flag_reason ?? grey?.flag_reason ?? null,
    sources: cits
      .filter((c) => c.tag)
      .map((c) => ({ tag: c.tag!, citationId: c.id, label: c.source_label ?? c.tag!, provisional: c.source_status === 'provisional', caseStatus: c.case_status })),
    risk: cits.some((c) => c.risk === 'high') ? 'high' : 'normal',
  };
}

export function lecturesRouter(buildQueue: Queue<BuildJobData> | undefined) {
  const r = express.Router();

  r.post('/lectures', async (req, res) => {
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
      }
      const id = (
        await c.query<{ id: string }>(
          `insert into lectures (college_id, owner_id, course_id, unit_id, topic, length_min, level, style_key, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'building') returning id`,
          [who.collegeId, who.userId, body.course.kind === 'course' ? body.course.courseId : null, body.course.kind === 'course' ? (body.course.unitId ?? null) : null, body.topic, body.lengthMin, body.level, body.styleKey],
        )
      ).rows[0]!.id;
      await c.query(
        `insert into lecture_inputs (lecture_id, college_id, owner_id, must_include_text, example_id, anything_special, filters, ambiguity_choice)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, who.collegeId, who.userId, body.mustInclude?.text || null, body.mustInclude?.exampleId ?? null, body.anythingSpecial || null, body.filters, conceptId],
      );
      return id;
    });
    const job = await buildQueue.add('build.lecture', { lectureId, ownerId: who.userId, collegeId: who.collegeId }, { ...BUILD_JOB_OPTIONS, jobId: `build.lecture-${lectureId}` });
    res.status(202).json(PrepareResponse.parse({ lectureId, jobId: job.id }));
  });

  r.post('/lectures/:id/retry', async (req, res) => {
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
        }>('select * from lectures where id = $1', [id])
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
        counts: { yellow: row.yellow_open, grey: row.grey_open, coverage: row.coverage_open },
        coverageScore: row.coverage_score === null ? null : Number(row.coverage_score),
        partsDone: row.parts_done,
        errorCode: row.error_code,
        createdAt: row.created_at.toISOString(),
        readyAt: row.ready_at?.toISOString() ?? null,
      }),
    );
  });

  r.get('/lectures/:id/slides', async (req, res) => {
    const id = Id.parse(req.params.id);
    const { slides, cits } = await req.db!(async (c) => ({
      slides: (
        await c.query<{ id: string; position: number; part_index: number; layout: string; title: string; body: { content?: LineNode[] }; notes: { content?: LineNode[] } }>(
          'select id, position, part_index, layout, title, body, notes from slides where lecture_id = $1 order by position',
          [id],
        )
      ).rows,
      cits: (
        await c.query<CitationRow>(
          `select c.id, c.slide_id, c.line_key, c.tag, c.source_label, c.check_status, c.flag_kind, c.flag_reason, c.risk,
                  s.status::text as source_status, cs.status as case_status
             from citations c left join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id
            where c.lecture_id = $1 order by c.created_at`,
          [id],
        )
      ).rows,
    }));
    const byLine = new Map<string, CitationRow[]>();
    for (const c of cits) byLine.set(`${c.slide_id}|${c.line_key}`, [...(byLine.get(`${c.slide_id}|${c.line_key}`) ?? []), c]);
    const out: StudioSlide[] = slides.map((s) => ({
      id: s.id,
      position: s.position,
      partIndex: s.part_index,
      layout: s.layout,
      title: s.title,
      lines: (s.body.content ?? []).map((n) => lineFrom(n, byLine.get(`${s.id}|${n.attrs?.lineKey}`) ?? [])),
      notes: (s.notes.content ?? []).map((n) => lineFrom(n, byLine.get(`${s.id}|${n.attrs?.lineKey}`) ?? [])),
    }));
    res.json(StudioSlides.parse({ slides: out }));
  });

  // Click-to-source (STUDIO-3): the stored span always; the paragraph or section while the library still holds it.
  r.get('/citations/:id/source', async (req, res) => {
    const id = Id.parse(req.params.id);
    const out = await req.db!(async (c) => {
      const row = (
        await c.query<{ id: string; claim_text: string; span_text: string; source_label: string | null; chunk_id: string | null; checks: { name: string; result: string; detail: string | null }[]; title: string | null; url: string | null; source_type: string | null; source_status: string | null; case_status: string | null }>(
          `select c.id, c.claim_text, c.span_text, c.source_label, c.chunk_id, c.checks, s.title, s.url, s.type::text source_type, s.status::text source_status, cs.status case_status
             from citations c left join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id where c.id = $1`,
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
      }),
    );
  });

  r.get('/lectures/:id/coverage', async (req, res) => {
    const id = Id.parse(req.params.id);
    const { items, plan } = await req.db!(async (c) => ({
      items: (
        await c.query<{ id: string; section_key: string; item_kind: string; item_label: string | null; state: 'covered' | 'missing' | 'left_out_by_teacher'; reason: string | null }>(
          'select id, section_key, item_kind, item_label, state, reason from coverage_items where lecture_id = $1 order by section_key, item_label',
          [id],
        )
      ).rows,
      plan: (await c.query<{ plan: { notFound?: { partIndex: number; question: string }[] } | null; coverage_score: string | null }>('select plan, coverage_score from lectures where id = $1', [id])).rows[0],
    }));
    if (!plan) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
    const toItem = (i: (typeof items)[number]) => ({ id: i.id, sectionKey: i.section_key, kind: i.item_kind as 'clause', label: i.item_label ?? i.section_key, state: i.state, reason: i.reason });
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
