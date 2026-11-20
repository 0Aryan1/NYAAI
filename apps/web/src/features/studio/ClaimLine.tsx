import { useState } from 'react';
import { AlertTriangle, CircleHelp, User } from 'lucide-react';
import type { SlideLine } from '@nyaai/shared';
import { cn } from '@/shared/lib/utils';

interface ClaimLineProps {
  line: SlideLine;
  active: boolean;
  /** Footnote number per citation on this slide (slide view). */
  numbers: Map<string, number>;
  /** Check view: every source as a labelled chip, the grey status as a pill. */
  showChecks: boolean;
  onOpenSource: (citationId: string) => void;
}

/**
 * One slide line (LLD §12.4). Slide view reads like a slide: plain text with small footnote numbers that open the
 * source. A yellow line always keeps its underline, margin dot and a labelled "verify" control, whatever the view:
 * an open point is never hidden. Colour is never the only signal (icon + text label everywhere).
 */
export function ClaimLine({ line, active, numbers, showChecks, onOpenSource }: ClaimLineProps) {
  const [open, setOpen] = useState(false);
  const yellow = line.flag === 'yellow';
  const grey = line.flag === 'grey';
  const footnotes = [...new Map(line.sources.map((s) => [numbers.get(s.citationId) ?? 0, s])).entries()].sort((a, b) => a[0] - b[0]);

  return (
    <li id={`line-${line.lineKey}`} className={cn('relative rounded-control px-2 py-1', active && 'ring-2 ring-accent')}>
      {yellow && <span className="absolute -left-3 top-3 size-2 rounded-full bg-flag-yellow" aria-hidden />}
      <span className={cn('leading-relaxed', yellow && 'underline decoration-flag-yellow-underline decoration-2 underline-offset-4', line.kind === 'question' && 'italic')}>
        {line.text}
      </span>
      {!showChecks &&
        footnotes.map(([n, s]) => (
          <button
            key={s.citationId}
            type="button"
            onClick={() => onOpenSource(s.citationId)}
            className={cn('ml-0.5 align-super text-[0.7em] font-medium hover:underline', grey ? 'text-flag-grey' : 'text-accent')}
            title={`${s.label}${grey ? ' · status not verified' : ''}${s.provisional ? ' · not yet reviewed' : ''}`}
            aria-label={`Source ${n}: ${s.label}${grey ? ', status not verified' : ''}`}
          >
            {n}
          </button>
        ))}
      {line.status === 'your_example' && (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-example-bg px-2 py-0.5 align-middle text-xs text-example">
          <User className="size-3" aria-hidden />
          Your example
        </span>
      )}
      {yellow && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-2 inline-flex items-center gap-1 rounded-full bg-flag-yellow-bg px-1.5 py-0.5 align-middle text-xs text-flag-yellow"
          title="Please verify"
        >
          <AlertTriangle className="size-3" aria-hidden />
          <span className={cn(!showChecks && 'sr-only')}>Please verify</span>
        </button>
      )}

      {showChecks && (line.sources.length > 0 || grey) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {line.sources.map((s) => (
            <button
              key={s.citationId}
              type="button"
              onClick={() => onOpenSource(s.citationId)}
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-text"
            >
              {s.tag} · {s.label}
            </button>
          ))}
          {grey && (
            <span className="inline-flex items-center gap-1 rounded-full bg-flag-grey-bg px-2 py-0.5 text-xs text-flag-grey" title="No law expert has confirmed this case's current status yet">
              <CircleHelp className="size-3" aria-hidden />
              Status not verified
            </span>
          )}
        </div>
      )}

      {yellow && open && (
        <div role="note" className="mt-2 rounded-card border border-border bg-surface p-3 text-sm not-italic">
          <p className="mb-1 font-medium">Not confirmed by NYAAI</p>
          <p className="text-muted">{line.flagReason ?? 'Please verify this line before teaching it.'}</p>
          {line.sources[0] && (
            <button type="button" className="mt-2 text-sm text-accent underline" onClick={() => onOpenSource(line.sources[0]!.citationId)}>
              Open the source
            </button>
          )}
          <p className="mt-2 text-xs text-muted">Edit, Mark verified and Remove arrive with slide editing.</p>
        </div>
      )}
    </li>
  );
}
