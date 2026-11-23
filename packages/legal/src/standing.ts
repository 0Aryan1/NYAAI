/**
 * A source's standing (decision 2026-11-24, docs/memory.md): how much weight a careful teacher would give it.
 *
 * Relevance comes first: the reranker's score (0–1) for how well the source answers the question. Small bonuses
 * then reorder sources of similar relevance by authority: the Act itself, the court and its bench, an official copy,
 * the court's own reasoning over a lawyer's argument, and the expert's finding on the case. The bonuses are small on
 * purpose (at most about +0.15): they never lift an off-topic source over the relevance floor, which applies to
 * relevance alone. Pure.
 */

export interface SourceFacts {
  sourceType: string;
  courtLevel: string | null;
  benchSize: number | null;
  origin: string;
  provisional: boolean;
  /** The newest confirmed case status (judgments only). Used for ranking; the Studio shows it live on its own. */
  caseStatus: string | null;
  paraRole: string | null;
  /** The chunk kind ("headnote", "para", "section", …). */
  kind: string | null;
}

export interface Standing {
  /** Relevance plus the bonuses: what sources are ordered by. */
  score: number;
  /** The reranker's score, or null when the reranker was not used. */
  relevance: number | null;
  /** Plain words for the teacher: "Supreme Court", "5-judge bench", "official copy", "the court's own reasoning". */
  reasons: string[];
}

const COURT: Record<string, [number, string]> = {
  supreme_court: [0.05, 'Supreme Court'],
  high_court: [0.02, 'High Court'],
  tribunal: [0, 'Tribunal'],
  district: [-0.02, 'District court'],
  foreign: [-0.03, 'Foreign court'],
};
const OFFICIAL = new Set(['court_site', 'india_code', 'egazette']);
const COPY: Record<string, string> = { court_site: 'official copy', india_code: 'official copy (India Code)', egazette: 'official copy (Gazette)', indian_kanoon: 'Indian Kanoon copy', upload: 'uploaded copy' };
const ROLE: Record<string, [number, string]> = {
  holding: [0.02, "the court's decision"],
  discussion: [0.02, "the court's own reasoning"],
  arguments: [-0.04, "a lawyer's argument, not the court's view"],
  lower_court_summary: [-0.03, "a lower court's view"],
  facts: [0, 'the facts of the case'],
};
const STATUS: Record<string, number> = { good_law: 0.02, doubted: -0.04, overruled: -0.2, reversed: -0.2 };

/** The bonus and the plain-words reasons, from the source's own facts (no relevance). */
export function standingOf(f: SourceFacts): { bonus: number; reasons: string[] } {
  let bonus = 0;
  const reasons: string[] = [];
  const add = (b: number, why: string | null) => {
    bonus += b;
    if (why) reasons.push(why);
  };
  if (f.sourceType === 'act') add(0.05, 'the Act itself');
  else if (f.sourceType === 'constitution') add(0.05, 'the Constitution itself');
  else if (f.sourceType === 'judgment') {
    const court = f.courtLevel ? COURT[f.courtLevel] : undefined;
    if (court) add(court[0], court[1]);
    if (f.benchSize) add(f.benchSize >= 5 ? 0.03 : f.benchSize >= 3 ? 0.015 : 0, `${f.benchSize}-judge bench`);
    if (f.kind === 'headnote') add(-0.03, "a headnote (the reporter's summary)");
    else if (f.paraRole && ROLE[f.paraRole]) add(ROLE[f.paraRole]![0], ROLE[f.paraRole]![1]);
    add(STATUS[f.caseStatus ?? ''] ?? 0, null); // shown live in the Studio, not as a stored reason
  }
  add(OFFICIAL.has(f.origin) ? 0.02 : 0, COPY[f.origin] ?? null);
  if (f.provisional) add(-0.02, 'copy not yet approved by the library team');
  return { bonus, reasons };
}

export function standing(f: SourceFacts, relevance: number | null): Standing {
  const { bonus, reasons } = standingOf(f);
  // No reranker score (it was unavailable): rank on authority around the middle.
  return { score: Math.round(((relevance ?? 0.5) + bonus) * 1000) / 1000, relevance, reasons };
}
