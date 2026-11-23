import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** Page width presets: reading pages stay narrow, work pages use the room. */
const WIDTH = { narrow: 'max-w-2xl', normal: 'max-w-4xl', wide: 'max-w-6xl' } as const;

export function Page({ width = 'normal', className, children }: { width?: keyof typeof WIDTH; className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full', WIDTH[width], className)}>{children}</div>;
}

/** Title block of a page: a small line above (where you are), the title, one sentence, and the page's actions. */
export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-8 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A plain surface for grouped content. */
export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' | 'li' }) {
  return <As className={cn('rounded-card border border-border bg-surface', className)}>{children}</As>;
}

/** Small uppercase label for a group of fields or a list section. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('mb-2 text-xs font-semibold uppercase tracking-wider text-muted', className)}>{children}</h2>;
}
