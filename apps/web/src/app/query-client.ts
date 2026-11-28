import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/shared/api/client';

/**
 * Worth asking again at once: no connection (status 0) or a server fault (5xx). A refusal (not allowed, not found,
 * invalid, "too many requests") would only be refused again; the screen shows it with its own retry.
 */
export function worthRetrying(err: unknown): boolean {
  if (!(err instanceof ApiRequestError)) return true;
  return err.status === 0 || err.status >= 500;
}

/**
 * Every failed load or action reaches the console (and an error reporter, later), even when a screen shows it.
 * "Not signed in" is not a failure: the router sends her to sign-in (and the sign-in page asks it on purpose).
 */
const logFailure = (kind: string) => (err: unknown) => {
  if (err instanceof ApiRequestError && err.status === 401) return;
  console.warn(`NYAAI ${kind} failed`, err);
};

/** One client for the app and the route loaders (LLD §11.3: stale time 30 s; one retry when it is worth it). */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: logFailure('load') }),
  mutationCache: new MutationCache({ onError: logFailure('action') }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => n < 1 && worthRetrying(err) },
  },
});
