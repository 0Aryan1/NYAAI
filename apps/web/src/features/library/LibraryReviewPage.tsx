import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Check, CircleHelp, ExternalLink, FilePlus, Search, ShieldCheck } from 'lucide-react';
import type { ParaRole } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { caseStatusLabel, isAdverseStatus } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { Tabs } from '@/shared/ui/tabs';
import { LoadError, Skeleton, SlowNote } from '@/shared/ui/states';
import { CaseStatusCard } from './CaseStatusCard';
import {
  checklistSteps,
  citationsOf,
  filterJudgments,
  OPINION_LABELS,
  originLabel,
  reviewCounts,
  ROLE_LABELS,
  ROLES,
  stillToDo,
  todo,
  type ChecklistStep,
  type Filter,
} from './review';
import { formatDate } from '@/shared/lib/format';
import { UploadJudgment } from './UploadJudgment';

/** The three checks that move a judgment to "Done", each with a jump to where it is done. */
function Checklist({ steps }: { steps: ChecklistStep[] }) {
  const left = steps.filter((x) => !x.done).length;
  return (
    <section aria-labelledby="checklist" className="rounded-card border border-border bg-surface p-5">
      <h3 id="checklist" className="font-semibold">
        {left ? `${left} of 3 checks left` : 'All three checks done'}
      </h3>
      <p className="mt-1 text-sm text-muted">
        {left
          ? 'When all three are done, this judgment moves to Done and lectures can rely on it fully.'
          : 'This judgment is in Done. Lectures can rely on it fully.'}
      </p>
      <ol className="mt-4 divide-y divide-border">
        {steps.map((x, i) => (
          <li key={i} className="flex items-center gap-3 py-2.5">
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                x.done ? 'bg-success/15 text-success' : 'bg-bg text-muted',
              )}
            >
              {x.done ? <Check className="size-3.5" aria-label="done" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-sm font-medium', x.done && 'text-muted')}>{x.title}</span>
              <span className="block text-xs text-muted">{x.hint}</span>
            </span>
            {!x.done && x.target && (
              <Button
                size="sm"
                onClick={() =>
                  document.getElementById(x.target!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                Do it
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Library editor (LIB-2): for each judgment she confirms whether it is still good law, checks the paragraph labels,
 * and approves a live lookup. Teachers' lectures then rest on her findings.
 */
export function LibraryReviewPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: queryKeys.reviewJudgments, queryFn: api.reviewJudgments });
  // Opened from a wrong-fact report: that judgment, whatever its state.
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('judgment'));
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<Filter>(params.get('judgment') ? 'all' : 'todo');
  const [q, setQ] = useState('');
  const [allCitations, setAllCitations] = useState(false);
  const all = useMemo(() => list.data?.judgments ?? [], [list.data]);
  const shown = useMemo(() => filterJudgments(all, filter, q), [all, filter, q]);
  const current = selected ?? shown[0]?.id ?? null;
  // Hold on to the judgment on screen. Without this, finishing a check refetches the list, the first entry changes,
  // and the screen jumps to a different judgment as if hers had vanished.
  useEffect(() => {
    if (!selected && current) setSelected(current);
  }, [selected, current]);
  const detail = useQuery({
    queryKey: queryKeys.reviewJudgment(current ?? ''),
    queryFn: () => api.reviewJudgment(current!),
    enabled: !!current && !adding,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: queryKeys.reviewAll });
  const setRole = useMutation({
    mutationFn: ({ chunkId, role }: { chunkId: string; role: ParaRole }) => api.setParagraphRole(chunkId, role),
    onSuccess: refresh,
  });
  const checked = useMutation({ mutationFn: api.rolesChecked, onSuccess: refresh });
  const approve = useMutation({ mutationFn: api.approveJudgment, onSuccess: refresh });
  const sameCase = useMutation({
    mutationFn: api.sameCase,
    onSuccess: (_, v) => {
      // The same case: this copy leaves the library, so show the one that stays.
      if (v.same && j?.maybeSameAs) {
        setSelected(j.maybeSameAs.id);
        setFilter('all');
      }
      refresh();
    },
  });
  const j = detail.data;
  const cites = citationsOf(j?.citation ?? null);
  const counts = reviewCounts(all);

  return (
    <div className="flex h-full">
      <nav aria-label="Judgments" className="flex w-80 shrink-0 flex-col border-r border-border bg-surface">
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight">Judgments</h1>
            <Button size="sm" onClick={() => setAdding(true)} aria-pressed={adding}>
              <FilePlus className="size-4" aria-hidden />
              Add
            </Button>
          </div>
          <label className="relative block">
            <span className="sr-only">Find a judgment</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find by name"
              className="w-full rounded-control border border-border bg-bg py-2 pl-8 pr-3 text-sm"
            />
          </label>
        </div>
        <Tabs<Filter>
          label="Show"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setSelected(null);
          }}
          className="px-2"
          options={[
            { value: 'todo', label: 'To check', count: counts.todo },
            { value: 'done', label: 'Done', count: counts.done },
            { value: 'all', label: 'All', count: counts.all },
          ]}
        />
        <ul className="min-h-0 flex-1 relative overflow-y-auto p-2">
          {list.isLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <li key={i} aria-hidden className="px-3 py-2.5">
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </li>
            ))}
          {list.isError && (
            <li>
              <LoadError what="The judgments" onRetry={() => void list.refetch()} className="m-1" />
            </li>
          )}
          {list.isSuccess && shown.length === 0 && (
            <li className="p-3 text-sm text-muted">
              {filter === 'todo' ? 'Nothing left to check.' : 'No judgments here.'}
            </li>
          )}
          {shown.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => {
                  setSelected(x.id);
                  setAdding(false);
                  setAllCitations(false);
                }}
                aria-current={x.id === current && !adding ? 'true' : undefined}
                className={cn(
                  'w-full rounded-control px-3 py-2.5 text-left',
                  x.id === current && !adding ? 'bg-accent/10' : 'hover:bg-bg',
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug">{x.title}</span>
                <span className="mt-1 block text-xs text-muted">
                  {x.decidedOn?.slice(0, 4)} · {originLabel(x.origin, x.scanned)}
                </span>
                <span className="mt-1 block text-xs">
                  {todo(x) ? (
                    <span className="text-flag-yellow">Still to do: {stillToDo(x).join(' · ')}</span>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1',
                        isAdverseStatus(x.caseStatus) ? 'text-flag-yellow' : 'text-success',
                      )}
                    >
                      <Check className="size-3" aria-hidden />
                      Checked · {caseStatusLabel(x.caseStatus)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 relative overflow-y-auto bg-bg px-6 py-8 lg:px-10">
        {adding ? (
          <UploadJudgment
            judgments={all}
            onDone={(id) => {
              setSelected(id);
              setAdding(false);
              setFilter('all');
            }}
          />
        ) : !j ? (
          detail.isLoading ? (
            <div role="status" aria-label="Opening the judgment" className="mx-auto max-w-3xl space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40 w-full" />
              <SlowNote />
            </div>
          ) : detail.isError ? (
            <LoadError what="This judgment" onRetry={() => void detail.refetch()} className="mx-auto max-w-3xl" />
          ) : (
            <p className="text-muted">
              {all.length === 0 && list.isSuccess ? 'No judgments in the library yet.' : 'Choose a judgment.'}
            </p>
          )
        ) : (
          <article className="mx-auto max-w-3xl space-y-6">
            <header>
              <h2 className="text-2xl font-semibold leading-tight tracking-tight">{j.title}</h2>
              <p className="mt-2 text-sm text-muted">
                {[j.court, j.decidedOn].filter(Boolean).join(' · ')}
                {cites.length > 0 && <span className="text-text"> · {cites[0]}</span>}
                {cites.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setAllCitations((v) => !v)}
                    className="ml-2 text-accent hover:underline"
                  >
                    {allCitations ? 'fewer' : `+${cites.length - 1} more`}
                  </button>
                )}
              </p>
              {allCitations && <p className="mt-1 text-xs leading-relaxed text-muted">{cites.slice(1).join(' · ')}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>
                  Text from <span className="text-text">{originLabel(j.origin, j.scanned)}</span>
                  {j.expiresAt ? `, kept until ${formatDate(j.expiresAt)}` : ', kept permanently'}
                </span>
                {j.url && (
                  <a
                    href={j.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Open the original <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
                {j.copies
                  .filter((c) => !c.inUse && c.url)
                  .map((c, i) => (
                    <a
                      key={i}
                      href={c.url!}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                      title={
                        c.agreement !== null
                          ? `Agrees ${Math.round(c.agreement * 100)}% with the text in use`
                          : undefined
                      }
                    >
                      {originLabel(c.origin, c.scanned)} PDF <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ))}
              </p>
              {j.scanned && (
                <p className="mt-3 rounded-control bg-flag-yellow-bg px-3 py-2 text-sm text-flag-yellow">
                  This text was read from a scan and may have reading errors. Check quoted words against the PDF.
                </p>
              )}
            </header>

            {j.maybeSameAs && (
              <section
                id="step-same"
                aria-labelledby="same"
                className="scroll-mt-6 rounded-card border border-flag-yellow bg-flag-yellow-bg p-5"
              >
                <h3 id="same" className="font-semibold">
                  Is this the same case as one already in the library?
                </h3>
                <p className="mt-1 max-w-prose text-sm">
                  The library already holds{' '}
                  <button
                    type="button"
                    className="font-medium text-accent hover:underline"
                    onClick={() => {
                      setSelected(j.maybeSameAs!.id);
                      setFilter('all');
                    }}
                  >
                    {j.maybeSameAs.title}
                  </button>
                  {[j.maybeSameAs.court, j.maybeSameAs.decidedOn].filter(Boolean).length > 0 &&
                    ` (${[j.maybeSameAs.court, j.maybeSameAs.decidedOn].filter(Boolean).join(', ')})`}
                  , with the same parties. This one may be a second copy of it, or a different judgment in the same
                  matter, such as an earlier order or a review. Compare the court and the date.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button disabled={sameCase.isPending} onClick={() => sameCase.mutate({ id: j.id, same: false })}>
                    Different case: keep both
                  </Button>
                  <Button disabled={sameCase.isPending} onClick={() => sameCase.mutate({ id: j.id, same: true })}>
                    Same case: remove this copy
                  </Button>
                </div>
              </section>
            )}

            <Checklist steps={checklistSteps(j)} />

            <div id="step-status" className="scroll-mt-6">
              <CaseStatusCard judgment={j} step={1} />
            </div>

            <section
              id="step-labels"
              aria-labelledby="labels"
              className="scroll-mt-6 rounded-card border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-prose">
                  <h3 id="labels" className="flex items-center gap-2 font-semibold">
                    <span className="grid size-6 place-items-center rounded-full bg-bg text-xs">2</span>
                    Are the paragraph labels right?
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    The app has labelled each paragraph below. A slide may say “the court held” only when it rests on
                    the court’s own reasoning or decision, so these labels must be right. Read the paragraphs, change
                    any wrong label in its menu, then confirm.
                  </p>
                </div>
                {j.rolesChecked && (
                  <Pill tone="success" icon={<Check className="size-3" aria-hidden />}>
                    Labels checked
                  </Pill>
                )}
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                {Object.values(ROLES).map(({ label, means }) => (
                  <div key={label} className="flex gap-2">
                    <dt className="shrink-0 font-medium">{label}</dt>
                    <dd className="text-muted">{means}</dd>
                  </div>
                ))}
              </dl>
              {!j.rolesChecked && (
                <Button
                  variant="primary"
                  className="mt-4"
                  disabled={checked.isPending}
                  onClick={() => checked.mutate(j.id)}
                >
                  <Check className="size-4" aria-hidden />I have checked: the labels are right
                </Button>
              )}
            </section>

            {j.status === 'provisional' && (
              <section
                id="step-approve"
                aria-labelledby="approve"
                className="scroll-mt-6 rounded-card border border-border bg-surface p-5"
              >
                <h3 id="approve" className="flex items-center gap-2 font-semibold">
                  <span className="grid size-6 place-items-center rounded-full bg-bg text-xs">3</span>
                  Is this the right judgment, with its full text?
                </h3>
                <p className="mt-1 max-w-prose text-sm text-muted">
                  This copy came from{' '}
                  {j.origin === 'indian_kanoon'
                    ? 'Indian Kanoon, not the official report'
                    : 'a court website or an upload and is not approved yet'}
                  . Until you approve it, lectures mark lines from it “not yet reviewed”. Check the name, court and date
                  above, and that the paragraphs run from start to end.
                </p>
                <Button
                  variant="primary"
                  className="mt-4"
                  disabled={approve.isPending || !!j.maybeSameAs}
                  onClick={() => approve.mutate(j.id)}
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  Approve this copy
                </Button>
                {j.maybeSameAs && (
                  <p className="mt-2 text-sm text-muted">
                    First answer whether this is the same case as the one already in the library.
                  </p>
                )}
              </section>
            )}

            <section aria-label="Paragraphs">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
                {j.paragraphs.length} paragraphs
              </h3>
              <ol className="space-y-3">
                {j.paragraphs.map((p) => (
                  <li
                    key={p.chunkId}
                    className={cn(
                      'rounded-card border border-border bg-surface px-5 py-4',
                      p.kind === 'headnote' && 'border-dashed bg-transparent',
                    )}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold">
                        {p.kind === 'headnote'
                          ? 'Headnote (the reporter’s summary, not the court)'
                          : `¶ ${p.paraNo ?? '?'}`}
                      </span>
                      {p.kind !== 'headnote' && (
                        <>
                          <Pill tone={p.opinion === 'majority' ? 'neutral' : 'yellow'}>
                            {OPINION_LABELS[p.opinion ?? 'unknown'] ?? p.opinion}
                            {p.judge ? ` · ${p.judge}` : ''}
                          </Pill>
                          <label className="ml-auto inline-flex items-center gap-2">
                            <span className="sr-only">Role of paragraph {p.paraNo}</span>
                            {p.role === 'unknown' && (
                              <CircleHelp className="size-3.5 text-flag-grey" aria-label="not sure" />
                            )}
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
                    <p className="whitespace-pre-line font-serif text-[0.95rem] leading-relaxed">{p.text}</p>
                  </li>
                ))}
              </ol>
            </section>
          </article>
        )}
      </main>
    </div>
  );
}
