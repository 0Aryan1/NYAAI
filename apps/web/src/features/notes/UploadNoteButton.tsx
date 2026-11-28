import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import type { TeacherNote } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { errorText } from '@/shared/lib/errors';
import { DOCUMENT_ACCEPT } from '@/shared/lib/files';

/** A button that uploads one document (optionally as a newer version of another) and reports the new note. */
export function UploadNoteButton({
  label = 'Upload a document',
  replaces,
  onUploaded,
  size = 'sm',
}: {
  label?: string;
  replaces?: string;
  onUploaded?: (n: TeacherNote) => void;
  size?: 'sm' | 'md';
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <span className="inline-flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setError(null);
          setSending(true);
          try {
            const note = await api.uploadNote(
              file,
              file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || 'My notes',
              replaces,
            );
            await qc.invalidateQueries({ queryKey: queryKeys.notes });
            onUploaded?.(note);
          } catch (err) {
            setError(errorText(err, 'The upload did not go through. Try again.'));
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
