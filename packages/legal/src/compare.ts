/**
 * Comparing two copies of the same judgment (pure). Used when an official copy replaces an Indian Kanoon copy:
 * - `textAgreement`: is it the same judgment, and how closely do the two texts agree?
 * - `matchChunks`: which new paragraph is which old one, so a paragraph keeps its id (citations and concept links
 *   still point at it), and keeps its role label when its text is the same.
 * Texts are compared as runs of four words, ignoring case, punctuation, quote styles and line breaks.
 */

const SHINGLE = 4;

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .match(/[a-z0-9]+/g) ?? [];
}

export function shingles(text: string, n = SHINGLE): Set<string> {
  const w = wordsOf(text);
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(' '));
    return out;
  }
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (big.has(s)) n++;
  return n;
}

/** Share of A's word runs found in B, and of B's in A. Same judgment: both high (a headnote in one copy lowers one side). */
export function textAgreement(a: string, b: string): { aInB: number; bInA: number } {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return { aInB: 0, bInA: 0 };
  const n = overlap(sa, sb);
  return { aInB: n / sa.size, bInA: n / sb.size };
}

export interface ChunkMatch {
  /** Id of the old chunk this new chunk takes over, or null for a new chunk. */
  id: string | null;
  /** The text is the same paragraph (same words, about the same length): its role label still applies. */
  same: boolean;
}

/**
 * One-to-one matching of new chunks to old ones, best first. A new chunk takes over an old chunk's id when most of the
 * shorter text's word runs are in the other and the lengths are comparable; `same` when they are nearly identical.
 */
export function matchChunks(old: { id: string; text: string }[], fresh: string[]): ChunkMatch[] {
  const so = old.map((o) => shingles(o.text));
  const sf = fresh.map((t) => shingles(t));
  const pairs: { f: number; o: number; score: number; ratio: number }[] = [];
  for (let f = 0; f < sf.length; f++) {
    for (let o = 0; o < so.length; o++) {
      const a = sf[f]!;
      const b = so[o]!;
      if (!a.size || !b.size) continue;
      const ratio = a.size / b.size;
      if (ratio < 0.6 || ratio > 1 / 0.6) continue;
      const score = overlap(a, b) / Math.min(a.size, b.size);
      if (score >= 0.8) pairs.push({ f, o, score, ratio });
    }
  }
  pairs.sort((x, y) => y.score - x.score || Math.abs(1 - x.ratio) - Math.abs(1 - y.ratio));
  const out: ChunkMatch[] = fresh.map(() => ({ id: null, same: false }));
  const usedF = new Set<number>();
  const usedO = new Set<number>();
  for (const p of pairs) {
    if (usedF.has(p.f) || usedO.has(p.o)) continue;
    usedF.add(p.f);
    usedO.add(p.o);
    out[p.f] = { id: old[p.o]!.id, same: p.score >= 0.9 && p.ratio >= 0.85 && p.ratio <= 1 / 0.85 };
  }
  return out;
}
