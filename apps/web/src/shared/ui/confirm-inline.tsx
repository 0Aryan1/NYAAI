import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Button } from './button';

/**
 * "Asked twice": a change that is hard to undo shows its question in place, with a Yes and a Cancel, instead of the
 * browser's confirm box (which cannot be styled, read by every screen reader the same way, or tested). `tone` says how
 * the Yes looks: `primary` for a normal step, `secondary` for a step back, `danger` for a removal. `stacked` lays it
 * out as a block, for a question that carries extra fields (`children`, such as a note).
 */
export function ConfirmInline({
  question,
  yes,
  onYes,
  onCancel,
  busy = false,
  tone = 'primary',
  stacked = false,
  children,
  className,
}: {
  question: ReactNode;
  yes: string;
  onYes: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  stacked?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const buttons = (
    <>
      <Button
        size="sm"
        variant={tone === 'primary' ? 'primary' : 'secondary'}
        className={tone === 'danger' ? 'border-danger text-danger' : undefined}
        disabled={busy}
        onClick={onYes}
      >
        {yes}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </>
  );
  if (stacked)
    return (
      <div
        role="group"
        aria-label="Are you sure?"
        className={cn('space-y-3 rounded-control border border-border bg-bg p-3', className)}
      >
        <p className="text-sm">{question}</p>
        {children}
        <div className="flex gap-2">{buttons}</div>
      </div>
    );
  return (
    <span
      role="group"
      aria-label="Are you sure?"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-control border border-border bg-bg px-3 py-2 text-sm',
        className,
      )}
    >
      <span>{question}</span>
      {children}
      {buttons}
    </span>
  );
}
