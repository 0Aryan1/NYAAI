import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import type { TeacherNote } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { LoadError, Skeleton } from '@/shared/ui/states';

export const NOTE_ACCEPT = '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

const busy = (n: TeacherNote) => n.status === 'queued' || n.status === 'reading';

/** Her notes, refreshed every two seconds while one is still being read. */
export function useNotes() {
  return useQuery({
    queryKey: queryKeys.notes,
    queryFn: api.notes,
    refetchInterval: (q) => (q.state.data?.notes.some(busy) ? 2000 : false),
  });
}

export function NoteStatus({ note }: { note: TeacherNote }) {
  if (busy(note)) return <Pill tone="grey">Reading…</Pill>;
  if (note.status === 'failed') return <Pill tone="danger">Could not read</Pill>;
  return <span className="text-xs text-muted">{note.sections} {note.sections === 1 ? 'section' : 'sections'}</span>;
}

/** A button that uploads one document (optionally as a newer version of another) and reports the new note. */
export function UploadNoteButton({ label = 'Upload a document', replaces, onUploaded, size = 'sm' }: { label?: string; replaces?: string; onUploaded?: (n: TeacherNote) => void; size?: 'sm' | 'md' }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept={NOTE_ACCEPT}
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setError(null);
          setSending(true);
          try {
            const note = await api.uploadNote(file, file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'My notes', replaces);
            await qc.invalidateQueries({ queryKey: queryKeys.notes });
            onUploaded?.(note);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'The upload did not go through. Try again.');
          } finally {
            setSending(false);
          }
        }}
      />
      <Button size={size} disabled={sending} onClick={() => input.current?.click()}>
        <FileUp className="size-4" aria-hidden />
        {sending ? 'Uploading…' : label}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}

/**
 * Her notes for one lecture (Option A): nothing is ticked until she ticks it, and a document she uploads here is
 * ticked for this lecture. Only ticked documents are used; her other notes are not.
 */
export function NotesPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const notes = useNotes();
  const list = notes.data?.notes ?? [];
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Only the documents you tick are used for this lecture. Your other notes are not.</p>
      {notes.isLoading && <Skeleton className="mb-3 h-12 w-full" />}
      {notes.isError && <LoadError what="Your notes" onRetry={() => void notes.refetch()} className="mb-3" />}
      {list.length > 0 && (
        <ul className="mb-3 space-y-2">
          {list.map((n) => (
            <li key={n.id}>
              <label className="flex items-start gap-3 rounded-control border border-border bg-bg px-3 py-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={selected.includes(n.id)} disabled={n.status === 'failed'} onChange={() => toggle(n.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{n.title}</span>
                  <span className="block text-xs text-muted">
                    {n.fileName} · uploaded {new Date(n.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                  {n.error && <span className="mt-1 block text-xs text-danger">{n.error}</span>}
                </span>
                <NoteStatus note={n} />
              </label>
            </li>
          ))}
        </ul>
      )}
      <UploadNoteButton onUploaded={(n) => onChange([...selected, n.id])} />
      <p className="mt-2 text-xs text-muted">
        Word, PDF or text. Your notes are private to you. Slides may use them for your examples and explanations; a point of law still needs the Act or a judgment.
      </p>
    </div>
  );
}

/** Ticked notes that are not ready yet (Prepare waits for them). */
export function waitingNotes(all: TeacherNote[] | undefined, selected: string[]): TeacherNote[] {
  return (all ?? []).filter((n) => selected.includes(n.id) && n.status !== 'ready');
}
