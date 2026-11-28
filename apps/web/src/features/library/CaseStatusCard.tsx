import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import type { ReviewJudgment, SetCaseStatus } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { caseStatusLabel } from '@/shared/lib/labels';
import { Button } from '@/shared/ui/button';
import { RadioCards } from '@/shared/ui/radio-cards';
import { CaseStatusPill } from '@/shared/ui/case-status-pill';
import { formatDate } from '@/shared/lib/format';
import { errorText } from '@/shared/lib/errors';

type Choice = SetCaseStatus['status'];
const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'good_law', label: 'Still good law', hint: 'No later judgment overrules or reverses it' },
  { value: 'doubted', label: 'Doubted', hint: 'A later bench doubted it; it still stands' },
  { value: 'overruled', label: 'Overruled', hint: 'A later bench overruled it' },
  { value: 'reversed', label: 'Reversed', hint: 'Reversed on appeal' },
];

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
      void qc.invalidateQueries({ queryKey: queryKeys.reviewAll });
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
            {step ? (
              <span className="grid size-6 place-items-center rounded-full bg-bg text-xs">{step}</span>
            ) : (
              <Scale className="size-4 text-muted" aria-hidden />
            )}
            Is it still good law?
          </h3>
          <p className="mt-1 text-sm text-muted">
            {latest
              ? `Confirmed by ${latest.confirmedBy ?? 'the library team'} on ${formatDate(latest.confirmedAt)}${latest.byCase ? `: ${latest.byCase}` : ''}.`
              : 'Not confirmed yet. Lectures show "Status not verified" on every line that rests on this case. Check a citator (SCC Online, Manupatra) or later judgments, then choose one answer below.'}
          </p>
          {latest?.note && <p className="mt-1 text-sm">{latest.note}</p>}
        </div>
        <CaseStatusPill status={judgment.caseStatus} />
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <RadioCards
          legend="Current status"
          legendClassName="sr-only"
          name="case-status"
          options={CHOICES}
          value={choice}
          onChange={setChoice}
        />
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
            {save.error && <p className="text-sm text-danger">{errorText(save.error, 'Not saved. Try again.')}</p>}
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
                {formatDate(h.confirmedAt)} · {caseStatusLabel(h.status)}
                {h.byCase ? ` (${h.byCase})` : ''} · {h.confirmedBy}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
