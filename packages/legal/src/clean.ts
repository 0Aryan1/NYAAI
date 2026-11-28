/**
 * Ingestion stage 3, clean (LLD §6.1). Pure: takes per-page text, returns lines that keep their page number.
 *
 * - Running headers and footers: a line within the first or last 2 lines of a page whose shape
 *   (digits ignored) repeats on more than 60% of pages is dropped. Only page edges are checked, so
 *   repeated statute wording ("Provided that ...") in the body is never removed.
 * - Page numbers at page edges are dropped.
 * - A word broken by a hyphen at the end of a line is joined.
 * - Spaces are normalised everywhere; quotes and odd dashes are normalised only outside quotation
 *   marks, so the original characters inside a quotation survive for the quote check (C4).
 * - Zero-width and soft-hyphen characters are removed (they can hide text; LLD §17.6 rule 5).
 * - A line whose words came out letter-spaced ("Tru stee ca n not r en ou nce") is rejoined, but only into words
 *   the same document uses elsewhere; anything else is left as it was.
 */

export interface Page {
  pageNo: number;
  text: string;
}

export interface Line {
  pageNo: number;
  text: string;
}

const EDGE = 2;
const REPEAT_SHARE = 0.6;
/** A whole line in parentheses, e.g. "(Part III.—Fundamental Rights)" or a roman page number "(iii)". */
const BRACKETED = /^\([^()]{2,120}\)$/;
const PAGE_NUMBER = /^\s*(?:page\s*)?[-\u2013\u2014]?\s*\d{1,4}\s*[-\u2013\u2014]?\s*(?:of\s+\d{1,4})?\s*$/i;
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;
const SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000\t]/g;

/** Shape of a line for header/footer matching: digits and case ignored, spaces collapsed. */
function shape(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function edgeIndexes(lines: string[]): number[] {
  const nonEmpty = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  return [...new Set([...nonEmpty.slice(0, EDGE), ...nonEmpty.slice(-EDGE)])];
}

export function cleanPages(pages: Page[]): Line[] {
  const split = pages.map((p) => ({
    pageNo: p.pageNo,
    lines: p.text.replace(INVISIBLE, '').replace(SPACES, ' ').split(/\r?\n/),
  }));

  // Running headers and footers.
  const counts = new Map<string, number>();
  for (const p of split) {
    const seen = new Set(
      edgeIndexes(p.lines)
        .map((i) => shape(p.lines[i] ?? ''))
        .filter(Boolean),
    );
    for (const s of seen) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const threshold = split.length >= 3 ? split.length * REPEAT_SHARE : Infinity;
  const running = new Set([...counts].filter(([, n]) => n > threshold).map(([s]) => s));

  // Section-of-document headers such as "(Part III.—Fundamental Rights)" repeat only on that Part's pages and
  // may sit anywhere in the extracted order: a short line wholly in parentheses on 3+ pages is a running header.
  const bracketPages = new Map<string, Set<number>>();
  for (const p of split) {
    for (const l of p.lines) {
      const t = l.trim();
      if (BRACKETED.test(t) && t.split(/\s+/).length <= 12)
        bracketPages.set(t, (bracketPages.get(t) ?? new Set()).add(p.pageNo));
    }
  }
  const bracketHeaders = new Set([...bracketPages].filter(([, pages]) => pages.size >= 3).map(([t]) => t));

  const out: Line[] = [];
  for (const p of split) {
    const edges = new Set(edgeIndexes(p.lines));
    p.lines.forEach((raw, i) => {
      if (edges.has(i) && (running.has(shape(raw)) || PAGE_NUMBER.test(raw))) return;
      if (bracketHeaders.has(raw.trim())) return;
      const text = raw.replace(/ {2,}/g, ' ').trimEnd();
      if (text.trim()) out.push({ pageNo: p.pageNo, text });
    });
  }
  return normaliseOutsideQuotes(repairSpacedWords(joinHyphenated(out)));
}

/** Real one- and two-letter words; any other short letter run in a line is a piece of a broken word. */
const SHORT_WORDS = new Set([
  'a',
  'i',
  'an',
  'as',
  'at',
  'be',
  'by',
  'do',
  'he',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'on',
  'or',
  'so',
  'to',
  'up',
  'us',
  'we',
]);
const MAX_PIECES = 12;
const lettersOf = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
const isFragment = (t: string, vocab: Set<string>) =>
  /^[A-Za-z]{1,3}$/.test(t) && !SHORT_WORDS.has(t.toLowerCase()) && !(t.length === 3 && vocab.has(t.toLowerCase()));

/**
 * Some PDFs space out the letters of a paragraph (wide tracking), and the text comes out as "4 6. Tru stee ca n not
 * r en ou nce af ter acc ep ta nce . —". Such a line (many pieces that are not words) is rebuilt greedily: the
 * longest run of up to 6 pieces that spells a word used elsewhere in the document becomes that word. Pieces that
 * spell nothing stay as they were, so the repair can only join, never invent.
 */
export function repairSpacedWords(lines: Line[]): Line[] {
  const tokenised = lines.map((l) => l.text.split(' ').filter(Boolean));
  const broken = (tokens: string[], vocab: Set<string>) =>
    tokens.length >= 2 &&
    ((n) => (tokens.length >= 5 && n >= tokens.length * 0.3) || n === tokens.length)(
      tokens.filter((t) => isFragment(t.replace(/[.,;:()\u2014\u2013-]+$/, ''), vocab)).length,
    );
  const vocab = new Set<string>();
  const empty = new Set<string>();
  tokenised.forEach((tokens) => {
    if (broken(tokens, empty)) return;
    for (const t of tokens) {
      const w = lettersOf(t);
      if (w.length >= 2 && /^[A-Za-z(["“‘']*[A-Za-z]+[A-Za-z.,;:)\]"”’'\u2014\u2013-]*$/.test(t)) vocab.add(w);
    }
  });
  return lines.map((line, n) => {
    const tokens = tokenised[n]!;
    if (!broken(tokens, vocab)) return line;
    const out: string[] = [];
    for (let i = 0; i < tokens.length;) {
      const t = tokens[i]!;
      // "4 6." → "46."
      if (/^\d$/.test(t) && /^\d+[A-Z]?\.?$/.test(tokens[i + 1] ?? '')) {
        out.push(t + tokens[i + 1]);
        i += 2;
        continue;
      }
      let taken = 1;
      for (let j = Math.min(tokens.length, i + MAX_PIECES); j > i + 1; j--) {
        const span = tokens.slice(i, j);
        // Only the last piece may carry punctuation, and the run must contain a real fragment.
        if (
          span.slice(0, -1).some((p) => !/^[A-Za-z]+$/.test(p)) ||
          !/^[A-Za-z]+[.,;:)]*$/.test(span[span.length - 1]!)
        )
          continue;
        if (!span.some((p) => isFragment(p.replace(/[.,;:)]+$/, ''), vocab))) continue;
        if (vocab.has(lettersOf(span.join('')))) {
          taken = j - i;
          break;
        }
      }
      out.push(tokens.slice(i, i + taken).join(''));
      i += taken;
    }
    // Punctuation left on its own ("acceptance . —", "( a)") rejoins its word.
    const text = out
      .join(' ')
      .replace(/\s+([.,;:)\u2014\u2013])/g, '$1')
      .replace(/([.]) ?([\u2014\u2013]) /g, '$1$2')
      .replace(/\( /g, '(');
    return { ...line, text };
  });
}

/**
 * Prefixes that form real hyphenated compounds in Indian statutes ("non-performance", "co-operative",
 * "sub-section", "self-acquired"). India Code PDFs do not hyphenate words at line ends, so a line-end hyphen
 * after one of these is kept; any other is treated as a soft break and removed ("compen-\nsation").
 */
const COMPOUND_PREFIX =
  /(?:^|[^a-z])(?:non|co|re|pre|sub|self|quasi|inter|intra|ex|anti|counter|cross|well|ill|half|post|mis|semi|multi|under|over|by|de|un|in|out|joint|first|second|third|so)-$/i;

/** "compen-\nsation" → "compensation"; "non-\nperformance" → "non-performance". */
function joinHyphenated(lines: Line[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = { ...lines[i]! };
    while (/[a-z]-$/.test(cur.text) && i + 1 < lines.length && /^\s*[a-z]/.test(lines[i + 1]!.text)) {
      const next = lines[++i]!.text.trimStart();
      const firstWord = next.split(/\s/, 1)[0] ?? '';
      cur.text = (COMPOUND_PREFIX.test(cur.text) ? cur.text : cur.text.slice(0, -1)) + firstWord;
      const rest = next.slice(firstWord.length).trimStart();
      if (rest) {
        out.push(cur);
        lines[i] = { pageNo: lines[i]!.pageNo, text: rest };
        i--;
        break;
      }
    }
    if (out[out.length - 1] !== cur) out.push(cur);
  }
  return out;
}

const OPEN = new Set(['“', '"']);
const CLOSE = new Set(['”', '"']);

/** Normalises curly single quotes and odd dash code points, but only outside double quotation marks. */
function normaliseOutsideQuotes(lines: Line[]): Line[] {
  let inQuote = false;
  return lines.map((line) => {
    let text = '';
    for (const ch of line.text) {
      if (!inQuote && OPEN.has(ch)) {
        inQuote = true;
        text += ch;
        continue;
      }
      if (inQuote && CLOSE.has(ch)) {
        inQuote = false;
        text += ch;
        continue;
      }
      if (inQuote) {
        text += ch;
        continue;
      }
      if (ch === '‘' || ch === '’' || ch === '‛' || ch === '‚') text += "'";
      else if (ch === '‐' || ch === '‑' || ch === '‒' || ch === '−') text += '-';
      else if (ch === '―' || ch === '⎯')
        text += '—'; // horizontal bar and line-extension dash (used by some Gazette PDFs)
      else text += ch;
    }
    return { pageNo: line.pageNo, text };
  });
}
