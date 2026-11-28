/**
 * Old ↔ new criminal law mapping rows, kept by the library editor (DATA-6, HLD 5.2 g, LIB-1). Rules live in
 * services/mappings.
 *   GET    /library/mappings?show=unsigned|all   rows, newest first; unsigned count
 *   POST   /library/mappings                     a new row (unsigned)
 *   PATCH  /library/mappings/:id                 change a row: its signature is removed, it must be signed again
 *   POST   /library/mappings/:id/sign            the criminal-law expert signs it
 *   DELETE /library/mappings/:id/sign            undo a signature
 *   DELETE /library/mappings/:id                 remove a row
 * A change to a signed row queues `ops.mapping_changed` inside the change's own transaction: if the commit then fails,
 * lines are only checked again without need (the safe side); a job lost after a commit would leave lines green with
 * no signed row under them.
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import { LawMapping, LawMappingList, SaveLawMapping } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { MAPPING_JOB_OPTIONS, type OpsJobData } from '../jobs/queues.ts';
import {
  changeMapping,
  createMapping,
  listMappings,
  removeMapping,
  signMapping,
  unsignMapping,
  type OnSignedChange,
} from '../services/mappings/index.ts';
import { enqueueOrUndo } from '../jobs/enqueue.ts';

const Id = z.uuid();

export function mappingsRouter(opsQueue?: Queue<OpsJobData>) {
  const r = express.Router();
  r.use('/library/mappings', requireRole('library_editor'));

  /** Queues the re-flag of lines that relied on the signed row as it was (section numbers only). */
  const reflag =
    (req: express.Request): OnSignedChange =>
    async (was, change) => {
      if (!opsQueue)
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          'Lectures that rely on this row cannot be told right now, so nothing was changed. Try again in a minute.',
        );
      const who = req.identity!;
      // Inside the change's transaction: if the queue refuses, the change is rolled back with the answer below.
      await enqueueOrUndo(
        () =>
          opsQueue.add(
            'ops.mapping_changed',
            {
              userId: who.userId,
              collegeId: who.collegeId,
              mapping: { oldSections: was.oldSections, newSections: was.newSections, relation: was.relation, change },
            },
            MAPPING_JOB_OPTIONS,
          ),
        async () => {},
        'Lectures that rely on this row cannot be told right now, so nothing was changed. Try again in a minute.',
        req.log,
      );
    };

  r.get('/library/mappings', async (req, res) => {
    const show = z.enum(['unsigned', 'all']).catch('unsigned').parse(req.query.show);
    res.json(LawMappingList.parse(await req.db!((c) => listMappings(c, show))));
  });

  r.post('/library/mappings', async (req, res) => {
    const body = SaveLawMapping.parse(req.body);
    res.status(201).json(LawMapping.parse(await req.db!((c) => createMapping(c, body))));
  });

  r.patch('/library/mappings/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SaveLawMapping.parse(req.body);
    res.json(LawMapping.parse(await req.db!((c) => changeMapping(c, id, body, reflag(req)))));
  });

  r.post('/library/mappings/:id/sign', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(LawMapping.parse(await req.db!((c) => signMapping(c, id))));
  });

  r.delete('/library/mappings/:id/sign', async (req, res) => {
    const id = Id.parse(req.params.id);
    res.json(LawMapping.parse(await req.db!((c) => unsignMapping(c, id, reflag(req)))));
  });

  r.delete('/library/mappings/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!((c) => removeMapping(c, id, reflag(req)));
    res.status(204).end();
  });

  return r;
}
