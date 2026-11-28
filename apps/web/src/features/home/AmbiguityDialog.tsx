import { useRef } from 'react';
import type { ResolveChoice } from '@nyaai/shared';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

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
  return (
    <Dialog
      title={`Which “${topic}” do you mean?`}
      description="This topic could belong to more than one subject."
      onClose={onCancel}
      initialFocus={first}
      footer={(close) => (
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
      )}
    >
      <div className="grid gap-2">
        {choices.map((c, i) => (
          <Button
            key={c.conceptId}
            ref={i === 0 ? first : undefined}
            variant="secondary"
            size="lg"
            className="justify-between"
            onClick={() => onChoose(c)}
          >
            <span>{c.name}</span>
            <span className="text-xs text-muted">{c.subject}</span>
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
