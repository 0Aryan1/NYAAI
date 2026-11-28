import { z } from 'zod';
import { NextCursor } from './responses.ts';

/** What a teacher may upload as her own notes, by media type. */
export const NOTE_MIME_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
} as const;
export type NoteKind = (typeof NOTE_MIME_TYPES)[keyof typeof NOTE_MIME_TYPES];
export const MAX_NOTE_BYTES = 20 * 1024 * 1024;

export const NoteStatus = z.enum(['queued', 'reading', 'ready', 'failed', 'replaced', 'deleted']);

/** One of her documents (GET /notes). Visible only to her. */
export const TeacherNote = z.object({
  id: z.uuid(),
  title: z.string(),
  fileName: z.string(),
  status: NoteStatus,
  /** Heading blocks read from it, once ready. */
  sections: z.number().int().nullable(),
  /** Why it could not be read, in plain words. */
  error: z.string().nullable(),
  uploadedAt: z.string(),
  /** The older version this one replaces. */
  replaces: z.object({ id: z.uuid(), title: z.string() }).nullable(),
});
export type TeacherNote = z.infer<typeof TeacherNote>;
export const TeacherNoteList = z.object({ notes: z.array(TeacherNote), nextCursor: NextCursor });
export type TeacherNoteList = z.infer<typeof TeacherNoteList>;

/** POST /notes?title=…&fileName=…[&replaces=…] with the file as the body (its media type in Content-Type). */
export const UploadNoteQuery = z.object({
  title: z.string().trim().min(2).max(200),
  fileName: z.string().trim().min(1).max(255),
  replaces: z.uuid().optional(),
});
export type UploadNoteQuery = z.infer<typeof UploadNoteQuery>;

/** POST /me/delete-data (BRD NFR-8): she types her own email to confirm; everything about her is deleted. */
export const DeleteMyData = z.object({ confirmEmail: z.string().trim().min(3).max(320) });
export type DeleteMyData = z.infer<typeof DeleteMyData>;
