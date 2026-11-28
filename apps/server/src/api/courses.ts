/**
 * Courses and the series (BRD COURSE-1 to COURSE-7, HLD F8; LLD §4 /courses). Rules live in services/course.
 *   POST   /courses/syllabus      her syllabus read into units and topics (nothing kept)
 *   GET    /courses               her courses
 *   POST   /courses               a new course (201); with findSources, the worker looks for every lecture's sources
 *   GET    /courses/:id           the plan · PATCH /courses/:id  name, semester, classes · DELETE  archive
 *   PATCH  /courses/:id/units     add, rename, delete, reorder, prerequisites, skip
 *   GET    /courses/:id/series-checks  suggestions only (COURSE-6)
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import {
  CourseDetail,
  CourseList,
  CreateCourse,
  MAX_NOTE_BYTES,
  NOTE_MIME_TYPES,
  SeriesChecks,
  SyllabusPreview,
  UpdateCourse,
  UpdateUnits,
} from '@nyaai/shared';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';
import { AppError } from '../errors.ts';
import {
  archiveCourse,
  courseDetail,
  createCourse,
  markSourcesNotChecked,
  listCourses,
  updateCourse,
  updateUnits,
} from '../services/course/plan.ts';
import { previewSyllabus } from '../services/course/syllabus.ts';

const Id = z.uuid();

export function coursesRouter(ingestQueue?: Queue<IngestJobData>) {
  const r = express.Router();

  r.post(
    '/courses/syllabus',
    express.raw({ type: Object.keys(NOTE_MIME_TYPES), limit: MAX_NOTE_BYTES }),
    async (req, res) => {
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const kind = NOTE_MIME_TYPES[mime as keyof typeof NOTE_MIME_TYPES];
      if (!kind)
        throw new AppError('UNSUPPORTED_FILE', 'Upload the syllabus as a Word document (.docx), a PDF or a text file.');
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
      const classCount = z.coerce.number().int().min(1).max(80).optional().catch(undefined).parse(req.query.classCount);
      res.json(SyllabusPreview.parse(await previewSyllabus(bytes, kind, classCount ?? null)));
    },
  );

  r.get('/courses', async (req, res) => {
    res.json(CourseList.parse(await req.db!(listCourses)));
  });

  r.post('/courses', async (req, res) => {
    const body = CreateCourse.parse(req.body);
    const who = req.identity!;
    const out = await req.db!((c) => createCourse(c, who, body, !!ingestQueue));
    if (out.waiting) {
      // The course is made either way; if the source check cannot be queued, its lectures say "not checked" (they
      // are checked when she prepares each one) instead of "waiting" for ever.
      try {
        await ingestQueue!.add(
          'ingest.syllabus',
          { courseId: out.course.id, ownerId: who.userId, collegeId: who.collegeId, requestedBy: who.userId },
          { ...INGEST_JOB_OPTIONS, attempts: 2, jobId: `ingest.syllabus-${out.course.id}` },
        );
      } catch (err) {
        req.log.error({ err, courseId: out.course.id }, 'the syllabus source check could not be queued');
        out.course = await req.db!((c) => markSourcesNotChecked(c, out.course.id));
      }
    }
    res.status(201).json(CourseDetail.parse(out.course));
  });

  r.get('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(CourseDetail.parse(await req.db!((c) => courseDetail(c, id))));
  });

  r.patch('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateCourse.parse(req.body);
    res.json(CourseDetail.parse(await req.db!((c) => updateCourse(c, id, body))));
  });

  r.delete('/courses/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => archiveCourse(c, id));
    res.status(204).end();
  });

  r.patch('/courses/:id/units', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateUnits.parse(req.body);
    res.json(CourseDetail.parse(await req.db!((c) => updateUnits(c, req.identity!, id, body))));
  });

  r.get('/courses/:id/series-checks', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(SeriesChecks.parse({ checks: (await req.db!((c) => courseDetail(c, id))).checks }));
  });

  return r;
}
