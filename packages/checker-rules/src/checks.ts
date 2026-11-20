/**
 * The checker's code part (LLD §8.2–8.4, HLD 5.2): risk level, checks C1–C8 and the decision table. Pure: the
 * caller passes the sources a part was written from and the signed law mappings; no database, no network, no AI.
 * C9 (support, Haiku) and C10 (second check, Sonnet) run in the server; their verdicts come back here as results.
 */
import { casePartyWords } from '@nyaai/legal';
import { normaliseForSpan } from './normalise.ts';

export type ClaimType = 'rule' | 'holding' | 'date' | 'punishment' | 'time_limit' | 'mapping' | 'quote' | 'fact' | 'example' | 'news_report';

export interface ClaimInput {
  text: string;
  type: ClaimType;
  tag: string;
  span: string;
}

/** One paragraph or statute chunk inside a supplied source, with what C7 needs. */
export interface SourcePiece {
  chunkId: string;
  text: string;
  paraNo: string | null;
  opinion: string | null;
  paraRole: string | null;
  kind: string;
}

/** A source as supplied to the writer (S1–S8), with its metadata. */
export interface CheckSource {
  tag: string;
  sourceId: string;
  sourceType: string;
  title: string | null;
  header: string;
  /** The full text the writer saw (parent section, or the paragraph window). */
  text: string;
  pieces: SourcePiece[];
  court: string | null;
  decidedOn: string | null;
  section: string | null;
  article: string | null;
  /** Judgments: confirmed treatment, or 'not_verified'. */
  caseStatus: string | null;
  rolesSampled: boolean;
  /** Editor's note of what the court held when there is no single majority. */
  holdingNote: string | null;
}

export interface MappingRow {
  oldAct: string;
  newAct: string;
  relation: 'same' | 'renumbered' | 'merged' | 'split' | 'substantively_changed' | 'no_direct_equivalent';
  oldSections: string[];
  newSections: string[];
  /** Signed off by the named criminal-law expert. */
  signed: boolean;
}

export type CheckName = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10';
export interface CheckResult {
  name: CheckName;
  result: 'pass' | 'fail' | 'grey' | 'skipped';
  detail: string | null;
}

export interface CodeCheckOutcome {
  results: CheckResult[];
  risk: 'normal' | 'high';
  /** The chunk whose text holds the span (a paragraph for judgments), when found. */
  chunkId: string | null;
  /** Offsets of the span in that chunk's normalised text. */
  spanStart: number | null;
  spanEnd: number | null;
}

/* ------------------------------------------------------------------------------------------------ risk (§8.2) */

const HIGH_TYPES = new Set<ClaimType>(['holding', 'date', 'punishment', 'time_limit', 'mapping']);
const NUMBERISH =
  /\b\d+(?:\.\d+)?\s*(?:days?|weeks?|months?|years?|hours?|per\s*cent|%|rupees?|lakh|crore)\b|\b(?:rs\.?|₹)\s*\d|\bimprisonment\b|\bfine\b|\bpenalty\b|\bwithin\s+(?:a\s+)?(?:\d+|one|two|three|six|seven|ten|thirty|sixty|ninety)\b|\b(?:1[6-9]|20)\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

/** Code decides; the writer's type can only raise the level, never lower it. */
export function riskOf(claim: Pick<ClaimInput, 'text' | 'type'>): 'normal' | 'high' {
  return HIGH_TYPES.has(claim.type) || NUMBERISH.test(claim.text) ? 'high' : 'normal';
}

/* ----------------------------------------------------------------------------------------------- helpers */

const HELD = /\b(?:held|holds|hold that|ruled|rules that|laid down|lays down|the court decided)\b/i;
const CASE_NAME = /\b([A-Z][\w.&'’-]*(?:\s+(?:[A-Z][\w.&'’-]*|of|and|&))*)\s+(?:v\.?|vs\.?|versus)\s+([A-Z][\w.&'’-]*(?:\s+(?:[A-Z][\w.&'’-]*|of|and|&))*)/g;
const YEAR = /\b(?:1[6-9]|20)\d{2}\b/g;
const SECTION_REF = /\b(?:s|ss|sec|secs|section|sections)\.?\s*(\d{1,4}[A-Z]{0,3})\b/gi;
const ARTICLE_REF = /\b(?:art|arts|article|articles)\.?\s*(\d{1,3}[A-Z]{0,3})\b/gi;
const COURT = /\b(Supreme Court|Privy Council|(?:[A-Z][a-z]+\s+)?High Court)\b/g;
const QUOTED = /[“"]([^”"]{12,})[”"]/g;
const OLD_LAW = /\b(IPC|Indian Penal Code|CrPC|Cr\.P\.C\.|Code of Criminal Procedure|Indian Evidence Act|Evidence Act)\b/i;
const NEW_LAW = /\b(BNS|Bharatiya Nyaya Sanhita|BNSS|Bharatiya Nagarik Suraksha Sanhita|BSA|Bharatiya Sakshya Adhiniyam)\b/i;
const EQUIVALENT = /\b(equivalent|corresponds? to|same as|replaced by|re-?enacted as|identical)\b/i;
const NEWS_WORDING = /^\s*(?:it was reported|it has been reported|reports say|according to (?:news )?reports)\b/i;

const lower = (s: string) => normaliseForSpan(s).toLowerCase();
const result = (name: CheckName, ok: boolean, detail: string | null): CheckResult => ({ name, result: ok ? 'pass' : 'fail', detail: ok ? null : detail });

/** Which piece holds the span (judgment paragraphs first, so C7 sees the paragraph's own role). */
function locate(span: string, src: CheckSource): { piece: SourcePiece | null; start: number; end: number } | null {
  const s = normaliseForSpan(span);
  for (const p of src.pieces) {
    const i = normaliseForSpan(p.text).indexOf(s);
    if (i >= 0) return { piece: p, start: i, end: i + s.length };
  }
  const i = normaliseForSpan(src.text).indexOf(s);
  return i >= 0 ? { piece: null, start: i, end: i + s.length } : null;
}

/* -------------------------------------------------------------------------------------------- C3: details */

function detailsCheck(claim: ClaimInput, src: CheckSource): CheckResult {
  const hay = lower(`${src.header}\n${src.title ?? ''}\n${src.text}`);
  const srcYear = src.decidedOn?.slice(0, 4) ?? src.header.match(YEAR)?.[0] ?? null;
  for (const y of claim.text.match(YEAR) ?? []) {
    if (!hay.includes(y) && y !== srcYear) return result('C3', false, srcYear ? `Year differs: source says ${srcYear}` : `Year ${y} is not in the source`);
  }
  for (const m of claim.text.matchAll(SECTION_REF)) {
    const n = m[1]!.toUpperCase();
    const own = src.section?.toUpperCase() === n;
    if (!own && !new RegExp(`(?:^|[^\\d])${n}(?:[^\\dA-Z]|$)`, 'i').test(`${src.header}\n${src.text}`)) {
      return result('C3', false, src.section ? `Section differs: source is s. ${src.section}` : `Section ${n} is not in the source`);
    }
  }
  for (const m of claim.text.matchAll(ARTICLE_REF)) {
    const n = m[1]!.toUpperCase();
    if (src.article?.toUpperCase() !== n && !new RegExp(`(?:^|[^\\d])${n}(?:[^\\dA-Z]|$)`, 'i').test(`${src.header}\n${src.text}`)) {
      return result('C3', false, src.article ? `Article differs: source is Article ${src.article}` : `Article ${n} is not in the source`);
    }
  }
  for (const m of claim.text.matchAll(CASE_NAME)) {
    const name = `${m[1]} v. ${m[2]}`;
    const words = casePartyWords(name);
    const found = words.length === 2 && words.some((w) => w !== null) && words.every((w) => w === null || hay.includes(w));
    if (!found) return result('C3', false, src.title ? `Case name differs: source is ${src.title}` : `${name} is not in the source`);
  }
  for (const m of claim.text.matchAll(COURT)) {
    // "the High Court" is generic; "Calcutta High Court" must be that court.
    const court = m[1]!.toLowerCase().replace(/^(?:the|a|this|that)\s+/, '');
    const srcCourt = (src.court ?? '').toLowerCase();
    if (!srcCourt.includes(court) && !hay.includes(court)) {
      return result('C3', false, src.court ? `Court differs: source is ${src.court}` : `${m[1]} is not in the source`);
    }
  }
  return result('C3', true, null);
}

/* ------------------------------------------------------------------------------------------- C5: mapping */

function mappingCheck(claim: ClaimInput, mappings: MappingRow[]): CheckResult {
  const crossesLaws = OLD_LAW.test(claim.text) && NEW_LAW.test(claim.text);
  if (claim.type !== 'mapping' && !crossesLaws) return { name: 'C5', result: 'skipped', detail: null };
  const secs = [...claim.text.matchAll(SECTION_REF)].map((m) => m[1]!.toUpperCase());
  const row = mappings.find((r) => secs.some((s) => r.oldSections.includes(s)) && secs.some((s) => r.newSections.includes(s)));
  if (!row || !row.signed) return result('C5', false, 'Mapping not confirmed');
  if ((row.relation === 'substantively_changed' || row.relation === 'no_direct_equivalent') && EQUIVALENT.test(claim.text)) {
    return result('C5', false, row.relation === 'substantively_changed' ? 'Not an equivalent: substantively changed' : 'Not an equivalent: no direct equivalent');
  }
  return result('C5', true, null);
}

/* ------------------------------------------------------------------------------------------- C7: paragraph role */

function roleCheck(claim: ClaimInput, src: CheckSource, piece: SourcePiece | null, risk: 'normal' | 'high'): CheckResult {
  const isHeld = claim.type === 'holding' || HELD.test(claim.text);
  if (!isHeld) return { name: 'C7', result: 'skipped', detail: null };
  if (src.sourceType !== 'judgment') return result('C7', false, 'Not the court\'s majority reasoning');
  if (!piece) return result('C7', false, 'The words run across paragraphs; cite one paragraph');
  if (piece.kind === 'headnote' || piece.paraRole === 'headnote') return result('C7', false, 'A headnote is not what the court held');
  if (piece.opinion === 'separate_no_majority') {
    return src.holdingNote ? result('C7', true, null) : result('C7', false, 'Separate opinions, no single majority');
  }
  if (piece.opinion !== 'majority') return result('C7', false, piece.opinion === 'dissent' ? 'This is a dissent, not what the court held' : 'Not the court\'s majority reasoning');
  if (piece.paraRole !== 'holding' && piece.paraRole !== 'discussion') return result('C7', false, 'Not the court\'s majority reasoning');
  if (risk === 'high' && !src.rolesSampled) return result('C7', false, 'Labels not yet checked by an expert');
  return result('C7', true, null);
}

/* ---------------------------------------------------------------------------------------------- C1–C8 */

/** Runs C1–C8 in order. C1 or C2 failing stops the checks that need the source text. */
export function codeChecks(claim: ClaimInput, sources: ReadonlyMap<string, CheckSource>, mappings: MappingRow[] = []): CodeCheckOutcome {
  const risk = riskOf(claim);
  const src = sources.get(claim.tag);
  const skipped = (names: CheckName[]) => names.map((name) => ({ name, result: 'skipped' as const, detail: null }));
  if (!src) return { results: [result('C1', false, 'Source not supplied'), ...skipped(['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'])], risk, chunkId: null, spanStart: null, spanEnd: null };

  const at = normaliseForSpan(claim.span).length >= 8 && !/\.\.\.|…/.test(claim.span) ? locate(claim.span, src) : null;
  if (!at) {
    return { results: [result('C1', true, null), result('C2', false, 'These words are not in the source'), ...skipped(['C3', 'C4', 'C5', 'C6', 'C7', 'C8'])], risk, chunkId: null, spanStart: null, spanEnd: null };
  }

  const results: CheckResult[] = [result('C1', true, null), result('C2', true, null), detailsCheck(claim, src)];

  // C4: words in quotation marks must be in the source character for character (quote styles and spaces aside).
  const srcNorm = normaliseForSpan(src.text);
  const badQuote = [...claim.text.matchAll(QUOTED)].map((m) => m[1]!).find((q) => !srcNorm.includes(normaliseForSpan(q)));
  results.push(badQuote === undefined ? result('C4', true, null) : result('C4', false, 'Quote differs from the source'));

  results.push(mappingCheck(claim, mappings));

  // C6: news and web support only "It was reported…" lines of type news_report.
  if (src.sourceType === 'news' || src.sourceType === 'web') {
    results.push(result('C6', claim.type === 'news_report' && NEWS_WORDING.test(claim.text), 'News cannot support a statement of law'));
  } else {
    results.push(result('C6', claim.type !== 'news_report', 'Only news can be reported as news'));
  }

  results.push(roleCheck(claim, src, at.piece, risk));

  // C8: case status. Unconfirmed → grey; confirmed overruled or reversed → yellow unless the line says so.
  if (src.sourceType === 'judgment') {
    const status = src.caseStatus ?? 'not_verified';
    if (status === 'not_verified') results.push({ name: 'C8', result: 'grey', detail: 'Status not verified' });
    else if ((status === 'overruled' || status === 'reversed') && !new RegExp(`\\b${status}\\b`, 'i').test(claim.text)) {
      results.push(result('C8', false, status === 'overruled' ? 'This case was overruled' : 'This case was reversed'));
    } else results.push(result('C8', true, null));
  } else results.push({ name: 'C8', result: 'skipped', detail: null });

  return { results, risk, chunkId: at.piece?.chunkId ?? src.pieces[0]?.chunkId ?? null, spanStart: at.start, spanEnd: at.end };
}

/** Checks whose failure sends a claim back to the writer once (LLD §8.3, repair loop). */
export const REPAIRABLE: ReadonlySet<CheckName> = new Set(['C1', 'C2', 'C3', 'C4', 'C7', 'C9']);

/** C1–C7 all passed (or did not apply): the claim may go to the AI checks. */
export const passedCode = (results: CheckResult[]) => results.every((r) => r.name === 'C8' || r.result !== 'fail');

/* ---------------------------------------------------------------------------------------- decision (§8.4) */

export interface Decision {
  status: 'supported' | 'open';
  flag: 'yellow' | 'grey' | null;
  reason: string | null;
}

/** Any failure of C1–C7, C9 or C10 → open + yellow; only C8 grey → supported + grey; else supported. */
export function decide(results: CheckResult[]): Decision {
  const failed = results.find((r) => r.result === 'fail');
  if (failed) return { status: 'open', flag: 'yellow', reason: failed.detail ?? 'Please verify' };
  const grey = results.find((r) => r.result === 'grey');
  if (grey) return { status: 'supported', flag: 'grey', reason: grey.detail };
  return { status: 'supported', flag: null, reason: null };
}

const LEGAL_EFFECT = /\b(?:is|are|becomes|become|shall be|will be)\s+(?:void|voidable|valid|enforceable|unenforceable|liable|punishable|discharged|frustrated)\b/i;
const TIME_OR_PENALTY = /\b\d+\s*(?:days?|weeks?|months?|years?)\b|\bwithin\s+(?:a\s+)?(?:\d+|one|two|three|six|seven|ten|thirty|sixty|ninety)\b|\bimprisonment\b|\bfine of\b|\bpenalty of\b|\b(?:rs\.?|₹)\s*\d/i;
/** A source named and then made to say something: "Section 56 makes…", "Article 19 guarantees…". */
const ASSERTS = /\b(?:provides?|makes?|declares?|requires?|renders?|guarantees?|prohibits?|permits?|governs?|applies to|says that|states that|lays down|holds that)\b/i;

/**
 * A line the writer marked teaching, question or transition must not state law without a claim. It is flagged when
 * it states a legal effect ("is void"), a holding ("held"), a time limit or a penalty, or names a section, Article or
 * case and makes it say something. Naming one in passing ("Next: what does s. 56 say?") is teaching, not a claim.
 */
export function looksLegal(text: string): boolean {
  if (HELD.test(text)) return true;
  if (/\?\s*$/.test(text)) return false; // a question asks; it does not state the law
  if (LEGAL_EFFECT.test(text) || TIME_OR_PENALTY.test(text)) return true;
  const namesSource = new RegExp(SECTION_REF.source, 'i').test(text) || new RegExp(ARTICLE_REF.source, 'i').test(text) || new RegExp(CASE_NAME.source).test(text);
  return namesSource && ASSERTS.test(text);
}

/** "One sentence either side" of the span, for C9 (LLD §8.3). */
export function spanContext(span: string, sourceText: string): { before: string; after: string } {
  const text = normaliseForSpan(sourceText);
  const s = normaliseForSpan(span);
  const i = text.indexOf(s);
  if (i < 0) return { before: '', after: '' };
  const head = text.slice(0, i);
  const tail = text.slice(i + s.length);
  const sentences = (t: string) => t.split(/(?<=[.;:])\s+(?=[A-Z(“"])/);
  const before = sentences(head).slice(-2).join(' ').slice(-600);
  const after = sentences(tail).slice(0, 2).join(' ').slice(0, 600);
  return { before, after };
}
