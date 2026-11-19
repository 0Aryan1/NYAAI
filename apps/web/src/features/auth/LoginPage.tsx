import { Button } from '@/shared/ui/button';

/** Placeholder: Google sign-in (CNLU email only) lands on Day 1 (LLD §15.1). */
export function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-6 text-center">
        <h1 className="mb-1 text-2xl font-semibold">NYAAI</h1>
        <p className="mb-6 text-sm text-muted">Sign in with your CNLU email</p>
        <Button variant="primary" size="lg" className="w-full" disabled>
          Sign in with Google
        </Button>
        <p className="mt-3 text-xs text-muted">Sign-in is being set up.</p>
      </div>
    </main>
  );
}
