import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Minus, X } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { caseStatusLabel } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Pill } from '@/shared/ui/pill';

/** Plain names for the ten checks (no AI terms, LLD §12.8). */
const CHECK_NAMES: Record<string, string> = {
  C1: 'Source supplied',
  C2: 'Words found in the source',
  C3: 'Names, years and sections match',
  C4: 'Quotations exact',
  C5: 'Old and new law link confirmed',
  C6: 'Right kind of source',
  C7: "Court's majority reasoning",
  C8: 'Case status',
  C9: 'Source supports the line',
  C10: 'Second check',
};

const squash = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** Splits the paragraph around the supporting words so they can be highlighted (spaces and quote styles aside). */
export function highlight(text: string, span: string): [string, string, string] | null {
  const t = squash(text);
  const s = squash(span);
  const i = t.indexOf(s);
  return i < 0 ? null : [t.slice(0, i), t.slice(i, i + s.length), t.slice(i + s.length)];
}

export function SourceDrawer({ citationId, onClose }: { citationId: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: queryKeys.citationSource(citationId),
    queryFn: () => api.citationSource(citationId),
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  const parts = d?.text ? highlight(d.text, d.span) : null;
  // Case status is read live: an expert's later finding replaces the status the line was built with.
  const live = d?.caseStatus ?? null;
  const checks = (d?.checks ?? [])
    .filter((c) => c.result !== 'skipped')
    .map((c) =>
      c.name === 'C8' && live && live !== 'not_verified'
        ? {
            ...c,
            result: live === 'overruled' || live === 'reversed' ? ('fail' as const) : ('pass' as const),
            detail: caseStatusLabel(live),
          }
        : c,
    );

  return (
    <aside aria-label="Source" className="flex h-full flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{d?.label ?? '…'}</h2>
          {d?.title && <p className="text-sm text-muted">{d.title}</p>}
          {d?.whyChosen && (d.whyChosen.relevance !== null || d.whyChosen.reasons.length > 0) && (
            <p className="mt-2 text-sm">
              <span className="font-medium">Why this source: </span>
              {[
                d.whyChosen.relevance !== null ? `relevance ${Math.round(d.whyChosen.relevance * 10)}/10` : null,
                ...d.whyChosen.reasons,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-control p-1 text-muted hover:bg-bg"
          aria-label="Close source"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {q.isLoading && <p className="text-sm text-muted">Opening the source…</p>}
      {q.isError && <p className="text-sm text-danger">The source could not be opened. Try again.</p>}
      {d && (
        // Keyed by citation: a new line opens its source at the top, not where the last one was scrolled to.
        <div key={citationId} className="min-h-0 flex-1 space-y-4 relative overflow-y-auto pr-1">
          {(d.provisional || live) && (
            <div className="flex flex-wrap gap-2">
              {d.provisional && <Pill tone="grey">Not yet reviewed by the library team</Pill>}
              {live && (
                <Pill
                  tone={
                    live === 'not_verified'
                      ? 'grey'
                      : live === 'overruled' || live === 'reversed'
                        ? 'yellow'
                        : 'success'
                  }
                >
                  {caseStatusLabel(live)}
                </Pill>
              )}
            </div>
          )}
          {d.header && <p className="text-xs text-muted">{d.header}</p>}
          <div className="rounded-card border border-border bg-bg p-3 text-sm leading-relaxed">
            {parts ? (
              <p>
                {parts[0]}
                <mark className="rounded bg-flag-yellow-bg px-0.5 text-text">{parts[1]}</mark>
                {parts[2]}
              </p>
            ) : d.text ? (
              <p className="whitespace-pre-line">{d.text}</p>
            ) : (
              <p>
                <mark className="rounded bg-flag-yellow-bg px-0.5 text-text">{d.span || d.claim}</mark>
                <span className="mt-2 block text-xs text-muted">
                  The full text is no longer held; the supporting words above were saved with your lecture.
                </span>
              </p>
            )}
          </div>
          {d.url && (
            <a
              href={d.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm text-accent underline"
            >
              Open the official copy <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted">Checks on this line</p>
            <ul className="space-y-1 text-sm">
              {checks.map((c) => (
                <li key={c.name} className="flex items-start gap-2">
                  {c.result === 'pass' ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="passed" />
                  ) : c.result === 'grey' ? (
                    <Minus className="mt-0.5 size-4 shrink-0 text-flag-grey" aria-label="not verified" />
                  ) : (
                    <X className="mt-0.5 size-4 shrink-0 text-flag-yellow" aria-label="please verify" />
                  )}
                  <span className={cn(c.result === 'fail' && 'font-medium')}>
                    {CHECK_NAMES[c.name] ?? c.name}
                    {c.detail && <span className="block text-xs text-muted">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </aside>
  );
}
