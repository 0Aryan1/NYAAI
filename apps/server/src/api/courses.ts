/**
 * Courses and the series (BRD COURSE-1 to COURSE-7, HLD F8; LLD §4 /courses). A course is her plan of lectures
 * (`course_units`); each unit keeps the memory of its taught lecture. Series checks are suggestions only: nothing
 * here changes the plan unless she asks.
 *
 * Syllabus upload (COURSE-2, DATA-3): POST /courses/syllabus reads her file into units and topics and returns them;
 * nothing is kept. She edits the list, then POST /courses makes the course; with `findSources`, the worker looks for
 * the sources of every lecture in the background (`ingest.syllabus`) and the plan shows what it found.
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import {
  defaultPer,
  readSyllabus,
  seriesChecks,
  syllabusLectures,
  syllabusLines,
  syllabusPdfLines,
  type NoteBlock,
} from '@nyaai/legal';
import {
  CourseDetail,
  CourseList,
  CreateCourse,
  MAX_NOTE_BYTES,
  NOTE_MIME_TYPES,
  SyllabusPreview,
  UnitSources,
  UpdateCourse,
  UpdateUnits,
  type CourseUnitView,
} from '@nyaai/shared';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';
import { docxBlocks, NoteReadError } from '../services/ingest/note.ts';
import { NoTextLayerError, pdfLines } from '../services/ingest/extract.ts';
import { AppError } from '../errors.ts';
import { consentMessage, hasConsent } from '../middleware/consent.ts';
import { loadUnits, seriesUnits } from '../services/course/index.ts';
import type pg from 'pg';

const Id = z.uuid();

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

/** Her syllabus file, line by line (Word paragraphs, PDF lines, text lines). */
async function syllabusBlocks(bytes: Uint8Array, kind: string): Promise<NoteBlock[]> {
  if (kind === 'docx') return docxBlocks(bytes);
  if (kind === 'pdf') {
    try {
      return syllabusPdfLines(await pdfLines(bytes));
    } catch (err) {
      if (err instanceof NoTextLayerError)
        throw new NoteReadError(
          'This PDF is a scan with no text in it. Upload a Word copy or a typed PDF, or paste the topics.',
        );
      throw err;
    }
  }
  return syllabusLines(new TextDecoder().decode(bytes));
}

async function detail(c: pg.PoolClient, id: string) {
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
  return CourseDetail.parse({
    id: course.id,
    name: course.name,
    semester: course.semester,
    classCount: course.class_count,
    units: view,
    checks: seriesChecks(units, course.class_count),
  });
}

export function coursesRouter(ingestQueue?: Queue<IngestJobData>) {
  const r = express.Router();

  /** Her syllabus, read into units and topics. Read in memory and not kept: she edits the result, then creates. */
  r.post(
    '/courses/syllabus',
    express.raw({ type: Object.keys(NOTE_MIME_TYPES), limit: MAX_NOTE_BYTES }),
    async (req, res) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const kind = NOTE_MIME_TYPES[mime as keyof typeof NOTE_MIME_TYPES];
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
      if (!kind)
        throw new AppError('UNSUPPORTED_FILE', 'Upload the syllabus as a Word document (.docx), a PDF or a text file.');
      const classCount = z.coerce.number().int().min(1).max(80).optional().catch(undefined).parse(req.query.classCount);
      let outline;
      try {
        outline = readSyllabus(await syllabusBlocks(bytes, kind));
      } catch (err) {
        if (err instanceof NoteReadError) throw new AppError('UNSUPPORTED_FILE', err.message);
        throw err;
      }
      const perUnit = syllabusLectures(outline, 'unit');
      const perTopic = syllabusLectures(outline, 'topic');
      if (!perUnit.length)
        throw new AppError(
          'VALIDATION_FAILED',
          'We found no lecture topics in this file. Paste the topics instead, one per line.',
        );
      res.json(
        SyllabusPreview.parse({
          courseName: outline.courseName,
          units: outline.units,
          perUnit,
          perTopic,
          suggested: defaultPer(outline, classCount ?? null),
        }),
      );
    },
  );

  r.get('/courses', async (req, res) => {
    const rows = await req.db!(
      async (c) =>
        (
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
        ).rows,
    );
    res.json(
      CourseList.parse({
        courses: rows.map((x) => ({
          id: x.id,
          name: x.name,
          semester: x.semester,
          classCount: x.class_count,
          lectures: x.lectures,
          taught: x.taught,
        })),
      }),
    );
  });

  // COURSE-1, COURSE-2 (a pasted list of topics, or empty).
  r.post('/courses', async (req, res) => {
    const body = CreateCourse.parse(req.body);
    const who = req.identity!;
    const out = await req.db!(async (c) => {
      const id = (
        await c.query<{ id: string }>(
          'insert into courses (college_id, owner_id, name, semester, class_count) values ($1, $2, $3, $4, $5) returning id',
          [who.collegeId, who.userId, body.name, body.semester || null, body.classCount ?? null],
        )
      ).rows[0]!.id;
      // DATA-3: each lecture waits for the background source check (its searches use outside services: consent first).
      const waiting = body.findSources && !!ingestQueue && body.topics.length > 0;
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
      return { course: await detail(c, id), waiting };
    });
    if (out.waiting) {
      await ingestQueue!.add(
        'ingest.syllabus',
        { courseId: out.course.id, ownerId: who.userId, collegeId: who.collegeId, requestedBy: who.userId },
        { ...INGEST_JOB_OPTIONS, attempts: 2, jobId: `ingest.syllabus-${out.course.id}` },
      );
    }
    res.status(201).json(out.course);
  });

  r.get('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(await req.db!((c) => detail(c, id)));
  });

  r.patch('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateCourse.parse(req.body);
    res.json(
      await req.db!(async (c) => {
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
        return detail(c, id);
      }),
    );
  });

  // Archive, not delete: her taught lectures and their memory stay (they may be in other exports).
  r.delete('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!(async (c) => {
      await courseRow(c, id);
      await c.query('update courses set archived_at = now() where id = $1', [id]);
    });
    res.status(204).end();
  });

  // COURSE-3: add, rename, delete, reorder; prerequisites; skip. One transaction.
  r.patch('/courses/:id/units', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateUnits.parse(req.body);
    const who = req.identity!;
    res.json(
      await req.db!(async (c) => {
        await courseRow(c, id);
        const units = await loadUnits(c, id);
        const mine = new Map(units.map((u) => [u.id, u]));
        const known = (ids: string[]) => {
          if (ids.some((x) => !mine.has(x)))
            throw new AppError('NOT_FOUND', 'One of those lectures is not in this course.');
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
        return detail(c, id);
      }),
    );
  });

  // COURSE-6: suggestions only.
  r.get('/courses/:id/series-checks', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(await req.db!(async (c) => ({ checks: (await detail(c, id)).checks })));
  });

  return r;
}
