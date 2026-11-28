import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/shared/api/client';

/**
 * One client for the app and the route loaders (LLD §11.3: stale time 30 s). One retry, except after "too many
 * requests": retrying at once would only be refused again (the banner asks her to wait a minute).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => n < 1 && !(err instanceof ApiRequestError && err.status === 429) },
  },
});
