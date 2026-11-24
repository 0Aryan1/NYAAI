/**
 * A course plan from a syllabus (BRD COURSE-2), read by code, not by a model: units ("Unit I: Arbitration
 * agreement", a heading) and the topics under them (numbered or bulleted lines, or a "topic; topic; topic" line).
 * Reading lists, marks, objectives and case lists are left out. The teacher always sees the result and edits it
 * before the course is made, so a syllabus laid out in an unusual way costs her a minute, never a wrong plan.
 */
import type { NoteBlock } from './notes.ts';
import type { PdfLines } from './pdf-judgment.ts';

export interface SyllabusUnit {
  title: string;
  topics: string[];
}

export interface SyllabusOutline {
  /** The document's title, when it reads like a course name. */
  courseName: string | null;
  units: SyllabusUnit[];
}

const MAX_LECTURES = 80;
const UNIT = /^(?:unit|module|part|chapter|week|topic|lecture|class|session)\s*[-–—:.]?\s*(?:[ivxlc]+|\d{1,2}|[a-h])\b\s*[-–—:.)]*\s*(.*)$/i;
const ITEM = /^(?:[-*•▪◦●○■□➢✓]|\(?\d{1,2}(?:\.\d{1,2})*[.)]|\(?[a-h][.)]|\(?(?:i{1,3}|iv|vi{0,3}|ix|x)[.)])\s+(.+)$/i;
/** Sections of a syllabus that are not lectures: everything after one, up to the next unit, is left out. */
const NOT_LECTURES =
  /^(?:(?:suggested|recommended|prescribed|essential|further|additional)\s+)?(?:readings?|reading list|books?|text\s*books?|references?|bibliography|materials?|evaluation|assessment|marks|marking|grading|course (?:objectives?|outcomes?|description|overview)|objectives?|learning outcomes?|outcomes?|teaching (?:method|methodology|plan)|pedagogy|methodology|credits?|attendance|instructions?|note)\b/i;
const CASE_LINE = /\s(?:v\.?|vs\.?|versus)\s/i;
const NOISE = /^(?:syllabus|course outline|course plan|course content|contents?|session plan|lecture plan|topics?)\s*:?$/i;

const tidy = (t: string) =>
  t
    .replace(/\s+/g, ' ')
    .replace(/^[\s:–—-]+|[\s:;,.–—-]+$/g, '')
    .trim();
const usable = (t: string) => t.length >= 3 && t.length <= 200 && /[a-z]/i.test(t) && !CASE_LINE.test(t) && !NOISE.test(t);

/** A line of several short topics ("Meaning; kinds; essentials") is split; a sentence is kept whole. */
function splitTopics(line: string): string[] {
  const bySemi = line.split(/\s*;\s*/).map(tidy).filter(Boolean);
  if (bySemi.length > 1) return bySemi;
  const byComma = line.split(/\s*,\s*/).map(tidy).filter(Boolean);
  if (byComma.length >= 3 && byComma.every((p) => p.split(' ').length <= 8)) return byComma;
  return [tidy(line)];
}

/** Plain text or Markdown, line by line (a syllabus is a list: lines are not joined into paragraphs). */
export function syllabusLines(text: string): NoteBlock[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const md = /^(#{1,6})\s+(.+)$/.exec(l);
      return md ? { text: md[2]!, heading: md[1]!.length } : { text: l, heading: null };
    });
}

/**
 * A PDF, line by line: a line set clearly larger than the body is a heading. A line that carries on the one before
 * (starts in lower case, no list mark) is joined to it, so a topic wrapped over two lines stays one topic.
 */
export function syllabusPdfLines(doc: PdfLines): NoteBlock[] {
  const out: NoteBlock[] = [];
  const body = doc.bodySize || 11;
  for (const page of doc.pages) {
    for (const line of page.lines) {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (!text || /^\d{1,4}$/.test(text)) continue;
      const prev = out.at(-1);
      if (prev && prev.heading === null && /^[a-z(]/.test(text) && !ITEM.test(text)) {
        prev.text = `${prev.text} ${text}`;
        continue;
      }
      out.push({ text, heading: line.size >= body * 1.15 ? 1 : null });
    }
  }
  return out;
}

export function readSyllabus(blocks: NoteBlock[]): SyllabusOutline {
  const units: SyllabusUnit[] = [];
  let courseName: string | null = null;
  let current: SyllabusUnit | null = null;
  let skipping = false;
  let awaitingTitle = false;
  const loose: string[] = [];

  const addTopic = (t: string) => {
    for (const topic of splitTopics(t)) {
      if (!usable(topic)) continue;
      if (current) current.topics.push(topic);
      else loose.push(topic);
    }
  };

  for (const b of blocks) {
    const text = tidy(b.text);
    if (!text) continue;
    const unit = UNIT.exec(text);
    if (unit) {
      skipping = false;
      const rest = tidy(unit[1] ?? '');
      current = { title: rest, topics: [] };
      units.push(current);
      awaitingTitle = !rest;
      if (rest && /[;,]/.test(rest) && rest.split(/[;,]/).length >= 3) {
        // "Unit II: Meaning, kinds, essentials, validity" — the first piece names the unit, the rest are topics.
        const [head, ...more] = splitTopics(rest);
        current.title = head!;
        for (const m of more) addTopic(m);
      }
      continue;
    }
    if (NOT_LECTURES.test(text)) {
      skipping = true;
      continue;
    }
    if (skipping) continue;
    if (awaitingTitle && current) {
      current.title = text;
      awaitingTitle = false;
      continue;
    }
    if (b.heading !== null) {
      // The first heading before any unit is the course's name; later headings start a unit.
      if (!units.length && !courseName && !loose.length) {
        if (usable(text)) courseName = text;
        continue;
      }
      if (!usable(text)) continue;
      current = { title: text, topics: [] };
      units.push(current);
      continue;
    }
    const item = ITEM.exec(text);
    if (item) addTopic(item[1]!);
    else if (current && text.split(' ').length <= 40) addTopic(text);
    else if (!current && text.split(' ').length <= 15) addTopic(text);
  }

  const kept = units.filter((u) => usable(u.title) || u.topics.length).map((u) => ({ title: usable(u.title) ? u.title : (u.topics[0] ?? ''), topics: u.topics }));
  // A syllabus with no units: its list is the plan, one lecture per line.
  if (!kept.length && loose.length) return { courseName, units: loose.map((t) => ({ title: t, topics: [] })) };
  return { courseName, units: kept };
}

/** One lecture per unit, or one per topic (a unit with no topics is one lecture either way). */
export function syllabusLectures(outline: SyllabusOutline, per: 'unit' | 'topic'): string[] {
  const out = per === 'unit' ? outline.units.map((u) => u.title) : outline.units.flatMap((u) => (u.topics.length ? u.topics : [u.title]));
  return [...new Set(out.map(tidy).filter((t) => t.length >= 2))].slice(0, MAX_LECTURES);
}

/** The likelier plan: one per topic when the topics fit the term (40 or fewer, or the class count), else per unit. */
export function defaultPer(outline: SyllabusOutline, classCount: number | null = null): 'unit' | 'topic' {
  const topics = syllabusLectures(outline, 'topic').length;
  const units = outline.units.length;
  if (topics === units) return 'unit';
  return topics <= (classCount ?? 40) ? 'topic' : 'unit';
}
