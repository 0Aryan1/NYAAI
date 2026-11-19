/**
 * Statute and Constitution splitter (LLD §6.3). Pure: cleaned lines in, legal-structure chunks out.
 *
 * - A section (or Article) is the unit. Sub-sections and clauses stay inside it.
 * - Provisos attach to the unit above them; explanations, illustrations and exceptions attach to their
 *   section (or to one sub-section when their text says "this sub-section"). None is ever stored alone;
 *   one that appears before any section throws OrphanAttachmentError, failing ingestion for that source.
 * - Size rule: a section of about MAX_TOKENS or fewer is one chunk. A longer one is a parent chunk (whole
 *   text) plus children split only at sub-section boundaries; each child repeats the section's intro and
 *   carries every whole-section attachment.
 * - Amendment footnotes become metadata (amending Act, w.e.f. date), never chunk text. Footnote markers in
 *   the text ("1[or co-operative societies]") lose their number but keep the brackets, as printed law does.
 * - Never splits by character count.
 */
import { STATUTE_PATTERNS as P } from './patterns.ts';
import type { Line } from './clean.ts';

export const MAX_TOKENS = 1500;

export type AttachmentKind = 'proviso' | 'explanation' | 'illustration' | 'exception';

export interface Amendment {
  marker: string;
  note: string;
  amendingAct: string | null;
  /** ISO date the change took effect, when the footnote gives one. */
  wef: string | null;
}

export interface StatuteChunk {
  seq: number;
  /** Stable key within the act: 's56', 'a19', 'a19(2)'. */
  key: string;
  parentKey: string | null;
  kind: 'section' | 'article' | 'subsection';
  number: string;
  subNumber: string | null;
  title: string;
  chapter: string | null;
  header: string;
  text: string;
  pageNo: number | null;
  attachments: AttachmentKind[];
  amendments: Amendment[];
  lawStatus: 'in_force' | 'repealed';
  validFrom: string | null;
}

export interface StatuteOptions {
  /** 'Indian Contract Act' or 'Constitution of India'. */
  actName: string;
  actYear?: number;
  kind: 'act' | 'constitution';
  maxTokens?: number;
}

export class OrphanAttachmentError extends Error {
  constructor(
    public readonly marker: AttachmentKind,
    public readonly pageNo: number | null,
    public readonly line: string,
  ) {
    super(`A ${marker} appears before any section (page ${pageNo ?? '?'}): "${line.slice(0, 80)}"`);
    this.name = 'OrphanAttachmentError';
  }
}

interface UnitLine {
  text: string;
  pageNo: number | null;
  /** Sub-section this line belongs to; null = section intro or whole-section text. */
  sub: string | null;
  attach: AttachmentKind | null;
  /** 'section' = applies to the whole section (copied into every child). */
  scope: 'sub' | 'section';
}

interface Unit {
  number: string;
  title: string;
  chapter: string | null;
  lines: UnitLine[];
  subs: string[];
  repealed: boolean;
}

interface Footnote {
  marker: string;
  pageNo: number | null;
  note: string;
}

const SEPARATOR = /^\s*[_\u2014\u2013-]{5,}\s*$/;
/** Looks like the start of a section heading whose ".—" may be on the next line. */
const LOOSE_SECTION = /^\s*(\d+[A-Z]{0,3})\.\s*[^\d\s]/;
/** "120. [Effect of wrongful refusal to accept.] Rep. by s. 65, ibid.": a repealed section kept as a one-liner. */
const REPEALED_SECTION = /^\s*(\d+[A-Z]{0,3})\.\s*\[([^\]]{2,300})\]\.?\s*(.*\b(?:Rep\.\s*by|Omitted\s+by|Repealed\s+by).*)$/;
/** A superscript marker glued after a word: "becomes impossible or unlawful.1" (marker 1). */
const GLUED_MARKER = /([A-Za-z\]][.;:,)])(\d{1,2})(?=\s|$)/g;
/** Footnote numbers restart on every page, so they stay small. */
const MAX_FOOTNOTE = 30;
/** Start of a table of contents: "ARRANGEMENT OF SECTIONS", or a "Contents" line in the Constitution. */
const CONTENTS_HEADING = /^\s*(?:ARRANGEMENT\s+OF\s+(?:SECTIONS|ARTICLES|RULES)\b.*|CONTENTS)\s*$/i;
/** "THE FIRST SCHEDULE", "THE SCHEDULE", "APPENDIX I": the sections are over. */
const SCHEDULE_HEADING = /^\s*(?:THE\s+)?(?:(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)\s+)?SCHEDULE\s*$|^\s*APPENDIX(?:\s+[IVX]+)?\s*$/;
const FOOTNOTE_START = /^\s*(\d{1,2})\.\s+(\S.*)$/;
const LEADING_MARKERS = /^\s*(?:\d{1,3}\[)+/;
const MARKER = /(?:^|[\s(\u2014\u2013-])(\d{1,3})(?=\[|\*\s*\*)/g;
const WEF = /w\.e\.f\.\s*(\d{1,2})[-./](\d{1,2})[-./](\d{4})/;
const AMENDING_ACT = /\bby\s+(?:the\s+)?((?:Constitution\s+\([^)]+\)\s+Act,?\s*\d{4})|(?:Act\s+\d+\s+of\s+\d{4})|(?:[A-Z][A-Za-z()\s,]*?Act,?\s*\d{4}))/;

const words = (s: string) => s.trim().split(/\s+/).length;
const sentenceCase = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

function sectionOrder(num: string): [number, string] {
  const m = /^(\d+)([A-Z]*)$/.exec(num);
  return m ? [Number(m[1]), m[2] ?? ''] : [Number.NaN, ''];
}

/** Section numbers only move forward (15 → 15A → 16); a smaller number is a footnote or a schedule item. */
function isNextSection(prev: string | null, num: string): boolean {
  if (prev === null) return true;
  const [pn, ps] = sectionOrder(prev);
  const [n, s] = sectionOrder(num);
  return n > pn || (n === pn && s > ps);
}

function isHeadingLike(text: string): boolean {
  const t = text.trim();
  return /^[A-Z]/.test(t) && words(t) <= 10 && !/[.;:,\u2014\u2013)-]$/.test(t) && !/^\(/.test(t);
}

function attachmentOf(probe: string): AttachmentKind | null {
  if (P.proviso.test(probe)) return 'proviso';
  if (P.explanation.test(probe)) return 'explanation';
  if (P.illustration.test(probe)) return 'illustration';
  if (P.exception.test(probe)) return 'exception';
  return null;
}

/** Display text: footnote numbers dropped, brackets kept ("unions 1[or" → "unions [or"). */
function displayText(raw: string): string {
  return raw
    .replace(MARKER, (m, _n, offset: number) => (offset === 0 && /^\d/.test(m) ? '' : m.charAt(0)))
    .replace(GLUED_MARKER, '$1')
    .trimEnd();
}

function markersIn(raw: string): string[] {
  return [...[...raw.matchAll(MARKER)].map((m) => m[1]!), ...[...raw.matchAll(GLUED_MARKER)].map((m) => m[2]!)];
}

function parseAmendment(f: Footnote): Amendment {
  const wef = WEF.exec(f.note);
  const act = AMENDING_ACT.exec(f.note);
  return {
    marker: f.marker,
    note: f.note.trim(),
    amendingAct: act?.[1]?.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim() ?? null,
    wef: wef ? `${wef[3]}-${wef[2]!.padStart(2, '0')}-${wef[1]!.padStart(2, '0')}` : null,
  };
}

interface MarkedLine extends Line {
  /** Footnote markers that sat on a line of their own just before this one. */
  strayMarkers?: string[];
}

/**
 * A superscript footnote marker sometimes comes out of a PDF as a line of its own ("1" then "[16. ...").
 * Before "[" or "*" it rejoins the next line ("1[16. ..."); before a lone punctuation mark it joins the line
 * above; otherwise (e.g. before "151. Care to be taken ...") it is remembered as a marker of the next line.
 */
function absorbStrayMarkers(lines: Line[]): MarkedLine[] {
  const out: MarkedLine[] = [];
  let pending: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1];
    const digit = /^\s*(\d{1,3})\s*$/.exec(line.text)?.[1];
    if (digit && next && next.pageNo === line.pageNo) {
      if (/^\s*[[*]/.test(next.text)) {
        out.push({ pageNo: next.pageNo, text: `${digit}${next.text.trimStart()}`, strayMarkers: pending.length ? pending : undefined });
        pending = [];
        i++;
        continue;
      }
      const prev = out[out.length - 1];
      if (/^\s*[.,;:]\s*$/.test(next.text) && prev) {
        prev.text += next.text.trim();
        prev.strayMarkers = [...(prev.strayMarkers ?? []), digit];
        i++;
        continue;
      }
      pending.push(digit);
      continue;
    }
    out.push(pending.length ? { ...line, strayMarkers: pending } : line);
    pending = [];
  }
  return out;
}

export function splitStatute(input: Line[] | string, opts: StatuteOptions): StatuteChunk[] {
  const lines: MarkedLine[] = absorbStrayMarkers(
    typeof input === 'string' ? input.split(/\r?\n/).filter((t) => t.trim()).map((text) => ({ pageNo: 0, text })) : input,
  );
  const isConst = opts.kind === 'constitution';
  const maxTokens = opts.maxTokens ?? MAX_TOKENS;

  const units: Unit[] = [];
  const footnotes: Footnote[] = [];
  const markerHome = new Map<string, Unit>(); // `${page}:${marker}` → unit
  // Context header: a Part and/or a Chapter inside it ("Part V: The Union › Chapter I: The executive").
  let partLabel: string | null = null;
  let chapterLabel: string | null = null;
  let chapter: string | null = null;
  let pendingChapter: { kind: 'Part' | 'Chapter'; label: string } | null = null; // waiting for its title line
  const setContext = (kind: 'Part' | 'Chapter', rawLabel: string) => {
    // Footnote markers and amendment brackets are not part of a heading: "The states 1***", "[The union territories]".
    const label = rawLabel.replace(/\s*\d{0,3}\*+(\s*\*)*/g, '').replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (kind === 'Part') {
      partLabel = label;
      chapterLabel = null;
    } else chapterLabel = label;
    chapter = [partLabel, chapterLabel].filter(Boolean).join(' › ') || null;
  };
  let footnotePage: number | null = null;
  let lastSection: string | null = null;

  const current = () => units[units.length - 1];

  const stripLead = (t: string) =>
    t
      .replace(LEADING_MARKERS, '')
      .replace(/^\s*\[/, '')
      .replace(/^(\s*\d+[A-Z]{0,3}\.\s*)\d{1,3}(?=\[)/, '$1'); // "368. 1[Power of Parliament ..." 
  // "ARRANGEMENT OF SECTIONS" (the table of contents) lists every heading without its ".—"; skip it until the
  // first line that is a full section heading on its own, so contents entries never become sections.
  let inContents = false;

  for (let i = 0; i < lines.length; i++) {
    const { pageNo, strayMarkers } = lines[i]!;
    let raw = lines[i]!.text;
    // Footnotes run from the first footnote (or separator rule) to the end of the page.
    if (footnotePage !== null && pageNo !== footnotePage) footnotePage = null;
    if (SEPARATOR.test(raw)) {
      footnotePage = pageNo;
      continue;
    }
    let probe = stripLead(raw);
    if (CONTENTS_HEADING.test(probe)) {
      inContents = true;
      continue;
    }
    if (inContents) {
      // The body starts at the first full heading of section or Article 1; contents entries can look like
      // headings ("[31. Compulsory acquisition of property —Omitted.]"), so any other number is still contents.
      const first = P.section.exec(probe);
      if (!first || first[1] !== '1') {
        // Keep following Part/Chapter headings, so the one printed just before section 1 is not lost.
        const c = P.chapter.exec(probe);
        if (c) {
          const kind = c[1] === 'PART' ? ('Part' as const) : ('Chapter' as const);
          const rest = c[3]?.replace(/^[\s.\u2014\u2013-]+/, '').trim();
          setContext(kind, rest ? `${kind} ${c[2]}: ${sentenceCase(rest)}` : `${kind} ${c[2]}`);
          pendingChapter = rest ? null : { kind, label: `${kind} ${c[2]}` };
        } else if (pendingChapter && isHeadingLike(probe.replace(/[.,;:\]]$/, ''))) {
          setContext(pendingChapter.kind, `${pendingChapter.label}: ${sentenceCase(probe.replace(/[.]$/, ''))}`);
          pendingChapter = null;
        } else pendingChapter = null;
        continue;
      }
      inContents = false;
    }
    // Schedules and appendices follow the last section; they are not sections and get their own chunking later.
    if (units.length > 0 && SCHEDULE_HEADING.test(probe)) break;
    let section: string[] | null = P.section.exec(probe);
    let repealedLine = false;

    // A heading that wraps: "25. Agreement without consideration, ... registered, or is a promise" + next line.
    const loose = LOOSE_SECTION.exec(probe);
    if (!section && loose && isNextSection(lastSection, loose[1]!)) {
      let joined = raw;
      for (let k = 1; k <= 3 && i + k < lines.length; k++) {
        const nextText = lines[i + k]!.text;
        const nextProbe = stripLead(nextText);
        if (LOOSE_SECTION.test(nextProbe) || P.chapter.test(nextProbe) || attachmentOf(nextProbe) || SEPARATOR.test(nextText)) break;
        joined = `${joined.trimEnd()} ${nextText.trim()}`;
        const m = P.section.exec(stripLead(joined)) ?? (REPEALED_SECTION.test(stripLead(joined)) ? null : undefined);
        if (m === null) {
          // a repealed one-liner whose bracketed title wrapped: handled by REPEALED_SECTION below
          raw = joined;
          probe = stripLead(joined);
          i += k;
          break;
        }
        if (m) {
          raw = joined;
          probe = stripLead(joined);
          section = m;
          i += k;
          break;
        }
      }
    }
    if (!section) {
      const r = REPEALED_SECTION.exec(probe);
      if (r) {
        section = [r[0], r[1]!, r[2]!.replace(/\.$/, ''), r[3]!];
        repealedLine = true;
      }
    }
    const startsSection = section !== null && isNextSection(lastSection, section[1]!);

    if (!startsSection) {
      const amend = P.amendment.exec(raw);
      if (amend && Number(amend[1]) <= MAX_FOOTNOTE) {
        footnotes.push({ marker: amend[1]!, pageNo, note: amend[2]! });
        footnotePage = pageNo;
        continue;
      }
      if (footnotePage !== null) {
        const start = FOOTNOTE_START.exec(raw);
        if (start && Number(start[1]) <= MAX_FOOTNOTE) footnotes.push({ marker: start[1]!, pageNo, note: start[2]! });
        else {
          const last = footnotes[footnotes.length - 1];
          if (last) last.note += ` ${raw.trim()}`;
        }
        continue;
      }
    }

    const chap = P.chapter.exec(probe);
    if (chap && !startsSection) {
      const kind = chap[1] === 'PART' ? ('Part' as const) : ('Chapter' as const);
      const label = `${kind} ${chap[2]}`;
      let rest = chap[3]?.replace(/^[\s.\u2014\u2013-]+/, '').trim();
      // "[CHAPTER VII.—SALES OF GOODS.] Rep. by the Indian Sale of Goods Act, 1930": keep the name, mark it repealed.
      const repealedChapter = rest ? /\]\s*(Rep\.|Omitted|Repealed)/.test(rest) : false;
      if (rest && repealedChapter) rest = `${rest.split(']')[0]!.replace(/[[\].]/g, '').trim()} (repealed)`;
      setContext(kind, rest ? `${label}: ${sentenceCase(rest.replace(/ \(repealed\)$/, ''))}${repealedChapter ? ' (repealed)' : ''}` : label);
      pendingChapter = rest ? null : { kind, label };
      continue;
    }
    if (pendingChapter && !startsSection && !attachmentOf(probe) && isHeadingLike(probe.replace(/[.,;:]$/, ''))) {
      setContext(pendingChapter.kind, `${pendingChapter.label}: ${sentenceCase(probe.replace(/[.]$/, ''))}`);
      pendingChapter = null;
      continue;
    }
    pendingChapter = null;

    if (startsSection && section) {
      // A short heading line just before this section ("Right to Freedom") is context, not law text.
      const prev = current();
      const tail = prev?.lines[prev.lines.length - 1];
      if (prev && tail && prev.lines.length > 1 && tail.attach === null && isHeadingLike(tail.text)) prev.lines.pop();

      const body = section[3] ?? '';
      const firstSub = P.subSection.exec(body)?.[1] ?? null;
      const unit: Unit = {
        number: section[1]!,
        title: section[2]!.trim().replace(/^\[(.*?)\.?\]?$/, '$1').replace(/\.$/, ''), // "[Power of Parliament ...]" → plain title
        chapter,
        lines: [{ text: displayText(raw), pageNo, sub: firstSub, attach: null, scope: 'sub' }],
        subs: firstSub ? [firstSub] : [],
        repealed: repealedLine || /^\s*\[?\s*(Omitted|Rep\.|Repealed)\b/i.test(body),
      };
      units.push(unit);
      lastSection = unit.number;
      footnotePage = null; // a new section ends the footnote block on this page
      for (const m of [...markersIn(raw), ...(strayMarkers ?? [])]) markerHome.set(`${pageNo}:${m}`, unit);
      continue;
    }

    const unit = current();
    const attach = attachmentOf(probe);
    if (!unit) {
      if (attach) throw new OrphanAttachmentError(attach, pageNo, raw);
      continue; // front matter: long title, preamble, enactment formula
    }
    for (const m of [...markersIn(raw), ...(strayMarkers ?? [])]) markerHome.set(`${pageNo}:${m}`, unit);

    const prevLine = unit.lines[unit.lines.length - 1]!;
    const sub = P.subSection.exec(probe);
    let line: UnitLine;
    if (sub && !P.clause.test(probe) && prevLine.attach !== 'illustration') {
      if (!unit.subs.includes(sub[1]!)) unit.subs.push(sub[1]!);
      line = { text: displayText(raw), pageNo, sub: sub[1]!, attach: null, scope: 'sub' };
    } else if (attach) {
      const currentSub = prevLine.sub;
      const subOnly =
        attach === 'proviso' ? currentSub !== null : /\bthis\s+sub-section\b|\bsub-section\s*\(/i.test(probe) && currentSub !== null;
      line = { text: displayText(raw), pageNo, sub: subOnly ? currentSub : null, attach, scope: subOnly ? 'sub' : 'section' };
    } else {
      line = { ...prevLine, text: displayText(raw), pageNo };
    }
    unit.lines.push(line);
  }

  // Attach each footnote to the unit that carries its marker on the same page.
  const amendmentsByUnit = new Map<Unit, Amendment[]>();
  let previous: Amendment | null = null;
  for (const f of footnotes) {
    const parsed = parseAmendment(f);
    // "omitted by s. 2, ibid." refers to the Act named in the footnote before it.
    if (!parsed.amendingAct && /\bibid\b/i.test(f.note) && previous) parsed.amendingAct = previous.amendingAct;
    previous = parsed;
    const home = markerHome.get(`${f.pageNo}:${f.marker}`);
    if (!home) continue;
    const list = amendmentsByUnit.get(home) ?? [];
    list.push(parsed);
    amendmentsByUnit.set(home, list);
  }

  const out: StatuteChunk[] = [];
  const ref = (n: string) => (isConst ? `Art. ${n}` : `s. ${n}`);
  const keyOf = (n: string) => `${isConst ? 'a' : 's'}${n}`;
  const actLabel = opts.actYear ? `${opts.actName}, ${opts.actYear}` : opts.actName;

  for (const unit of units) {
    const base = [actLabel, unit.chapter, `${ref(unit.number)} ${unit.title}`].filter(Boolean).join(' › ');
    const amendments = amendmentsByUnit.get(unit) ?? [];
    const validFrom = amendments.map((a) => a.wef).filter((d): d is string => !!d).sort().pop() ?? null;
    const kinds = (ls: UnitLine[]) => [...new Set(ls.map((l) => l.attach).filter((a): a is AttachmentKind => !!a))];
    const text = unit.lines.map((l) => l.text).join('\n');
    const common = {
      number: unit.number,
      title: unit.title,
      chapter: unit.chapter,
      amendments,
      lawStatus: unit.repealed ? ('repealed' as const) : ('in_force' as const),
      validFrom,
    };
    const parent: StatuteChunk = {
      ...common,
      seq: out.length + 1,
      key: keyOf(unit.number),
      parentKey: null,
      kind: isConst ? 'article' : 'section',
      subNumber: null,
      header: base,
      text,
      pageNo: unit.lines[0]?.pageNo ?? null,
      attachments: kinds(unit.lines),
    };
    out.push(parent);
    if (Math.ceil(text.length / 4) <= maxTokens || unit.subs.length < 2) continue;

    const intro = unit.lines.filter((l) => l.sub === null && l.scope === 'sub');
    const wholeSection = unit.lines.filter((l) => l.scope === 'section');
    for (const sub of unit.subs) {
      const own = unit.lines.filter((l) => l.sub === sub);
      const childLines = [...intro, ...own, ...wholeSection];
      out.push({
        ...common,
        seq: out.length + 1,
        key: `${keyOf(unit.number)}(${sub})`,
        parentKey: parent.key,
        kind: 'subsection',
        subNumber: sub,
        header: `${base} › ${isConst ? 'cl.' : 'sub-s.'} (${sub})`,
        text: childLines.map((l) => l.text).join('\n'),
        pageNo: own[0]?.pageNo ?? parent.pageNo,
        attachments: kinds(childLines),
      });
    }
  }
  return out;
}
