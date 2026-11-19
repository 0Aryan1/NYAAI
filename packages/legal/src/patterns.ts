/**
 * Statute and Constitution line markers (LLD §6.3). The full splitter lands on Day 1; these patterns are
 * its contract. Dashes: hyphen, en dash, em dash.
 */
const DASH = '[.\\u2014\\u2013-]';

export const STATUTE_PATTERNS = {
  chapter: /^CHAPTER\s+[IVXLC]+\b/,
  section: new RegExp(`^\\s*(\\d+[A-Z]{0,2})\\.\\s+(.{3,200}?)${DASH}{1,2}`),
  subSection: /^\s*\((\d+[A-Z]?)\)\s/,
  clause: /^\s*\(([a-z]{1,3}|[ivx]{1,5})\)\s/,
  proviso: /^\s*Provided\s+(further\s+)?that\b/,
  explanation: new RegExp(`^\\s*Explanation(\\s+\\d+|\\s+[IVX]+)?\\.?\\s*[\\u2014\\u2013-]`),
  illustration: /^\s*Illustrations?\b/,
  exception: /^\s*Exception(\s+\d+|\s+[IVX]+)?\.?/,
  amendment: /^\s*\d+\.\s*(Subs\.|Ins\.|Omitted)\s+by\b/,
} as const;

export type StatuteMarker = keyof typeof STATUTE_PATTERNS;

/** Attachments that must never be stored apart from the rule they qualify (HLD 5.1 Layer 1). */
export const ATTACHED_MARKERS: ReadonlySet<StatuteMarker> = new Set(['proviso', 'explanation', 'illustration', 'exception']);
