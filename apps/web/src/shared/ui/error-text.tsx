import { errorText } from '@/shared/lib/errors';
import { cn } from '@/shared/lib/utils';

/**
 * The plain message of a failed action, read out by screen readers as it appears. Nothing when there is no error.
 * `fallback` is what to say when the error carries no message of ours (a crash, not a server refusal).
 */
export function ErrorText({ error, fallback, className }: { error: unknown; fallback: string; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn('text-sm text-danger', className)}>
      {errorText(error, fallback)}
    </p>
  );
}
