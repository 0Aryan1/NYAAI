import { useId } from 'react';
import { cn } from '@/shared/lib/utils';

export interface ChipOption {
  value: string;
  label: string;
  hint?: string;
}

interface ChipGroupProps {
  label: string;
  options: readonly ChipOption[];
  /** null = nothing chosen. Chips never start with a choice made for her (HOME-5). */
  value: string | null;
  onChange: (value: string) => void;
  name?: string;
  className?: string;
}

/** One-tap choice as a row of chips. Native radios underneath: arrow keys, screen readers and forms just work. */
export function ChipGroup({ label, options, value, onChange, name, className }: ChipGroupProps) {
  const id = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input
              type="radio"
              className="peer sr-only"
              name={name ?? id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span
              className={cn(
                'inline-flex min-h-9 items-center rounded-full border px-3.5 py-1.5 text-sm transition-colors duration-[120ms] ease-calm',
                'border-border bg-surface text-text hover:border-accent',
                'peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-contrast',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
              )}
            >
              {o.label}
              {o.hint && <span className="ml-1.5 text-xs opacity-75">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
