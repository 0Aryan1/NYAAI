/**
 * Lectures, the read-only Studio, and the coverage list (F3, F7 reading, COURSE-7; LLD §4.2–4.3). Rules live in
 * services/lectures and services/coverage; editing lives in slides.ts.
 *   POST   /lectures                      prepare: checks, then the build job (202)
 *   POST   /lectures/:id/retry            a failed build runs again (202)
 *   GET    /lectures/:id                  the Studio header
 *   POST   /lectures/:id/taught           mark taught (course memory is written by learn.summary)
 *   DELETE /lectures/:id/taught           undo "taught"
 *   DELETE /lectures/:id/may-need-update  "it's still right"
 *   GET    /lectures/:id/slides           every slide with each line's status and sources
 *   GET    /lectures/:id/coverage         the Coverage tab
 *   GET    /citations/:id/source          the source drawer
 *   POST   /coverage/:id/add              "Add this for me" (201)
 *   POST   /coverage/:id/leave-out        she leaves an item out on purpose
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import {
  CitationSource,
  CoverageAdded,
  CoverageResponse,
  LectureSummary,
  MarkTaught,
  MarkTaughtResponse,
  PrepareLecture,
  PrepareResponse,
  StudioSlides,
} from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { BUILD_JOB_OPTIONS, LEARN_JOB_OPTIONS, type BuildJobData, type LearnJobData } from '../jobs/queues.ts';
import { loadStudioSlides } from '../services/studio/index.ts';
import { coverageView, leaveOut } from '../services/coverage/index.ts';
import { refreshCounts } from '../services/edit/index.ts';
import { addCoverageLine } from '../services/coverage/add-line.ts';
import {
  citationSource,
  clearMayNeedUpdate,
  lectureSummary,
  markForRetry,
  markTaught,
  prepareLecture,
  undoTaught,
} from '../services/lectures/index.ts';

const Id = z.uuid();

export function lecturesRouter(buildQueue: Queue<BuildJobData> | undefined, learnQueue?: Queue<LearnJobData>) {
  const r = express.Router();

  r.post('/lectures', requireConsent, async (req, res) => {
    if (!buildQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Preparing lectures is not available right now.');
    const body = PrepareLecture.parse(req.body);
    const who = req.identity!;
    const lectureId = await req.db!((c) => prepareLecture(c, who, body));
    const job = await buildQueue.add(
      'build.lecture',
      { lectureId, ownerId: who.userId, collegeId: who.collegeId },
      { ...BUILD_JOB_OPTIONS, jobId: `build.lecture-${lectureId}` },
    );
    res.status(202).json(PrepareResponse.parse({ lectureId, jobId: job.id }));
  });

  r.post('/lectures/:id/retry', requireConsent, async (req, res) => {
    if (!buildQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Preparing lectures is not available right now.');
    const id = Id.parse(req.params.id);
    const who = req.identity!;
    await req.db!((c) => markForRetry(c, id));
    const job = await buildQueue.add(
      'build.lecture',
      { lectureId: id, ownerId: who.userId, collegeId: who.collegeId },
      { ...BUILD_JOB_OPTIONS, jobId: `build.lecture-${id}-${Date.now()}` },
    );
    res.status(202).json(PrepareResponse.parse({ lectureId: id, jobId: job.id }));
  });

  r.get('/lectures/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const summary = await req.db!((c) => lectureSummary(c, id));
    if (!summary) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
    res.json(LectureSummary.parse(summary));
  });

  r.post('/lectures/:id/taught', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = MarkTaught.parse(req.body);
    const who = req.identity!;
    const unitId = await req.db!((c) => markTaught(c, who, id, body.taughtOn));
    let memoryJob: string | null = null;
    if (unitId && learnQueue) {
      const job = await learnQueue.add(
        'learn.summary',
        { lectureId: id, ownerId: who.userId, collegeId: who.collegeId },
        { ...LEARN_JOB_OPTIONS, jobId: `learn.summary-${id}-${Date.now()}` },
      );
      memoryJob = job.id ?? null;
    }
    res.json(MarkTaughtResponse.parse({ unitId, memoryJob }));
  });

  r.delete('/lectures/:id/taught', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => undoTaught(c, id));
    res.status(204).end();
  });

  r.delete('/lectures/:id/may-need-update', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => clearMayNeedUpdate(c, id));
    res.status(204).end();
  });

  r.get('/lectures/:id/slides', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(StudioSlides.parse({ slides: await req.db!((c) => loadStudioSlides(c, id)) }));
  });

  r.get('/lectures/:id/coverage', async (req, res) => {
    const id = Id.parse(req.params.id);
    const view = await req.db!((c) => coverageView(c, id));
    if (!view) throw new AppError('NOT_FOUND', 'We could not find that lecture.');
    res.json(CoverageResponse.parse(view));
  });

  r.get('/citations/:id/source', async (req, res) => {
    const id = Id.parse(req.params.id);
    const source = await req.db!((c) => citationSource(c, id));
    if (!source) throw new AppError('NOT_FOUND', 'We could not find that source.');
    res.json(CitationSource.parse(source));
  });

  r.post('/coverage/:id/add', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const out = await req.db!(async (c) => {
      const added = await addCoverageLine(c, req.identity!, id);
      await refreshCounts(c, added.lectureId);
      return added;
    });
    res.status(201).json(CoverageAdded.parse({ slideId: out.slideId, lineKey: out.lineKey }));
  });

  r.post('/coverage/:id/leave-out', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => leaveOut(c, id));
    res.status(204).end();
  });

  return r;
}
