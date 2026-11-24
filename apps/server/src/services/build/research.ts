/**
 * The research stage of a lecture build (decision 2026-11-24, docs/memory.md): after the plan, before any writing.
 *
 *   1. Search    every part's questions against the library at once (with the gap lookup for a thin result).
 *   2. Merge     duplicates inside a part are removed; a case several parts found gets one main part, and the other
 *                parts are told to mention it only briefly.
 *   3. Code gap check   the topic's key sections and confirmed leading cases. One that no part found is added to the
 *                part it fits best. Every proviso, exception and explanation of the sections in the notes is given
 *                to one part, whose writer is told to teach it ("MUST COVER"), so it is not left out by accident.
 *   4. AI gap check (Sonnet, at most two rounds)   what a careful teacher would still miss, as library search
 *                questions; each is searched and what it finds joins that part's notes. It reads labels only, never
 *                source text, and its questions search the library only: a query that leaves the app (the outside
 *                lookup) comes only from clean context (rules §2, LLD §17.6). What is still missing is reported.
 *
 * Her own notes (Option A, decision 2026-11-25): only the documents she attached to this lecture are searched, each
 * one is used (a section of it joins the part it fits best when no search found it), and any private source that is
 * not attached is dropped (`onlyAttached`), whatever the search returned.
 *
 * The notes are saved on the lecture (`lectures.research`), so a retried build reuses them; each part is then
 * written closed-book from its own notes, and the ten checks run as before.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { mustCoverParts, type MustCoverKind } from '@nyaai/legal';
import { normaliseForSpan } from '@nyaai/checker-rules';
import { PROMPTS, fence } from '@nyaai/prompts';
import { GapQuestions, type LecturePlan } from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import { searchWithLookup, type GapLookup, type TenantRunner } from '../lookup/index.ts';
import { conceptMustCover, noteSources, search, sourceDetails, statuteSource, statuteUnits, type RetrievedSource, type SearchDeps, type SearchRequest, type StatuteUnit } from '../search/index.ts';
import type { UsageSink } from '../usage.ts';
import { partQuery, sourceLabel } from './part.ts';
import { pool } from './pool.ts';

/** Sources per part: S1…S8, as the writer prompt expects. */
export const MAX_SOURCES = 8;
/** The first search leaves room for what the gap checks add. */
const FIRST_SEARCH = 6;
const GAP_SEARCH = 3;
const MAX_ROUNDS = 2;
const MAX_MUST_COVER = 15;
const MAX_MUST_PER_PART = 6;

export interface PartNotes {
  sources: RetrievedSource[];
  outcome: 'ok' | 'thin' | 'not_found';
}

export interface MustCoverNote {
  key: string;
  kind: MustCoverKind | 'leading_case';
  /** "Explanation 1 to s. 34", "Leading case: Ssangyong Engineering v. NHAI". */
  label: string;
  sourceId: string;
  /** The Act and section or Article it belongs to (null for a leading case). */
  act: string | null;
  number: string | null;
  /** The part whose writer must teach it; null when no part's notes hold it. */
  partIndex: number | null;
}

export interface LectureResearch {
  version: 1;
  /** One entry per part of the plan, in plan order. */
  parts: PartNotes[];
  mustCover: MustCoverNote[];
  /** Per part index: cases another part teaches in full, as lines for its writer. */
  elsewhere: Record<string, string[]>;
  /** The AI gap check's questions and how many new sources each brought. */
  gaps: { round: number; partIndex: number; question: string; why: string; added: number }[];
  /** Gap questions the library could not answer (shown as "Not found in the library"; the library team is told). */
  notFound: { partIndex: number; question: string }[];
}

export interface ResearchInput {
  plan: LecturePlan;
  topic: string;
  level: string;
  filters: { jurisdiction?: string; asOn?: string };
  contextAct?: string;
  conceptId: string | null;
  /** Her notes attached to this lecture (private source ids): the only private sources it may use. */
  notes?: string[];
}

export interface ResearchDeps {
  tenant: TenantRunner;
  searchDeps: (c: pg.PoolClient) => SearchDeps;
  lookup: GapLookup | null;
  gateway: Gateway;
  usage: UsageSink;
  traceId?: string;
  concurrency?: number;
}

export async function researchLecture(input: ResearchInput, deps: ResearchDeps): Promise<LectureResearch> {
  const { plan } = input;
  const limit = deps.concurrency ?? 3;
  const request = (query: string, maxSources: number, noExpand = false): SearchRequest => ({
    query,
    purpose: 'lecture_part',
    filters: { jurisdiction: input.filters.jurisdiction ? [input.filters.jurisdiction] : undefined, asOn: input.filters.asOn },
    maxSources,
    contextAct: input.contextAct,
    noExpand,
    notes: input.notes ?? [],
  });

  // 1. Search every part at once.
  const parts: PartNotes[] = plan.parts.map(() => ({ sources: [], outcome: 'not_found' }));
  await pool(
    plan.parts.map((p, i) => ({ p, i })),
    limit,
    async ({ p, i }) => {
      const found = await searchWithLookup(deps.tenant, request(partQuery(input.topic, p), FIRST_SEARCH), deps.searchDeps, deps.lookup);
      parts[i] = { sources: dedupe(found.sources), outcome: found.outcome };
    },
  );

  // 2–3. Code gap check: the topic's key sections and leading cases.
  const concept = input.conceptId ? await deps.tenant((c) => conceptMustCover(c, input.conceptId!)) : { sectionChunkIds: [], cases: [] };
  const keyUnits = await deps.tenant((c) => statuteUnits(c, concept.sectionChunkIds));
  for (const u of keyUnits) {
    if (parts.some((p) => hasUnit(p, u))) continue;
    const src = await deps.tenant((c) => statuteSource(c, u.chunkId));
    const at = src ? bestPart(plan, `${u.header} ${u.text}`) : null;
    if (src && at !== null) addTo(parts[at]!, [src], true);
  }
  const caseNotes: MustCoverNote[] = [];
  for (const k of concept.cases) {
    let at = mainPart(parts, k.sourceId);
    if (at === null) {
      // Its own paragraphs, found by its name; library only (a leading case is in the library by definition).
      const found = await deps.tenant((c) => search(c, request(k.title, FIRST_SEARCH, true), deps.searchDeps(c)));
      const mine = found.sources.filter((s) => s.sourceId === k.sourceId).slice(0, 2);
      const best = mine.length ? bestPart(plan, mine.map((s) => s.text).join(' ')) : null;
      if (best !== null) {
        addTo(parts[best]!, mine, true);
        at = best;
      }
    }
    caseNotes.push({ key: `case|${k.sourceId}`, kind: 'leading_case', label: `Leading case: ${k.title}`, sourceId: k.sourceId, act: null, number: null, partIndex: at });
  }
  // Her attached notes: each document is used. One no search found gives its best-fitting sections to their parts.
  const attached = input.notes ?? [];
  if (attached.length) {
    const all = await deps.tenant((c) => noteSources(c, attached));
    for (const id of attached) {
      if (parts.some((p) => p.sources.some((s) => s.sourceId === id))) continue;
      const mine = all.filter((s) => s.sourceId === id);
      const fit = mine.map((s) => ({ s, at: bestPart(plan, `${s.header} ${s.text}`), score: Math.max(0, ...plan.parts.map((p) => overlap(`${s.header} ${s.text}`, p))) }));
      const chosen = fit.filter((f) => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
      for (const f of chosen.length ? chosen : fit.slice(0, 1)) if (f.at !== null) addTo(parts[f.at]!, [f.s], true);
    }
  }
  settle(parts);
  let mustCover = [...(await statuteMustCover(plan, parts, keyUnits, deps.tenant)), ...caseNotes];

  // 4. AI gap check, at most two rounds; it stops early when nothing new turns up.
  const gaps: LectureResearch['gaps'] = [];
  const notFound: LectureResearch['notFound'] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const titles = await deps.tenant((c) => sourceDetails(c, judgmentIds(parts)));
    let asked: GapQuestions['questions'];
    try {
      const task = gapTask(input, parts, mustCover, gaps, (id) => titles.get(id)?.title ?? null);
      asked = (await deps.gateway.run({ prompt: PROMPTS['research.gaps'], schema: GapQuestions, task, traceId: deps.traceId }, deps.usage)).data.questions;
    } catch {
      break; // the gap check helps; it never blocks the build
    }
    const fresh = asked.filter((q) => q.part >= 1 && q.part <= plan.parts.length && !gaps.some((g) => sameQuestion(g.question, q.question)));
    if (!fresh.length) break;
    let added = 0;
    await pool(fresh, limit, async (q) => {
      const i = q.part - 1;
      // Library only (lookup = null): this query was written by a model that read library labels. A thin result
      // is still recorded as a library gap for the library team.
      const found = await searchWithLookup(deps.tenant, request(`${input.topic}: ${q.question}`, GAP_SEARCH, true), deps.searchDeps, null);
      const n = addTo(parts[i]!, found.sources, false);
      added += n;
      gaps.push({ round, partIndex: i, question: q.question, why: q.why, added: n });
      if (!found.sources.length) notFound.push({ partIndex: i, question: q.question });
    });
    settle(parts);
    // Sections the gap searches brought in join the must-cover list.
    mustCover = [...(await statuteMustCover(plan, parts, keyUnits, deps.tenant)), ...caseNotes.map((n) => ({ ...n, partIndex: mainPart(parts, n.sourceId) }))];
    if (!added) break;
  }

  for (const p of parts) p.sources = onlyAttached(p.sources, attached);
  const titles = await deps.tenant((c) => sourceDetails(c, judgmentIds(parts)));
  return { version: 1, parts, mustCover, elsewhere: elsewhere(plan, parts, (id) => titles.get(id)?.title ?? null), gaps, notFound };
}

/* ------------------------------------------------------------------------------------------------------------
 * Pure helpers (exported for tests).
 * ---------------------------------------------------------------------------------------------------------- */

const isStatute = (s: RetrievedSource) => s.meta.sourceType === 'act' || s.meta.sourceType === 'constitution';
const unitNo = (s: RetrievedSource) => s.meta.section ?? s.meta.article ?? null;

/** Two notes are the same when they are the same section, or overlapping paragraphs of the same judgment. */
export function sameNote(a: RetrievedSource, b: RetrievedSource): boolean {
  if (a.sourceId !== b.sourceId) return false;
  if (isStatute(a) && isStatute(b) && unitNo(a) && unitNo(a) === unitNo(b)) return true;
  return a.chunkId === b.chunkId || a.coveredChunkIds.some((id) => b.coveredChunkIds.includes(id));
}

/**
 * The last guard on her notes (Option A): a private source is kept only if it is one of the documents attached to the
 * lecture. The search already filters them; this holds even if it did not (and for notes saved by an earlier build).
 */
export function onlyAttached(list: RetrievedSource[], attached: string[]): RetrievedSource[] {
  return list.filter((s) => !s.meta.private || attached.includes(s.sourceId));
}

/** Keeps the first (best-ranked) of each duplicate. */
export function dedupe(list: RetrievedSource[]): RetrievedSource[] {
  const out: RetrievedSource[] = [];
  for (const s of list) if (!out.some((o) => sameNote(o, s))) out.push(s);
  return out;
}

/**
 * Adds new notes to a part, up to S8. `force` (a key section or leading case the topic must cover) makes room by
 * dropping the part's lowest-ranked judgment paragraph. Returns how many were added.
 */
export function addTo(part: PartNotes, more: RetrievedSource[], force: boolean): number {
  let n = 0;
  for (const s of more) {
    if (part.sources.some((o) => sameNote(o, s))) continue;
    if (part.sources.length >= MAX_SOURCES) {
      if (!force) continue;
      // The lowest judgment paragraph makes room; never a section, never her own attached note.
      const drop = part.sources.map((x, i) => ({ x, i })).reverse().find(({ x }) => !isStatute(x) && !x.meta.private);
      if (!drop) continue;
      part.sources.splice(drop.i, 1);
    }
    part.sources.push(s);
    n++;
  }
  return n;
}

/** A part's outcome after notes were added: three or more sources is enough. */
function settle(parts: PartNotes[]) {
  for (const p of parts) if (p.sources.length) p.outcome = p.sources.length >= 3 ? 'ok' : p.outcome === 'ok' ? 'ok' : 'thin';
}

function hasUnit(part: PartNotes, u: StatuteUnit): boolean {
  return part.sources.some((s) => s.coveredChunkIds.includes(u.chunkId) || (isStatute(s) && s.sourceId === u.sourceId && unitNo(s) === u.number));
}

const STOP = new Set(['that', 'with', 'this', 'which', 'shall', 'from', 'have', 'under', 'such', 'where', 'their', 'there', 'what', 'when', 'does', 'been', 'being', 'into', 'upon', 'other', 'than', 'only', 'also', 'were', 'will', 'would', 'section', 'said', 'made']);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** How many distinctive words a text shares with a part's title and questions. */
export function overlap(text: string, part: LecturePlan['parts'][number]): number {
  const a = words(text);
  return [...words(`${part.title} ${part.questions.join(' ')}`)].filter((w) => a.has(w)).length;
}

/** The teaching part (not the recap or bridge) a text fits best; ties go to the earlier part. */
export function bestPart(plan: LecturePlan, text: string, among?: number[]): number | null {
  let best: number | null = null;
  let score = -1;
  plan.parts.forEach((p, i) => {
    if (p.kind === 'recap' || p.kind === 'bridge') return;
    if (among && !among.includes(i)) return;
    const s = overlap(text, p);
    if (s > score) {
      best = i;
      score = s;
    }
  });
  return best;
}

/** The part where a source ranked highest (its main treatment), or null when no part has it. */
export function mainPart(parts: PartNotes[], sourceId: string): number | null {
  let best: number | null = null;
  let score = -Infinity;
  parts.forEach((p, i) => {
    for (const s of p.sources) {
      if (s.sourceId !== sourceId) continue;
      const v = s.standing?.score ?? s.rerankScore ?? 0;
      if (v > score) {
        best = i;
        score = v;
      }
    }
  });
  return best;
}

/**
 * Provisos, exceptions and explanations of every section in the notes (the topic's key sections first), each given
 * to one part that holds its section: the one whose questions it fits best, at most six per part.
 */
export function assignMustCover(plan: LecturePlan, parts: PartNotes[], units: StatuteUnit[]): MustCoverNote[] {
  const out: MustCoverNote[] = [];
  const perPart = new Map<number, number>();
  for (const u of units) {
    const holders = parts.map((p, i) => (hasUnit(p, u) ? i : -1)).filter((i) => i >= 0);
    for (const item of mustCoverParts(u.text, u.sourceType === 'constitution' ? 'constitution' : 'act', u.number)) {
      if (out.length >= MAX_MUST_COVER) return out;
      const key = `${u.actName}:${u.number}|${item.label}`;
      if (out.some((o) => o.key === key)) continue;
      const open = holders.filter((i) => (perPart.get(i) ?? 0) < MAX_MUST_PER_PART);
      // A recap or bridge holds a section only to recall it; the item goes to a teaching part when one holds it.
      const at = bestPart(plan, item.text, open) ?? (open[0] ?? null);
      if (at !== null) perPart.set(at, (perPart.get(at) ?? 0) + 1);
      out.push({ key, kind: item.kind, label: item.label, sourceId: u.sourceId, act: u.actName, number: u.number, partIndex: at });
    }
  }
  return out;
}

async function statuteMustCover(plan: LecturePlan, parts: PartNotes[], keyUnits: StatuteUnit[], tenant: TenantRunner): Promise<MustCoverNote[]> {
  const inNotes = await tenant((c) => statuteUnits(c, parts.flatMap((p) => p.sources.filter(isStatute).map((s) => s.chunkId))));
  const units = [...keyUnits, ...inNotes.filter((u) => !keyUnits.some((k) => k.chunkId === u.chunkId))];
  return assignMustCover(plan, parts, units);
}

function judgmentIds(parts: PartNotes[]): string[] {
  return [...new Set(parts.flatMap((p) => p.sources.filter((s) => !isStatute(s)).map((s) => s.sourceId)))];
}

/** For each part: the cases it shares with another part that teaches them in full (their main part). */
export function elsewhere(plan: LecturePlan, parts: PartNotes[], title: (sourceId: string) => string | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const id of judgmentIds(parts)) {
    const holders = parts.map((p, i) => (p.sources.some((s) => s.sourceId === id) ? i : -1)).filter((i) => i >= 0);
    if (holders.length < 2) continue;
    const main = mainPart(parts, id)!;
    const name = title(id) ?? parts[main]!.sources.find((s) => s.sourceId === id)!.header.split(' › ')[0]!;
    for (const i of holders) if (i !== main) (out[String(i)] ??= []).push(`${name}: taught in full in Part ${main + 1} (${plan.parts[main]!.title})`);
  }
  return out;
}

const sameQuestion = (a: string, b: string) => normaliseForSpan(a).toLowerCase() === normaliseForSpan(b).toLowerCase();

/** The gap checker's task: the outline (clean), and the labels of what was found, fenced as library data. */
export function gapTask(input: Pick<ResearchInput, 'plan' | 'topic' | 'level'>, parts: PartNotes[], mustCover: MustCoverNote[], asked: LectureResearch['gaps'], title: (sourceId: string) => string | null): string {
  const boundary = randomBytes(6).toString('hex');
  const outline = input.plan.parts.map((p, i) => [`Part ${i + 1}: ${p.title} (${p.kind}, ${p.minutes} min)`, ...p.questions.map((q) => `  - ${q}`)].join('\n')).join('\n');
  const found = parts
    .map((p, i) => `Part ${i + 1}: ${p.sources.length ? p.sources.map((s) => `${sourceLabel(s, title(s.sourceId))}${s.meta.paraRole ? ` [${s.meta.paraRole}]` : ''}`).join('; ') : 'nothing found'}`)
    .join('\n');
  const must = mustCover.length ? mustCover.map((m) => `- ${m.label}: ${m.partIndex === null ? 'NOT FOUND in any part' : `in Part ${m.partIndex + 1}`}`).join('\n') : '(none)';
  const prev = asked.length ? asked.map((g) => `- Part ${g.partIndex + 1}: ${g.question} (${g.added ? `${g.added} new source(s)` : 'nothing new'})`).join('\n') : '(none)';
  return [
    `TOPIC: ${input.topic}`,
    `LEVEL: ${input.level}`,
    `OUTLINE:\n${outline}`,
    fence('research', `FOUND FOR EACH PART:\n${found}\n\nMUST-COVER:\n${must}\n\nQUESTIONS ALREADY SEARCHED:\n${prev}`, boundary),
    'Return the gaps as "questions", with part numbers as in the OUTLINE, or an empty list when the research is enough.',
  ].join('\n\n');
}
