import { Link } from 'react-router';

export function RouteError({ notFound = false }: { notFound?: boolean }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="mb-2 text-xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="mb-6 text-sm text-muted">
        {notFound ? 'This page does not exist.' : 'Please try again. If it keeps happening, tell your administrator.'}
      </p>
      <Link to="/" className="text-sm text-accent underline underline-offset-4">Back to Home</Link>
    </main>
  );
}
