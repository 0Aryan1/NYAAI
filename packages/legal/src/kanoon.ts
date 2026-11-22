/**
 * Indian Kanoon judgment document → JudgmentInput (pure; no DOM). Kanoon returns HTML with:
 * - `h2.doc_title` "X vs Y on 16 November, 1953", `h3.doc_citations`, `h3.doc_author`, `h3.doc_bench`;
 * - an optional `pre` block in old Supreme Court Reports style (parties, bench, ACT, HEADNOTE, "JUDGMENT:");
 * - one `p` or `blockquote` per paragraph, with hidden `span`s carrying the printed report's page numbers.
 * Kanoon's own `data-structure` labels are machine guesses and are ignored: roles come from our rules (LLD §6.4).
 */
import type { JudgmentBlock, JudgmentInput } from './judgment.ts';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ''));
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "Satyabrata Ghose vs Mugneeram Bangur & Co., And Another on 16 November, 1953" → name and ISO date. */
export function parseKanoonTitle(title: string): { caseName: string; decidedOn: string | null } {
  const m = /^(.*?)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})\s*$/.exec(title.trim());
  const name = (m?.[1] ?? title).replace(/\s+vs\.?\s+/i, ' v. ').replace(/,?\s+And\s+(Another|Others|Ors\.?|Anr\.?)$/i, '').trim();
  const month = m ? MONTHS[m[3]!.toLowerCase()] : undefined;
  return { caseName: name, decidedOn: m && month ? `${m[4]}-${month}-${m[2]!.padStart(2, '0')}` : null };
}

/** Printer's slugs in old reports ("L/B(D)2SCI-6(a)") and lone page numbers are not judgment text. */
const PRINTER_JUNK = /\b[A-Z]{1,3}\/[A-Z]{1,3}\([A-Z]\)\s*\d+\s*SCI[-\s]?\d+\s*(\([a-z]\))?/g;

export interface KanoonDoc {
  tid: number | string;
  title: string;
  doc: string;
  docsource?: string;
  publishdate?: string;
}

export function kanoonToJudgment(d: KanoonDoc): JudgmentInput {
  const html = d.doc;
  const h3 = (cls: string) => {
    const m = new RegExp(`<h3 class="${cls}">(.*?)</h3>`, 's').exec(html);
    return m ? squash(stripTags(m[1]!)) : null;
  };
  const { caseName, decidedOn } = parseKanoonTitle(stripTags(d.title));
  const citations = (h3('doc_citations') ?? '').replace(/^Equivalent citations:\s*/i, '').split(/\s*,\s*/).filter(Boolean);
  const author = (h3('doc_author') ?? '').replace(/^Author:\s*/i, '') || null;
  const bench = (h3('doc_bench') ?? '').replace(/^Bench:\s*/i, '').split(/\s*,\s*/).filter(Boolean);

  // Old reports: the reporter's ACT summary and HEADNOTE sit in the preformatted header block.
  let headnote: string | null = null;
  const pre = /<pre[^>]*>(.*?)<\/pre>/s.exec(html);
  if (pre) {
    const text = stripTags(pre[1]!);
    const hn = /HEADNOTE:\s*([\s\S]*?)(?:\n\s*JUDGMENT:|$)/.exec(text);
    const act = /\bACT:\s*([\s\S]*?)\n\s*HEADNOTE:/.exec(text);
    const parts = [act ? `ACT: ${squash(act[1]!)}` : null, hn ? squash(hn[1]!) : null].filter(Boolean);
    if (parts.length) headnote = parts.join('\n');
  }

  const blocks: JudgmentBlock[] = [];
  let page: number | null = null;
  const body = pre ? html.slice(pre.index + pre[0].length) : html;

  // Some judgments come as one preformatted block holding the whole text (Chloro Controls, 2012: 3,500 lines of
  // <pre>, then five short <p> notes). Then the paragraphs are the <pre> text's blank-line-separated runs.
  if (pre && !/HEADNOTE:/.test(pre[1]!)) {
    const preText = stripTags(pre[1]!).replace(/&amp;/g, '&');
    const bodyText = stripTags(body);
    if (preText.length > 3000 && bodyText.replace(/\s+/g, '').length < preText.replace(/\s+/g, '').length * 0.3) {
      for (const run of preText.split(/\n[ \t]*\n/)) {
        const text = squash(run.replace(PRINTER_JUNK, ' '));
        // Page footers and numbers of the typed judgment ("Page 12 of 80", "12").
        if (!text || /^(?:page\s*)?\d{1,4}(?:\s*of\s*\d{1,4})?$/i.test(text)) continue;
        blocks.push({ text, page: null, quoted: false });
      }
    }
  }
  for (const m of body.matchAll(/<(p|blockquote)\b[^>]*>(.*?)<\/\1>/gs)) {
    let inner = m[2]!;
    // Page numbers of the printed report: the paragraph starts on the page in force before its first marker.
    const pages = [...inner.matchAll(/<span class="hidden_text"[^>]*>\s*(\d{1,5})\s*<\/span>/g)].map((p) => Number(p[1]));
    inner = inner.replace(/<span class="hidden_text"[^>]*>.*?<\/span>/gs, ' ');
    const text = squash(stripTags(inner).replace(PRINTER_JUNK, ' '));
    if (text) blocks.push({ text, page, quoted: m[1] === 'blockquote' });
    if (pages.length) page = pages[pages.length - 1]!;
  }

  return {
    caseName,
    decidedOn,
    court: d.docsource ?? null,
    citations,
    author,
    bench,
    headnote,
    blocks,
  };
}
