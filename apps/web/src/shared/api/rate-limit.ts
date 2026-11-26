import { useEffect, useSyncExternalStore } from 'react';

/**
 * "Too many requests" (429): the server allows a set number of requests a minute. When one is refused, every screen
 * shows the same plain message until the minute is over, instead of each screen failing in its own way.
 */
const WAIT_MS = 60_000;
let until = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function noteRateLimited(now = Date.now()): void {
  until = now + WAIT_MS;
  emit();
}

/** The time the wait ends (ms), or 0 when there is nothing to wait for. Clears itself when the minute is over. */
export function useRateLimitedUntil(): number {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (until > Date.now() ? until : 0),
    () => 0,
  );
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(emit, Math.max(0, value - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [value]);
  return value;
}
