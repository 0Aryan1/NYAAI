import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Suggestion } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';

const KIND_LABEL: Record<Suggestion['kind'], string> = { concept: 'Topic', section: 'Section', case: 'Case', unit: 'Your plan' };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Topic box (HOME-1, HOME-2): plain words, a section, a case or a question. Suggestions come from the library only
 * (GET /suggest, no AI). ARIA combobox: arrows move, Enter picks, Escape closes.
 */
export function TopicBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = useDebounced(value.trim(), 150);
  const suggest = useQuery({ queryKey: queryKeys.suggest(q), queryFn: () => api.suggest(q), enabled: q.length >= 2, staleTime: 5 * 60_000 });
  const items = q.length >= 2 ? (suggest.data?.suggestions ?? []) : [];
  const showList = open && items.length > 0;

  function pick(s: Suggestion) {
    onChange(s.value);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="mb-2 block text-sm font-medium">
        What do you want to teach?
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        value={value}
        maxLength={200}
        autoComplete="off"
        placeholder="A topic, a section, a case or a question, e.g. frustration of contract, s. 56"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="h-12 w-full rounded-control border border-border bg-surface px-4 text-base placeholder:text-muted focus:border-accent"
      />
      {showList && (
        <ul id={`${id}-list`} role="listbox" aria-label="Suggestions from the library" className="absolute z-20 mt-1 w-full overflow-hidden rounded-card border border-border bg-surface shadow-popover">
          {items.map((s, i) => (
            <li
              key={`${s.kind}:${s.label}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex cursor-pointer items-baseline gap-3 px-4 py-2 text-sm', i === active && 'bg-bg')}
            >
              <span className="w-16 shrink-0 text-xs text-muted">{KIND_LABEL[s.kind]}</span>
              <span className={cn('min-w-0 flex-1 truncate', s.kind === 'case' && 'font-serif italic')}>{s.label}</span>
              {s.detail && <span className="shrink-0 truncate text-xs text-muted">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
