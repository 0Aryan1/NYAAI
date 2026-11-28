import type { ReactNode } from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

/**
 * One checked line, read-only, with the same marks as the Studio: yellow (underlined, "Please verify" and why) when
 * the checks could not support it, grey when it rests on a case whose status no expert has confirmed. `children` go
 * right after the text (the source chips). Never shows a flagged line without its mark (CLAUDE.md "never").
 */
export function FlaggedLine({
  text,
  flag,
  reason,
  className,
  children,
}: {
  text: string;
  flag: 'yellow' | 'grey' | null;
  reason: string | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li className={className}>
      <span
        className={cn(
          flag === 'yellow' && 'underline decoration-flag-yellow-underline decoration-2 underline-offset-4',
        )}
      >
        {text}
      </span>
      {children}
      {flag === 'yellow' && (
        <span className="mt-0.5 flex items-center gap-1 text-xs text-flag-yellow">
          <AlertTriangle className="size-3" aria-hidden /> Please verify: {reason}
        </span>
      )}
      {flag === 'grey' && (
        <span className="mt-0.5 flex items-center gap-1 text-xs text-flag-grey">
          <CircleHelp className="size-3" aria-hidden /> {reason}
        </span>
      )}
    </li>
  );
}
