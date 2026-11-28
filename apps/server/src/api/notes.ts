/**
 * A teacher's own notes (migration 0013, BRD DATA-5). Every row is hers alone (row security on uploads, sources and
 * chunks). She uploads a document; the worker reads it as her (`ingest.upload`, ids only in the job). A lecture uses
 * only the notes she attaches to it (POST /lectures `notes`).
 *
 *   GET    /notes                     her documents, newest first (not deleted, not replaced)
 *   POST   /notes?title&fileName[&replaces]   the file as the body; 202 with the new document
 *   DELETE /notes/:id                 taken out of search at once; lectures already built keep their saved words
 */
import express from 'express';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_NOTE_BYTES, NOTE_MIME_TYPES, TeacherNote, TeacherNoteList, UploadNoteQuery } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import { INGEST_JOB_OPTIONS, type IngestJobData } from '../jobs/queues.ts';
import type { Storage } from '../services/storage/index.ts';

const Id = z.uuid();

interface Row {
  id: string;
  title: string | null;
  file_name: string;
  status: TeacherNote['status'];
  sections: number | null;
  error: string | null;
  created_at: Date;
  replaces_id: string | null;
  replaces_title: string | null;
}

const SELECT = `select u.id, u.title, u.file_name, u.status, u.sections, u.error, u.created_at,
                       o.id as replaces_id, coalesce(o.title, o.file_name) as replaces_title
                  from uploads u left join uploads o on o.id = u.replaces`;

const toNote = (x: Row): TeacherNote => ({
  id: x.id,
  title: x.title ?? x.file_name,
  fileName: x.file_name,
  status: x.status,
  sections: x.sections,
  error: x.error,
  uploadedAt: x.created_at.toISOString(),
  replaces: x.replaces_id ? { id: x.replaces_id, title: x.replaces_title! } : null,
});

export function notesRouter(ingestQueue: Queue<IngestJobData> | undefined, storage: Storage | undefined) {
  const r = express.Router();

  r.get('/notes', async (req, res) => {
    const rows = await req.db!(
      async (c) =>
        (await c.query<Row>(`${SELECT} where u.status not in ('deleted', 'replaced') order by u.created_at desc`)).rows,
    );
    res.json(TeacherNoteList.parse({ notes: rows.map(toNote) }));
  });

  r.post(
    '/notes',
    requireConsent,
    express.raw({ type: Object.keys(NOTE_MIME_TYPES), limit: MAX_NOTE_BYTES }),
    async (req, res) => {
      if (!ingestQueue || !storage) throw new AppError('SERVICE_UNAVAILABLE', 'Uploading is not available right now.');
      const q = UploadNoteQuery.parse(req.query);
      const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      const kind = NOTE_MIME_TYPES[mime as keyof typeof NOTE_MIME_TYPES];
      const bytes = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array();
      if (!kind) throw new AppError('UNSUPPORTED_FILE', 'Upload a Word document (.docx), a PDF or a text file.');
      if (bytes.byteLength < 2) throw new AppError('VALIDATION_FAILED', 'That file is empty.');
      const who = req.identity!;
      const id = randomUUID();
      // Her private space: the key names her college and her, never shared with the library.
      const key = `private/${who.collegeId}/${who.userId}/${id}.${kind}`;
      await storage.put(key, bytes, mime);
      const note = await req.db!(async (c) => {
        if (q.replaces) {
          const old = (
            await c.query("select 1 from uploads where id = $1 and status not in ('deleted', 'replaced')", [q.replaces])
          ).rowCount;
          if (!old) throw new AppError('NOT_FOUND', 'We could not find the document this one should replace.');
        }
        await c.query(
          `insert into uploads (id, college_id, owner_id, file_name, mime, size_bytes, storage_key, title, replaces, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')`,
          [id, who.collegeId, who.userId, q.fileName, mime, bytes.byteLength, key, q.title, q.replaces ?? null],
        );
        return (await c.query<Row>(`${SELECT} where u.id = $1`, [id])).rows[0]!;
      });
      await ingestQueue.add(
        'ingest.upload',
        { uploadId: id, ownerId: who.userId, collegeId: who.collegeId, requestedBy: who.userId },
        { ...INGEST_JOB_OPTIONS, jobId: `ingest.upload-${id}` },
      );
      res.status(202).json(TeacherNote.parse(toNote(note)));
    },
  );

  r.delete('/notes/:id', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Removing documents is not available right now.');
    const id = Id.parse(req.params.id);
    const ok = await req.db!(
      async (c) =>
        (
          await c.query("update uploads set status = 'deleted' where id = $1 and status <> 'deleted' returning id", [
            id,
          ])
        ).rowCount,
    );
    if (!ok) throw new AppError('NOT_FOUND', 'We could not find that document.');
    // The worker takes its text out of search (its private source and chunks are hers to change, as the worker).
    const who = req.identity!;
    await ingestQueue.add(
      'ingest.upload',
      { uploadId: id, ownerId: who.userId, collegeId: who.collegeId, requestedBy: who.userId },
      { ...INGEST_JOB_OPTIONS, jobId: `ingest.upload-${id}-remove` },
    );
    res.status(204).end();
  });

  return r;
}
