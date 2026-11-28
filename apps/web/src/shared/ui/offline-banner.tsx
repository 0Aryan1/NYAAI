import { WifiOff } from 'lucide-react';
import { useOnline } from '@/shared/hooks/useOnline';

/** Across the top of every screen while the browser is offline. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-border bg-flag-yellow-bg px-4 py-2 text-sm text-text"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>You’re offline. You can keep reading and editing; your changes save when you’re back online.</span>
    </div>
  );
}
