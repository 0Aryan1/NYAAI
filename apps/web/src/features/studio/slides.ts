/** What the Studio works out from the slides alone: the open points to step through, and each slide's footnotes. */
import type { StudioSlide } from '@nyaai/shared';

/** Every open (yellow) line in slide order, for N / Shift+N. */
export function openPoints(slides: StudioSlide[]): { slide: number; lineKey: string }[] {
  return slides.flatMap((s, i) =>
    [...s.lines, ...s.notes].filter((l) => l.flag === 'yellow').map((l) => ({ slide: i, lineKey: l.lineKey })),
  );
}

/** Footnote numbers for one slide: each distinct source label gets one number, in reading order. */
export function footnoteNumbers(slide: StudioSlide): {
  byCitation: Map<string, number>;
  notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[];
} {
  const byLabel = new Map<string, number>();
  const byCitation = new Map<string, number>();
  const notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[] = [];
  for (const line of [...slide.lines, ...slide.notes]) {
    for (const s of line.sources) {
      let n = byLabel.get(s.label);
      if (n === undefined) {
        n = byLabel.size + 1;
        byLabel.set(s.label, n);
        notes.push({
          n,
          label: s.label,
          provisional: s.provisional,
          grey: s.caseStatus === 'not_verified',
          citationId: s.citationId,
        });
      }
      byCitation.set(s.citationId, n);
    }
  }
  return { byCitation, notes };
}
