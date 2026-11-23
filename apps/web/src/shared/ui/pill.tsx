import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

const TONES = {
  neutral: 'border border-border bg-surface text-muted',
  accent: 'bg-accent/10 text-accent',
  yellow: 'bg-flag-yellow-bg text-flag-yellow',
  grey: 'bg-flag-grey-bg text-flag-grey',
  coverage: 'bg-flag-coverage-bg text-flag-coverage',
  example: 'bg-example-bg text-example',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
} as const;
export type PillTone = keyof typeof TONES;

/** A small status label. Colour is never the only signal: pass an icon and words (LLD §12.4). */
export function Pill({ tone = 'neutral', icon, children, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: PillTone; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
