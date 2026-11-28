import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { errorText } from '@/shared/lib/errors';

/**
 * "Report a wrong fact" (ADM-2, HLD F12): the line and the source words it rests on go to the library team, with
 * her note if she adds one. The team answers within a day; the answer shows on the line.
 */
export function ReportDialog({
  lectureId,
  slideId,
  lineKey,
  text,
  onClose,
}: {
  lectureId: string;
  slideId: string;
  lineKey: string;
  text: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reportLine(lectureId, { slideId, lineKey, note: note.trim() || undefined });
      await qc.invalidateQueries({ queryKey: queryKeys.lectureReports(lectureId) });
      setSent(true);
    } catch (err) {
      setError(errorText(err, 'The report was not sent. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={
        <>
          <Flag className="size-4" aria-hidden />
          Report a wrong fact
        </>
      }
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={() => close()}>{sent ? 'Close' : 'Cancel'}</Button>
          {!sent && (
            <Button variant="primary" disabled={busy} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send report'}
            </Button>
          )}
        </>
      )}
    >
      <blockquote className="border-l-2 border-flag-yellow pl-3">{text}</blockquote>
      {sent ? (
        <p role="status">
          Thank you. The library team will check this line and its source within a day; the answer will show on the
          line.
        </p>
      ) : (
        <>
          <p className="text-muted">
            The line and the source words it rests on go to the library team. Your lecture stays private.
          </p>
          <label className="block">
            <span className="mb-1 block font-medium">What is wrong? (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-control border border-border bg-bg px-3 py-2"
              placeholder="e.g. The Act says “may”, not “must”."
            />
          </label>
          {error && <p className="text-danger">{error}</p>}
        </>
      )}
    </Dialog>
  );
}
