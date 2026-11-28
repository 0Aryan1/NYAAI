import { useId, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface RadioCardOption<T extends string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
}

/**
 * One choice from a few, each a card with a name and a line saying what it means. Native radios underneath (hidden),
 * so arrow keys, screen readers and forms just work; the card shows the keyboard focus. `children` go under the
 * cards, inside the same group (a field that only one of the choices needs).
 */
export function RadioCards<T extends string>({
  legend,
  legendClassName,
  options,
  value,
  onChange,
  columns = 2,
  name,
  className,
  children,
}: {
  legend: ReactNode;
  legendClassName?: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 1 | 2;
  name?: string;
  className?: string;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={legendClassName ?? 'mb-2 text-sm font-medium'}>{legend}</legend>
      <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              'cursor-pointer rounded-control border px-3 py-2 text-sm transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
              value === o.value ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/60',
            )}
          >
            <input
              type="radio"
              name={name ?? id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="block font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}
