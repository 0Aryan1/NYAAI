import { useEffect, useState, type ReactNode } from 'react';
import { RotateCw, WifiOff } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from './button';

/**
 * Loading, error and slow states (LLD §12: skeletons in the final layout, never a spinner over a blank page; plain
 * words on failure, with a way to try again).
 */

/** A grey block in the shape of what is coming. Still for people who ask for less motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-control bg-border/60 motion-reduce:animate-none', className)}
    />
  );
}

/** Rows of a list while it loads, labelled for screen readers. */
export function ListSkeleton({ rows = 3, label, className }: { rows?: number; label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
      <SlowNote />
    </div>
  );
}

/** True once `active` has lasted `ms` (a slow connection, or a slow server). */
function useSlow(active: boolean, ms = 8000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}

/** Shown inside a loading state after 8 seconds. */
export function SlowNote({ active = true }: { active?: boolean }) {
  const slow = useSlow(active);
  if (!slow) return null;
  return (
    <p className="text-sm text-muted">
      This is taking longer than usual. Your connection may be slow; it will appear as soon as it arrives.
    </p>
  );
}

/** A load that failed: what failed, in plain words, and a way to try again. */
export function LoadError({
  what,
  onRetry,
  className,
  children,
}: {
  what: string;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div role="alert" className={cn('rounded-card border border-border bg-surface p-5 text-sm', className)}>
      <p className="flex items-center gap-2 font-medium">
        {offline && <WifiOff className="size-4 text-muted" aria-hidden />}
        {offline ? 'You seem to be offline.' : `${what} could not be loaded.`}
      </p>
      <p className="mt-1 text-muted">
        {offline
          ? 'Check your internet connection, then try again.'
          : 'Nothing you made is lost. Try again in a moment.'}
      </p>
      {children}
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Nothing here yet: what this place is for, and the first step. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-surface p-6 text-sm">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-prose text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
