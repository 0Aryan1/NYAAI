import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { NoteStatus, UploadNoteButton, useNotes } from './notes-ui';

/**
 * My notes (BRD DATA-5): her own documents, private to her. A lecture uses only the ones she ticks when she prepares
 * it. "Upload a newer version" replaces a document everywhere it is attached, for lectures prepared from now on.
 */
export function NotesPage() {
  const qc = useQueryClient();
  const notes = useNotes();
  const remove = useMutation({
    mutationFn: api.deleteNote,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notes }),
  });
  const list = notes.data?.notes ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My notes</h1>
        <UploadNoteButton size="md" />
      </div>
      <p className="mb-6 max-w-prose text-sm text-muted">
        Your own documents, seen only by you. When you prepare a lecture, tick the ones it should use; the others are
        left out. Slides may use your notes for examples and explanations; a point of law still comes from the Act or a
        judgment.
      </p>

      {notes.isLoading && <ListSkeleton label="Loading your notes" />}
      {notes.isError && <LoadError what="Your notes" onRetry={() => void notes.refetch()} />}
      {notes.isSuccess && list.length === 0 && (
        <EmptyState title="No documents yet" action={<UploadNoteButton size="md" />}>
          Upload your own notes as a Word file, a PDF or a text file. When you prepare a lecture, you choose which of
          them it may use.
        </EmptyState>
      )}
      <ul className="space-y-3">
        {list.map((n) => (
          <li key={n.id} className="rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{n.title}</p>
                <p className="text-xs text-muted">
                  {n.fileName} · uploaded{' '}
                  {new Date(n.uploadedAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {n.replaces && ` · replaces ${n.replaces.title}`}
                </p>
                {n.error && <p className="mt-1 text-sm text-danger">{n.error}</p>}
              </div>
              <NoteStatus note={n} />
            </div>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              {n.status === 'ready' && <UploadNoteButton label="Upload a newer version" replaces={n.id} />}
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(`Remove “${n.title}”? Lectures already prepared keep the words they quoted from it.`)
                  )
                    remove.mutate(n.id);
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
