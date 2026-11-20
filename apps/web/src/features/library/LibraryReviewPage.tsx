import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, ExternalLink } from 'lucide-react';
import type { ParaRole } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

/** Paragraph roles in the words a law teacher uses (HLD 5.2 b). */
export const ROLE_LABELS: Record<ParaRole, string> = {
  facts: 'Facts',
  arguments: "Counsel's arguments",
  lower_court_summary: "Lower court's view",
  discussion: "Court's reasoning",
  holding: "Court's decision",
  unknown: 'Not sure',
};
const OPINION_LABELS: Record<string, string> = {
  majority: 'Majority',
  concurring: 'Concurring',
  dissent: 'Dissent',
  separate_no_majority: 'Separate opinions, no single majority',
  unknown: 'Opinion not identified',
};

/**
 * Library editor: check judgments (LIB-2, pulled forward). For each judgment she reads the paragraphs, corrects any
 * label, and marks the labels checked; a live lookup she also approves. Teachers' "held" lines can then rest on it.
 */
export function LibraryReviewPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.reviewJudgments, queryFn: api.reviewJudgments });
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? list.data?.judgments.find((j) => !j.rolesChecked)?.id ?? list.data?.judgments[0]?.id ?? null;
  const detail = useQuery({ queryKey: queryKeys.reviewJudgment(current ?? ''), queryFn: () => api.reviewJudgment(current!), enabled: !!current });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['review'] });
  };
  const setRole = useMutation({ mutationFn: ({ chunkId, role }: { chunkId: string; role: ParaRole }) => api.setParagraphRole(chunkId, role), onSuccess: refresh });
  const checked = useMutation({ mutationFn: api.rolesChecked, onSuccess: refresh });
  const approve = useMutation({ mutationFn: api.approveJudgment, onSuccess: refresh });
  const j = detail.data;
  const waiting = list.data?.judgments.filter((x) => !x.rolesChecked).length ?? 0;

  return (
    <div className="-mx-4 -my-8 flex h-[calc(100dvh-3.5rem)] sm:-mx-8">
      <nav aria-label="Judgments" className="w-80 shrink-0 overflow-y-auto border-r border-border bg-surface p-3">
        <h1 className="px-2 text-lg font-semibold">Check judgments</h1>
        <p className="mb-3 px-2 text-xs text-muted">{list.data ? `${waiting} of ${list.data.judgments.length} still to check` : 'Loading…'}</p>
        <ul className="space-y-1">
          {list.data?.judgments.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSelected(x.id)}
                aria-current={x.id === current ? 'true' : undefined}
                className={cn('w-full rounded-control px-2 py-2 text-left text-sm', x.id === current ? 'bg-bg' : 'hover:bg-bg')}
              >
                <span className="line-clamp-2 font-medium">{x.title}</span>
                <span className="mt-1 flex flex-wrap gap-1 text-xs">
                  {x.rolesChecked ? (
                    <span className="inline-flex items-center gap-1 text-success"><Check className="size-3" aria-hidden />Labels checked</span>
                  ) : (
                    <span className="text-flag-yellow">Labels to check</span>
                  )}
                  {x.status === 'provisional' && <span className="text-flag-grey">· not yet approved</span>}
                  <span className="text-muted">· {x.paragraphs} paragraphs</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!j ? (
          <p className="text-muted">{list.data?.judgments.length === 0 ? 'No judgments in the library yet.' : 'Choose a judgment.'}</p>
        ) : (
          <article className="mx-auto max-w-3xl">
            <header className="mb-4">
              <h2 className="text-xl font-semibold">{j.title}</h2>
              <p className="text-sm text-muted">
                {[j.court, j.decidedOn].filter(Boolean).join(' · ')}
                {j.url && (
                  <a href={j.url} target="_blank" rel="noreferrer noopener" className="ml-2 inline-flex items-center gap-1 text-accent underline">
                    Open the original <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </p>
            </header>

            <div className="mb-6 rounded-card border border-border bg-surface p-4 text-sm">
              <p className="mb-2 font-medium">How to check</p>
              <ol className="list-decimal space-y-1 pl-5 text-muted">
                <li>Read each paragraph and its label. Correct any wrong label with the menu.</li>
                <li>"Court's decision" and "Court's reasoning" must be the majority's own words, never counsel's arguments or a dissent.</li>
                <li>When every label is right, press <strong>Labels checked</strong>.{j.status === 'provisional' ? ' If this is the right judgment and the text is complete, also press Approve.' : ''}</li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" disabled={j.rolesChecked || checked.isPending} onClick={() => checked.mutate(j.id)}>
                  <Check className="size-4" aria-hidden />
                  {j.rolesChecked ? 'Labels checked' : 'Labels checked'}
                </Button>
                {j.status === 'provisional' && (
                  <Button disabled={approve.isPending} onClick={() => approve.mutate(j.id)}>
                    Approve this judgment
                  </Button>
                )}
              </div>
              {j.rolesChecked && <p className="mt-2 text-xs text-success">Checked. Lectures prepared from now on can rely on these labels.</p>}
            </div>

            <ol className="space-y-3">
              {j.paragraphs.map((p) => (
                <li key={p.chunkId} className={cn('rounded-card border border-border bg-surface p-4', p.kind === 'headnote' && 'opacity-70')}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{p.kind === 'headnote' ? 'Headnote (reporter, not the court)' : `¶ ${p.paraNo ?? '?'}`}</span>
                    {p.kind !== 'headnote' && (
                      <>
                        <span className={cn('rounded-full px-2 py-0.5', p.opinion === 'majority' ? 'bg-bg' : 'bg-flag-yellow-bg text-flag-yellow')}>
                          {OPINION_LABELS[p.opinion ?? 'unknown'] ?? p.opinion}
                          {p.judge ? ` · ${p.judge}` : ''}
                        </span>
                        <label className="ml-auto inline-flex items-center gap-2">
                          <span className="sr-only">Role of paragraph {p.paraNo}</span>
                          {p.role === 'unknown' && <CircleHelp className="size-3 text-flag-grey" aria-hidden />}
                          <select
                            value={p.role ?? 'unknown'}
                            onChange={(e) => setRole.mutate({ chunkId: p.chunkId, role: e.target.value as ParaRole })}
                            disabled={setRole.isPending}
                            className="rounded-control border border-border bg-bg px-2 py-1 text-xs"
                          >
                            {(Object.keys(ROLE_LABELS) as ParaRole[]).map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{p.text}</p>
                </li>
              ))}
            </ol>
          </article>
        )}
      </main>
    </div>
  );
}
