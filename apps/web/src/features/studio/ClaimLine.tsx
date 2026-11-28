import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Pencil, Trash2, User, Flag } from 'lucide-react';
import type { SlideLine, LineReport } from '@nyaai/shared';
import { cn } from '@/shared/lib/utils';

/** The background check of an edited line is still running (server: services/edit CHANGED). */
export const CHECKING = 'Changed by you: being checked against the source';

interface ClaimLineProps {
  line: SlideLine;
  active: boolean;
  /** Footnote number per citation on this slide (slide view). */
  numbers: Map<string, number>;
  /** Check view: every source as a labelled chip, the grey status as a pill. */
  showChecks: boolean;
  onOpenSource: (citationId: string) => void;
  /** Editing (STUDIO-2, -4): present when she may change the lecture. */
  onEdit?: (text: string) => void;
  onRemove?: () => void;
  onVerify?: () => void;
  /** Wrong-fact report (ADM-2): one click on the line, then an optional note. */
  onReport?: () => void;
  /** Her latest report on this line, with the library's answer. */
  report?: LineReport;
}

const OUTCOME: Record<NonNullable<LineReport['outcome']>, string> = {
  was_correct: 'The library checked it: the source is right',
  fixed_chunk: 'The library corrected the source: check this line',
  fixed_label: 'The library corrected a label on the source: check this line',
  fixed_mapping: 'The library corrected a law mapping: check this line',
};

/** A textarea that grows with its text, saved on Enter or when she leaves it; Escape puts the words back. */
function LineEditor({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);
  const finish = () => onDone(text.trim() === initial.trim() ? null : text.trim());
  return (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      aria-label="Edit this line"
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onDone(null);
        }
      }}
      className="block w-full resize-none rounded-control border border-accent bg-bg px-2 py-1 leading-relaxed outline-none"
    />
  );
}

/**
 * One slide line (LLD §12.4). Slide view reads like a slide: plain text with small footnote numbers that open the
 * source. A yellow line always keeps its underline, margin dot and a labelled "verify" control, whatever the view:
 * an open point is never hidden. Colour is never the only signal (icon + text label everywhere). Click the words to
 * change them; the line is checked again (LLD §8.6).
 */
export function ClaimLine({
  line,
  active,
  numbers,
  showChecks,
  onOpenSource,
  onEdit,
  onRemove,
  onVerify,
  onReport,
  report,
}: ClaimLineProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const checking = line.flagReason === CHECKING;
  const yellow = line.flag === 'yellow' && !checking;
  const grey = line.flag === 'grey';
  const footnotes = [...new Map(line.sources.map((s) => [numbers.get(s.citationId) ?? 0, s])).entries()].sort(
    (a, b) => a[0] - b[0],
  );

  return (
    <li
      id={`line-${line.lineKey}`}
      className={cn(
        'group relative -mx-2 rounded-control px-2 py-1',
        active && 'ring-2 ring-accent',
        onEdit && !editing && 'hover:bg-bg/70',
      )}
    >
      {(yellow || checking) && (
        <span
          className={cn(
            'absolute -left-3 top-3 size-2 rounded-full',
            checking ? 'animate-pulse bg-muted' : 'bg-flag-yellow',
          )}
          aria-hidden
        />
      )}
      {editing && onEdit ? (
        <LineEditor
          initial={line.text}
          onDone={(t) => {
            setEditing(false);
            if (t === '') onRemove?.();
            else if (t !== null) onEdit(t);
          }}
        />
      ) : (
        <span
          className={cn(
            'leading-relaxed',
            yellow && 'underline decoration-flag-yellow-underline decoration-2 underline-offset-4',
            line.kind === 'question' && 'italic',
            onEdit && 'cursor-text',
          )}
          onClick={onEdit ? () => setEditing(true) : undefined}
        >
          {line.text}
        </span>
      )}
      {!editing &&
        !showChecks &&
        footnotes.map(([n, s]) => (
          <button
            key={s.citationId}
            type="button"
            onClick={() => onOpenSource(s.citationId)}
            className={cn(
              'ml-0.5 align-super text-[0.7em] font-medium hover:underline',
              grey ? 'text-flag-grey' : 'text-accent',
            )}
            title={`${s.label}${grey ? ' · status not verified' : ''}${s.provisional ? ' · not yet reviewed' : ''}`}
            aria-label={`Source ${n}: ${s.label}${grey ? ', status not verified' : ''}`}
          >
            {n}
          </button>
        ))}
      {!editing && line.status === 'your_example' && (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-example-bg px-2 py-0.5 align-middle text-xs text-example">
          <User className="size-3" aria-hidden />
          Your example
        </span>
      )}
      {!editing && line.status === 'verified_by_you' && (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 align-middle text-xs text-success">
          <Check className="size-3" aria-hidden />
          Verified by you
        </span>
      )}
      {!editing && checking && <span className="ml-2 align-middle text-xs not-italic text-muted">Checking…</span>}
      {!editing && report && (
        <span
          className="mt-0.5 flex items-center gap-1 text-xs not-italic text-muted"
          title={report.resolutionNote ?? undefined}
        >
          <Flag className="size-3 shrink-0" aria-hidden />
          {report.status === 'resolved' && report.outcome
            ? OUTCOME[report.outcome]
            : 'Reported: the library team will check it within a day'}
          {report.status === 'resolved' && report.resolutionNote && (
            <span className="truncate">({report.resolutionNote})</span>
          )}
        </span>
      )}
      {!editing && yellow && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="ml-2 inline-flex items-center gap-1 rounded-full bg-flag-yellow-bg px-1.5 py-0.5 align-middle text-xs not-italic text-flag-yellow"
          title="Please verify"
        >
          <AlertTriangle className="size-3" aria-hidden />
          <span className={cn(!showChecks && 'sr-only')}>Please verify</span>
        </button>
      )}

      {/* Line actions: shown on hover or keyboard focus, never covering the words. */}
      {onEdit && !editing && (
        <span className="absolute -right-2 top-0.5 hidden translate-x-full items-center gap-0.5 pl-1 group-focus-within:flex group-hover:flex">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-control p-1 text-muted hover:bg-bg hover:text-text"
            aria-label="Edit this line"
            title="Edit"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-control p-1 text-muted hover:bg-bg hover:text-danger"
              aria-label="Remove this line"
              title="Remove"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          )}
          {onReport && (
            <button
              type="button"
              onClick={onReport}
              className="rounded-control p-1 text-muted hover:bg-bg hover:text-flag-yellow"
              aria-label="Report a wrong fact"
              title="Report a wrong fact"
            >
              <Flag className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      )}

      {!editing && showChecks && (line.sources.length > 0 || grey || line.edited) && (
        <div className="mt-1 flex flex-wrap gap-1.5 text-[0.8rem] not-italic">
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
            <span
              className="inline-flex items-center gap-1 rounded-full bg-flag-grey-bg px-2 py-0.5 text-xs text-flag-grey"
              title="No law expert has confirmed this case's current status yet"
            >
              <CircleHelp className="size-3" aria-hidden />
              Status not verified
            </span>
          )}
          {line.edited && <span className="rounded-full px-2 py-0.5 text-xs text-muted">Edited by you</span>}
        </div>
      )}

      {!editing && yellow && open && (
        <div
          role="note"
          className="mt-2 rounded-card border border-border bg-surface p-3 text-sm not-italic shadow-popover"
        >
          <p className="mb-1 font-medium">Please verify this line</p>
          <p className="text-muted">{line.flagReason ?? 'Please verify this line before teaching it.'}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {line.sources[0] && (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => onOpenSource(line.sources[0]!.citationId)}
              >
                Open the source
              </button>
            )}
            {onVerify && (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  setOpen(false);
                  onVerify();
                }}
              >
                I have checked it: mark verified
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                className="text-accent hover:underline"
                onClick={() => {
                  setOpen(false);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
            {onRemove && (
              <button type="button" className="text-danger hover:underline" onClick={onRemove}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
