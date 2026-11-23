import { cn } from '@/shared/lib/utils';

/** A row of tabs (or filters). Arrow keys move along the row. */
export function Tabs<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex gap-1 border-b border-border', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = options[(i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length]!;
            onChange(next.value);
            (e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement | undefined)?.focus();
          }}
          className={cn(
            '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
            value === o.value ? 'border-accent font-medium text-text' : 'border-transparent text-muted hover:text-text',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className="rounded-full bg-bg px-1.5 text-xs text-muted">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
