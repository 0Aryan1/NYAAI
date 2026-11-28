/**
 * Her data (BRD NFR-8, LLD §4 "Live and privacy"; DPDP Act, 2023):
 *   GET  /me/export-data   a zip of everything about her, made now from her own rows (see services/account)
 *   POST /me/delete-data   she types her email to confirm; `ops.delete_user_data` deletes everything about her, and
 *                          she is signed out at once (her account is closed when the job runs, seconds later)
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { DeleteMyData, JobAccepted } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { CSRF_COOKIE } from '../auth/csrf.ts';
import { SESSION_COOKIE } from '../auth/session.ts';
import type { OpsJobData } from '../jobs/queues.ts';
import { assertOwnEmail, exportTeacherData } from '../services/account/index.ts';
import type { Storage } from '../services/storage/index.ts';
import { enqueueOrUndo } from '../jobs/enqueue.ts';

export function accountRouter(opsQueue: Queue<OpsJobData> | undefined, storage: Storage | undefined) {
  const r = express.Router();

  r.get('/me/export-data', async (req, res) => {
    const who = req.identity!;
    const zip = await req.db!((c) => exportTeacherData(c, who, storage));
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="nyaai-my-data-${day}.zip"`);
    res.setHeader('cache-control', 'no-store');
    res.send(Buffer.from(zip));
  });

  r.post('/me/delete-data', async (req, res) => {
    if (!opsQueue)
      throw new AppError('SERVICE_UNAVAILABLE', 'Deleting your data is not available right now. Try again later.');
    const body = DeleteMyData.parse(req.body);
    const who = req.identity!;
    await req.db!((c) => assertOwnEmail(c, body.confirmEmail));
    const job = await enqueueOrUndo(
      () =>
        opsQueue.add(
          'ops.delete_user_data',
          { userId: who.userId, collegeId: who.collegeId },
          {
            jobId: `ops.delete_user_data-${who.userId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        ),
      async () => {}, // nothing was changed yet: she stays signed in and can try again
      'Deleting your data is not available right now. Nothing was deleted; try again in a minute.',
      req.log,
    );
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    res.status(202).json(JobAccepted.parse({ jobId: job.id }));
  });

  return r;
}
