/**
 * Library sources (LIB-1, F2): a library editor or admin adds an official statute; ingestion runs in the
 * worker as nyaai_library. The job payload holds the source id only (HLD D4).
 *
 * Library gaps (migration 0004): the list of questions the library could not answer, with what the automatic
 * lookup tried and links on official sites; the editor closes, reopens or re-runs the lookup for each.
 */
import express from 'express';
import type { Queue } from 'bullmq';
import {
  CreateSourceRequest,
  CreateSourceResponse,
  UploadJudgmentQuery,
  UploadJudgmentResponse,
  UploadJudgmentStatus,
  GapLookupResponse,
  LibraryGap,
  LibraryGapList,
  LibraryGapQuery,
  SourceStatus,
  UpdateGapRequest,
} from '@nyaai/shared';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';
import type { Storage } from '../services/storage/index.ts';
import type { JudgmentPdfResult } from '../services/ingest/judgment-pdf.ts';
import { sha256 } from '../lib/hash.ts';
import {
  assertGapOpen,
  createSource,
  deletePendingSource,
  listGaps,
  registerJudgmentUpload,
  sourceStatus,
  updateGap,
} from '../services/library-edit/index.ts';
import { pageFrom } from '../lib/page.ts';

const Id = z.uuid();

export function libraryRouter(ingestQueue: Queue<IngestJobData> | undefined, storage?: Storage, maxUploadMb = 50) {
  const MAX_UPLOAD = maxUploadMb * 1024 * 1024;
  const r = express.Router();

  r.post('/library/sources', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Loading sources is not available right now.');
    const body = CreateSourceRequest.parse(req.body);
    const sourceId = await req.db!((c) => createSource(c, body));
    let job;
    try {
      // BullMQ custom ids may not contain ':'. One job per source keeps a double click idempotent.
      job = await ingestQueue.add(
        'ingest.source',
        { sourceId, requestedBy: req.identity!.userId },
        { ...INGEST_JOB_OPTIONS, jobId: `ingest.source-${sourceId}` },
      );
    } catch (err) {
      await req.db!((c) => deletePendingSource(c, sourceId));
      throw err;
    }
    res.status(202).json(CreateSourceResponse.parse({ sourceId, jobId: job.id }));
  });

  r.get('/library/sources/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const status = await req.db!((c) => sourceStatus(c, id));
    if (!status) throw new AppError('NOT_FOUND', 'We could not find that source.');
    res.json(SourceStatus.parse(status));
  });

  r.get('/library/gaps', async (req, res) => {
    const { state } = LibraryGapQuery.parse(req.query);
    const page = pageFrom(req.query, { default: 200, max: 500 });
    res.json(LibraryGapList.parse(await req.db!((c) => listGaps(c, state, page))));
  });

  r.patch('/library/gaps/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateGapRequest.parse(req.body);
    res.json(LibraryGap.parse(await req.db!((c) => updateGap(c, id, body))));
  });

  r.post('/library/gaps/:id/lookup', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Looking up sources is not available right now.');
    const id = Id.parse(req.params.id);
    await req.db!((c) => assertGapOpen(c, id));
    // Every click runs a lookup: the page shows its progress until it ends. Two at once on one gap cannot happen, as
    // the job claims the gap first (a second one finds it "looking" and stops), and the button waits for the result.
    const job = await ingestQueue.add(
      'ingest.lookup',
      { gapId: id, force: true, requestedBy: req.identity!.userId },
      { ...INGEST_JOB_OPTIONS, attempts: 1, jobId: `ingest.lookup-${id}-${Date.now()}` },
    );
    res.status(202).json(GapLookupResponse.parse({ jobId: job.id }));
  });

  /**
   * A judgment PDF the editor has (an official court website's copy, or the college's own). Stored as it is, then read
   * in the worker like any official PDF (services/ingest/judgment-pdf.ts). The job carries ids and the storage key only.
   */
  r.post('/library/uploads/judgment', express.raw({ type: 'application/pdf', limit: MAX_UPLOAD }), async (req, res) => {
    if (!ingestQueue || !storage) throw new AppError('SERVICE_UNAVAILABLE', 'Uploading is not available right now.');
    const q = UploadJudgmentQuery.parse(req.query);
    const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
    if (bytes.byteLength < 100 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new AppError('NOT_A_PDF', 'That file is not a PDF. Upload the judgment as a PDF.');
    }
    const origin = q.official ? 'court_site' : 'upload';
    const hash = sha256(bytes);
    const key = `sources/${origin}/${hash}.pdf`;
    const sourceId = await req.db!((c) => registerJudgmentUpload(c, q, { hash, key, origin }));
    if (!(await storage.exists(key))) await storage.put(key, bytes, 'application/pdf');
    const job = await ingestQueue.add(
      'ingest.judgment',
      { sourceId, uploadKey: key, replace: !!q.replaces, official: q.official, requestedBy: req.identity!.userId },
      { ...INGEST_JOB_OPTIONS, attempts: 1, jobId: `ingest.judgment-${sourceId}-${hash.slice(0, 12)}` },
    );
    res.status(202).json(UploadJudgmentResponse.parse({ jobId: job.id, sourceId }));
  });

  r.get('/library/uploads/:jobId', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Uploading is not available right now.');
    const jobId = z
      .string()
      .regex(/^ingest\.judgment-[0-9a-f-]{36}-[0-9a-f]{12}$/)
      .parse(req.params.jobId);
    const job = await ingestQueue.getJob(jobId);
    if (!job || job.data.requestedBy !== req.identity!.userId)
      throw new AppError('NOT_FOUND', 'We could not find that upload.');
    const state = await job.getState();
    const result = job.returnvalue as JudgmentPdfResult | null;
    const outcome =
      state === 'completed' && result
        ? {
            kind: result.kind,
            sourceId: result.sourceId,
            paragraphs: result.kind === 'loaded' ? result.paragraphs : null,
            scanned: result.kind === 'loaded' ? result.scanned : null,
            agreement: 'agreement' in result ? result.agreement : null,
            status: result.kind === 'loaded' ? result.status : null,
          }
        : null;
    res.json(
      UploadJudgmentStatus.parse({
        state:
          state === 'completed' ? 'done' : state === 'failed' ? 'failed' : state === 'active' ? 'reading' : 'waiting',
        outcome,
        message:
          state === 'failed'
            ? job.failedReason?.includes('text layer')
              ? 'This PDF is a picture with no text in it. Upload a copy with selectable text.'
              : 'We could not read this PDF.'
            : null,
      }),
    );
  });

  return r;
}
