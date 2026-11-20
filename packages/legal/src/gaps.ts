/**
 * Library gaps, code part: what kind of source a thin or not-found question is missing, a key for counting repeats,
 * and the checks a lookup result must pass before it is used. Pure; no network, no AI.
 */
import { ACT_ALIASES, ACT_YEARS, understandQuery } from './query.ts';

export interface ActMention {
  /** Library-style name: "Sale of Goods Act" (no "The", no year). */
  name: string;
  year: number | null;
}

export type GapKind = 'act' | 'case' | 'topic';

export interface GapClass {
  kind: GapKind;
  act: ActMention | null;
  caseName: string | null;
}

/** "The Sale of Goods Act, 1930" → "sale of goods act". Used to compare Act names from any source. */
export function actKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(1[6-9]|20)\d{2}\b/g, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const sameAct = (a: string, b: string) => actKey(a) === actKey(b);

// A capitalised name ending in "Act", "Code" or "Sanhita", optionally followed by its year:
// "Transfer of Property Act, 1882", "the Limitation Act 1963", "Code of Civil Procedure, 1908".
const ACT_NAME = /\b((?:[A-Z][A-Za-z]+)(?:\s+(?:[A-Z][A-Za-z]+|of|and|for|on|in|the|\([A-Z][A-Za-z]+\)))*?\s+(?:Act|Code|Sanhita|Adhiniyam))\b(?:,?\s+((?:1[6-9]|20)\d{2}))?/g;
/** Words that start a sentence or a phrase, never an Act's name. */
const LEAD_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'what', 'which', 'how', 'why', 'when', 'where', 'who', 'explain', 'discuss', 'describe',
  'define', 'compare', 'under', 'in', 'on', 'of', 'and', 'for', 'this', 'that', 'does', 'do', 'can', 'teach', 'lecture', 'notes',
  'section', 'sections', 'chapter', 'about', 'per', 'as', 'by', 'from', 'with', 'new', 'old',
]);

/** Acts a question names: known aliases first (with their year), then any capitalised "… Act[, year]". */
export function actMentions(question: string): ActMention[] {
  const out = new Map<string, ActMention>();
  for (const [re, name] of ACT_ALIASES) {
    if (!re.test(question)) continue;
    const year = ACT_YEARS[name];
    if (year === null) continue; // the Constitution is not an India Code Act
    out.set(actKey(name), { name, year: year ?? null });
  }
  for (const m of question.matchAll(ACT_NAME)) {
    // A sentence may start with a capital: "Explain the Transfer of Property Act" → "Transfer of Property Act".
    const words = m[1]!.trim().split(/\s+/);
    while (words.length && LEAD_WORDS.has(words[0]!.toLowerCase())) words.shift();
    const name = words.join(' ');
    if (words.length < 2) continue;
    const key = actKey(name);
    const known = out.get(key);
    const year = m[2] ? Number(m[2]) : (known?.year ?? null);
    out.set(key, { name: known?.name ?? name, year });
  }
  return [...out.values()];
}

/**
 * What the question is missing. An Act it names that the library does not hold → 'act' (India Code);
 * else a case name → 'case' (Indian Kanoon); else 'topic' (judgments by topic, and links for the editor).
 */
export function classifyGap(question: string, loadedActs: string[]): GapClass {
  const loaded = new Set(loadedActs.map(actKey));
  const act = actMentions(question).find((a) => !loaded.has(actKey(a.name))) ?? null;
  if (act) return { kind: 'act', act, caseName: null };
  const caseName = understandQuery(question).caseNames[0] ?? null;
  if (caseName) return { kind: 'case', act: null, caseName };
  return { kind: 'topic', act: null, caseName: null };
}

/** "The Sale of Goods Act, 1930" → "Sale of Goods Act": the library `act_name` style. */
export function libraryActName(title: string): string {
  return title.replace(/^\s*The\s+/i, '').replace(/,?\s*(1[6-9]|20)\d{2}\s*$/, '').replace(/\s+/g, ' ').trim();
}

const PARTY_NOISE = new Set(['the', 'state', 'union', 'of', 'and', 'ltd', 'limited', 'pvt', 'private', 'company', 'co', 'india', 'others', 'ors', 'anr']);
/** First distinctive word of a party: "M/s. Satyabrata Ghose" → "satyabrata"; "State of Bihar" → "bihar". */
function partyWord(party: string): string | null {
  return party.toLowerCase().match(/[a-z]{3,}/g)?.find((w) => !PARTY_NOISE.has(w)) ?? null;
}

/** The distinctive word of each party of "X v. Y" (null for a generic party such as "State of U.P."). */
export function casePartyWords(caseName: string): (string | null)[] {
  const parties = caseName.split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  return parties.length === 2 ? parties.map(partyWord) : [];
}

/**
 * A search hit is the named case only if a distinctive word of each party is in its title. A party made only of
 * generic words ("State of U.P.", "Union of India") is skipped, but at least one party must match.
 */
export function caseMatches(caseName: string, title: string): boolean {
  const parties = caseName.split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  if (parties.length !== 2) return false;
  const t = title.toLowerCase().split(/\s+(?:v\.?|vs\.?|versus)\s+/i);
  if (t.length < 2) return false;
  const words = parties.map(partyWord);
  if (words.every((w) => w === null)) return false;
  return words.every((w, i) => w === null || t[i]!.includes(w));
}

/** Normalised question for counting repeats: "Doctrine of Frustration?" and "doctrine of  frustration" are one gap. */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 500);
}

export interface ActCandidate {
  title: string;
  year: number | null;
  repealed: boolean;
}

export type ActPick<T extends ActCandidate> =
  | { kind: 'one'; act: T }
  | { kind: 'none' }
  | { kind: 'repealed'; act: T }
  | { kind: 'ambiguous'; acts: T[] };

/**
 * Picks the Act to load automatically. Only an exact name match counts (never "closest"), the year must agree when
 * we know it, and a repealed Act or a choice between several is left to the library editor: loading the wrong Act
 * is the mistake this must not make.
 */
export function pickAct<T extends ActCandidate>(wanted: ActMention, candidates: T[]): ActPick<T> {
  const exact = candidates.filter((c) => sameAct(c.title, wanted.name) && (wanted.year === null || c.year === wanted.year));
  if (exact.length === 0) return { kind: 'none' };
  const inForce = exact.filter((c) => !c.repealed);
  if (inForce.length === 1) return { kind: 'one', act: inForce[0]! };
  if (inForce.length === 0) return { kind: 'repealed', act: exact[0]! };
  return { kind: 'ambiguous', acts: inForce };
}

/** True when the URL is https and its host is an allowlisted domain or a sub-domain of one. */
export function onAllowlist(url: string, allowlist: string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return allowlist.some((d) => {
    const domain = d.toLowerCase().replace(/^\.+/, '');
    return domain.length > 0 && (host === domain || host.endsWith(`.${domain}`));
  });
}
