import { Hourglass } from 'lucide-react';
import { formatTime } from '@/shared/lib/format';
import { useRateLimitedUntil } from '@/shared/api/rate-limit';

/** Across the top of every screen for a minute after the server said "too many requests". */
export function RateLimitBanner() {
  const until = useRateLimitedUntil();
  if (!until) return null;
  const at = formatTime(until);
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-border bg-flag-yellow-bg px-4 py-2 text-sm text-text"
    >
      <Hourglass className="size-4 shrink-0" aria-hidden />
      <span>
        Too many requests in a short time. Please wait a minute (until about {at}) and try again; nothing you saved is
        lost.
      </span>
    </div>
  );
}
