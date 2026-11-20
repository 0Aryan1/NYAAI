/**
 * Query understanding, code part (LLD §7.2 steps 1–2): exact references and acts, found by pattern.
 * "s. 56", "section 56 of the Contract Act", "Sec. 56 ICA", "Art. 19(1)(g)", "Article 21", "Satyabrata Ghose v. Mugneeram".
 */

export interface ExactRef {
  kind: 'section' | 'article';
  number: string;
  act: string | null;
}

export interface QueryUnderstanding {
  refs: ExactRef[];
  /** Act names the query points at (library `act_name` values). */
  acts: string[];
  /** Possible case names ("X v. Y"), matched later against source titles by trigram similarity. */
  caseNames: string[];
}

/** Common names and abbreviations → the act name stored in the library. */
export const ACT_ALIASES: [RegExp, string][] = [
  [/\b(?:Indian\s+)?Contract\s+Act\b|\bICA\b/i, 'Indian Contract Act'],
  [/\bConstitution\b|\bCOI\b/i, 'Constitution of India'],
  [/\bSpecific\s+Relief\s+Act\b|\bSRA\b/i, 'Specific Relief Act'],
  [/\bSale\s+of\s+Goods\s+Act\b|\bSGA\b/i, 'Sale of Goods Act'],
  [/\bIndian\s+Penal\s+Code\b|\bIPC\b/i, 'Indian Penal Code'],
  [/\bBharatiya\s+Nyaya\s+Sanhita\b|\bBNS\b/i, 'Bharatiya Nyaya Sanhita'],
];

const SECTION = /\b(?:s|ss|sec|secs|section|sections)\.?\s*(\d{1,4}[A-Z]{0,3})\b/gi;
const ARTICLE = /\b(?:art|arts|article|articles)\.?\s*(\d{1,3}[A-Z]{0,3})\b/gi;
const CASE = /\b([A-Z][\w.&'-]*(?:\s+(?:[A-Z][\w.&'-]*|of|and|&))*)\s+(?:v\.?|vs\.?|versus)\s+([A-Z][\w.&'-]*(?:\s+(?:[A-Z][\w.&'-]*|of|and|&))*)/g;

export function understandQuery(query: string): QueryUnderstanding {
  const acts = [...new Set(ACT_ALIASES.filter(([re]) => re.test(query)).map(([, name]) => name))];
  const defaultAct = acts.length === 1 ? acts[0]! : null;
  const refs: ExactRef[] = [];
  for (const m of query.matchAll(SECTION)) refs.push({ kind: 'section', number: m[1]!.toUpperCase(), act: defaultAct === 'Constitution of India' ? null : defaultAct });
  for (const m of query.matchAll(ARTICLE)) refs.push({ kind: 'article', number: m[1]!.toUpperCase(), act: 'Constitution of India' });
  const caseNames = [...query.matchAll(CASE)].map((m) => `${m[1]} v. ${m[2]}`.replace(/\s+/g, ' ').trim());
  const unique = new Map(refs.map((r) => [`${r.kind}:${r.number}:${r.act}`, r]));
  return { refs: [...unique.values()], acts, caseNames };
}

/** Reciprocal rank fusion (LLD §7.4): score(d) = Σ 1 / (k + rank). Pinned ids come first, in their own order. */
export function reciprocalRankFusion(lists: string[][], pinned: string[] = [], k = 60): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  const pins = [...new Set(pinned)];
  const rest = [...scores].filter(([id]) => !pins.includes(id)).sort((a, b) => b[1] - a[1]);
  return [...pins.map((id) => ({ id, score: Infinity })), ...rest.map(([id, score]) => ({ id, score }))];
}
