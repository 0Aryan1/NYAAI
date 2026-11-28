/** Her own notes: list, upload (a newer version replaces an older one), remove (DATA-5). */
import { TeacherNote, TeacherNoteList } from '@nyaai/shared';
import { fileType } from '@/shared/lib/files';
import { call, sendFile } from './http';

export const notesApi = {
  notes: () => call('GET', '/notes', { parse: (v) => TeacherNoteList.parse(v) }),
  /** Her document, sent as it is (its type says what it is); read in the worker as hers. */
  uploadNote: (file: File, title: string, replaces?: string) => {
    const params = new URLSearchParams({ title, fileName: file.name });
    if (replaces) params.set('replaces', replaces);
    return sendFile(`/notes?${params.toString()}`, file, fileType(file), (v) => TeacherNote.parse(v));
  },
  deleteNote: (id: string) => call<void>('DELETE', `/notes/${id}`),
};

export const notesKeys = {
  notes: ['notes'] as const,
};
