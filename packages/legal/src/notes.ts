/**
 * A teacher's own notes (HLD "Teacher notes and slides": one heading block per chunk). Her document is read into
 * blocks (a heading or a paragraph), then split under its headings. A heading block longer than NOTE_CHUNK_WORDS is
 * split between paragraphs, never inside one. Every chunk's header starts "Your notes:", so the writer, the checks
 * and the teacher can always tell her notes from the law.
 */
import type { PdfLines } from './pdf-judgment.ts';

export interface NoteBlock {
  text: string;
  /** Heading level 1–6; null for a paragraph. */
  heading: number | null;
}

export interface NoteChunk {
  seq: number;
  /** The heading path it sits under ("Arbitration › Seat and venue"), or null before the first heading. */
  heading: string | null;
  header: string;
  text: string;
}

export const NOTE_CHUNK_WORDS = 350;
export const NOTES_LABEL = 'Your notes';

export const noteHeader = (title: string, heading: string | null) => `${NOTES_LABEL}: ${title}${heading ? ` › ${heading}` : ''}`;

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
const clean = (t: string) => t.replace(/\s+/g, ' ').trim();

export function splitNotes(title: string, blocks: NoteBlock[]): NoteChunk[] {
  const out: NoteChunk[] = [];
  const path: string[] = [];
  let paras: string[] = [];
  const flush = () => {
    const heading = path.filter(Boolean).slice(-2).join(' › ') || null;
    let group: string[] = [];
    let words = 0;
    const push = () => {
      if (group.length) out.push({ seq: out.length + 1, heading, header: noteHeader(title, heading), text: group.join('\n\n') });
      group = [];
      words = 0;
    };
    for (const p of paras) {
      const n = wordCount(p);
      if (group.length && words + n > NOTE_CHUNK_WORDS) push();
      group.push(p);
      words += n;
    }
    push();
    paras = [];
  };
  for (const b of blocks) {
    const text = clean(b.text);
    if (!text) continue;
    if (b.heading !== null) {
      flush();
      const level = Math.min(Math.max(b.heading, 1), 6);
      path.length = level - 1;
      path[level - 1] = text;
      continue;
    }
    paras.push(text);
  }
  flush();
  return out;
}

const NUMBERED = /^(?:\d{1,2}(?:\.\d{1,2})*|[IVXLC]{1,6}|[A-Z])[.)]?\s+\S/;

/** A short line that reads as a heading: numbered ("2.1 Seat"), all capitals, or every main word capitalised. */
export function looksLikeHeading(line: string): boolean {
  const t = clean(line);
  const words = t.split(' ');
  if (t.length < 3 || words.length > 12 || /[.,;]$/.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  if (NUMBERED.test(t) && words.length <= 10) return true;
  const main = words.filter((w) => /^[A-Za-z]/.test(w) && w.length > 3);
  return main.length > 0 && main.every((w) => /^[A-Z]/.test(w));
}

/** Plain text or Markdown: "#" headings, blank lines between paragraphs, a lone short line that reads as a heading. */
export function textBlocks(text: string): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const md = /^(#{1,6})\s+(.+)$/.exec(lines[0]!);
    if (md) {
      out.push({ text: md[2]!, heading: md[1]!.length });
      if (lines.length > 1) out.push({ text: lines.slice(1).join(' '), heading: null });
    } else if (lines.length === 1 && looksLikeHeading(lines[0]!)) {
      out.push({ text: lines[0]!, heading: 1 });
    } else {
      out.push({ text: lines.join(' '), heading: null });
    }
  }
  return out;
}

/**
 * A PDF, line by line: a line set clearly larger than the body text is a heading (the larger, the higher); a short
 * numbered or all-capitals line on its own is a heading too. Paragraphs break at a wider gap between lines.
 */
export function pdfBlocks(doc: PdfLines): NoteBlock[] {
  const out: NoteBlock[] = [];
  const body = doc.bodySize || 11;
  const sizes = [...new Set(doc.pages.flatMap((p) => p.lines.map((l) => Math.round(l.size))).filter((s) => s >= body * 1.15))].sort((a, b) => b - a);
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ text: para.join(' '), heading: null });
    para = [];
  };
  for (const page of doc.pages) {
    let lastY: number | null = null;
    for (const line of page.lines) {
      const text = clean(line.text);
      if (!text || /^\d{1,4}$/.test(text)) continue; // page numbers
      const big = line.size >= body * 1.15;
      if (big || (looksLikeHeading(text) && (NUMBERED.test(text) || text === text.toUpperCase()))) {
        flush();
        out.push({ text, heading: big ? Math.min(sizes.indexOf(Math.round(line.size)) + 1, 3) || 1 : 2 });
        lastY = line.y;
        continue;
      }
      const gap = lastY === null ? 0 : Math.abs(line.y - lastY);
      if (gap > line.size * 1.9) flush();
      para.push(text);
      lastY = line.y;
    }
  }
  flush();
  return out;
}
