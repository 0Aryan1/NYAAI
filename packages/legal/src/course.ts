/**
 * Course series (BRD COURSE-4 to COURSE-7, HLD F8), pure. Course memory is what the class has been taught, kept per
 * lecture in the plan when the teacher marks it taught: a short summary, terms, cases, the running example and open
 * threads. A new lecture reads the memory of the lectures before it (recap, no repeats, a bridge to the next one),
 * and the series checks turn the plan into suggestions. Nothing here changes the plan: suggestions only (COURSE-6).
 *
 * Course memory is context for continuity, never a source of law: a recap line that states law still needs a
 * source and passes the checks like any other line.
 */

export interface CourseCase {
  sourceId: string;
  /** "Satyabrata Ghose v. Mugneeram Bangur" */
  name: string;
}

/** `course_units.memory`, written when the lecture is marked taught (COURSE-7). */
export interface UnitMemory {
  summary?: string;
  terms?: string[];
  cases?: CourseCase[];
  runningExample?: string | null;
  openThreads?: string[];
  /** The taught lecture the memory was made from. */
  lectureId?: string;
  updatedAt?: string;
}

export interface CourseUnit {
  id: string;
  position: number;
  title: string;
  status: 'planned' | 'taught' | 'skipped';
  taughtOn: string | null;
  prerequisites: string[];
  memory: UnitMemory;
}

export interface CourseContext {
  /** The last two taught lectures before this one, in plan order. */
  earlier: { position: number; title: string; taughtOn: string | null; summary: string }[];
  /** Terms the class already knows, oldest first, without repeats. */
  terms: string[];
  /** Cases already taught, with the lecture that used them. */
  cases: (CourseCase & { position: number })[];
  runningExample: string | null;
  openThreads: string[];
  /** The next lecture in the plan, for the bridge. */
  next: { position: number; title: string } | null;
  /** Lectures before this one in the plan that are not taught yet (HOME-10: the recap must not assume them). */
  untaughtEarlier: { position: number; title: string }[];
  /** Prerequisites of this lecture not marked taught (HOME-10 warning). */
  untaughtPrerequisites: { position: number; title: string }[];
}

const MAX_TERMS = 40;
const MAX_CASES = 30;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function uniqueBy<T>(items: T[], k: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const x = k(t);
    if (!x || seen.has(x)) return false;
    seen.add(x);
    return true;
  });
}

/**
 * The course memory a lecture reads (HLD F8.2). `unitId` null (a lecture in the course with no planned slot) reads
 * every taught lecture and bridges to the first one still planned.
 */
export function courseContext(units: CourseUnit[], unitId: string | null): CourseContext {
  const sorted = [...units].sort((a, b) => a.position - b.position);
  const me = unitId ? sorted.find((u) => u.id === unitId) : undefined;
  const before = me ? sorted.filter((u) => u.position < me.position) : sorted;
  const taught = before.filter((u) => u.status === 'taught');
  const last = [...taught].reverse().find((u) => u.memory.runningExample);
  const after = me ? sorted.filter((u) => u.position > me.position) : sorted;
  const next = after.find((u) => u.status === 'planned');
  const recent = taught.slice(-2);
  return {
    earlier: recent.filter((u) => u.memory.summary).map((u) => ({ position: u.position, title: u.title, taughtOn: u.taughtOn, summary: u.memory.summary! })),
    terms: uniqueBy(taught.flatMap((u) => u.memory.terms ?? []), key).slice(-MAX_TERMS),
    cases: uniqueBy(
      taught.flatMap((u) => (u.memory.cases ?? []).map((c) => ({ ...c, position: u.position }))),
      (c) => c.sourceId,
    ).slice(-MAX_CASES),
    runningExample: last?.memory.runningExample ?? null,
    // Threads left open by the last two lectures (older ones were either picked up or are stale).
    openThreads: uniqueBy(recent.flatMap((u) => u.memory.openThreads ?? []), key),
    next: next ? { position: next.position, title: next.title } : null,
    untaughtEarlier: me ? before.filter((u) => u.status === 'planned').map((u) => ({ position: u.position, title: u.title })) : [],
    untaughtPrerequisites: me
      ? (me.prerequisites ?? [])
          .map((id) => sorted.find((u) => u.id === id))
          .filter((u): u is CourseUnit => !!u && u.status !== 'taught')
          .map((u) => ({ position: u.position, title: u.title }))
      : [],
  };
}

export const lectureNo = (position: number) => `L${String(position).padStart(2, '0')}`;

/** True when the lecture has something to recap. */
export const hasMemory = (ctx: CourseContext) => ctx.earlier.length > 0 || ctx.terms.length > 0 || ctx.cases.length > 0;

/** Course memory as plain text for the planner and the writer (passed inside a fenced, untrusted block). */
export function courseMemoryText(ctx: CourseContext): string {
  const lines: string[] = [];
  for (const e of ctx.earlier) lines.push(`${lectureNo(e.position)} ${e.title}${e.taughtOn ? ` (taught ${e.taughtOn})` : ''}: ${e.summary}`);
  if (!ctx.earlier.length) lines.push('No lecture of this course has been marked taught yet.');
  if (ctx.terms.length) lines.push(`Terms the class already knows: ${ctx.terms.join('; ')}`);
  if (ctx.cases.length) lines.push(`Cases already taught: ${ctx.cases.map((c) => `${c.name} (${lectureNo(c.position)})`).join('; ')}`);
  if (ctx.runningExample) lines.push(`Running example used in class: ${ctx.runningExample}`);
  if (ctx.openThreads.length) lines.push(`Open threads (promised for a later class): ${ctx.openThreads.join('; ')}`);
  if (ctx.untaughtPrerequisites.length) lines.push(`This lecture builds on lectures not taught yet (do not assume the class knows them): ${ctx.untaughtPrerequisites.map((u) => `${lectureNo(u.position)} ${u.title}`).join('; ')}`);
  if (ctx.untaughtEarlier.length) lines.push(`Earlier lectures in the plan not taught yet (do not assume the class knows them): ${ctx.untaughtEarlier.map((u) => `${lectureNo(u.position)} ${u.title}`).join('; ')}`);
  lines.push(ctx.next ? `Next lecture in the plan: ${lectureNo(ctx.next.position)} ${ctx.next.title}` : 'This is the last planned lecture of the course.');
  return lines.join('\n');
}

/* ---------------------------------------------------------------------------------------------------------------
 * Series checks (COURSE-6, HLD F8.4): suggestions only.
 * ------------------------------------------------------------------------------------------------------------- */

export type SeriesCheckKind = 'repeated_case' | 'untaught_prerequisite' | 'out_of_order' | 'too_many_lectures';

export interface SeriesCheck {
  kind: SeriesCheckKind;
  /** The lecture in the plan the suggestion is about (null: the whole course). */
  unitId: string | null;
  message: string;
}

export interface SeriesUnit extends CourseUnit {
  /** Judgments the unit's current lecture teaches from (outside its recap); taught units also have memory.cases. */
  lectureCases?: CourseCase[];
  /** A lecture has been prepared for the unit. */
  hasLecture?: boolean;
}

export function seriesChecks(units: SeriesUnit[], classCount: number | null = null): SeriesCheck[] {
  const sorted = [...units].sort((a, b) => a.position - b.position);
  const out: SeriesCheck[] = [];
  const casesOf = (u: SeriesUnit) => uniqueBy([...(u.lectureCases ?? []), ...(u.memory.cases ?? [])], (c) => c.sourceId);

  for (const [i, u] of sorted.entries()) {
    if (u.status === 'skipped') continue;
    // A case taught again in a later lecture.
    for (const c of casesOf(u)) {
      const first = sorted.slice(0, i).find((v) => v.status !== 'skipped' && casesOf(v).some((x) => x.sourceId === c.sourceId));
      if (first) {
        out.push({
          kind: 'repeated_case',
          unitId: u.id,
          message: `${lectureNo(u.position)} teaches ${c.name}, which ${lectureNo(first.position)} (${first.title}) also uses. A short recap may be enough.`,
        });
      }
    }
    // Builds on a lecture not taught yet.
    if (u.status === 'taught' || u.hasLecture) {
      for (const p of u.prerequisites ?? []) {
        const pre = sorted.find((v) => v.id === p);
        if (pre && pre.status !== 'taught') {
          out.push({ kind: 'untaught_prerequisite', unitId: u.id, message: `${lectureNo(u.position)} builds on ${lectureNo(pre.position)} (${pre.title}), which is not marked taught yet.` });
        }
      }
    }
    // Taught ahead of earlier lectures still planned.
    if (u.status === 'taught') {
      const skipped = sorted.slice(0, i).filter((v) => v.status === 'planned');
      if (skipped.length) {
        out.push({
          kind: 'out_of_order',
          unitId: u.id,
          message: `${lectureNo(u.position)} was taught before ${skipped.map((v) => `${lectureNo(v.position)} (${v.title})`).join(', ')}. Move ${skipped.length === 1 ? 'it' : 'them'}, mark ${skipped.length === 1 ? 'it' : 'them'} skipped, or teach ${skipped.length === 1 ? 'it' : 'them'} next.`,
        });
      }
    }
  }
  const planned = sorted.filter((u) => u.status !== 'skipped').length;
  if (classCount && planned > classCount) {
    out.push({ kind: 'too_many_lectures', unitId: null, message: `The plan has ${planned} lectures for ${classCount} classes.` });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------
 * Course memory from a taught lecture (learn.summary): keep only what is on her slides (LLD §9, "only what is on
 * the slides").
 * ------------------------------------------------------------------------------------------------------------- */

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'under', 'which', 'when', 'where', 'over', 'their', 'there']);
const contentWords = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

/** A term is kept only if every word of it is on the slides (no new terms from the summariser). */
export function termsOnSlides(terms: string[], slideText: string): string[] {
  const have = new Set(contentWords(slideText));
  return uniqueBy(
    terms.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => {
      const w = contentWords(t);
      return w.length > 0 && w.every((x) => have.has(x));
    }),
    key,
  );
}

/** A running example is kept only when most of its words are on the slides. */
export function exampleOnSlides(example: string | null, slideText: string): string | null {
  if (!example?.trim()) return null;
  const have = new Set(contentWords(slideText));
  const w = contentWords(example);
  return w.length && w.filter((x) => have.has(x)).length / w.length >= 0.6 ? example.trim() : null;
}

/** Plan parts in teaching order: the recap first and the bridge last, whatever order they came in. */
export function orderParts<P extends { kind: string }>(parts: P[]): P[] {
  const rank = (p: P) => (p.kind === 'recap' ? 0 : p.kind === 'bridge' ? 2 : 1);
  return parts.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(({ p }) => p);
}
