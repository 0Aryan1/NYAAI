import { useState, type FormEvent } from 'react';
import { useLoaderData, useNavigate, useSearchParams } from 'react-router';
import type { AuthOptions } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { queryClient } from '@/app/queryClient';
import { Button } from '@/shared/ui/button';

const ERRORS: Record<string, string> = {
  not_invited: 'This email has not been invited yet. Please ask your college admin.',
  removed: 'Your access has ended. Please contact your college admin.',
  domain_not_allowed: 'Please sign in with your CNLU email address.',
  hd_mismatch: 'Please sign in with your CNLU email address.',
  email_unverified: 'Google has not verified this email address.',
  expired: 'The sign-in took too long. Please try again.',
  google_failed: 'Google sign-in did not finish. Please try again.',
  not_configured: "Google sign-in isn't set up yet.",
  deleted: 'Your data is being deleted and you have been signed out.',
};

/** Seeded development accounts (packages/db/seeds/dev.sql). Shown only when the server allows dev login. */
const DEV_ACCOUNTS = [
  { email: 'teacher.a@cnlu.ac.in', label: 'Teacher A' },
  { email: 'teacher.b@cnlu.ac.in', label: 'Teacher B' },
  { email: 'admin@cnlu.ac.in', label: 'Admin' },
  { email: 'editor@cnlu.ac.in', label: 'Library editor' },
];

export function LoginPage() {
  const options = useLoaderData() as AuthOptions;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(ERRORS[params.get('error') ?? ''] ?? null);

  async function devSignIn(address: string) {
    setBusy(true);
    setError(null);
    try {
      await api.devLogin(address);
      queryClient.clear();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (email.trim()) void devSignIn(email.trim());
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6">
        <h1 className="mb-1 text-center text-2xl font-semibold">NYAAI</h1>
        <p className="mb-6 text-center text-sm text-muted">Sign in with your CNLU email</p>

        {error && (
          <p role="alert" className="mb-4 rounded-control bg-flag-yellow-bg px-3 py-2 text-sm text-flag-yellow">
            {error}
          </p>
        )}

        {options.google ? (
          <Button variant="primary" size="lg" className="w-full" onClick={() => window.location.assign('/api/v1/auth/google')}>
            Sign in with Google
          </Button>
        ) : (
          <>
            <Button variant={options.devLogin ? 'secondary' : 'primary'} size="lg" className="w-full" disabled>
              Sign in with Google
            </Button>
            <p className="mt-2 text-center text-xs text-muted">Google sign-in isn't set up yet.</p>
          </>
        )}

        {options.devLogin && (
          <section aria-labelledby="dev" className="mt-6 border-t border-border pt-5">
            <h2 id="dev" className="mb-1 text-sm font-semibold">Development sign-in</h2>
            <p className="mb-3 text-xs text-muted">Only on this computer. It is switched off in the pilot.</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {DEV_ACCOUNTS.map((a) => (
                <Button key={a.email} size="sm" disabled={busy} onClick={() => void devSignIn(a.email)}>
                  {a.label}
                </Button>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex gap-2">
              <label htmlFor="dev-email" className="sr-only">
                Email
              </label>
              <input
                id="dev-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@cnlu.ac.in"
                className="h-8 min-w-0 flex-1 rounded-control border border-border bg-bg px-2 text-sm"
              />
              <Button type="submit" size="sm" disabled={busy || !email.trim()}>
                Sign in
              </Button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
