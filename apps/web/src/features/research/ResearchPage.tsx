import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch } from 'lucide-react';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';
import { Pill } from '@/shared/ui/pill';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';

const STATUS: Record<string, string> = { planning: 'Planning', awaiting_edit: 'Waiting for you', gathering: 'Gathering', writing: 'Writing', checking: 'Checking', ready: 'Ready', failed: 'Did not finish' };

/**
 * Research (RES-1): a question and its scope; a quick run takes about two minutes and gives an evidence table and a
 * brief written only from it, every line checked. "My research" keeps every run.
 */
export function ResearchPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<'india' | 'comparative'>('india');
  const [fromYear, setFromYear] = useState('');
  const [toYear, setToYear] = useState('');
  // Always fresh: a run started a moment ago (or finished since) must show in "My research".
  const list = useQuery({ queryKey: queryKeys.research, queryFn: api.researchList, refetchOnMount: 'always' });
  const start = useMutation({
    mutationFn: () =>
      api.startResearch({
        question: question.trim(),
        scope: { comparative: scope === 'comparative', fromYear: fromYear ? Number(fromYear) : undefined, toYear: toYear ? Number(toYear) : undefined },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: queryKeys.research, exact: true });
      void navigate(`/research/${r.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 10) start.mutate();
  };
  const runs = list.data?.runs ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <FileSearch className="size-6" aria-hidden />
        Research
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Ask a research question. NYAAI splits it into smaller questions, gathers the Acts and judgments for each, and writes a short brief from that evidence
        only, every line checked. It takes about two minutes.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5 rounded-card border border-border bg-surface p-5">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Your question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="e.g. When can a court refuse to enforce a foreign arbitral award on grounds of public policy?"
            className="w-full rounded-control border border-border bg-bg px-3 py-2"
          />
        </label>
        <ChipGroup
          label="Scope"
          value={scope}
          onChange={(v) => setScope(v as 'india' | 'comparative')}
          options={[
            { value: 'india', label: 'India only' },
            { value: 'comparative', label: 'Comparative' },
          ]}
        />
        <fieldset className="text-sm">
          <legend className="mb-1 font-medium">Judgments from (optional)</legend>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="from-year">
              From year
            </label>
            <input id="from-year" type="number" min={1800} max={2100} value={fromYear} onChange={(e) => setFromYear(e.target.value)} placeholder="Year" className="h-10 w-28 rounded-control border border-border bg-bg px-3" />
            <span className="text-muted">to</span>
            <label className="sr-only" htmlFor="to-year">
              To year
            </label>
            <input id="to-year" type="number" min={1800} max={2100} value={toYear} onChange={(e) => setToYear(e.target.value)} placeholder="Year" className="h-10 w-28 rounded-control border border-border bg-bg px-3" />
          </div>
          <span className="mt-1 block text-xs text-muted">Acts always count. Leave empty for all years.</span>
        </fieldset>
        {start.error && <p className="text-sm text-danger">{start.error instanceof ApiRequestError ? start.error.message : 'The research did not start. Try again.'}</p>}
        <Button type="submit" variant="primary" disabled={start.isPending || question.trim().length < 10}>
          {start.isPending ? 'Starting…' : 'Start research'}
        </Button>
      </form>

      <h2 className="mb-3 mt-10 text-lg font-semibold">My research</h2>
      {list.isLoading && <ListSkeleton rows={2} label="Loading your research" />}
      {list.isError && <LoadError what="Your research" onRetry={() => void list.refetch()} />}
      {list.isSuccess && runs.length === 0 && <EmptyState title="No research yet">Your questions and their briefs are kept here.</EmptyState>}
      {runs.length > 0 && (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {runs.map((r) => (
            <li key={r.id}>
              <Link to={`/research/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg">
                <span className="min-w-0">
                  <span className="line-clamp-2 text-sm font-medium">{r.question}</span>
                  <span className="text-xs text-muted">{new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {r.yellow > 0 && <Pill tone="yellow">{r.yellow} to verify</Pill>}
                  <Pill tone={r.status === 'ready' ? 'success' : r.status === 'failed' ? 'danger' : 'grey'}>{STATUS[r.status] ?? r.status}</Pill>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
