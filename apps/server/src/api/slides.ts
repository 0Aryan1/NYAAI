/**
 * Studio editing (F7; STUDIO-2, -4, -6, -7; LLD §4, §8.6). Every write answers with the slide as the Studio shows it;
 * changed legal lines are queued for the background check (`check.lines`), which never blocks her typing.
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { AddExample, DownloadRequest, EditSlide, RestoreSlide, SlideVersions, SlideWriteResponse, VerifyLine } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { CHECK_JOB_OPTIONS, type CheckJobData } from '../jobs/queues.ts';
import { addExample, loadSlide, refreshCounts, restoreSlide, saveSlideEdit, verifyLine } from '../services/edit/index.ts';
import { loadStudioSlides } from '../services/studio/index.ts';
import { exportPptx } from '../services/export/index.ts';

const Id = z.uuid();

export function slidesRouter(checkQueue?: Queue<CheckJobData>) {
  const r = express.Router();

  const answer = async (req: express.Request, res: express.Response, slideId: string, lectureId: string, pending: string[] = []) => {
    const who = req.identity!;
    if (pending.length && checkQueue) {
      await checkQueue.add('check.lines', { lectureId, ownerId: who.userId, collegeId: who.collegeId, citationIds: pending }, CHECK_JOB_OPTIONS);
    }
    const slide = (await req.db!((c) => loadStudioSlides(c, lectureId, slideId)))[0];
    if (!slide) throw new AppError('NOT_FOUND', 'We could not find that slide.');
    res.json(SlideWriteResponse.parse({ slide, checking: pending.length }));
  };

  r.patch('/slides/:id', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = EditSlide.parse(req.body);
    const who = req.identity!;
    const out = await req.db!(async (c) => {
      const saved = await saveSlideEdit(c, who, id, body);
      await refreshCounts(c, saved.lectureId);
      return saved;
    });
    await answer(req, res, id, out.lectureId, out.pending);
  });

  r.post('/slides/:id/verify', async (req, res) => {
    const id = Id.parse(req.params.id);
    const { lineKey } = VerifyLine.parse(req.body);
    const lectureId = await req.db!(async (c) => {
      const l = await verifyLine(c, id, lineKey);
      await refreshCounts(c, l);
      return l;
    });
    await answer(req, res, id, lectureId);
  });

  r.post('/slides/:id/examples', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = AddExample.parse(req.body);
    const who = req.identity!;
    const lectureId = await req.db!(async (c) => {
      const l = await addExample(c, who, id, body.text, body.save);
      await refreshCounts(c, l);
      return l;
    });
    await answer(req, res, id, lectureId);
  });

  r.get('/slides/:id/versions', async (req, res) => {
    const id = Id.parse(req.params.id);
    const rows = await req.db!(async (c) => {
      await loadSlide(c, id);
      return (await c.query<{ version: number; reason: string; created_at: Date }>('select version, reason, created_at from slide_versions where slide_id = $1 order by version desc', [id])).rows;
    });
    res.json(SlideVersions.parse({ versions: rows.map((v) => ({ version: v.version, reason: v.reason, createdAt: v.created_at.toISOString() })) }));
  });

  r.post('/slides/:id/restore', requireConsent, async (req, res) => {
    const id = Id.parse(req.params.id);
    const { version } = RestoreSlide.parse(req.body);
    const who = req.identity!;
    const lectureId = await req.db!(async (c) => {
      const l = await restoreSlide(c, who, id, version);
      await refreshCounts(c, l);
      return l;
    });
    await answer(req, res, id, lectureId);
  });

  /**
   * The .pptx (PPT-1 to PPT-4). Built from what is saved and checked; small enough to answer at once (well under the
   * 10 s budget), so no export job yet.
   */
  r.post('/lectures/:id/download', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = DownloadRequest.parse(req.body);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const out = await req.db!((c) => exportPptx(c, req.identity!, id, { ...body, today }));
    if ('coverageChanged' in out) {
      // Thrown after the commit, so the removed lines stay removed (each slide's Undo brings one back).
      throw new AppError('COVERAGE_CHANGED', `Removing the unverified lines left ${out.coverageChanged.length === 1 ? 'one part' : `${out.coverageChanged.length} parts`} of the sections you teach uncovered. Add them, or leave them out, then download again.`, {
        removed: out.removed,
        items: out.coverageChanged,
      });
    }
    res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('content-disposition', `attachment; filename="${out.fileName}"`);
    res.setHeader('x-removed-lines', String(out.removed));
    res.send(out.file);
  });

  return r;
}
