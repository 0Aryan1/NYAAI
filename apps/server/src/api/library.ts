/**
 * Library sources (LIB-1, F2): a library editor or admin adds an official statute; ingestion runs in the
 * worker as nyaai_library. The job payload holds the source id only (HLD D4).
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { CreateSourceRequest, CreateSourceResponse, SourceStatus } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';

export function libraryRouter(ingestQueue: Queue<IngestJobData> | undefined) {
  const r = express.Router();
  r.use('/library', requireRole('library_editor', 'admin'));

  r.post('/library/sources', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Loading sources is not available right now.');
    const body = CreateSourceRequest.parse(req.body);
    const sourceId = await req.db!(async (c) =>
      (
        await c.query<{ id: string }>(
          `insert into sources (college_id, visibility, type, origin, title, act_name, act_year, url, content_hash)
           values (global_college(), 'shared', $1, $2, $3, $4, $5, $6, 'pending:' || gen_random_uuid())
           returning id`,
          [body.type, body.origin, body.title, body.actName, body.actYear ?? null, body.url],
        )
      ).rows[0]!.id,
    );
    let job;
    try {
      // BullMQ custom ids may not contain ':'. One job per source keeps a double click idempotent.
      job = await ingestQueue.add('ingest.source', { sourceId, requestedBy: req.identity!.userId }, { ...INGEST_JOB_OPTIONS, jobId: `ingest.source-${sourceId}` });
    } catch (err) {
      await req.db!((c) => c.query('delete from sources where id = $1', [sourceId]));
      throw err;
    }
    res.status(202).json(CreateSourceResponse.parse({ sourceId, jobId: job.id }));
  });

  r.get('/library/sources/:id', async (req, res) => {
    const row = await req.db!(async (c) =>
      (
        await c.query<{ id: string; title: string; status: SourceStatus['status']; fetched_at: Date | null; chunk_count: number }>(
          `select s.id, s.title, s.status, s.fetched_at, (select count(*)::int from chunks k where k.source_id = s.id) as chunk_count
             from sources s where s.id = $1`,
          [req.params.id],
        )
      ).rows[0],
    );
    if (!row) throw new AppError('NOT_FOUND', 'We could not find that source.');
    res.json(SourceStatus.parse({ id: row.id, title: row.title, status: row.status, chunkCount: row.chunk_count, fetchedAt: row.fetched_at?.toISOString() ?? null }));
  });

  return r;
}
