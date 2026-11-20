/**
 * Must-cover list, statute part (LLD §8.5 step 1, HLD 5.2 d): re-read a section's or Article's text and list what a
 * lecture that states it must either cover or deliberately leave out — its provisos, exceptions and explanations,
 * and for Articles its clauses and sub-clauses. Illustrations are not listed: they teach the rule, they do not limit
 * it (decision 2026-11-20, docs/memory.md). Pure.
 */
import { STATUTE_PATTERNS as P } from './patterns.ts';

export type MustCoverKind = 'proviso' | 'exception' | 'explanation' | 'clause';

export interface MustCoverPart {
  kind: MustCoverKind;
  /** "Proviso to s. 25", "Explanation 2 to s. 25", "Article 19(1)(a)". */
  label: string;
  /** The item's own words, as stored in the section text. */
  text: string;
}

/** Strips a leading amendment bracket ("[(2) Nothing…", "4[(2)…") so markers are seen. */
const bare = (line: string) => line.replace(/^\s*\d*\[/, '').replace(/^\s+/, '');
/** "Contract to do an act afterwards becoming impossible or unlawful.—A contract …" */
const HEADED_PARA = /^([A-Z][A-Za-z ,'’()-]{8,140}?)\.\s*[—–]/;
const OMITTED =/^\(?[a-z0-9]+\)?\s*(\*\s*){3,}\]?\s*$/i;

/**
 * @param text   the section or Article text as stored (lines kept)
 * @param number the section or Article number ("25", "19")
 */
export function mustCoverParts(text: string, kind: 'act' | 'constitution', number: string): MustCoverPart[] {
  const where = kind === 'constitution' ? `Article ${number}` : `s. ${number}`;
  const lines = text.split('\n');
  const out: { kind: MustCoverKind; label: string; lines: string[] }[] = [];
  let current: (typeof out)[number] | null = null;
  // Articles: the numbered clause we are in; "19. Protection….—(1) All citizens…" opens clause (1) on line one.
  let clause: string | null = /[—–]\s*\((\d+[A-Z]?)\)/.exec(lines[0] ?? '')?.[1] ?? null;
  let provisos = 0;

  const start = (k: MustCoverKind, label: string, line: string) => {
    current = { kind: k, label, lines: [line.trim()] };
    out.push(current);
  };

  for (const raw of lines.slice(1)) {
    const line = bare(raw);
    if (!line) continue;
    const exp = P.explanation.exec(line);
    const exc = P.exception.exec(line);
    if (P.proviso.test(line)) {
      provisos++;
      start('proviso', `${provisos > 1 ? `Proviso ${provisos}` : 'Proviso'} to ${where}${clause ? `(${clause})` : ''}`, line);
    } else if (exp) {
      start('explanation', `Explanation${exp[1] ? ` ${exp[1].trim()}` : ''} to ${where}`, line);
    } else if (exc) {
      start('exception', `Exception${exc[1] ? ` ${exc[1].trim()}` : ''} to ${where}`, line);
    } else if (kind === 'act' && HEADED_PARA.test(line)) {
      // A further rule with its own marginal heading inside the section (s. 56, 2nd and 3rd paragraphs).
      start('clause', `${where}: ${HEADED_PARA.exec(line)![1]!.trim()}`, line);
    } else if (P.illustration.test(line)) {
      current = null; // illustrations end the item before them and are not listed
    } else if (kind === 'act' && P.subSection.test(line)) {
      // A sub-section of an Act is part of the rule itself; it only tells later provisos where they belong.
      clause = P.subSection.exec(line)![1]!;
      current = null;
    } else if (kind === 'constitution' && P.subSection.test(line)) {
      const n = P.subSection.exec(line)![1]!;
      clause = n;
      if (OMITTED.test(line)) current = null;
      else start('clause', `${where}(${n})`, line);
    } else if (kind === 'constitution' && P.clause.test(line)) {
      const c = /^\s*\(([a-z]{1,3}|[ivx]{1,5})\)/.exec(line)![1]!;
      if (OMITTED.test(line)) current = null;
      else start('clause', `${where}${clause ? `(${clause})` : ''}(${c})`, line);
    } else if (current) {
      (current as { lines: string[] }).lines.push(line.trim());
    }
  }
  // Clause (1) whose words are only "All citizens shall have the right—" is covered through its sub-clauses.
  const withKids = new Set(out.filter((o) => /\)\(/.test(o.label)).map((o) => o.label.replace(/\([a-z]{1,3}\)$|\([ivx]{1,5}\)$/, '')));
  return out
    .filter((o) => !(o.kind === 'clause' && withKids.has(o.label) && o.lines.join(' ').length < 120))
    .map((o) => ({ kind: o.kind, label: o.label, text: o.lines.join('\n') }));
}
