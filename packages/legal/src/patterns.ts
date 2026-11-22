/**
 * Statute and Constitution line markers (LLD §6.3), used by the splitter in statute.ts.
 * Lines are tested after footnote markers ("1[", "4[(2)") are stripped from their start.
 * Dashes: hyphen, en dash, em dash.
 */

export const STATUTE_PATTERNS = {
  /** CHAPTER IV, or PART III / PART IVA in the Constitution: context header only. A footnote marker may be glued on ("CHAPTER II1"). */
  chapter: /^\s*(CHAPTER|PART)\s+([IVXLC]+[A-Z]?|\d+)(?:(?<=[A-Z])\d{1,2})?\b\.?\s*(.*)$/,
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
  /**
   * Amendment or commencement footnote: "1. Subs. by Act 4 of 1938, s. 2 ...", "3. Sub-clause (f) omitted by s. 2,
   * ibid.", "1. 9th day of October, 2023, vide notification No. S.O. 4384(E) …", "2. w.e.f. 1-7-2017".
   */
  amendment:
    /^\s*(\d{1,3})\.\s+(?=.*(?:\b(?:Subs\.|Ins\.|Rep\.|(?:Omitted|omitted|repealed|Added|added|inserted|substituted|Renumbered|renumbered)\b)|\bvide\s+notification\b|\bw\.e\.f\.|\bcame\s+into\s+force\b))(.*)$/,
  /**
   * Editor's footnote: "1. See s. 138, infra.", "1. See now the Specific Relief Act, 1963", "1. For the Statement of
   * Objects and Reasons …", "1. S. 35A ins. by Act 9 of 1922", "1. This Act has been amended in its application to …".
   */
  editorialNote:
    /^\s*(\d{1,3})\.\s+(?=.*\b(?:infra|supra|ibid)\b|(?:See|As\s+to)\b,?\s+(?:however,\s+)?(?:now\s+|also\s+)?(?:the\s+|s\.|ss\.|section|suits)|For\s+(?:the\s+)?(?:Report|Statement\s+of\s+Objects|Proceedings)|.*\b(?:ins|rep|subs)\.\s+by\b|.*\bamended\s+in\s+its\s+application\b|.*\bNotifn\.|(?:Insertion|Amendment|Substitution|Omission)\s+of\s+(?:new\s+)?section)(.*)$/,
} as const;

export type StatuteMarker = keyof typeof STATUTE_PATTERNS;

/** Attachments that must never be stored apart from the rule they qualify (HLD 5.1 Layer 1). */
export const ATTACHED_MARKERS: ReadonlySet<StatuteMarker> = new Set(['proviso', 'explanation', 'illustration', 'exception']);
