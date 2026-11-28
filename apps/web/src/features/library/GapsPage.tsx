import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROVIDER, useGapLookup, WATCH_EVERY_MS } from './gap-lookup';
import { CheckCircle2, ExternalLink, Loader2, RotateCw, SearchX, Undo2, Users } from 'lucide-react';
import type { LibraryGap } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { ConfirmInline } from '@/shared/ui/confirm-inline';
import { PageHeader } from '@/shared/ui/page';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { Tabs } from '@/shared/ui/tabs';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { errorText } from '@/shared/lib/errors';

type Show = 'waiting' | 'answered' | 'all';

const KIND: Record<LibraryGap['kind'], string> = { act: 'An Act', case: 'A case', topic: 'A topic' };
const STATE: Record<LibraryGap['state'], { label: string; tone: 'grey' | 'yellow' | 'success' | 'neutral' }> = {
  open: { label: 'Waiting', tone: 'yellow' },
  looking: { label: 'Looking now…', tone: 'grey' },
  loaded: { label: 'Sources loaded, to check', tone: 'yellow' },
  answered: { label: 'Answered by the library', tone: 'success' },
  resolved: { label: 'Closed: loaded by hand', tone: 'neutral' },
  wont_fill: { label: 'Closed: not something we hold', tone: 'neutral' },
};

function GapCard({ g, show, onWatching }: { g: LibraryGap; show: Show; onWatching: (on: boolean) => void }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState<'resolved' | 'wont_fill' | null>(null);
  const [note, setNote] = useState('');
  const { lookup, watching, message, setMessage } = useGapLookup(g, onWatching);
  const update = useMutation({
    mutationFn: (state: 'open' | 'resolved' | 'wont_fill') =>
      api.updateGap(g.id, { state, note: note.trim() || undefined }),
    onSuccess: (x) => {
      setAsking(null);
      setMessage({
        text: x.state === 'open' ? 'Reopened.' : 'Closed. The teachers who asked will find the answer in the library.',
        tone: 'success',
      });
      qc.setQueryData<{ gaps: LibraryGap[] }>(queryKeys.gaps(show), (old) =>
        old ? { gaps: old.gaps.map((y) => (y.id === x.id ? x : y)) } : old,
      );
    },
  });
  const closed = g.state === 'resolved' || g.state === 'wont_fill';
  const err = lookup.error ?? update.error;
  // From her click until the result is in, the card is "looking", even before the worker has picked the job up.
  const looking = watching || g.state === 'looking';
  const s = looking ? STATE.looking : STATE[g.state];

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
        <span>last asked {formatDateTime(g.lastSeenAt)}</span>
      </p>

      {g.leads.length > 0 && (
        <>
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Links to check</p>
          <p className="mt-1 text-xs text-muted">
            Found on official sites. They are not in the library: open one, and if it is the right official document,
            add it from Library.
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {g.leads.map((l) => (
              <li key={l.url} className="flex flex-wrap items-center gap-2">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {l.title || l.url} <ExternalLink className="size-3" aria-hidden />
                </a>
                <span className="text-xs text-muted">
                  {PROVIDER[l.provider]}
                  {l.lastUpdated && ` · updated ${formatDate(l.lastUpdated)}`}
                  {l.checked ? ' · opens' : ' · not checked'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {g.attempts.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">
            What the lookup tried ({g.attempts.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {g.attempts.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-32 shrink-0 text-xs text-muted">{formatDateTime(a.at)}</span>
                <span>
                  <span className="font-medium">{PROVIDER[a.provider]}</span>: {a.detail}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {g.loadedSourceIds.length > 0 && (
        <p className="mt-3 text-sm text-muted">
          {g.loadedSourceIds.length} source(s) loaded by the lookup, waiting for your review in Library.
        </p>
      )}
      {g.note && <p className="mt-3 text-sm text-muted">Note: {g.note}</p>}

      <div className="mt-4 border-t border-border pt-4">
        {looking ? (
          <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Looking in India Code,
            Indian Kanoon and official websites. This usually takes under a minute.
          </p>
        ) : (
          message && (
            <p
              role="status"
              className={cn(
                'mb-3 flex items-center gap-2 text-sm',
                message.tone === 'success' ? 'text-success' : 'text-muted',
              )}
            >
              <CheckCircle2 className="size-4 shrink-0" aria-hidden /> {message.text}
            </p>
          )
        )}
        {err && <p className="mb-3 text-sm text-danger">{errorText(err, 'Not saved. Try again.')}</p>}
        {asking ? (
          <ConfirmInline
            stacked
            question={
              asking === 'resolved'
                ? 'Close this gap because you loaded the source?'
                : 'Close this gap because the library will not hold this?'
            }
            yes="Yes, close it"
            busy={update.isPending}
            onYes={() => update.mutate(asking)}
            onCancel={() => setAsking(null)}
          >
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Note (optional)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                className="h-10 w-full rounded-control border border-border bg-surface px-3"
              />
            </label>
          </ConfirmInline>
        ) : closed ? (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate('open')}>
            <Undo2 className="size-4" aria-hidden />
            Reopen
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={looking} onClick={() => lookup.mutate()}>
              <RotateCw className="size-4" aria-hidden />
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
  // A lookup running when the page opened (or started elsewhere): keep the list fresh until it ends.
  // One timer for the page: while any card follows a lookup it started, or a lookup runs (opened mid-way, or
  // started elsewhere), the list is fetched every few seconds.
  const [watchingIds, setWatchingIds] = useState<ReadonlySet<string>>(new Set());
  const setWatching = useCallback(
    (id: string, on: boolean) =>
      setWatchingIds((s) => (on === s.has(id) ? s : on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id)))),
    [],
  );
  const q = useQuery({
    queryKey: queryKeys.gaps(show),
    queryFn: () => api.libraryGaps(show),
    refetchInterval: (query) =>
      watchingIds.size || query.state.data?.gaps.some((x) => x.state === 'looking') ? WATCH_EVERY_MS : false,
  });
  const list = q.data?.gaps ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={SearchX}
        title="Library gaps"
        description="Questions teachers asked that the library could not answer well, most-asked first, with what the lookup tried and links to check."
      />
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
        {q.isSuccess && list.length === 0 && (
          <EmptyState title={show === 'waiting' ? 'No gaps waiting' : 'Nothing here'}>
            When a search cannot find enough in the library, the question appears here.
          </EmptyState>
        )}
        <ul className="space-y-4">
          {list.map((g) => (
            <GapCard key={g.id} g={g} show={show} onWatching={(on) => setWatching(g.id, on)} />
          ))}
        </ul>
      </div>
    </div>
  );
}
