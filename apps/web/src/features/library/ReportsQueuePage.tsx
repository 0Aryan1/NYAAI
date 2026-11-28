import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, ExternalLink, Flag } from 'lucide-react';
import type { QueueReport, ReportOutcome, ReportQueue } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { Tabs } from '@/shared/ui/tabs';

const OUTCOMES: { value: ReportOutcome; label: string; hint: string }[] = [
  { value: 'was_correct', label: 'The source is right', hint: 'Nothing changes; the teacher is told.' },
  {
    value: 'fixed_chunk',
    label: 'I fixed the source text',
    hint: 'Every lecture line resting on it turns yellow for its teacher to check.',
  },
  { value: 'fixed_label', label: 'I fixed a paragraph label', hint: 'Lines resting on it are checked again.' },
  { value: 'fixed_mapping', label: 'I fixed a law mapping', hint: 'Lines resting on it are checked again.' },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label])) as Record<ReportOutcome, string>;

/** "Due in 5 h" or "2 h overdue" (HLD F12: reviewed within 24 hours). */
function due(at: string | null): { text: string; late: boolean } | null {
  if (!at) return null;
  const h = Math.round((new Date(at).getTime() - Date.now()) / 3_600_000);
  return h >= 0 ? { text: `due in ${h} h`, late: false } : { text: `${-h} h overdue`, late: true };
}

function ReportCard({ r }: { r: QueueReport }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: () => api.resolveReport(r.id, { outcome: outcome!, note: note.trim() || undefined }),
    onSuccess: (x) => {
      setDone(
        x.linesFlagged
          ? `Answered. ${x.linesFlagged} lecture ${x.linesFlagged === 1 ? 'line' : 'lines'} turned yellow for their teachers to check.`
          : 'Answered. The teacher sees your answer on her line.',
      );
      // The card stays where it is with her confirmation (not whisked out of the list); the count drops, and the
      // "Answered" tab is fresh when she opens it.
      qc.setQueryData<ReportQueue>(queryKeys.reportQueue('open'), (old) =>
        old ? { ...old, open: Math.max(0, old.open - 1) } : old,
      );
      void qc.invalidateQueries({ queryKey: queryKeys.reportQueue('resolved') });
    },
  });
  const d = due(r.dueAt);
  return (
    <li className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>
          Reported{' '}
          {new Date(r.createdAt).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {r.status === 'resolved' && r.outcome ? (
          <Pill tone={r.outcome === 'was_correct' ? 'success' : 'yellow'}>{OUTCOME_LABEL[r.outcome]}</Pill>
        ) : (
          d && (
            <span className={cn('inline-flex items-center gap-1', d.late && 'font-medium text-danger')}>
              <Clock className="size-3.5" aria-hidden />
              {d.text}
            </span>
          )
        )}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">The line on the slide</p>
      <blockquote className="mt-1 border-l-2 border-flag-yellow pl-3">{r.lineCopy}</blockquote>
      {r.note && (
        <>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">The teacher says</p>
          <p className="mt-1">{r.note}</p>
        </>
      )}
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">The source words it rests on</p>
      {r.spanCopy ? (
        <p className="mt-1 rounded-control bg-bg p-3 text-sm">
          <mark className="rounded bg-flag-yellow-bg px-0.5 text-text">{r.spanCopy}</mark>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted">This line had no source: it was a teaching line.</p>
      )}
      {(r.sourceTitle || r.sourceHeader || r.sourceLabel) && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          {r.sourceHeader ?? r.sourceTitle ?? r.sourceLabel}
          {r.judgmentId && (
            <Link
              to={`/library?judgment=${r.judgmentId}`}
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Open the judgment <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
        </p>
      )}

      {r.status === 'resolved' ? (
        r.resolutionNote && <p className="mt-3 text-sm text-muted">Your note: {r.resolutionNote}</p>
      ) : done ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          {done}
        </p>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Your answer</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {OUTCOMES.map((o) => (
                <label
                  key={o.value}
                  className={cn(
                    'cursor-pointer rounded-control border p-3 text-sm',
                    outcome === o.value ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg',
                  )}
                >
                  <input
                    type="radio"
                    name={`outcome-${r.id}`}
                    className="sr-only"
                    checked={outcome === o.value}
                    onChange={() => setOutcome(o.value)}
                  />
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 block text-sm">
            <span className="mb-1 block font-medium">Note for the teacher (optional)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              className="h-10 w-full rounded-control border border-border bg-bg px-3"
            />
          </label>
          {resolve.error && (
            <p className="mt-2 text-sm text-danger">
              {resolve.error instanceof ApiRequestError ? resolve.error.message : 'Not saved. Try again.'}
            </p>
          )}
          <Button
            variant="primary"
            className="mt-3"
            disabled={!outcome || resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            {resolve.isPending ? 'Saving…' : 'Send answer'}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Wrong-fact reports (LIB-1, HLD F12): what teachers reported, as copies (never their lectures), oldest first, each
 * due within a day. Her answer reaches the teacher's line; a fixed source re-flags every line resting on it, and the
 * case joins the gold set.
 */
export function ReportsQueuePage() {
  const [state, setState] = useState<'open' | 'resolved'>('open');
  const q = useQuery({ queryKey: queryKeys.reportQueue(state), queryFn: () => api.reportQueue(state) });
  const list = q.data?.reports ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Flag className="size-5" aria-hidden />
        Wrong-fact reports
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Lines teachers think are wrong, with the source words they rest on. Answer each within a day.
      </p>
      <Tabs<'open' | 'resolved'>
        label="Show"
        value={state}
        onChange={setState}
        className="mt-4"
        options={[
          { value: 'open', label: 'To answer', count: q.data && state === 'open' ? q.data.open : undefined },
          { value: 'resolved', label: 'Answered' },
        ]}
      />
      <div className="mt-4">
        {q.isLoading && <ListSkeleton label="Loading the reports" />}
        {q.isError && <LoadError what="The reports" onRetry={() => void q.refetch()} />}
        {q.isSuccess && list.length === 0 && (
          <EmptyState title={state === 'open' ? 'Nothing to answer' : 'No answered reports yet'}>
            When a teacher reports a line, it appears here.
          </EmptyState>
        )}
        <ul className="space-y-4">
          {list.map((r) => (
            <ReportCard key={r.id} r={r} />
          ))}
        </ul>
      </div>
    </div>
  );
}
