/**
 * Studio changes that could not reach the server because the connection dropped. They are kept (in this tab's
 * memory only: never written to the browser's storage, which may be a shared college computer), shown on the slide
 * at once, and sent again when the connection is back. Several changes to one slide become one save: each holds the
 * whole slide as she left it, so the latest one carries them all.
 */
import { useSyncExternalStore } from 'react';
import type { EditLine, EditSlide, SlideLine, StudioSlide } from '@nyaai/shared';
import { ApiRequestError } from '@/shared/api/client';

/** A line she added while offline has no key from the server yet; it is sent as a new line. */
const UNSAVED = 'unsaved-';

export const toEdit = (l: SlideLine): EditLine => ({
  lineKey: l.lineKey.startsWith(UNSAVED) ? null : l.lineKey,
  text: l.text,
  kind: l.kind,
});

/** The request did not reach the server, or the server could not be reached through the proxy: try again later. */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof ApiRequestError)
    return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

let added = 0;
/** The slide as she left it, shown while its save waits: her words, with the line kinds and checks it had. */
export function optimisticSlide(s: StudioSlide, payload: EditSlide): StudioSlide {
  const all = [...s.lines, ...s.notes];
  const line = (e: EditLine): SlideLine => {
    const was = e.lineKey ? all.find((l) => l.lineKey === e.lineKey) : undefined;
    if (was) return { ...was, text: e.text, edited: was.edited || was.text !== e.text };
    return {
      lineKey: `${UNSAVED}${++added}`,
      text: e.text,
      kind: e.kind,
      status: 'open',
      flag: null,
      flagReason: null,
      sources: [],
      risk: 'normal',
      edited: true,
    };
  };
  return { ...s, title: payload.title, lines: payload.lines.map(line), notes: payload.notes.map(line) };
}

/**
 * A later change still lists a line she added offline as new (no key), but the save before it has just created that
 * line: take the key the server gave it (same words, not used elsewhere), so the line is not added twice.
 */
export function adoptKeys(payload: EditSlide, saved: StudioSlide): EditSlide {
  const adopt = (list: EditLine[], from: SlideLine[]) => {
    const used = new Set(list.map((e) => e.lineKey).filter(Boolean));
    return list.map((e) => {
      if (e.lineKey) return e;
      const match = from.find((l) => l.text === e.text && !used.has(l.lineKey));
      if (!match) return e;
      used.add(match.lineKey);
      return { ...e, lineKey: match.lineKey };
    });
  };
  return { ...payload, lines: adopt(payload.lines, saved.lines), notes: adopt(payload.notes, saved.notes) };
}

interface Pending {
  lectureId: string;
  slideId: string;
  payload: EditSlide;
}

const queue = new Map<string, Pending>();
const listeners = new Set<() => void>();
let snapshot: Pending[] = [];
const changed = () => {
  snapshot = [...queue.values()];
  listeners.forEach((l) => l());
};

export const pendingSaves = {
  /** The latest version of a slide waiting to be saved replaces an older one. */
  put(p: Pending) {
    queue.set(p.slideId, p);
    changed();
  },
  drop(slideId: string) {
    if (queue.delete(slideId)) changed();
  },
  get(slideId: string): Pending | undefined {
    return queue.get(slideId);
  },
  forLecture(lectureId: string): Pending[] {
    return snapshot.filter((p) => p.lectureId === lectureId);
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  all: () => snapshot,
  /** Tests only. */
  clear() {
    queue.clear();
    changed();
  },
};

/** The changes of one lecture still waiting to be saved. */
export function usePendingSaves(lectureId: string): Pending[] {
  const all = useSyncExternalStore(pendingSaves.subscribe, pendingSaves.all, pendingSaves.all);
  return all.filter((p) => p.lectureId === lectureId);
}
