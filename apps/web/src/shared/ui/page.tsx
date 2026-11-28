import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/** Page width presets: reading pages stay narrow, work pages use the room. */
const WIDTH = { narrow: 'max-w-2xl', normal: 'max-w-4xl', wide: 'max-w-6xl' } as const;

export function Page({
  width = 'normal',
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('mx-auto w-full', WIDTH[width], className)}>{children}</div>;
}

/**
 * Title block of a page: a small line above (where you are), the title with its icon, one sentence, and the page's
 * actions. It has no outer margin of its own: the page spaces what follows.
 */
export function PageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {Icon && <Icon className="size-5 shrink-0" aria-hidden />}
          {title}
        </h1>
        {description && <p className="mt-2 max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
