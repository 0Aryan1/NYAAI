import { useEffect, useRef } from 'react';
import type { ResolveChoice } from '@nyaai/shared';
import { Button } from '@/shared/ui/button';

/** HOME-9: an unclear topic ("damages": contract or tort?) gets one tap question before anything is built. */
export function AmbiguityDialog({
  topic,
  choices,
  onChoose,
  onCancel,
}: {
  topic: string;
  choices: ResolveChoice[];
  onChoose: (c: ResolveChoice) => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="ambig-title" className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-dialog">
        <h2 id="ambig-title" className="mb-1 text-lg font-semibold">
          Which “{topic}” do you mean?
        </h2>
        <p className="mb-5 text-sm text-muted">This topic could belong to more than one subject.</p>
        <div className="grid gap-2">
          {choices.map((c, i) => (
            <Button key={c.conceptId} ref={i === 0 ? first : undefined} variant="secondary" size="lg" className="justify-between" onClick={() => onChoose(c)}>
              <span>{c.name}</span>
              <span className="text-xs text-muted">{c.subject}</span>
            </Button>
          ))}
        </div>
        <div className="mt-5 text-right">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
