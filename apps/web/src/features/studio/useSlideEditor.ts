import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EditSlide, SlideLine, SlideWriteResponse, StudioSlide } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { adoptKeys, isConnectionError, optimisticSlide, pendingSaves, toEdit, usePendingSaves } from './pending-saves';
import { errorText } from '@/shared/lib/errors';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const asEdit = (s: StudioSlide, patch: Partial<Pick<EditSlide, 'title' | 'lines' | 'notes'>> = {}): EditSlide => ({
  version: s.version,
  title: s.title,
  lines: s.lines.map(toEdit),
  notes: s.notes.map(toEdit),
  ...patch,
});

const RETRY_MS = 15_000;
const OFFLINE = "You're offline. Try again when you're back online.";

/**
 * Saving Studio edits (STUDIO-2, -4, -6, -7). Every change is saved at once (no Save button) and answered with the
 * slide as checked; the lecture's counts refresh. A change made elsewhere since she opened the slide is reported,
 * and the newer copy is loaded.
 *
 * When the connection drops, an edit is not lost: her words stay on the slide, the change waits (pending-saves) and
 * is sent again when the browser is back online, every 15 seconds meanwhile, or when she asks. A save the server
 * refuses (a newer copy, a line too long) is not retried: she sees why.
 */
export function useSlideEditor(lectureId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const pending = usePendingSaves(lectureId);
  const flushing = useRef(false);

  const setSlide = useCallback(
    (slide: StudioSlide) =>
      qc.setQueryData<{ slides: StudioSlide[] }>(queryKeys.slides(lectureId), (old) =>
        old ? { slides: old.slides.map((s) => (s.id === slide.id ? slide : s)) } : old,
      ),
    [qc, lectureId],
  );
  const saved = useCallback(
    (r: SlideWriteResponse) => {
      setSlide(r.slide);
      void qc.invalidateQueries({ queryKey: queryKeys.lecture(lectureId) });
      void qc.invalidateQueries({ queryKey: queryKeys.coverage(lectureId) });
    },
    [qc, lectureId, setSlide],
  );
  const refused = useCallback(
    (err: unknown) => {
      setState('error');
      setError(errorText(err, 'Not saved. Try again.'));
      // Her copy is out of date (or the change was refused): show the slide as the server has it.
      void qc.invalidateQueries({ queryKey: queryKeys.slides(lectureId) });
    },
    [qc, lectureId],
  );

  /** Changes that need the server's answer (verify, add an example, undo): offline, she is told plainly. */
  const run = useCallback(
    async (fn: () => Promise<SlideWriteResponse>) => {
      setState('saving');
      setError(null);
      try {
        saved(await fn());
        setState('saved');
      } catch (err) {
        if (isConnectionError(err)) {
          setState('error');
          setError(OFFLINE);
        } else refused(err);
      }
    },
    [saved, refused],
  );

  /**
   * Sends what is waiting, one slide at a time; stops at the first connection failure (still offline). A change she
   * made while a save was on its way waits on: it moves to the slide's new version and goes next, and her newer words
   * stay on screen.
   */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (let p = pendingSaves.forLecture(lectureId)[0]; p; p = pendingSaves.forLecture(lectureId)[0]) {
        setState('saving');
        try {
          const r = await api.saveSlide(p.slideId, p.payload);
          const now = pendingSaves.get(p.slideId);
          if (now && now !== p) {
            const next = { ...now, payload: { ...adoptKeys(now.payload, r.slide), version: r.slide.version } };
            pendingSaves.put(next);
            saved({ ...r, slide: optimisticSlide(r.slide, next.payload) });
            continue;
          }
          pendingSaves.drop(p.slideId);
          saved(r);
          setState('saved');
        } catch (err) {
          if (isConnectionError(err)) {
            setState('idle');
            return;
          }
          pendingSaves.drop(p.slideId);
          refused(err);
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [lectureId, saved, refused]);

  /** A change to the slide's words: shown at once, saved now, or kept until the connection is back. */
  const save = useCallback(
    async (s: StudioSlide, payload: EditSlide) => {
      // A slide already waiting keeps the server's version it was opened at, so the latest change carries them all.
      const waiting = pendingSaves.get(s.id);
      const body = waiting ? { ...payload, version: waiting.payload.version } : payload;
      setSlide(optimisticSlide(s, body));
      setError(null);
      if (waiting || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
        pendingSaves.put({ lectureId, slideId: s.id, payload: body });
        setState('idle');
        if (navigator.onLine !== false) void flush();
        return;
      }
      setState('saving');
      try {
        saved(await api.saveSlide(s.id, body));
        setState('saved');
      } catch (err) {
        if (isConnectionError(err)) {
          pendingSaves.put({ lectureId, slideId: s.id, payload: body });
          setState('idle');
        } else refused(err);
      }
    },
    [lectureId, saved, refused, setSlide, flush],
  );

  // Back online: save what waited. Meanwhile, try again every 15 seconds (the browser may not notice a dead network).
  const count = pending.length;
  useEffect(() => {
    if (!count) return;
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const t = setInterval(() => {
      if (navigator.onLine !== false) void flush();
    }, RETRY_MS);
    // Leaving the page with changes not saved yet: the browser asks her first.
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onLeave);
      clearInterval(t);
    };
  }, [count, flush]);

  const replace = (list: SlideLine[], key: string, text: string | null) =>
    list.flatMap((l) => (l.lineKey !== key ? [toEdit(l)] : text === null ? [] : [{ ...toEdit(l), text }]));

  return {
    state,
    error,
    /** Changes waiting for the connection, and a way to send them now. */
    pending: count,
    retryNow: flush,
    editLine: (s: StudioSlide, key: string, text: string) =>
      save(
        s,
        asEdit(
          s,
          s.lines.some((l) => l.lineKey === key)
            ? { lines: replace(s.lines, key, text) }
            : { notes: replace(s.notes, key, text) },
        ),
      ),
    removeLine: (s: StudioSlide, key: string) =>
      save(
        s,
        asEdit(
          s,
          s.lines.some((l) => l.lineKey === key)
            ? { lines: replace(s.lines, key, null) }
            : { notes: replace(s.notes, key, null) },
        ),
      ),
    addLine: (s: StudioSlide, text: string, where: 'lines' | 'notes' = 'lines') =>
      save(
        s,
        asEdit(s, {
          [where]: [...(where === 'lines' ? s.lines : s.notes).map(toEdit), { lineKey: null, text, kind: 'teaching' }],
        }),
      ),
    editTitle: (s: StudioSlide, title: string) => save(s, asEdit(s, { title })),
    verify: (s: StudioSlide, key: string) => run(() => api.verifyLine(s.id, key)),
    addExample: (s: StudioSlide, text: string, keep: boolean) => run(() => api.addExample(s.id, text, keep)),
    undo: (s: StudioSlide) => (s.version > 1 ? run(() => api.restoreSlide(s.id, s.version - 1)) : Promise.resolve()),
  };
}
export type SlideEditor = ReturnType<typeof useSlideEditor>;
