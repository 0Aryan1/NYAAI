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
  GapLookupResponse,
  LibraryGap,
  LibraryGapList,
  LibraryGapQuery,
  SourceStatus,
  UpdateGapRequest,
} from '@nyaai/shared';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';

interface GapRow {
  id: string;
  question: string;
  kind: LibraryGap['kind'];
  act_name: string | null;
  act_year: number | null;
  case_name: string | null;
  asks: number;
  teachers: number;
  state: LibraryGap['state'];
  attempts: LibraryGap['attempts'];
  leads: LibraryGap['leads'];
  loaded_source_ids: string[];
  note: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_lookup_at: Date | null;
}

const GAP_COLUMNS = `id, question, kind, act_name, act_year, case_name, asks, teachers, state, attempts, leads, loaded_source_ids, note,
  first_seen_at, last_seen_at, last_lookup_at`;

const toGap = (r: GapRow): LibraryGap =>
  LibraryGap.parse({
    id: r.id,
    question: r.question,
    kind: r.kind,
    actName: r.act_name,
    actYear: r.act_year,
    caseName: r.case_name,
    asks: r.asks,
    teachers: r.teachers,
    state: r.state,
    attempts: r.attempts,
    leads: r.leads,
    loadedSourceIds: r.loaded_source_ids,
    note: r.note,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastSeenAt: r.last_seen_at.toISOString(),
    lastLookupAt: r.last_lookup_at?.toISOString() ?? null,
  });

const Id = z.uuid();

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

  // Most teachers first, then most recent. Row-level security limits rows to her college and GLOBAL.
  r.get('/library/gaps', async (req, res) => {
    const { state } = LibraryGapQuery.parse(req.query);
    const states = state === 'waiting' ? ['open', 'looking', 'loaded'] : state === 'all' ? null : [state];
    const rows = await req.db!(async (c) =>
      (
        await c.query<GapRow>(
          `select ${GAP_COLUMNS} from library_gaps where ($1::gap_state[] is null or state = any($1))
            order by teachers desc, asks desc, last_seen_at desc limit 200`,
          [states],
        )
      ).rows,
    );
    res.json(LibraryGapList.parse({ gaps: rows.map(toGap) }));
  });

  r.patch('/library/gaps/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = UpdateGapRequest.parse(req.body);
    const closing = body.state !== 'open';
    const row = await req.db!(async (c) => {
      const updated = (
        await c.query<GapRow>(
          `update library_gaps
              set state = $2, note = coalesce($3, note),
                  resolved_by = case when $4 then app_user() end, resolved_at = case when $4 then now() end
            where id = $1 returning ${GAP_COLUMNS}`,
          [id, body.state, body.note ?? null, closing],
        )
      ).rows[0];
      // Keep the review queue in step (library editors work the queue; for an admin this changes no rows).
      if (updated) {
        await c.query(
          closing
            ? `update review_queue set state = 'resolved', resolved_at = now(), resolution = jsonb_build_object('gapState', $2::text, 'note', $3::text)
                where ref_id = $1 and kind = 'library_gap' and state in ('open', 'in_progress')`
            : `update review_queue set state = 'open', resolved_at = null where ref_id = $1 and kind = 'library_gap' and state = 'resolved'`,
          closing ? [id, body.state, body.note ?? null] : [id],
        );
      }
      return updated;
    });
    if (!row) throw new AppError('NOT_FOUND', 'We could not find that gap.');
    res.json(toGap(row));
  });

  r.post('/library/gaps/:id/lookup', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Looking up sources is not available right now.');
    const id = Id.parse(req.params.id);
    const state = await req.db!(async (c) => (await c.query<{ state: string }>('select state from library_gaps where id = $1', [id])).rows[0]?.state);
    if (!state) throw new AppError('NOT_FOUND', 'We could not find that gap.');
    if (state === 'resolved' || state === 'wont_fill') throw new AppError('GAP_CLOSED', 'This gap is closed. Reopen it first.');
    // One job per gap per minute: a double click runs once, a later click runs again.
    const job = await ingestQueue.add(
      'ingest.lookup',
      { gapId: id, force: true, requestedBy: req.identity!.userId },
      { ...INGEST_JOB_OPTIONS, attempts: 1, jobId: `ingest.lookup-${id}-${Math.floor(Date.now() / 60_000)}` },
    );
    res.status(202).json(GapLookupResponse.parse({ jobId: job.id }));
  });

  return r;
}
