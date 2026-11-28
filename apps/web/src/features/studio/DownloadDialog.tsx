import { AlertTriangle, CircleHelp, Download } from 'lucide-react';
import type { LectureSummary } from '@nyaai/shared';
import { Button } from '@/shared/ui/button';
import { RadioCards } from '@/shared/ui/radio-cards';
import { useDeckDownload } from './useDeckDownload';
import { Dialog } from '@/shared/ui/dialog';

/**
 * Download (PPT-1 to PPT-4). With open points she either confirms she has seen them (they are written into each
 * slide's speaker notes and a hidden last slide) or removes every unverified line first. Never silently.
 */
export function DownloadDialog({ lecture, onClose }: { lecture: LectureSummary; onClose: () => void }) {
  const { open, mode, setMode, seen, setSeen, busy, error, done, changed, answer, go, ready } =
    useDeckDownload(lecture);

  return (
    <Dialog
      title="Download as PowerPoint"
      onClose={onClose}
      footer={(close) => (
        <>
          <Button onClick={() => close()}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && (
            <Button variant="primary" disabled={!ready || busy} onClick={() => void go()}>
              <Download className="size-4" aria-hidden />
              {busy ? 'Preparing the file…' : 'Download'}
            </Button>
          )}
        </>
      )}
    >
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
                  <span className="text-xs text-muted">{i.answer === 'added' ? 'Added to its slide' : 'Left out'}</span>
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
            Speaker notes carry your notes and every source with its exact words. The slides the class sees stay clean.
          </p>
          {open > 0 ? (
            <RadioCards
              columns={1}
              legendClassName="mb-2 flex items-center gap-2 font-medium text-flag-yellow"
              legend={
                <>
                  <AlertTriangle className="size-4" aria-hidden />
                  {open} {open === 1 ? 'point' : 'points'} still to verify
                </>
              }
              options={[
                {
                  value: 'with_flags',
                  label: 'Download with the points written in',
                  hint: 'Each point goes into its slide’s speaker notes, and a hidden last slide lists them all.',
                },
                {
                  value: 'remove_unverified',
                  label: `Remove the ${open} unverified ${open === 1 ? 'line' : 'lines'} first`,
                  hint: 'They leave the lecture itself, not just the file. Undo on a slide brings one back.',
                },
              ]}
              value={mode}
              onChange={setMode}
            >
              {mode === 'with_flags' && (
                <label className="mt-2 flex items-start gap-2">
                  <input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} className="mt-1" />
                  <span>I have seen the points to verify and will check them before teaching.</span>
                </label>
              )}
            </RadioCards>
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
    </Dialog>
  );
}
