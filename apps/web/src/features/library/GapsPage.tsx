import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, RotateCw, SearchX, Undo2, Users } from 'lucide-react';
import type { LibraryGap } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { Tabs } from '@/shared/ui/tabs';

type Show = 'waiting' | 'answered' | 'all';

const KIND: Record<LibraryGap['kind'], string> = { act: 'An Act', case: 'A case', topic: 'A topic' };
const PROVIDER: Record<LibraryGap['attempts'][number]['provider'], string> = { india_code: 'India Code', indian_kanoon: 'Indian Kanoon', web: 'Official websites' };
const STATE: Record<LibraryGap['state'], { label: string; tone: 'grey' | 'yellow' | 'success' | 'neutral' }> = {
  open: { label: 'Waiting', tone: 'yellow' },
  looking: { label: 'Looking now…', tone: 'grey' },
  loaded: { label: 'Sources loaded, to check', tone: 'yellow' },
  answered: { label: 'Answered by the library', tone: 'success' },
  resolved: { label: 'Closed: loaded by hand', tone: 'neutral' },
  wont_fill: { label: 'Closed: not something we hold', tone: 'neutral' },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function GapCard({ g, show }: { g: LibraryGap; show: Show }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<'resolved' | 'wont_fill' | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['review', 'gaps'] });
  const lookup = useMutation({
    mutationFn: () => api.lookupGap(g.id),
    onSuccess: () => {
      setMessage('Looking again in India Code, Indian Kanoon and official websites. This page updates when it is done.');
      // The lookup runs in the background: look at the list again shortly.
      setTimeout(refresh, 8000);
    },
  });
  const update = useMutation({
    mutationFn: (state: 'open' | 'resolved' | 'wont_fill') => api.updateGap(g.id, { state, note: note.trim() || undefined }),
    onSuccess: (x) => {
      setAsking(null);
      setMessage(x.state === 'open' ? 'Reopened.' : 'Closed. The teachers who asked will find the answer in the library.');
      qc.setQueryData<{ gaps: LibraryGap[] }>(queryKeys.gaps(show), (old) => (old ? { gaps: old.gaps.map((y) => (y.id === x.id ? x : y)) } : old));
    },
  });
  const closed = g.state === 'resolved' || g.state === 'wont_fill';
  const err = lookup.error ?? update.error;
  const s = STATE[g.state];

  return (
    <li className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{g.question}</p>
        <Pill tone={s.tone}>{s.label}</Pill>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {KIND[g.kind]}
          {g.actName && `: ${g.actName}${g.actYear ? `, ${g.actYear}` : ''}`}
          {g.caseName && `: ${g.caseName}`}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" aria-hidden />
          {g.teachers} {g.teachers === 1 ? 'teacher' : 'teachers'}, asked {g.asks} {g.asks === 1 ? 'time' : 'times'}
        </span>
        <span>last asked {when(g.lastSeenAt)}</span>
      </p>

      {g.leads.length > 0 && (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Links to check</p>
          <p className="mt-1 text-xs text-muted">Found on official sites. They are not in the library: open one, and if it is the right official document, add it from Library.</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {g.leads.map((l) => (
              <li key={l.url} className="flex flex-wrap items-center gap-2">
                <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent hover:underline">
                  {l.title || l.url} <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="text-xs text-muted">
                  {PROVIDER[l.provider]}
                  {l.lastUpdated && ` · updated ${l.lastUpdated.slice(0, 10)}`}
                  {l.checked ? ' · opens' : ' · not checked'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {g.attempts.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">What the lookup tried ({g.attempts.length})</summary>
          <ul className="mt-2 space-y-1">
            {g.attempts.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-32 shrink-0 text-xs text-muted">{when(a.at)}</span>
                <span>
                  <span className="font-medium">{PROVIDER[a.provider]}</span>: {a.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {g.loadedSourceIds.length > 0 && <p className="mt-3 text-sm text-muted">{g.loadedSourceIds.length} source(s) loaded by the lookup, waiting for your review in Library.</p>}
      {g.note && <p className="mt-3 text-sm text-muted">Note: {g.note}</p>}

      <div className="mt-4 border-t border-border pt-4">
        {message && (
          <p role="status" className="mb-3 flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden /> {message}
          </p>
        )}
        {err && <p className="mb-3 text-sm text-danger">{err instanceof ApiRequestError ? err.message : 'Not saved. Try again.'}</p>}
        {asking ? (
          <div role="group" aria-label="Are you sure?" className="space-y-3 rounded-control border border-border bg-bg p-3">
            <p className="text-sm">{asking === 'resolved' ? 'Close this gap because you loaded the source?' : 'Close this gap because the library will not hold this?'}</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Note (optional)</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="h-10 w-full rounded-control border border-border bg-surface px-3" />
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={update.isPending} onClick={() => update.mutate(asking)}>
                Yes, close it
              </Button>
              <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : closed ? (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate('open')}>
            <Undo2 className="size-4" aria-hidden />
            Reopen
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={lookup.isPending || g.state === 'looking'} onClick={() => lookup.mutate()}>
              <RotateCw className={cn('size-4', lookup.isPending && 'animate-spin motion-reduce:animate-none')} aria-hidden />
              Look again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking('resolved')}>
              Close: I loaded the source
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking('wont_fill')}>
              Close: not something we hold
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Library gaps (LIB-1): questions the library could not answer well, most-asked first, with what the automatic lookup
 * tried (India Code, Indian Kanoon) and links found on official websites (gov.in, nic.in) for the editor to check.
 * Web links are never library content: she opens one and adds the document through the library if it is right.
 */
export function GapsPage() {
  const [show, setShow] = useState<Show>('waiting');
  const q = useQuery({ queryKey: queryKeys.gaps(show), queryFn: () => api.libraryGaps(show) });
  const list = q.data?.gaps ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <SearchX className="size-5" aria-hidden />
        Library gaps
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">Questions teachers asked that the library could not answer well, most-asked first, with what the lookup tried and links to check.</p>
      <Tabs<Show>
        label="Show"
        value={show}
        onChange={setShow}
        className="mt-4"
        options={[
          { value: 'waiting', label: 'Waiting', count: show === 'waiting' && q.data ? list.length : undefined },
          { value: 'answered', label: 'Answered' },
          { value: 'all', label: 'All' },
        ]}
      />
      <div className="mt-4">
        {q.isLoading && <ListSkeleton label="Loading the gaps" />}
        {q.isError && <LoadError what="The library gaps" onRetry={() => void q.refetch()} />}
        {q.isSuccess && list.length === 0 && <EmptyState title={show === 'waiting' ? 'No gaps waiting' : 'Nothing here'}>When a search cannot find enough in the library, the question appears here.</EmptyState>}
        <ul className="space-y-4">
          {list.map((g) => (
            <GapCard key={g.id} g={g} show={show} />
          ))}
        </ul>
      </div>
    </div>
  );
}
