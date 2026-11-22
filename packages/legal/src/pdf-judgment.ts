/**
 * Judgment PDF lines → JudgmentInput (pure). Reads the official Supreme Court Reports (e-SCR) and the Supreme Court's
 * own judgment PDFs, which a library editor may also upload. The splitter (judgment.ts) then numbers paragraphs,
 * finds opinions and labels roles, exactly as for Indian Kanoon.
 *
 * Taken out before paragraphs are built, page by page:
 * - running heads ("[2023] 15 S.C.R. 621 : 2023 INSC 1051", "SUPREME COURT REPORTS [2014] 13 S.C.R.", the case
 *   title repeated at the top or foot of a page), page numbers, the reporter's margin letters A–H;
 * - footnotes: superscript markers are already out of the text (`marks`), and the notes they point to (smaller
 *   type at the foot of the page, starting with a marked number) are dropped. The PDF keeps them;
 * - the editor's notes ("*Ed. Note: The pagination as per the original Judgment."), table-of-contents lines, and
 *   digital-signature stamps of the court's own PDFs.
 * Everything before the court's text (the reporter's headnotes, case details, counsel) becomes the headnote, which
 * can never support "held".
 */
import { repairSpacedWords } from './clean.ts';
import type { JudgmentBlock, JudgmentInput } from './judgment.ts';

export interface PdfLine {
  text: string;
  /** Font size most of the line is set in. */
  size: number;
  /** Left edge of the line's first character. */
  x: number;
  y: number;
  /** Superscript footnote markers taken out of the line. */
  marks: string[];
}

export interface PdfLines {
  pages: { pageNo: number; lines: PdfLine[] }[];
  /** Pictures of printed pages with a machine-read text layer: expect reading errors. */
  scanned: boolean;
  /** The document's body text size (the size most characters are set in). */
  bodySize: number;
}

export interface PdfJudgmentHint {
  caseName: string;
  decidedOn: string | null;
  court: string | null;
  citations?: string[];
  bench?: string[];
}

const SCR_HEAD = /^\[\d{4}\]\s*\d+\s*S\.\s?C\.\s?R\.?\s*(\d{1,5})?(?:\s*:\s*\d{4}\s*INSC\s*\d+)?$/i;
const SCR_RUNNING = /^(\d{1,5}\s+)?SUPREME\s+COURT\s+REPORTS\s*\[\d{4}\]\s*\d+\s*S\.\s?C\.\s?R\.?\s*(\d{1,5})?$/i;
const PAGE_NO = /^\d{1,5}$/;
const MARGIN = /^[A-H]$/;
const MARGIN_RUN = /^[A-Hc0](?:\s+[A-Hc0]){1,7}$/;
const JUNK = [
  /^\*?\s*Ed\.\s*Note\s*:\s*The pagination/i,
  /^Signature Not Verified$/i,
  /^Digitally signed by\b/i,
  /^Date:\s*\d{4}\.\d{2}\.\d{2}/i,
  /^\d{2}:\d{2}:\d{2}\s*IST$/i,
  /^Reason:\s*$/i,
  /^Page\s+\d+\s+of\s+\d+$/i,
  /^(?:NON-)?REPORTABLE$/i,
  /\.{4,}\s*\d{1,4}\s*$/, // table of contents
];
/** "The Judgment of the Court was delivered by", "The Judgment of S. K. Das and K. Subba Rao, JJ. was delivered by …". */
const DELIVERED =
  /\bJudgments?(?:\s+and\s+orders?)?\s+of\s+(?:the\s+Court|[A-Z][\s\S]{2,200}?)\s+(?:was|were)\s+delivered\b|\bJudgments?\s+(?:was|were)\s+delivered\b|\bdelivered\s+the\s+following\s+judgments?\b/i;
/** Where the court's own text starts. */
const BODY_MARKERS: { re: RegExp; skipLine: boolean }[] = [
  { re: /^JUDGMENT\s*\/\s*ORDER\s+OF\s+THE\s+SUPREME\s+COURT$/i, skipLine: true },
  // Kept in the body: the splitter reads who delivered the judgment from this sentence.
  { re: DELIVERED, skipLine: false },
  { re: /^J\s*U\s*D\s*G\s*M\s*E\s*N\s*T$|^O\s*R\s*D\s*E\s*R$/, skipLine: true },
];
const HEADING_AFTER_MARKER = /^(?:J\s*U\s*D\s*G\s*M\s*E\s*N\s*T|O\s*R\s*D\s*E\s*R)$/i;
/** The author's name repeated at the foot of each page: "[DR. DHANANJAYA Y CHANDRACHUD, CJI]". */
const AUTHOR_FOOTER = /^\[[A-Z][A-Za-z .,']{2,80},?\s*(?:CJI|C\.\s?J\.(?:I\.)?|JJ?\.)\]$/;
/** A table of contents (long judgments): from its heading to the court's first paragraph. */
const CONTENTS_HEADING = /^(?:Table\s+of\s+Contents|Index|Contents)\*?$/i;
const PARA_START = /^\(?\d{1,4}[.)](?:\s|$)/;
const ABBREV_END = /\b(?:v|vs|Ltd|Co|No|Nos|s|ss|Art|Arts|Mr|Mrs|Ms|Dr|Sr|Jr|Pvt|Corpn|Govt|Anr|Ors|Hon'ble|i\.e|e\.g|viz|p|pp|para|paras|Vol|cl|Sch)\.$/i;
const TERMINAL = /[.:;?!”"’)\]]$/;
/** Where the reporter's summary ends and case details or lists begin. */
const HEAD_END =
  /^(?:Case Law Cited|Case Law Reference|List of (?:Acts|Keywords|Citations)|Case Arising From|Appearances for Parties|(?:CIVIL|CRIMINAL) (?:APPELLATE|ORIGINAL) JURISDICTION|ORIGINAL JURISDICTION|EXTRAORDINARY (?:APPELLATE )?JURISDICTION)\b/i;
const MAX_HEADNOTE_CHARS = 12_000;

/** Cut a long text at the last sentence end before `max` characters. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf('. ');
  return `${cut.slice(0, end > max / 2 ? end + 1 : max).trim()} …`;
}

const words = (s: string) => s.toUpperCase().match(/[A-Z0-9&]+/g) ?? [];
const upperShare = (s: string) => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  return letters ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
};

/** The printed page number in a running head, or a lone number at the top or foot of the page. */
function printedPage(lines: PdfLine[]): number | null {
  const text = lines.map((l) => l.text.trim()).filter((t) => t && !MARGIN.test(t));
  const edge = [...text.slice(0, 3), ...text.slice(-2)];
  for (const t of edge) {
    const m = SCR_HEAD.exec(t) ?? SCR_RUNNING.exec(t);
    if (m) {
      const n = m[1] && /^\d+$/.test(m[1].trim()) ? m[1] : m[2];
      if (n) return Number(n.trim());
    }
    const run = /SUPREME\s+COURT\s+REPORTS\s*\[\d{4}\]\s*\d+\s*S\.\s?C\.\s?R\.?\s*(\d{1,5})$/i.exec(t);
    if (run) return Number(run[1]);
  }
  for (const t of edge) if (PAGE_NO.test(t)) return Number(t);
  return null;
}

/** Words a running title may shorten or add ("PVT. LTD.", "& ANR."), besides the case title's own words. */
const TITLE_EXTRAS = new Set(['V', 'VS', 'VERSUS', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'CO', 'CORPN', 'CORPORATION', 'ANR', 'ORS', 'M', 'S', 'AND', 'OF', 'THE', 'INC', 'LLP', 'JV', 'ETC', 'DR', '&']);

/**
 * A running title: mostly capitals and every word from the case title. e-SCR prints it at the top of odd pages, but
 * the PDF may draw it anywhere in the page's text order, so it is matched wherever it falls. The author's name in
 * brackets after it ("[R. F. NARIMAN, J.]") goes with it.
 */
function isRunningTitle(text: string, titleWords: Set<string>): boolean {
  const t = text.replace(/\s*\[[^\]]*,\s*(?:CJI|C\.\s?J\.(?:I\.)?|JJ?\.)\]\s*$/, '').replace(/\s*\d{1,5}\s*$/, '').trim();
  if (t.length < 4 || t.length > 140 || upperShare(t) < 0.8) return false;
  const ws = words(t).filter((w) => !/^\d+$/.test(w));
  if (ws.length < 2) return false;
  // Running heads shorten words ("SSANGYONG ENG. & CONST. CO. … AUTH. OF INDIA"): a word counts when it starts a
  // word of the title.
  const known = (w: string) => TITLE_EXTRAS.has(w) || titleWords.has(w) || (w.length >= 3 && [...titleWords].some((x) => x.startsWith(w)));
  const own = ws.filter((w) => !TITLE_EXTRAS.has(w) && known(w)).length;
  const share = ws.filter(known).length / ws.length;
  const versus = ws.some((w) => w === 'V' || w === 'VS' || w === 'VERSUS');
  return own > 0 && (share === 1 || (versus && share >= 0.6));
}

/** Lines that are not the text: running heads, page numbers, margin letters, editor's notes, signature stamps. */
function cleanPage(lines: PdfLine[], titleWords: Set<string>, bodySize: number, scanned: boolean, page: number | null): PdfLine[] {
  const marks = new Set(lines.flatMap((l) => l.marks).filter((m) => /^\d+$/.test(m)));
  const real = lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text && !MARGIN.test(l.text) && !(scanned && MARGIN_RUN.test(l.text)));
  const n = real.length;
  const kept: PdfLine[] = [];
  let inFootnotes = false;
  for (let i = 0; i < n; i++) {
    const l = real[i]!;
    let t = l.text;
    const edge = i < 3 || i >= n - 2;
    if (SCR_HEAD.test(t) || SCR_RUNNING.test(t) || /SUPREME\s+COURT\s+REPORTS\s*\[\d{4}\]/i.test(t)) continue;
    if (edge && PAGE_NO.test(t)) continue;
    if (isRunningTitle(t, titleWords) || (edge && AUTHOR_FOOTER.test(t))) continue;
    if (JUNK.some((re) => re.test(t))) continue;
    // Footnotes: smaller type at the foot of the page, starting with a number marked in this page's text.
    const small = bodySize > 0 && l.size > 0 && l.size < bodySize * 0.92;
    const fn = /^(\d{1,3})(?=\s|\D)/.exec(t);
    if (!inFootnotes && small && fn && marks.has(fn[1]!) && i > n / 3) inFootnotes = true;
    if (inFootnotes) {
      if (small || PAGE_NO.test(t)) continue;
      inFootnotes = false;
    }
    // The page number drawn inside a line of text ("two Indian parties 549 could not").
    if (page !== null) t = t.replace(new RegExp(`([a-z,;]) ${page} (?=[a-z])`, 'g'), '$1 ');
    kept.push({ ...l, text: t });
  }
  return kept;
}

/** Where the court's own text starts: the earliest marker in the first 60% of the document (a later "ORDER" or a
 * quoted "1." must not count). */
function bodyStart(lines: { text: string }[]): number {
  const limit = Math.ceil(lines.length * 0.6);
  for (let i = 0; i < limit; i++) {
    const here = lines[i]!.text;
    // Scanned reports may break the sentence over several lines, a word or two each.
    const window = lines.slice(i, i + 5).map((l) => l.text).join(' ');
    for (const { re, skipLine } of BODY_MARKERS) {
      const m = re === DELIVERED ? re.exec(window) : re.exec(here);
      if (!m || m.index >= here.length) continue;
      let j = skipLine ? i + 1 : i;
      while (j < lines.length && HEADING_AFTER_MARKER.test(lines[j]!.text)) j++;
      return j;
    }
  }
  // No marker: the court's numbered paragraphs, when "1." is followed by "2." soon after.
  for (let i = 0; i < limit; i++) {
    if (/^1\.\s/.test(lines[i]!.text) && lines.slice(i + 1, i + 80).some((l) => /^2\.\s/.test(l.text))) return i;
  }
  return 0;
}

/**
 * e-SCR prints the next case straight after the last page of this one ("DHRANGADHRA CHEMICAL WORKS LTD. v. THE
 * DHRANGADHRA MUNICIPALITY … (B. P. SINHA, … JJ.)"): cut the text where another case's title and Bench appear in
 * the last pages.
 */
function nextCaseStart<T extends { text: string }>(lines: T[], titleWords: Set<string>, from: number): number {
  const tail = Math.max(from, lines.length - 150);
  for (let i = tail; i < lines.length; i++) {
    const t = lines[i]!.text;
    const alone = /^v\.?$/i.test(t);
    if (!alone && !/\sv\.(?:\s|$)/.test(t)) continue;
    // A title in capitals that is not this case's ("v." alone on its line: the parties are the lines around it).
    const parties = alone ? [lines[i - 1]?.text ?? '', lines[i + 1]?.text ?? ''] : [t];
    if (parties.some((x) => upperShare(x) < 0.8 || isRunningTitle(x, titleWords)) || parties.every((x) => isRunningTitle(`${x} V.`, titleWords))) continue;
    const near = lines.slice(i, i + 6).map((l) => l.text).join(' ');
    if (/[([][A-Z][A-Za-z.,' ]{5,300}(?:C\.\s?J\.(?:I\.)?|JJ?\.)\s*[)\]]/.test(near)) {
      // The title may start a line or two above "v.".
      let k = i;
      while (k > tail && upperShare(lines[k - 1]!.text) >= 0.8 && lines[k - 1]!.text.length < 80 && !isRunningTitle(lines[k - 1]!.text, titleWords)) k--;
      return k;
    }
  }
  return lines.length;
}

/** Hyphenated line ends: drop the hyphen only when the joined word is used elsewhere in the same document. */
function joinLines(lines: string[], vocabulary: Set<string>, hyphenated: Set<string> = new Set()): string {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!out) {
      out = line;
      continue;
    }
    const soft = /([A-Za-z]+)-$/.exec(out);
    const next = /^([a-z]+)/.exec(line);
    if (soft && next) {
      const joined = (soft[1]! + next[1]!).toLowerCase();
      const keep = hyphenated.has(`${soft[1]!.toLowerCase()}-${next[1]!}`);
      out = vocabulary.has(joined) && !keep ? out.slice(0, -1) + line : out + line;
    } else if (/[—–]$/.test(out)) {
      out += line;
    } else {
      out += ` ${line}`;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Drop a table of contents: from its heading to the line before the court's first numbered paragraph. */
function dropContents<T extends { text: string }>(lines: T[]): T[] {
  const out: T[] = [];
  let skipping = false;
  for (const l of lines) {
    if (CONTENTS_HEADING.test(l.text)) {
      skipping = true;
      continue;
    }
    if (skipping && PARA_START.test(l.text)) skipping = false;
    // A judge's name line just before the first paragraph is kept: it starts that judge's opinion.
    if (skipping && !/,\s*(?:CJI|C\.\s?J\.|J\.)$/.test(l.text)) continue;
    out.push(l);
  }
  return out;
}

/** The Bench as printed under the title: "[RANJAN GOGOI AND ROHINTON FALI NARIMAN, JJ.]". */
export function benchOf(headLines: string[]): string[] {
  const text = headLines.slice(0, 40).join(' ');
  const m = /\[([A-Z][^\]]{3,400}?),?\s*(?:JJ?\.|C\.\s?J\.)\s*\]/.exec(text);
  if (!m) return [];
  return m[1]!
    .split(/,|\bAND\b|\band\b/)
    .map((s) => s.replace(/\b(?:CJI|C\.\s?J\.|SHRI|DR\.?)\b/gi, '').trim())
    .filter((s) => /[A-Za-z]{3,}/.test(s));
}

/**
 * The official reporter's notes on the opinions (e-SCR headnotes), for the splitter to type each opinion:
 * - "Ed. Note: Hon'ble Dr. Dhananjaya Y. Chandrachud, CJI pronounced judgment on behalf of …, Hon'ble Mr. Justice
 *   J.B. Pardiwala and Hon'ble Mr. Justice Manoj Misra." and "Held (per X, CJI) (for himself, A, B and C, JJ.)":
 *   the majority, when they are more than half the Bench (the splitter checks);
 * - "(per K.V. Viswanathan, J.) (Dissenting)", "Per N. V. RAMANA, J. (Concurring):".
 */
export function reporterNoteOf(headLines: string[]): { majority: string[]; concurring: string[]; dissenting: string[] } {
  const text = headLines.join(' ').replace(/\s+/g, ' ');
  const clean = (s: string) =>
    s
      .replace(/\b(?:Hon[’']?ble|Mr|Mrs|Ms|Dr)\.?(?=\s|$)|\b(?:Justice|his\s+Lordship|her\s+Ladyship|himself|herself|CJI)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s,]+|[\s,]+$/g, '');
  const names = (xs: string[]) => [...new Set(xs.map(clean).filter((s) => /[A-Za-z]{3,}/.test(s)))];
  const majority: string[] = [];
  const ed = /Ed\.\s*Note\s*:\s*(.+?)\s+pronounced\s+(?:the\s+)?judgment\s+on\s+behalf\s+of\s+/.exec(text);
  if (ed) {
    // The list ends at the sentence's full stop: the next sentence starts "Hon'ble …" or a capital word then a
    // lower-case one; "Mr. Justice" and initials ("J.B.") do not end it.
    const rest = text.slice(ed.index + ed[0].length, ed.index + ed[0].length + 400);
    const stop = /(?<!\b[A-Z])\.(?:\s+(?=Hon[’']?ble|[A-Z][a-z]+\s+[a-z])|\s*$)/.exec(rest);
    majority.push(ed[1]!, ...(stop ? rest.slice(0, stop.index) : rest).split(/,|\band\b/));
  }
  const JUDGE = String.raw`([A-Z][A-Za-z.'’ ]{2,60}?),?\s*(?:CJI|C\.\s?J\.(?:I\.)?|J\.)`;
  const forHimself = new RegExp(String.raw`\bper\s+${JUDGE}\s*\)?\s*\(\s*for\s+(?:himself|herself)\s*(?:,|\band\b)\s*([^)]{3,200}?),?\s*JJ?\.\s*\)`, 'i').exec(text);
  if (forHimself && !majority.length) majority.push(forHimself[1]!, ...forHimself[2]!.split(/,|\band\b/));
  const separate = (word: string) =>
    [...text.matchAll(new RegExp(String.raw`\bper\s+${JUDGE}\s*[)\]]?\s*[(\[]?\s*(?:partly\s+)?${word}`, 'gi'))].map((m) => m[1]!);
  return { majority: names(majority), concurring: names(separate('concurring')), dissenting: names(separate('dissenting')) };
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function pdfToJudgment(doc: PdfLines, hint: PdfJudgmentHint): JudgmentInput {
  const titleWords = new Set(words(hint.caseName));
  const flat: (PdfLine & { page: number | null; margin: number })[] = [];
  for (const p of doc.pages) {
    const page = printedPage(p.lines);
    const lines = cleanPage(p.lines, titleWords, doc.bodySize, doc.scanned, page);
    // The page's left margin: where most long lines start.
    const xs = lines.filter((l) => l.text.length > 40).map((l) => Math.round(l.x / 2) * 2);
    const counts = new Map<number, number>();
    for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const margin = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
    for (const l of lines) flat.push({ ...l, page, margin });
  }

  const start = bodyStart(flat);
  // The headnote keeps the reporter's summary; case details, cited cases and counsel lists are left out.
  const headLines = flat.slice(0, start).map((l) => l.text);
  const cut = headLines.findIndex((t, i) => i > 0 && HEAD_END.test(t));
  const head = cut > 0 ? headLines.slice(0, cut) : headLines;
  const end = nextCaseStart(flat, titleWords, start);
  const body = dropContents(flat.slice(start, end));
  // Wide letter-spacing in justified lines ("I n t h e co u r s e o f t h i s j u d g m e n t"): rejoin pieces that
  // spell a word used elsewhere in the document (never invents a word).
  const repaired = repairSpacedWords(body.map((l, i) => ({ pageNo: i, text: l.text })));
  body.forEach((l, i) => (l.text = repaired[i]!.text));
  const vocabulary = new Set(flat.flatMap((l) => l.text.toLowerCase().match(/[a-z]{3,}/g) ?? []));
  const hyphenated = new Set(flat.flatMap((l) => l.text.toLowerCase().match(/[a-z]+-[a-z]+/g) ?? []));
  const typical = median(body.filter((l) => !doc.scanned || l.text.length > 20).map((l) => l.text.length));

  const blocks: JudgmentBlock[] = [];
  let cur: typeof body = [];
  const flush = () => {
    if (!cur.length) return;
    const lines = cur.map((l, i) => {
      // Scanned reports print margin letters inside the text column: "… public policy of India F", "A an award …".
      let t = l.text;
      if (doc.scanned) {
        if (t.length >= 30) t = t.replace(/\s+[A-H]$/, '');
        if (i > 0 && !TERMINAL.test(cur[i - 1]!.text)) t = t.replace(/^[A-H]\s+(?=[a-z])/, '');
      }
      return t;
    });
    const text = joinLines(lines, vocabulary, hyphenated);
    if (text && !/^\d{1,5}$/.test(text)) {
      const indented = cur.filter((l) => l.x - l.margin >= 15).length;
      const quoted = (cur.length > 1 && indented / cur.length >= 0.6) || (cur.length === 1 && indented === 1 && !PARA_START.test(text));
      blocks.push({ text, page: cur[0]!.page, quoted });
    }
    cur = [];
  };
  for (let i = 0; i < body.length; i++) {
    const l = body[i]!;
    const prev = cur[cur.length - 1];
    if (prev) {
      const prevIndented = prev.x - prev.margin >= 15;
      const indented = l.x - l.margin >= 15;
      const startsPara = PARA_START.test(l.text);
      const prevShort = prev.text.length < typical * 0.7;
      const continues = /^[a-z(]/.test(l.text) || ABBREV_END.test(prev.text) || /[-—–,]$/.test(prev.text);
      const shortEnd = prevShort && !continues && (TERMINAL.test(prev.text) || !doc.scanned);
      // A first line indented under a body paragraph, or the reverse, is a quotation starting or ending.
      const indentShift = !doc.scanned && prevIndented !== indented && !continues && (TERMINAL.test(prev.text) || startsPara);
      if (startsPara || shortEnd || indentShift) flush();
    }
    cur.push(l);
  }
  flush();

  return {
    caseName: hint.caseName,
    decidedOn: hint.decidedOn,
    court: hint.court,
    citations: hint.citations ?? [],
    author: null,
    bench: hint.bench?.length ? hint.bench : benchOf(headLines),
    reporterNote: reporterNoteOf(headLines),
    quotesMarked: !doc.scanned,
    headnote: head.length ? capText(joinLines(head, vocabulary, hyphenated), MAX_HEADNOTE_CHARS) : null,
    blocks,
  };
}
