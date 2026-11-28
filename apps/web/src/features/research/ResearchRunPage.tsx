import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Circle, FileDown, Loader2, Presentation } from 'lucide-react';
import type { BriefLine, EvidenceRow, ResearchRunView } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Pill } from '@/shared/ui/pill';
import { ListSkeleton, LoadError, SlowNote } from '@/shared/ui/states';
import { HighlightedPassage } from '@/shared/ui/highlighted-passage';

import { FlaggedLine } from '@/shared/ui/flagged-line';
import { evidenceTone, sortEvidence, useBriefExport, type EvidenceSort } from './evidence';
import { BUDGET_EXHAUSTED_TEXT } from '@/shared/lib/errors';

const STEPS: { key: ResearchRunView['status']; label: string }[] = [
  { key: 'planning', label: 'Planning: splitting your question into smaller ones' },
  { key: 'gathering', label: 'Gathering: Acts and judgments for each' },
  { key: 'writing', label: 'Writing the brief from the evidence only' },
  { key: 'checking', label: 'Checking every statement' },
];
const ORDER = ['planning', 'gathering', 'writing', 'checking', 'ready'];
const RELATION: Record<EvidenceRow['relation'], { label: string; tone: 'success' | 'yellow' | 'danger' }> = {
  supports: { label: 'Supports', tone: 'success' },
  limits: { label: 'Limits', tone: 'yellow' },
  conflicts: { label: 'Conflicts', tone: 'danger' },
};
const FAILED: Record<string, string> = {
  BUDGET_EXHAUSTED: BUDGET_EXHAUSTED_TEXT,
  SERVICE_UNAVAILABLE: 'The writing service is not available right now. Ask again in a little while.',
  RESEARCH_TIMEOUT: 'This research took too long. Ask again, perhaps a narrower question.',
};

function Lines({ lines, onSource }: { lines: BriefLine[]; onSource: (tag: string) => void }) {
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {lines.map((l, i) => (
        <FlaggedLine key={i} text={l.text} flag={l.flag} reason={l.reason}>
          {l.sources.map((s) => (
            <button
              key={s.tag}
              type="button"
              onClick={() => onSource(s.tag)}
              className="ml-1.5 rounded-full border border-border px-2 py-0.5 align-middle text-xs text-muted hover:border-accent hover:text-text"
            >
              {s.tag} · {s.label}
            </button>
          ))}
        </FlaggedLine>
      ))}
    </ul>
  );
}

/**
 * One Research run (RES-3, RES-4): live progress while it runs, then the brief and the evidence table. Every brief line
 * carries its evidence row; a row shows the exact words used, how it relates, and a status no stronger than an expert
 * confirmed.
 */
export function ResearchRunPage() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: queryKeys.researchRun(runId),
    queryFn: () => api.researchRun(runId),
    refetchInterval: (query) =>
      query.state.data && !['ready', 'failed'].includes(query.state.data.status) ? 2000 : false,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<EvidenceSort>('order');
  // RES-5: Word or PDF, made by the server from the brief as checked; lines to verify are marked in the file.
  const { exportAs, exporting, note: exportNote } = useBriefExport(runId);
  const run = q.data;
  const evidence = useMemo(() => sortEvidence(run?.brief?.evidence ?? [], sort), [run, sort]);

  if (q.isError)
    return <LoadError what="This research" onRetry={() => void q.refetch()} className="mx-auto max-w-3xl" />;
  if (!run)
    return (
      <div className="mx-auto max-w-3xl">
        <ListSkeleton rows={3} label="Opening the research" />
      </div>
    );

  const showSource = (tag: string) => {
    setOpen(tag);
    document.getElementById(`evidence-${tag}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const brief = run.brief;
  const at = ORDER.indexOf(run.status);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link to="/research" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" aria-hidden /> My research
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-3xl text-2xl font-semibold leading-snug">{run.question}</h1>
          {run.status === 'ready' && (
            <span className="flex flex-wrap gap-2">
              {run.brief && (run.brief.shortAnswer.length > 0 || run.brief.keyPoints.length > 0) && (
                <>
                  <Button
                    disabled={exporting !== null}
                    onClick={() => exportAs('docx')}
                    title="Lines to verify are marked in the file, with a closing list"
                  >
                    <FileDown className="size-4" aria-hidden />
                    {exporting === 'docx' ? 'Preparing…' : 'Word'}
                  </Button>
                  <Button
                    disabled={exporting !== null}
                    onClick={() => exportAs('pdf')}
                    title="Lines to verify are marked in the file, with a closing list"
                  >
                    <FileDown className="size-4" aria-hidden />
                    {exporting === 'pdf' ? 'Preparing…' : 'PDF'}
                  </Button>
                </>
              )}
              <Button
                variant="primary"
                onClick={() => void navigate(`/?topic=${encodeURIComponent(run.question.slice(0, 200))}`)}
              >
                <Presentation className="size-4" aria-hidden />
                Turn into a lecture
              </Button>
            </span>
          )}
        </div>
        {exportNote && (
          <p role="status" className="mt-2 text-sm text-muted">
            {exportNote}
          </p>
        )}
        <p className="mt-1 text-sm text-muted">
          {run.scope.comparative ? 'Comparative' : 'India only'}
          {(run.scope.fromYear || run.scope.toYear) &&
            ` · judgments ${run.scope.fromYear ?? 'any year'}–${run.scope.toYear ?? 'now'}`}
        </p>
      </div>

      {run.status === 'failed' && (
        <div role="alert" className="rounded-card border border-border bg-surface p-5 text-sm">
          <p className="font-medium">This research did not finish.</p>
          <p className="mt-1 text-muted">
            {FAILED[run.errorCode ?? ''] ?? 'Something went wrong on our side. Ask the question again.'}
          </p>
          <Link to="/research" className="mt-3 inline-block text-accent hover:underline">
            Ask again
          </Link>
        </div>
      )}

      {run.status !== 'ready' && run.status !== 'failed' && (
        <section aria-labelledby="progress" className="rounded-card border border-border bg-surface p-5">
          <h2 id="progress" className="sr-only">
            Progress
          </h2>
          <ol className="space-y-3" aria-live="polite">
            {STEPS.map((s, i) => {
              const done = at > i;
              const now = at === i;
              return (
                <li key={s.key} className={cn('flex items-center gap-3 text-sm', !done && !now && 'text-muted')}>
                  {done ? (
                    <Check className="size-4 text-success" aria-label="done" />
                  ) : now ? (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-label="now" />
                  ) : (
                    <Circle className="size-4" aria-hidden />
                  )}
                  {s.label}
                </li>
              );
            })}
          </ol>
          {run.subQuestions.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">The smaller questions</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {run.subQuestions.map((s) => (
                  <li key={s.position}>{s.text}</li>
                ))}
              </ol>
            </div>
          )}
          <SlowNote />
        </section>
      )}

      {brief && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="brief" className="space-y-6">
            <h2 id="brief" className="text-lg font-semibold">
              The brief
            </h2>
            {brief.shortAnswer.length === 0 && brief.keyPoints.length === 0 ? (
              <p className="text-sm text-muted">
                The library does not hold enough to answer this yet. The library team has your question and will look
                for the sources.
              </p>
            ) : (
              <>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Short answer</h3>
                  <Lines lines={brief.shortAnswer} onSource={showSource} />
                </div>
                {brief.keyPoints.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Key points</h3>
                    <Lines lines={brief.keyPoints} onSource={showSource} />
                  </div>
                )}
                {brief.conflicts.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                      Where the authorities differ
                    </h3>
                    <Lines lines={brief.conflicts} onSource={showSource} />
                  </div>
                )}
              </>
            )}
            {brief.openQuestions.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Open questions</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {brief.openQuestions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.notFound.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Not found in sources</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  {brief.notFound.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section aria-labelledby="evidence">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="evidence" className="text-lg font-semibold">
                Evidence ({brief.evidence.length})
              </h2>
              {brief.evidence.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  Sort by
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as EvidenceSort)}
                    className="h-8 rounded-control border border-border bg-surface px-2 text-text"
                  >
                    <option value="order">Question</option>
                    <option value="relation">How it relates</option>
                    <option value="court">Court</option>
                    <option value="date">Date</option>
                  </select>
                </label>
              )}
            </div>
            <ul className="space-y-3">
              {evidence.map((e) => {
                const expanded = open === e.tag;
                return (
                  <li
                    key={e.tag}
                    id={`evidence-${e.tag}`}
                    className={cn(
                      'rounded-card border bg-surface p-4 text-sm',
                      expanded ? 'border-accent' : 'border-border',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">
                        {e.tag} · {e.label}
                      </p>
                      <span className="flex flex-wrap gap-1.5">
                        <Pill tone={RELATION[e.relation].tone}>{RELATION[e.relation].label}</Pill>
                        <Pill tone={evidenceTone(e)}>{e.statusLabel}</Pill>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {[e.court, e.decidedOn].filter(Boolean).join(' · ')}
                      {(e.court || e.decidedOn) && ' · '}found for question {e.subQuestion}
                      {e.provisional && ' · not yet reviewed by the library team'}
                    </p>
                    <p className={cn('mt-2 whitespace-pre-line leading-relaxed', !expanded && 'line-clamp-4')}>
                      <HighlightedPassage text={e.text} span={e.spans[0]} />
                    </p>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : e.tag)}
                      className="mt-1 text-xs text-accent hover:underline"
                      aria-expanded={expanded}
                    >
                      {expanded ? 'Show less' : 'Show the whole passage'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
