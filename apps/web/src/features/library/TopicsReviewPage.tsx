import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Tags, Undo2, X } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ConfirmInline } from '@/shared/ui/confirm-inline';
import { PageHeader } from '@/shared/ui/page';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { Tabs } from '@/shared/ui/tabs';
import { errorText } from '@/shared/lib/errors';

type Show = 'unconfirmed' | 'all';

/**
 * Leading cases of each topic (HLD D28, LIB-1). Links come from the course packs, unconfirmed; the law expert reads
 * the case and confirms it, or removes it from the topic. A confirmed case is taught in every lecture on the topic
 * ("must cover"), and Explore shows it without the grey "not yet confirmed" chip.
 */
export function TopicsReviewPage() {
  const qc = useQueryClient();
  const [show, setShow] = useState<Show>('unconfirmed');
  // Rows she acted on stay on screen (with the result) until she leaves, so nothing jumps under her pointer.
  const [done, setDone] = useState<Record<string, 'confirmed' | 'removed' | 'unconfirmed' | 'restored'>>({});
  // Every decision is asked twice (a click by mistake is easy on a long list): which row, and which decision.
  const [asking, setAsking] = useState<{ key: string; action: 'confirm' | 'remove' } | null>(null);
  const q = useQuery({ queryKey: queryKeys.topicCases(show), queryFn: () => api.topicCases(show) });
  const act = useMutation({
    mutationFn: async ({
      conceptId,
      sourceId,
      action,
    }: {
      conceptId: string;
      sourceId: string;
      action: 'confirm' | 'unconfirm' | 'remove' | 'restore';
    }) => {
      if (action === 'confirm') await api.confirmTopicCase(conceptId, sourceId);
      else if (action === 'unconfirm') await api.unconfirmTopicCase(conceptId, sourceId);
      else if (action === 'remove') await api.removeTopicCase(conceptId, sourceId);
      else await api.restoreTopicCase(conceptId, sourceId);
      const result = {
        confirm: 'confirmed',
        unconfirm: 'unconfirmed',
        remove: 'removed',
        restore: 'restored',
      } as const;
      return { key: `${conceptId}|${sourceId}`, result: result[action] };
    },
    onSuccess: ({ key, result }) => {
      setAsking(null);
      setDone((d) => ({ ...d, [key]: result }));
      void qc.invalidateQueries({ queryKey: queryKeys.topicCases(show === 'all' ? 'unconfirmed' : 'all') });
      void qc.invalidateQueries({ queryKey: queryKeys.exploreAll });
    },
  });
  const topics = q.data?.topics ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={Tags}
        title="Leading cases of each topic"
        description="These links came from the course packs. Confirm each case you agree belongs to the topic: a confirmed case is taught in every lecture on it, and teachers see it as confirmed. Remove a case that does not belong. Each choice asks you once more, and can be undone."
      />
      <Tabs<Show>
        label="Show"
        value={show}
        onChange={(v) => {
          setShow(v);
          setDone({});
          setAsking(null);
        }}
        className="mt-4"
        options={[
          {
            value: 'unconfirmed',
            label: 'To confirm',
            count:
              q.data && show === 'unconfirmed'
                ? q.data.unconfirmed - Object.values(done).filter((d) => d !== 'unconfirmed').length
                : undefined,
          },
          { value: 'all', label: 'All' },
        ]}
      />
      {act.error && <p className="mt-3 text-sm text-danger">{errorText(act.error, 'Not saved. Try again.')}</p>}
      <div className="mt-4 space-y-6">
        {q.isLoading && <ListSkeleton rows={4} label="Loading the topics" />}
        {q.isError && <LoadError what="The topics" onRetry={() => void q.refetch()} />}
        {q.isSuccess && topics.length === 0 && (
          <EmptyState title={show === 'unconfirmed' ? 'Nothing to confirm' : 'No leading cases linked yet'}>
            Links appear here when cases are linked to topics.
          </EmptyState>
        )}
        {topics.map((t) => (
          <section
            key={t.conceptId}
            aria-labelledby={`t-${t.conceptId}`}
            className="rounded-card border border-border bg-surface"
          >
            <h2
              id={`t-${t.conceptId}`}
              className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3"
            >
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-muted">{t.subject}</span>
            </h2>
            <ul className="divide-y divide-border">
              {t.cases.map((c) => {
                const key = `${t.conceptId}|${c.sourceId}`;
                const result = done[key];
                const confirmed = result === 'confirmed' || (!result && !!c.confirmedAt);
                const ask = asking?.key === key ? asking.action : null;
                const busy =
                  act.isPending && act.variables?.conceptId === t.conceptId && act.variables?.sourceId === c.sourceId;
                return (
                  <li key={c.sourceId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0">
                      <span className={result === 'removed' ? 'text-muted line-through' : 'font-medium'}>
                        {c.title}
                      </span>
                      <span className="text-muted">
                        {[c.court, c.year].filter(Boolean).length
                          ? ` · ${[c.court, c.year].filter(Boolean).join(', ')}`
                          : ''}
                      </span>
                      <Link
                        to={`/library?judgment=${c.sourceId}`}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        Read it <ExternalLink className="size-3" aria-hidden />
                      </Link>
                      {c.confirmedBy && !result && (
                        <span className="block text-xs text-muted">Confirmed by {c.confirmedBy}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      {ask ? (
                        <ConfirmInline
                          question={
                            ask === 'confirm'
                              ? `Confirm as a leading case on ${t.name}?`
                              : `Remove from ${t.name}? Lectures on this topic will stop teaching it.`
                          }
                          yes={ask === 'confirm' ? 'Yes, confirm' : 'Yes, remove'}
                          tone={ask === 'confirm' ? 'primary' : 'danger'}
                          busy={busy}
                          onYes={() => act.mutate({ conceptId: t.conceptId, sourceId: c.sourceId, action: ask })}
                          onCancel={() => setAsking(null)}
                        />
                      ) : result === 'removed' ? (
                        <>
                          <Pill tone="grey">Removed from this topic</Pill>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              act.mutate({ conceptId: t.conceptId, sourceId: c.sourceId, action: 'restore' })
                            }
                          >
                            <Undo2 className="size-4" aria-hidden />
                            Put it back
                          </Button>
                        </>
                      ) : confirmed ? (
                        <>
                          <Pill tone="success" icon={<Check className="size-3" aria-hidden />}>
                            Confirmed
                          </Pill>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              act.mutate({ conceptId: t.conceptId, sourceId: c.sourceId, action: 'unconfirm' })
                            }
                          >
                            <Undo2 className="size-4" aria-hidden />
                            Undo
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={busy}
                            onClick={() => setAsking({ key, action: 'confirm' })}
                          >
                            <Check className="size-4" aria-hidden />
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setAsking({ key, action: 'remove' })}
                          >
                            <X className="size-4" aria-hidden />
                            Not this topic
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
