import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EditLine, EditSlide, SlideLine, SlideWriteResponse, StudioSlide } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const toEdit = (l: SlideLine): EditLine => ({ lineKey: l.lineKey, text: l.text, kind: l.kind });
const asEdit = (s: StudioSlide, patch: Partial<Pick<EditSlide, 'title' | 'lines' | 'notes'>> = {}): EditSlide => ({
  version: s.version,
  title: s.title,
  lines: s.lines.map(toEdit),
  notes: s.notes.map(toEdit),
  ...patch,
});

/**
 * Saving Studio edits (STUDIO-2, -4, -6, -7). Every change is saved at once (no Save button) and answered with the
 * slide as checked; the lecture's counts refresh. A change made elsewhere since she opened the slide is reported,
 * and the newer copy is loaded.
 */
export function useSlideEditor(lectureId: string) {
  const qc = useQueryClient();
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<SlideWriteResponse>) => {
      setState('saving');
      setError(null);
      try {
        const r = await fn();
        qc.setQueryData<{ slides: StudioSlide[] }>(queryKeys.slides(lectureId), (old) => (old ? { slides: old.slides.map((s) => (s.id === r.slide.id ? r.slide : s)) } : old));
        void qc.invalidateQueries({ queryKey: queryKeys.lecture(lectureId), exact: true });
        void qc.invalidateQueries({ queryKey: queryKeys.coverage(lectureId) });
        setState('saved');
      } catch (err) {
        setState('error');
        setError(err instanceof ApiRequestError ? err.message : 'Not saved. Check your connection and try again.');
        if (err instanceof ApiRequestError && err.body?.error.code === 'VERSION_CONFLICT') void qc.invalidateQueries({ queryKey: queryKeys.slides(lectureId) });
      }
    },
    [qc, lectureId],
  );

  const replace = (list: SlideLine[], key: string, text: string | null) =>
    list.flatMap((l) => (l.lineKey !== key ? [toEdit(l)] : text === null ? [] : [{ ...toEdit(l), text }]));

  return {
    state,
    error,
    editLine: (s: StudioSlide, key: string, text: string) =>
      run(() => api.saveSlide(s.id, asEdit(s, s.lines.some((l) => l.lineKey === key) ? { lines: replace(s.lines, key, text) } : { notes: replace(s.notes, key, text) }))),
    removeLine: (s: StudioSlide, key: string) =>
      run(() => api.saveSlide(s.id, asEdit(s, s.lines.some((l) => l.lineKey === key) ? { lines: replace(s.lines, key, null) } : { notes: replace(s.notes, key, null) }))),
    addLine: (s: StudioSlide, text: string, where: 'lines' | 'notes' = 'lines') =>
      run(() => api.saveSlide(s.id, asEdit(s, { [where]: [...(where === 'lines' ? s.lines : s.notes).map(toEdit), { lineKey: null, text, kind: 'teaching' }] }))),
    editTitle: (s: StudioSlide, title: string) => run(() => api.saveSlide(s.id, asEdit(s, { title }))),
    verify: (s: StudioSlide, key: string) => run(() => api.verifyLine(s.id, key)),
    addExample: (s: StudioSlide, text: string, save: boolean) => run(() => api.addExample(s.id, text, save)),
    undo: (s: StudioSlide) => (s.version > 1 ? run(() => api.restoreSlide(s.id, s.version - 1)) : Promise.resolve()),
  };
}
export type SlideEditor = ReturnType<typeof useSlideEditor>;
