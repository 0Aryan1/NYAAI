/**
 * Statute and Constitution line markers (LLD §6.3), used by the splitter in statute.ts.
 * Lines are tested after footnote markers ("1[", "4[(2)") are stripped from their start.
 * Dashes: hyphen, en dash, em dash.
 */

export const STATUTE_PATTERNS = {
  /** CHAPTER IV, or PART III / PART IVA in the Constitution: context header only. */
  chapter: /^\s*(CHAPTER|PART)\s+([IVXLC]+[A-Z]?|\d+)\b\.?\s*(.*)$/,
  /**
   * "56. Agreement to do impossible act.—An agreement ..." The title ends at a full stop followed by a
   * dash, or at an em/en dash, so hyphenated words ("co-operative") and abbreviations ("etc.") stay in it.
   */
  section: /^\s*(\d+[A-Z]{0,3})\.\s*([^\d\s].{1,300}?)\s*(?:\.\s*[—–-]+|[—–]+)\s*(.*)$/,
  subSection: /^\s*\((\d+[A-Z]?)\)\s*/,
  clause: /^\s*\(([a-z]{1,3}|[ivx]{1,5})\)\s/,
  proviso: /^\s*Provided\s+(further\s+)?(also\s+)?that\b/,
  explanation: /^\s*Explanation(\s+\d+|\s+[IVX]+)?\.?\s*[—–-]/,
  illustration: /^\s*Illustrations?\b/,
  exception: /^\s*Exception(\s+\d+|\s+[IVX]+)?\.?(\s*[—–-]|\s*$)/,
  /** Amendment footnote: "1. Subs. by Act 4 of 1938, s. 2 ...", "3. Sub-clause (f) omitted by s. 2, ibid." */
  amendment:
    /^\s*(\d{1,3})\.\s+(?=.*\b(?:Subs\.|Ins\.|Rep\.|(?:Omitted|omitted|repealed|Added|added|inserted|substituted|Renumbered|renumbered)\b))(.*)$/,
} as const;

export type StatuteMarker = keyof typeof STATUTE_PATTERNS;

/** Attachments that must never be stored apart from the rule they qualify (HLD 5.1 Layer 1). */
export const ATTACHED_MARKERS: ReadonlySet<StatuteMarker> = new Set(['proviso', 'explanation', 'illustration', 'exception']);
