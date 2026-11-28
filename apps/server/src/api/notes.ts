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
import { listNotes, noteStorageKey, recordNote, removeNote } from '../services/notes/index.ts';
import { pageFrom } from '../lib/page.ts';

const Id = z.uuid();

export function notesRouter(ingestQueue: Queue<IngestJobData> | undefined, storage: Storage | undefined) {
  const r = express.Router();

  r.get('/notes', async (req, res) => {
    const page = pageFrom(req.query, { default: 200, max: 500 });
    res.json(TeacherNoteList.parse(await req.db!((c) => listNotes(c, page))));
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
      const key = noteStorageKey(who, id, kind);
      await storage.put(key, bytes, mime);
      const note = await req.db!((c) =>
        recordNote(c, who, {
          id,
          fileName: q.fileName,
          mime,
          sizeBytes: bytes.byteLength,
          key,
          title: q.title,
          replaces: q.replaces,
        }),
      );
      await ingestQueue.add(
        'ingest.upload',
        { uploadId: id, ownerId: who.userId, collegeId: who.collegeId, requestedBy: who.userId },
        { ...INGEST_JOB_OPTIONS, jobId: `ingest.upload-${id}` },
      );
      res.status(202).json(TeacherNote.parse(note));
    },
  );

  r.delete('/notes/:id', async (req, res) => {
    if (!ingestQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Removing documents is not available right now.');
    const id = Id.parse(req.params.id);
    await req.db!((c) => removeNote(c, id));
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
