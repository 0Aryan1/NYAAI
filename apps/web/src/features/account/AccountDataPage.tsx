import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Download, ShieldOff, Trash2 } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { PageHeader } from '@/shared/ui/page';
import { ErrorText } from '@/shared/ui/error-text';
import { LoadError } from '@/shared/ui/states';
import { errorText } from '@/shared/lib/errors';

/**
 * Your data (BRD NFR-8, DPDP Act, 2023): download a copy of everything about her, or delete it all. Deleting asks
 * for her own email, signs her out at once and cannot be undone.
 */
export function AccountDataPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me });
  const email = me.data?.user.email ?? '';
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  const withdraw = useMutation({
    mutationFn: api.withdrawConsent,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me }),
  });

  async function deleteAll() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMyData(typed.trim());
      qc.clear();
      window.location.assign('/login?error=deleted');
    } catch (err) {
      setError(errorText(err, 'Your data was not deleted. Try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {me.isError && <LoadError what="Your account" onRetry={() => void me.refetch()} />}
      <PageHeader
        title="Your data"
        description="Everything NYAAI keeps about you is yours: you can take a copy at any time, or delete it all."
      />

      <section aria-labelledby="export" className="rounded-card border border-border bg-surface p-5">
        <h2 id="export" className="font-semibold">
          Download a copy
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          One zip file: your profile and consents, your courses and what each class learnt, your lectures with every
          slide and the source words each line rests on, your own notes (the files and their text), your examples and
          edits, and the AI use made for you.
        </p>
        <a
          href="/api/v1/me/export-data"
          download
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm hover:bg-bg"
        >
          <Download className="size-4" aria-hidden />
          Download my data
        </a>
      </section>

      <section aria-labelledby="consent" className="rounded-card border border-border bg-surface p-5">
        <h2 id="consent" className="font-semibold">
          Your consent
        </h2>
        {me.data?.consented === false ? (
          <>
            <p className="mt-1 max-w-prose text-sm">
              You have withdrawn your consent. NYAAI sends nothing of yours to the services it uses, so preparing
              lectures, reading your notes and checking edits are paused. Your data is still here: you can download or
              delete it.
            </p>
            <Link
              to="/setup/consent"
              className="mt-4 inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm text-accent-contrast hover:opacity-90"
            >
              Read and agree again
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-sm text-muted">
              You agreed that NYAAI may send your work to the services it uses (writing and checking, search, storage).
              You can withdraw this at any time. Your data is kept, but nothing new is sent: preparing lectures, reading
              your notes and checking edits pause until you agree again.
            </p>
            <Button className="mt-4" disabled={withdraw.isPending || !me.data} onClick={() => withdraw.mutate()}>
              <ShieldOff className="size-4" aria-hidden />
              {withdraw.isPending ? 'Withdrawing…' : 'Withdraw my consent'}
            </Button>
            <ErrorText className="mt-2" error={withdraw.error} fallback="Your consent was not withdrawn. Try again." />
          </>
        )}
      </section>

      <section aria-labelledby="delete" className="rounded-card border border-danger/40 bg-surface p-5">
        <h2 id="delete" className="font-semibold text-danger">
          Delete everything
        </h2>
        <p className="mt-1 max-w-prose text-sm">This deletes, for good:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>your lectures and slides, with the source words each line rests on;</li>
          <li>your courses and what each class learnt;</li>
          <li>your own notes: the files, their text and their search data;</li>
          <li>your profile, style, examples, edits, feedback and consents;</li>
          <li>the record of AI use made for you;</li>
          <li>your account: you are signed out and cannot sign in again unless your college invites you afresh.</li>
        </ul>
        <p className="mt-3 max-w-prose text-sm text-muted">
          Questions you asked the library stay as library questions, without your name. Backup copies clear within 7
          days. Download a copy first if you want one; this cannot be undone.
        </p>
        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">To confirm, type your email ({email})</span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="h-10 w-full max-w-md rounded-control border border-border bg-bg px-3"
          />
        </label>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <Button className="mt-4 border-danger text-danger" disabled={!matches || busy} onClick={() => void deleteAll()}>
          <Trash2 className="size-4" aria-hidden />
          {busy ? 'Deleting…' : 'Delete all my data'}
        </Button>
      </section>
    </div>
  );
}
