import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { ThemeSwitch } from './ThemeSwitch';

function StatusDot({ ok }: { ok: boolean | undefined }) {
  const label = ok === undefined ? 'Checking' : ok ? 'Working' : 'Not reachable';
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span aria-hidden className={`size-2 rounded-full ${ok === undefined ? 'bg-border' : ok ? 'bg-success' : 'bg-danger'}`} />
      {label}
    </span>
  );
}

/** Day 0 placeholder for Home: shows the system is wired end to end and the token palette in both themes. */
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 10_000 });
  const h = health.data;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold leading-tight">NYAAI</h1>
          <p className="text-sm text-muted">Source-checked law lectures in your own style</p>
        </div>
        <ThemeSwitch />
      </header>

      <section aria-labelledby="sys" className="mb-6 rounded-card border border-border bg-surface p-5">
        <h2 id="sys" className="mb-3 text-base font-semibold">System</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm" aria-live="polite">
          <dt className="text-muted">Server</dt>
          <dd><StatusDot ok={health.isError ? false : h ? true : undefined} /></dd>
          <dt className="text-muted">Database</dt>
          <dd><StatusDot ok={health.isError ? false : h ? h.db === 'ok' : undefined} /></dd>
          <dt className="text-muted">Job queue</dt>
          <dd><StatusDot ok={health.isError ? false : h ? h.redis === 'ok' : undefined} /></dd>
          <dt className="text-muted">Search index</dt>
          <dd className="text-sm">{h?.pgvector ? `pgvector ${h.pgvector}` : '—'}</dd>
        </dl>
      </section>

      <section aria-labelledby="marks" className="rounded-card border border-border bg-surface p-5">
        <h2 id="marks" className="mb-3 text-base font-semibold">How statements are marked</h2>
        <ul className="space-y-3 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">S2 · s. 56 ICA</span>
            Supported by that source
          </li>
          <li>
            <span className="underline decoration-flag-yellow-underline decoration-2 underline-offset-4">
              The agreement becomes void when performance becomes impossible.
            </span>{' '}
            <span className="rounded-full bg-flag-yellow-bg px-2 py-0.5 text-xs text-flag-yellow">Please verify</span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="font-serif italic">Satyabrata Ghose v. Mugneeram Bangur</span>
            <span className="rounded-full bg-flag-grey-bg px-2 py-0.5 text-xs text-flag-grey">Status not verified</span>
          </li>
          <li>
            <span className="rounded-card bg-flag-coverage-bg px-2 py-1 text-xs text-flag-coverage">Missing: exception to s. 56</span>
          </li>
          <li>
            <span className="rounded-full bg-example-bg px-2 py-0.5 text-xs text-example">Your example</span>{' '}
            A wedding hall booking cancelled in lockdown
          </li>
        </ul>
      </section>
    </main>
  );
}
