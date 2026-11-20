/**
 * Coverage check, matching part (LLD §8.5 steps 2, 4, 5). Pure: the caller builds the must-cover list
 * (statute parts from @nyaai/legal mustCoverParts, plus confirmed leading cases) and passes the lecture's citations.
 */
import { normaliseForSpan } from './normalise.ts';

export interface MustCoverItem {
  /** Stable within the lecture, e.g. 'ICA:s56|s. 56: Contract to do an act afterwards…'. */
  key: string;
  sectionKey: string;
  kind: 'proviso' | 'exception' | 'explanation' | 'clause' | 'leading_case';
  label: string;
  /** Statute parts: the item's words. Leading cases: null. */
  text: string | null;
  /** Chunk id (statute part) or source id (leading case). */
  ref: string;
}

export interface CitedSpan {
  citationId: string;
  sourceId: string | null;
  chunkId: string | null;
  span: string;
}

/**
 * Covered when a citation's span lies inside the item's words (or contains them all), or, for a leading case, when
 * any citation cites that case. Returns the covering citation id per item key (null = missing).
 */
export function matchCoverage(items: MustCoverItem[], cited: CitedSpan[]): Map<string, string | null> {
  const spans = cited.map((c) => ({ ...c, norm: normaliseForSpan(c.span) }));
  const out = new Map<string, string | null>();
  for (const item of items) {
    let by: string | null = null;
    if (item.kind === 'leading_case') {
      by = spans.find((c) => c.sourceId === item.ref)?.citationId ?? null;
    } else if (item.text) {
      const t = normaliseForSpan(item.text);
      by = spans.find((c) => c.norm.length >= 8 && (t.includes(c.norm) || c.norm.includes(t)))?.citationId ?? null;
    }
    out.set(item.key, by);
  }
  return out;
}

/** Covered ÷ (all − left out by the teacher). Null when there is nothing to cover. */
export function coverageScore(states: ('covered' | 'missing' | 'left_out_by_teacher')[]): number | null {
  const counted = states.filter((s) => s !== 'left_out_by_teacher');
  if (counted.length === 0) return null;
  return Math.round((counted.filter((s) => s === 'covered').length / counted.length) * 1000) / 1000;
}

/** Missing items grouped per section: `coverage_open` counts groups, not items (LLD §8.5 step 4). */
export function openGroups(items: { sectionKey: string; state: string }[]): number {
  return new Set(items.filter((i) => i.state === 'missing').map((i) => i.sectionKey)).size;
}
