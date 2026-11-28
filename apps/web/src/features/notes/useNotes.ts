/** Her notes (DATA-5) as the screens read them: refreshed while one is still being read. */
import { useQuery } from '@tanstack/react-query';
import type { TeacherNote } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';

export const busy = (n: TeacherNote) => n.status === 'queued' || n.status === 'reading';

/** Her notes, refreshed every two seconds while one is still being read. */
export function useNotes() {
  return useQuery({
    queryKey: queryKeys.notes,
    queryFn: api.notes,
    refetchInterval: (q) => (q.state.data?.notes.some(busy) ? 2000 : false),
  });
}

/** Ticked notes that are not ready yet (Prepare waits for them). */
export function waitingNotes(all: TeacherNote[] | undefined, selected: string[]): TeacherNote[] {
  return (all ?? []).filter((n) => selected.includes(n.id) && n.status !== 'ready');
}
