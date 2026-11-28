/**
 * "Look again" on a library gap (Gaps screen): what the lookup she started brought, and the hook that follows it.
 * The lookup runs in the background; the card is "looking" from her click until a newer lookup than the one before
 * has finished, then says what that run found. The Gaps list does the polling (one timer for the page).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { LibraryGap } from '@nyaai/shared';
import { api } from '@/shared/api/client';

export const PROVIDER: Record<LibraryGap['attempts'][number]['provider'], string> = {
  india_code: 'India Code',
  indian_kanoon: 'Indian Kanoon',
  web: 'Official websites',
};

/** Checked every few seconds while a lookup runs; after this long the card stops waiting and says so. */
export const WATCH_EVERY_MS = 3000;
const WATCH_FOR_MS = 3 * 60_000;

/** The card as it was when she clicked "Look again". */
interface LookupStart {
  lastLookupAt: string | null;
  leadUrls: string[];
  startedAt: number;
}

/**
 * Has the lookup she started finished, and what did it bring? Done when a newer lookup than the one before her click
 * has run and the gap is no longer "looking". Only that run's attempts count (they are stamped after it started).
 */
export function lookupOutcome(
  start: LookupStart,
  g: LibraryGap,
): { done: false } | { done: true; message: string; tone: 'success' | 'muted' } {
  if (g.state === 'looking' || !g.lastLookupAt || g.lastLookupAt === start.lastLookupAt) return { done: false };
  const run = g.attempts.filter((a) => a.at >= g.lastLookupAt!);
  const downloaded = run
    .filter((a) => a.provider !== 'web' && a.outcome === 'loaded')
    .reduce((n, a) => n + (a.sourceIds?.length ?? 0), 0);
  const newLinks = g.leads.filter((l) => !start.leadUrls.includes(l.url)).length;
  const failed = [...new Set(run.filter((a) => a.outcome === 'failed').map((a) => PROVIDER[a.provider]))];
  const links = (n: number) => `${n} new ${n === 1 ? 'link' : 'links'} to check below`;
  let message: string;
  if (downloaded)
    message = `Done: ${downloaded} ${downloaded === 1 ? 'source' : 'sources'} downloaded. Check ${downloaded === 1 ? 'it' : 'them'} in Library, under “To check”.${newLinks ? ` Also ${links(newLinks)}.` : ''}`;
  else if (newLinks) message = `Done: nothing to download, but ${links(newLinks)}.`;
  else message = 'Done: nothing new found.';
  if (failed.length) message += ` ${failed.join(' and ')} did not answer; try again later.`;
  return { done: true, message, tone: downloaded || newLinks ? 'success' : 'muted' };
}

/**
 * Starts a lookup on gap `g` and follows it. `onWatching(true)` asks the page to keep the list fresh; after
 * WATCH_FOR_MS without a result the card stops waiting and says the lookup is still running.
 */
export function useGapLookup(g: LibraryGap, onWatching: (on: boolean) => void) {
  const [watching, setWatching] = useState<LookupStart | null>(null);
  // The page's callback may be a new function on each render; follow the latest without re-running the timer.
  const onWatchingRef = useRef(onWatching);
  onWatchingRef.current = onWatching;
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'muted' } | null>(null);
  const lookup = useMutation({
    mutationFn: () => api.lookupGap(g.id),
    onMutate: () => {
      setMessage(null);
      setWatching({ lastLookupAt: g.lastLookupAt, leadUrls: g.leads.map((l) => l.url), startedAt: Date.now() });
    },
    onError: () => setWatching(null),
  });
  useEffect(() => {
    onWatchingRef.current(!!watching);
    if (!watching) return;
    const t = setTimeout(
      () => {
        setWatching(null);
        setMessage({
          text: 'Still looking in the background. Come back to this card in a few minutes.',
          tone: 'muted',
        });
      },
      WATCH_FOR_MS - (Date.now() - watching.startedAt),
    );
    return () => clearTimeout(t);
  }, [watching]);
  useEffect(() => {
    if (!watching) return;
    const r = lookupOutcome(watching, g);
    if (r.done) {
      setWatching(null);
      setMessage({ text: r.message, tone: r.tone });
    }
  }, [watching, g]);
  return { lookup, watching: !!watching, message, setMessage };
}
