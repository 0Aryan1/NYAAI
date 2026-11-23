/**
 * What goes into a downloaded deck (LLD §10.2–10.3, PPT-1 to PPT-4), worked out before any file is written (pure):
 * one or more output slides per saved slide (a long slide splits into "(cont.)" slides rather than shrinking text),
 * speaker notes with the explanation, the SOURCES behind the slide with their exact words, and every open point:
 *   [!] PLEASE VERIFY   a yellow line, with the reason
 *   [?] STATUS NOT VERIFIED   a case no law expert has confirmed
 *   [~] NOT COVERED   a proviso, exception or leading case left out
 * The slides the class sees stay clean; the points are for her, in the notes and on a hidden last slide.
 */
import type { StudioSlide } from '@nyaai/shared';

export interface CitationDetail {
  citationId: string;
  label: string;
  title: string | null;
  span: string;
  caseStatus: string | null;
}

export interface DeckLine {
  text: string;
  kind: string;
  yourExample: boolean;
  /** Footnote numbers of the sources it rests on, as on the Studio slide. */
  marks: number[];
}

export interface DeckSlide {
  title: string;
  layout: string;
  lines: DeckLine[];
  /** Footnotes under the slide: "1 s. 34 Arbitration Act". */
  footnotes: string[];
  notes: string;
  /** The saved slide this came from (1-based), for the "Points to verify" list. */
  from: number;
}

export interface OpenPoint {
  /** Its slide's number in the downloaded file (the title slide is 1). */
  slide: number;
  text: string;
}

export interface Deck {
  slides: DeckSlide[];
  verify: OpenPoint[];
  notVerified: string[];
  notCovered: string[];
}

const MAX_LINES = 7;
const MAX_CHARS = 700;

/** Lines grouped into output slides: at most 7 lines and about 700 characters each. */
export function paginate<T extends { text: string }>(lines: T[]): T[][] {
  const pages: T[][] = [[]];
  let chars = 0;
  for (const l of lines) {
    const page = pages.at(-1)!;
    if (page.length && (page.length >= MAX_LINES || chars + l.text.length > MAX_CHARS)) {
      pages.push([l]);
      chars = l.text.length;
    } else {
      page.push(l);
      chars += l.text.length;
    }
  }
  return pages;
}

const quoted = (s: string) => `"${s.replace(/\s+/g, ' ').trim()}"`;

export function planDeck(
  slides: StudioSlide[],
  citations: Map<string, CitationDetail>,
  opts: { withFlags: boolean; notCovered: string[]; yourExampleKeys?: Set<string> },
): Deck {
  const out: DeckSlide[] = [];
  const verify: OpenPoint[] = [];
  const notVerified = new Set<string>();

  slides.forEach((s, i) => {
    const n = i + 1;
    // Footnote numbers: each source label once per slide, in reading order (as in the Studio).
    const numbers = new Map<string, number>();
    const sources: string[] = [];
    for (const line of [...s.lines, ...s.notes]) {
      for (const src of line.sources) {
        if (numbers.has(src.label)) continue;
        numbers.set(src.label, numbers.size + 1);
        const d = citations.get(src.citationId);
        sources.push(`[${numbers.size}] ${src.label}${d?.title && !src.label.includes(d.title) ? ` (${d.title})` : ''}${d?.span ? ` — ${quoted(d.span)}` : ''}`);
        if (src.caseStatus === 'not_verified' && d?.title) notVerified.add(d.title);
      }
    }
    const flags: string[] = [];
    if (opts.withFlags) {
      for (const line of [...s.lines, ...s.notes]) {
        if (line.flag === 'yellow') {
          flags.push(`[!] PLEASE VERIFY, not confirmed by NYAAI: ${quoted(line.text)}${line.flagReason ? ` (${line.flagReason})` : ''}`);
          verify.push({ slide: out.length + 2, text: `${line.text}${line.flagReason ? ` (${line.flagReason})` : ''}` });
        }
      }
      for (const line of [...s.lines, ...s.notes]) {
        for (const src of line.sources) {
          const d = citations.get(src.citationId);
          if (src.caseStatus === 'not_verified' && d?.title) {
            const f = `[?] STATUS NOT VERIFIED: ${d.title}; no law expert has yet confirmed whether this case is still good law`;
            if (!flags.includes(f)) flags.push(f);
          }
        }
      }
    }
    const notes = [
      s.notes.map((l) => l.text).join('\n'),
      sources.length ? `SOURCES\n${sources.join('\n')}` : '',
      flags.join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n');

    const lines = s.lines.map((l) => ({
      text: l.text,
      kind: l.kind,
      yourExample: l.status === 'your_example' || (opts.yourExampleKeys?.has(l.lineKey) ?? false),
      marks: [...new Set(l.sources.map((src) => numbers.get(src.label)!).filter(Boolean))].sort((a, b) => a - b),
    }));
    const footnotes = [...numbers.entries()].map(([label, k]) => `${k} ${label}`);
    const pages = paginate(lines.length ? lines : [{ text: '', kind: 'teaching', yourExample: false, marks: [] as number[] }]);
    pages.forEach((page, p) =>
      out.push({
        title: p === 0 ? s.title : `${s.title} (cont.)`,
        layout: s.layout,
        lines: page.filter((l) => l.text),
        footnotes,
        notes: p === 0 ? notes : `Continued from the previous slide.\n\n${notes}`,
        from: n,
      }),
    );
  });

  return { slides: out, verify, notVerified: [...notVerified], notCovered: opts.withFlags ? opts.notCovered : [] };
}

/** PPT-3: "L09_Frustration_of_Contract.pptx" in a course, "OneOff_<Topic>_<YYYY-MM-DD>.pptx" otherwise. */
export function deckFileName(topic: string, position: number | null, today: string): string {
  const words = topic
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .map((w) => w[0]!.toUpperCase() + w.slice(1));
  const name = words.join('_') || 'Lecture';
  return position ? `L${String(position).padStart(2, '0')}_${name}.pptx` : `OneOff_${name}_${today}.pptx`;
}
