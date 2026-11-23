import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import type { ReviewJudgment, SetCaseStatus } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { caseStatusLabel } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill, type PillTone } from '@/shared/ui/pill';

type Choice = SetCaseStatus['status'];
const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'good_law', label: 'Still good law', hint: 'No later judgment overrules or reverses it' },
  { value: 'doubted', label: 'Doubted', hint: 'A later bench doubted it; it still stands' },
  { value: 'overruled', label: 'Overruled', hint: 'A later bench overruled it' },
  { value: 'reversed', label: 'Reversed', hint: 'Reversed on appeal' },
];

export const statusTone = (s: string): PillTone => (s === 'not_verified' ? 'grey' : s === 'overruled' || s === 'reversed' ? 'yellow' : s === 'doubted' ? 'coverage' : 'success');

/**
 * The expert's finding on a case's current status (HLD 5.2 a, LIB-2). Until she records one, every lecture shows
 * "Status not verified" on lines that rest on the case; her finding shows in every lecture at once.
 */
export function CaseStatusCard({ judgment, step }: { judgment: ReviewJudgment; step?: number }) {
  const qc = useQueryClient();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const [byCase, setByCase] = useState('');
  const save = useMutation({
    mutationFn: (body: SetCaseStatus) => api.setCaseStatus(judgment.id, body),
    onSuccess: () => {
      setChoice(null);
      setNote('');
      setByCase('');
      void qc.invalidateQueries({ queryKey: ['review'] });
    },
  });
  const latest = judgment.statusHistory[0];
  const adverse = choice !== null && choice !== 'good_law';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (choice) save.mutate({ status: choice, note, byCase: adverse ? byCase : undefined });
  };

  return (
    <section aria-labelledby="case-status" className="rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="case-status" className="flex items-center gap-2 font-semibold">
            {step ? <span className="grid size-6 place-items-center rounded-full bg-bg text-xs">{step}</span> : <Scale className="size-4 text-muted" aria-hidden />}
            Is it still good law?
          </h3>
          <p className="mt-1 text-sm text-muted">
            {latest
              ? `Confirmed by ${latest.confirmedBy ?? 'the library team'} on ${latest.confirmedAt.slice(0, 10)}${latest.byCase ? `: ${latest.byCase}` : ''}.`
              : 'Not confirmed yet. Lectures show "Status not verified" on every line that rests on this case. Check a citator (SCC Online, Manupatra) or later judgments, then choose one answer below.'}
          </p>
          {latest?.note && <p className="mt-1 text-sm">{latest.note}</p>}
        </div>
        <Pill tone={statusTone(judgment.caseStatus)}>{caseStatusLabel(judgment.caseStatus)}</Pill>
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <fieldset>
          <legend className="sr-only">Current status</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHOICES.map((c) => (
              <label
                key={c.value}
                className={cn(
                  'cursor-pointer rounded-control border px-3 py-2 text-sm transition-colors',
                  choice === c.value ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60',
                )}
              >
                <input type="radio" name="case-status" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="sr-only" />
                <span className="block font-medium">{c.label}</span>
                <span className="block text-xs text-muted">{c.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {choice && (
          <>
            {adverse && (
              <label className="block text-sm">
                <span className="mb-1 block font-medium">The later judgment</span>
                <input
                  value={byCase}
                  onChange={(e) => setByCase(e.target.value)}
                  required
                  minLength={5}
                  placeholder="e.g. Ssangyong Engineering v. NHAI, (2019) 15 SCC 131"
                  className="w-full rounded-control border border-border bg-bg px-3 py-2"
                />
              </label>
            )}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">What you checked</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                required
                minLength={10}
                rows={2}
                placeholder="e.g. Citator checked to Nov 2026; followed in later cases, never overruled."
                className="w-full rounded-control border border-border bg-bg px-3 py-2"
              />
            </label>
            {save.error && <p className="text-sm text-danger">{save.error instanceof ApiRequestError ? save.error.message : 'Not saved. Try again.'}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={save.isPending}>
                Save the status
              </Button>
              <Button onClick={() => setChoice(null)}>Cancel</Button>
            </div>
          </>
        )}
      </form>

      {judgment.statusHistory.length > 1 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">Earlier findings</summary>
          <ul className="mt-2 space-y-1">
            {judgment.statusHistory.slice(1).map((h, i) => (
              <li key={i} className="text-muted">
                {h.confirmedAt.slice(0, 10)} · {caseStatusLabel(h.status)}
                {h.byCase ? ` (${h.byCase})` : ''} · {h.confirmedBy}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
