import { highlight } from '@/shared/lib/highlight';

/** The exact source words, marked the same way everywhere (yellow, like a highlighter pen). */
export function Mark({ children }: { children: string }) {
  return <mark className="rounded bg-flag-yellow-bg px-0.5 text-text">{children}</mark>;
}

/**
 * A source paragraph with the words a line rests on marked. When those words cannot be found in it (the text was
 * re-typed with other spacing the matcher does not know), the paragraph shows unmarked rather than not at all.
 * Renders inline: the caller gives the paragraph element and its styling.
 */
export function HighlightedPassage({ text, span }: { text: string; span: string | null | undefined }) {
  const parts = span ? highlight(text, span) : null;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <Mark>{parts[1]}</Mark>
      {parts[2]}
    </>
  );
}
