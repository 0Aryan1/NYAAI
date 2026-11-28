/**
 * Which topics (the expert's concept list) a leading case belongs to, from a course pack's note on the case
 * ("Public policy grounds under section 34"). Read by code, never by a model:
 *  - a section or Article the note names links the case to the topic of the same subject whose key sections hold it;
 *  - a topic's name or alias written in the note links it too (whole words; a plural "s" allowed);
 *  - a pack may also name the topics outright, for a note that says neither (a person wrote it; it wins).
 * Links made here are suggestions: unconfirmed until the law expert confirms each one (HLD D28).
 */
export interface ConceptForLinking {
  id: string;
  name: string;
  subject: string;
  aliases: string[];
  /** Key sections and Articles: which Act (null for the Constitution) and the number ("34", "53A", "300A"). */
  sections: { kind: 'section' | 'article'; act: string | null; number: string }[];
}

export interface PackCase {
  name: string;
  topic: string;
  /** Topic names a person chose for this case (used instead of matching). */
  concepts?: string[];
  /** The Acts taught in the case's unit: a section number links only to a key section of one of them. */
  acts?: string[];
}

export type LinkReason = 'named_by_pack' | 'section' | 'name';

export interface CaseLink {
  conceptId: string;
  reason: LinkReason;
}

const REF = /\b(sections?|ss?\.|art(?:icle)?s?\.?)\s*(\d{1,4}[A-Z]{0,2})\b/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sections and Articles a note names: "section 34(4)" → section 34, "Article 300A" → article 300A. */
export function refsIn(text: string): { kind: 'section' | 'article'; number: string }[] {
  const out = new Map<string, { kind: 'section' | 'article'; number: string }>();
  for (const m of text.matchAll(REF)) {
    const kind = /^art/i.test(m[1]!) ? 'article' : 'section';
    const number = m[2]!.toUpperCase();
    out.set(`${kind}:${number}`, { kind, number });
  }
  return [...out.values()];
}

/** The numbers alone ("34", "53A", "300A"). */
export function numbersIn(text: string): string[] {
  return [...new Set(refsIn(text).map((r) => r.number))];
}

const actKey = (a: string) =>
  a
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/,?\s*\d{4}$/, '')
    .replace(/\s+/g, ' ')
    .trim();

function phraseIn(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (p.length < 4) return false;
  return new RegExp(`(?:^|[^a-z0-9])${esc(p.toLowerCase())}s?(?:[^a-z0-9]|$)`).test(text.toLowerCase());
}

export function linkCase(c: PackCase, concepts: ConceptForLinking[], subject: string): CaseLink[] {
  if (c.concepts?.length) {
    return c.concepts.flatMap((n) => {
      const k = concepts.find((x) => x.name.toLowerCase() === n.toLowerCase());
      return k ? [{ conceptId: k.id, reason: 'named_by_pack' as const }] : [];
    });
  }
  const mine = concepts.filter((k) => k.subject === subject);
  const out = new Map<string, LinkReason>();
  // An Article matches only an Article; a section only a key section of an Act taught in the case's unit (two
  // Acts in one subject may share a number: s. 52 of the Transfer of Property Act and of the Easements Act).
  const acts = c.acts?.length ? new Set(c.acts.map(actKey)) : null;
  const refs = refsIn(c.topic);
  for (const k of mine) {
    const hit = refs.some((r) =>
      k.sections.some(
        (s) =>
          s.kind === r.kind &&
          s.number === r.number &&
          (r.kind === 'article' || !acts || (s.act !== null && acts.has(actKey(s.act)))),
      ),
    );
    if (hit) out.set(k.id, 'section');
  }
  for (const k of mine)
    if (!out.has(k.id) && [k.name, ...k.aliases].some((p) => phraseIn(c.topic, p))) out.set(k.id, 'name');
  return [...out].map(([conceptId, reason]) => ({ conceptId, reason }));
}
