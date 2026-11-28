/**
 * Is a judgment found on Indian Kanoon one the library already holds under another copy (an official court copy that
 * replaced the Kanoon text, or an upload)? The link check catches the same Kanoon document; this catches the same case.
 *
 *  - same:  the parties match, the decision dates are the same and the courts do not differ. Not downloaded again.
 *  - maybe: the parties match but the date is different or unknown, or the court differs. Two judgments in one matter
 *           (an order and the final judgment, a review) share their names, so it is downloaded and the library editor
 *           is asked whether it is the same case. When unsure, a case is never skipped.
 */
import { caseMatches } from './gaps.ts';
import { identifyCourt } from './courts.ts';
import { parseKanoonTitle } from './kanoon.ts';

export interface HeldCase {
  sourceId: string;
  /** "Gayatri Balasamy v. M/S Isg Novasoft Technologies Limited" */
  title: string;
  /** YYYY-MM-DD */
  decidedOn: string | null;
  courtLevel: string | null;
}

export interface FoundCase {
  /** Kanoon's title: "Gayatri Balasamy vs M/S Isg Novasoft Technologies Limited on 30 April, 2025" */
  title: string;
  publishdate?: string | null;
  docsource?: string | null;
}

export type CaseMatch = { kind: 'same'; held: HeldCase } | { kind: 'maybe'; held: HeldCase };

/** A held title without a trailing "(2025)". */
const bare = (title: string) => title.replace(/\s*\(\d{4}\)\s*$/, '').trim();

const VERSUS = /\s+(?:v\.?|vs\.?|versus)\s+/i;
const titleWords = (t: string): string[] => [
  ...(t
    .toLowerCase()
    .replace(/\.\.\.|…/g, ' ')
    .match(/[a-z]{4,}/g) ?? []),
];

/**
 * The parties match either way round (Kanoon shortens long names, the library keeps the full one). A title with no
 * "v." ("In Re: Interplay between …") matches when nearly all the distinctive words of the shorter one are in the other.
 */
export function sameParties(a: string, b: string): boolean {
  if (VERSUS.test(a) && VERSUS.test(b)) return caseMatches(bare(a), bare(b)) || caseMatches(bare(b), bare(a));
  const [x, y] = [titleWords(bare(a)), titleWords(bare(b))].sort((p, q) => p.length - q.length) as [string[], string[]];
  if (x.length < 4) return false;
  const other = new Set(y);
  return x.filter((w) => other.has(w)).length / x.length >= 0.8;
}

export function matchHeldCase(found: FoundCase, held: HeldCase[]): CaseMatch | null {
  const parsed = parseKanoonTitle(found.title);
  const date =
    parsed.decidedOn ?? (found.publishdate && /^\d{4}-\d{2}-\d{2}$/.test(found.publishdate) ? found.publishdate : null);
  const level = identifyCourt(found.docsource)?.level ?? null;
  let maybe: HeldCase | null = null;
  for (const h of held) {
    if (!sameParties(h.title, parsed.caseName)) continue;
    const courtsAgree = !level || !h.courtLevel || level === h.courtLevel;
    if (date && h.decidedOn === date && courtsAgree) return { kind: 'same', held: h };
    maybe ??= h;
  }
  return maybe ? { kind: 'maybe', held: maybe } : null;
}
