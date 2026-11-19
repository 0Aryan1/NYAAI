/**
 * Ingestion stages 1–2: fetch the original and extract text per page (LLD §6.1, §6.2).
 * PDF via unpdf (pdf.js); HTML via Readability on jsdom (no scripts run, nothing else loaded); plain text.
 * Scanned PDFs (no text layer) are refused here; OCR arrives with uploads.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocumentProxy } from 'unpdf';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Page } from '@nyaai/legal';

export const MAX_BYTES = 50 * 1024 * 1024;

export interface Fetched {
  bytes: Uint8Array;
  contentType: string;
  ext: 'pdf' | 'html' | 'txt';
}

export class NoTextLayerError extends Error {
  constructor() {
    super('This PDF has no text layer (it looks scanned); it needs OCR.');
    this.name = 'NoTextLayerError';
  }
}

function kindOf(contentType: string, name: string): Fetched['ext'] {
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf') || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (ct.includes('html') || /\.html?$/i.test(name)) return 'html';
  return 'txt';
}

/** https only; `file:` only when allowFile (development CLI). Size-capped and time-limited. */
export async function fetchOriginal(url: string, { allowFile = false } = {}): Promise<Fetched> {
  const u = new URL(url);
  if (u.protocol === 'file:') {
    if (!allowFile) throw new Error('Local files can only be loaded in development.');
    const bytes = new Uint8Array(await readFile(fileURLToPath(u)));
    if (bytes.byteLength > MAX_BYTES) throw new Error('File is larger than 50 MB.');
    const ext = kindOf('', u.pathname);
    return { bytes, contentType: ext === 'pdf' ? 'application/pdf' : ext === 'html' ? 'text/html' : 'text/plain', ext };
  }
  if (u.protocol !== 'https:') throw new Error('Only https links can be loaded.');
  const res = await fetch(u, {
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
    headers: { 'user-agent': 'NYAAI-library-loader/0.1', accept: 'application/pdf,text/html;q=0.9,*/*;q=0.5' },
  });
  if (!res.ok || !res.body) throw new Error(`The source returned HTTP ${res.status}.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    size += part.byteLength;
    if (size > MAX_BYTES) throw new Error('The source is larger than 50 MB.');
    chunks.push(part);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  const contentType = res.headers.get('content-type') ?? '';
  return { bytes, contentType, ext: kindOf(contentType, u.pathname) };
}

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

/**
 * pdf.js text items → lines. A new line starts on hasEOL, or when the baseline moves by more than 70% of the
 * larger font size. Superscript footnote markers ("1[", "3***") shift the baseline by less than that, so they
 * stay inside their line instead of becoming lines of their own.
 */
async function pdfPages(bytes: Uint8Array): Promise<Page[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Page[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let text = '';
    let lastY: number | null = null;
    let lastSize = 0;
    for (const raw of content.items as TextItem[]) {
      if (typeof raw.str !== 'string') continue;
      const y = raw.transform?.[5] ?? null;
      const size = Math.abs(raw.transform?.[3] ?? 0) || lastSize;
      const threshold = Math.max(3, 0.7 * Math.max(size, lastSize));
      if (lastY !== null && y !== null && Math.abs(y - lastY) > threshold && !text.endsWith('\n')) text += '\n';
      text += raw.str;
      if (raw.hasEOL) text += '\n';
      // Track the main text baseline, not a superscript's.
      if (y !== null && (size >= lastSize * 0.8 || lastY === null)) {
        lastY = y;
        lastSize = size;
      }
    }
    pages.push({ pageNo: i, text });
  }
  const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, '').length, 0);
  if (chars < 40 * pages.length) throw new NoTextLayerError();
  return pages;
}

const BLOCK = new Set(['P', 'DIV', 'BR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'TR', 'BLOCKQUOTE', 'PRE']);

function htmlPages(bytes: Uint8Array, url: string): Page[] {
  const dom = new JSDOM(new TextDecoder().decode(bytes), { url });
  const article = new Readability(dom.window.document).parse();
  const body = new JSDOM(article?.content ?? dom.window.document.body.innerHTML).window.document.body;
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === 3) text += (node.textContent ?? '').replace(/\s+/g, ' ');
    for (const child of Array.from(node.childNodes)) walk(child);
    if (node.nodeType === 1 && BLOCK.has((node as Element).tagName)) text += '\n';
  };
  walk(body);
  return [{ pageNo: 1, text }];
}

export async function extractPages(f: Fetched, url: string): Promise<Page[]> {
  if (f.ext === 'pdf') return pdfPages(f.bytes);
  if (f.ext === 'html') return htmlPages(f.bytes, url);
  return new TextDecoder().decode(f.bytes).split('\f').map((text, i) => ({ pageNo: i + 1, text }));
}
