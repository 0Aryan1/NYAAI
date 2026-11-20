import { useEffect, useRef } from 'react';
import { LiveEvent } from '@nyaai/shared';

/**
 * One EventSource per tab on /api/v1/events/stream (LLD §4.4, §11.3). The browser reconnects by itself and sends
 * Last-Event-ID, and the server replays what was missed. Events are small; screens refetch full data on them.
 */
export function useEventStream(onEvent: (e: LiveEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/v1/events/stream', { withCredentials: true });
    es.onmessage = (msg) => {
      try {
        const parsed = LiveEvent.safeParse(JSON.parse(msg.data as string));
        if (parsed.success) handler.current(parsed.data);
      } catch {
        /* ignore a malformed event; the next one or a refetch restores the state */
      }
    };
    return () => es.close();
  }, [enabled]);
}
