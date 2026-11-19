import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '@/shared/lib/theme';
import { cn } from '@/shared/lib/utils';

const OPTIONS: ThemeChoice[] = ['system', 'light', 'dark'];

export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => applyTheme(choice), [choice]);
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full border border-border bg-surface p-0.5 text-xs">
      {OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={choice === o}
          onClick={() => setChoice(o)}
          className={cn('rounded-full px-3 py-1 capitalize', choice === o ? 'bg-accent text-accent-contrast' : 'text-muted')}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
