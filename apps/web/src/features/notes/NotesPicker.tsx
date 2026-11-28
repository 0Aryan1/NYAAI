import { LoadError, Skeleton } from '@/shared/ui/states';
import { useNotes } from './useNotes';
import { NoteStatus } from './NoteStatus';
import { UploadNoteButton } from './UploadNoteButton';
import { formatShortDate } from '@/shared/lib/format';

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
      <p className="mb-3 text-sm text-muted">
        Only the documents you tick are used for this lecture. Your other notes are not.
      </p>
      {notes.isLoading && <Skeleton className="mb-3 h-12 w-full" />}
      {notes.isError && <LoadError what="Your notes" onRetry={() => void notes.refetch()} className="mb-3" />}
      {list.length > 0 && (
        <ul className="mb-3 space-y-2">
          {list.map((n) => (
            <li key={n.id}>
              <label className="flex items-start gap-3 rounded-control border border-border bg-bg px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(n.id)}
                  disabled={n.status === 'failed'}
                  onChange={() => toggle(n.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{n.title}</span>
                  <span className="block text-xs text-muted">
                    {n.fileName} · uploaded {formatShortDate(n.uploadedAt)}
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
        Word, PDF or text. Your notes are private to you. Slides may use them for your examples and explanations; a
        point of law still needs the Act or a judgment.
      </p>
    </div>
  );
}
