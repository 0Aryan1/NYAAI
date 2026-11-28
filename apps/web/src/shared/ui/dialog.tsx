import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

/**
 * A modal dialog on the browser's own `<dialog>`: it traps focus, closes on Escape and gives focus back to what opened
 * it. A title bar with a close button, the body, and a footer of buttons. `footer` gets `close`, which closes it the
 * same way Escape does, so `onClose` always runs once. Focus starts on `initialFocus`, or on the first control.
 */
export function Dialog({
  title,
  description,
  onClose,
  footer,
  initialFocus,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  footer?: (close: () => void) => ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    initialFocus?.current?.focus();
  }, [initialFocus]);
  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-full max-w-lg rounded-card border border-border bg-surface p-0 text-text shadow-dialog backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        <button type="button" onClick={close} className="rounded-control p-1 text-muted hover:bg-bg" aria-label="Close">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-4 px-6 py-5 text-sm">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer(close)}</div>}
    </dialog>
  );
}
