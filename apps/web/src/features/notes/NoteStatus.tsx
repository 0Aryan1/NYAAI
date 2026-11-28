import type { TeacherNote } from '@nyaai/shared';
import { Pill } from '@/shared/ui/pill';
import { busy } from './useNotes';

export function NoteStatus({ note }: { note: TeacherNote }) {
  if (busy(note)) return <Pill tone="grey">Reading…</Pill>;
  if (note.status === 'failed') return <Pill tone="danger">Could not read</Pill>;
  return (
    <span className="text-xs text-muted">
      {note.sections} {note.sections === 1 ? 'section' : 'sections'}
    </span>
  );
}
