import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { ApiRequestError } from '@/shared/api/http';
import { Button } from '@/shared/ui/button';

const NOT_FOUND = { title: 'Page not found', body: 'This page does not exist.', canRetry: false };

/** What went wrong, in her words, and what to do about it. */
export function routeErrorText(err: unknown): { title: string; body: string; canRetry: boolean } {
  if (isRouteErrorResponse(err) && err.status === 404) return NOT_FOUND;
  if (err instanceof ApiRequestError && err.status === 0)
    return {
      title: 'No connection',
      body: 'We could not reach NYAAI. Check your connection and try again.',
      canRetry: true,
    };
  // A screen's code could not be loaded: usually NYAAI was updated while the page was open.
  if (
    err instanceof Error &&
    /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(err.message)
  )
    return { title: 'NYAAI was updated', body: 'Reload the page to get the latest version.', canRetry: true };
  return {
    title: 'Something went wrong',
    body: 'Please try again. If it keeps happening, tell your administrator.',
    canRetry: true,
  };
}

/**
 * The error page of a route. Under the signed-in frame it shows inside it, so the menu stays and she can go elsewhere;
 * for sign-in and setup it is the whole page. The error is logged for the console (and an error reporter, later).
 */
export function RouteError({ notFound = false }: { notFound?: boolean }) {
  const err = useRouteError();
  useEffect(() => {
    if (!notFound && err) console.error('NYAAI route error', err);
  }, [err, notFound]);
  const shown = notFound ? NOT_FOUND : routeErrorText(err);
  return (
    <main role="alert" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="mb-2 text-xl font-semibold">{shown.title}</h1>
      <p className="mb-6 text-sm text-muted">{shown.body}</p>
      <div className="flex items-center justify-center gap-4">
        {shown.canRetry && (
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
        <Link to="/" className="text-sm text-accent underline underline-offset-4">
          Back to Home
        </Link>
      </div>
    </main>
  );
}

/** Shown while the first page's data loads (React Router's hydrate fallback): a quiet line, no layout jump. */
export function AppLoading() {
  return (
    <p role="status" className="py-24 text-center text-sm text-muted">
      Opening NYAAI…
    </p>
  );
}
