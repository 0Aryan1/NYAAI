import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleHelp, Download, X } from 'lucide-react';
import { CoverageChangedItem, type LectureSummary } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { saveFile } from '@/shared/lib/save-file';
import { Button } from '@/shared/ui/button';

type Mode = 'with_flags' | 'remove_unverified';

/**
 * Download (PPT-1 to PPT-4). With open points she either confirms she has seen them (they are written into each
 * slide's speaker notes and a hidden last slide) or removes every unverified line first. Never silently.
 */
export function DownloadDialog({ lecture, onClose }: { lecture: LectureSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const open = lecture.counts.yellow;
  const [mode, setMode] = useState<Mode>('with_flags');
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 409 COVERAGE_CHANGED (LLD §8.5 step 6): removing the unverified lines left these items uncovered. The removal is
  // kept; she adds or leaves out each one, then downloads again.
  const [changed, setChanged] = useState<{
    removed: number;
    items: (CoverageChangedItem & { answer?: 'added' | 'left_out' })[];
  } | null>(null);
  const answer = async (item: CoverageChangedItem, how: 'added' | 'left_out') => {
    setError(null);
    try {
      if (how === 'added') await api.addCoverage(item.id);
      else await api.leaveOut(item.id);
      setChanged((c) => c && { ...c, items: c.items.map((x) => (x.id === item.id ? { ...x, answer: how } : x)) });
      void qc.invalidateQueries({ queryKey: ['lecture', lecture.id] });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work. Try again.');
    }
  };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.downloadDeck(lecture.id, { mode, acknowledgeOpen: seen });
      saveFile(r.blob, r.fileName);
      setDone(
        r.removed
          ? `Downloaded ${r.fileName}. ${r.removed} unverified ${r.removed === 1 ? 'line was' : 'lines were'} removed from the lecture; Undo on a slide brings a line back.`
          : `Downloaded ${r.fileName}.`,
      );
      if (r.removed) void qc.invalidateQueries({ queryKey: ['lecture', lecture.id] });
    } catch (err) {
      if (err instanceof ApiRequestError && err.body?.error.code === 'COVERAGE_CHANGED') {
        const items = CoverageChangedItem.array().safeParse(err.body.error.details?.items);
        setChanged({ removed: Number(err.body.error.details?.removed ?? 0), items: items.success ? items.data : [] });
        void qc.invalidateQueries({ queryKey: ['lecture', lecture.id] });
      } else setError(err instanceof ApiRequestError ? err.message : 'The download did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const ready = changed ? changed.items.every((i) => i.answer) : !open || mode === 'remove_unverified' || seen;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="dl-title"
      className="m-auto w-full max-w-lg rounded-card border border-border bg-surface p-0 text-text shadow-dialog backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 id="dl-title" className="text-lg font-semibold">
          Download as PowerPoint
        </h2>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          className="rounded-control p-1 text-muted hover:bg-bg"
          aria-label="Close"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-4 px-6 py-5 text-sm">
        {done ? (
          <p>{done}</p>
        ) : changed ? (
          <>
            <p>
              {changed.removed} unverified {changed.removed === 1 ? 'line was' : 'lines were'} removed from the lecture.
              That left {changed.items.length === 1 ? 'this part' : 'these parts'} of the sections you teach uncovered:
            </p>
            <ul className="space-y-2">
              {changed.items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between gap-2 rounded-control bg-flag-coverage-bg px-3 py-2"
                >
                  <span className="font-medium">{i.label}</span>
                  {i.answer ? (
                    <span className="text-xs text-muted">
                      {i.answer === 'added' ? 'Added to its slide' : 'Left out'}
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-1">
                      {i.canAdd && (
                        <Button size="sm" variant="ghost" onClick={() => void answer(i, 'added')}>
                          Add this for me
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void answer(i, 'left_out')}>
                        Leave out
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Undo on a slide brings a removed line back.</p>
            {error && <p className="text-danger">{error}</p>}
          </>
        ) : (
          <>
            <p className="text-muted">
              Speaker notes carry your notes and every source with its exact words. The slides the class sees stay
              clean.
            </p>
            {open > 0 ? (
              <fieldset className="space-y-2">
                <legend className="mb-2 flex items-center gap-2 font-medium text-flag-yellow">
                  <AlertTriangle className="size-4" aria-hidden />
                  {open} {open === 1 ? 'point' : 'points'} still to verify
                </legend>
                {(
                  [
                    [
                      'with_flags',
                      'Download with the points written in',
                      'Each point goes into its slide’s speaker notes, and a hidden last slide lists them all.',
                    ],
                    [
                      'remove_unverified',
                      `Remove the ${open} unverified ${open === 1 ? 'line' : 'lines'} first`,
                      'They leave the lecture itself, not just the file. Undo on a slide brings one back.',
                    ],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      'block cursor-pointer rounded-control border px-3 py-2',
                      mode === value ? 'border-accent bg-accent/10' : 'border-border',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input type="radio" name="dl-mode" checked={mode === value} onChange={() => setMode(value)} />
                      {label}
                    </span>
                    <span className="ml-6 block text-xs text-muted">{hint}</span>
                  </label>
                ))}
                {mode === 'with_flags' && (
                  <label className="mt-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={seen}
                      onChange={(e) => setSeen(e.target.checked)}
                      className="mt-1"
                    />
                    <span>I have seen the points to verify and will check them before teaching.</span>
                  </label>
                )}
              </fieldset>
            ) : (
              <p>Every line is supported or verified by you.</p>
            )}
            {lecture.counts.grey > 0 && (
              <p className="flex gap-2 text-muted">
                <CircleHelp className="mt-0.5 size-4 shrink-0 text-flag-grey" aria-hidden />
                {lecture.counts.grey} {lecture.counts.grey === 1 ? 'line rests' : 'lines rest'} on cases whose status no
                law expert has confirmed yet. They are marked in the speaker notes.
              </p>
            )}
            {error && <p className="text-danger">{error}</p>}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
        <Button onClick={() => dialog.current?.close()}>{done ? 'Close' : 'Cancel'}</Button>
        {!done && (
          <Button variant="primary" disabled={!ready || busy} onClick={() => void go()}>
            <Download className="size-4" aria-hidden />
            {busy ? 'Preparing the file…' : 'Download'}
          </Button>
        )}
      </div>
    </dialog>
  );
}
