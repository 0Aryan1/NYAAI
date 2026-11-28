/**
 * Download as PowerPoint (PPT-1 to PPT-4), without the dialog. With open points she either confirms she has seen them
 * (they are written into each slide's speaker notes and a hidden last slide) or removes every unverified line first.
 * Never silently. If removing them left part of a section she teaches uncovered (409 COVERAGE_CHANGED, LLD §8.5
 * step 6), the removal is kept and she answers each item (add it to its slide, or leave it out) before downloading.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CoverageChangedItem, type LectureSummary } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { errorText } from '@/shared/lib/errors';
import { saveFile } from '@/shared/lib/save-file';

type DownloadMode = 'with_flags' | 'remove_unverified';

export function useDeckDownload(lecture: LectureSummary) {
  const qc = useQueryClient();
  const open = lecture.counts.yellow;
  const [mode, setMode] = useState<DownloadMode>('with_flags');
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
      void qc.invalidateQueries({ queryKey: queryKeys.lectureAll(lecture.id) });
    } catch (err) {
      setError(errorText(err, 'That did not work. Try again.'));
    }
  };

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
      if (r.removed) void qc.invalidateQueries({ queryKey: queryKeys.lectureAll(lecture.id) });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'COVERAGE_CHANGED') {
        const items = CoverageChangedItem.array().safeParse(err.body?.error.details?.items);
        setChanged({ removed: Number(err.body?.error.details?.removed ?? 0), items: items.success ? items.data : [] });
        void qc.invalidateQueries({ queryKey: queryKeys.lectureAll(lecture.id) });
      } else setError(errorText(err, 'The download did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const ready = changed ? changed.items.every((i) => i.answer) : !open || mode === 'remove_unverified' || seen;

  return { open, mode, setMode, seen, setSeen, busy, error, done, changed, answer, go, ready };
}
