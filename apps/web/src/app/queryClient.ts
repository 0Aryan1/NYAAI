import { QueryClient } from '@tanstack/react-query';

/** One client for the app and the route loaders (LLD §11.3: stale time 30 s). */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } });
