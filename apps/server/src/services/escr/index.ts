/**
 * Supreme Court Reports (e-SCR), the Supreme Court's official law report, read from a public mirror (HLD D25,
 * BRD DATA-7). The only module that talks to it.
 *
 * Why a mirror: e-SCR's own search (scr.sci.gov.in) needs a captcha, and the loader never gets around one. The mirror
 * (AWS Open Data "Indian Supreme Court Judgments", CC-BY-4.0) holds e-SCR's own PDFs and the catalogue scraped from
 * e-SCR's result pages, one year per folder:
 *   metadata/tar/year=YYYY/metadata.tar   one JSON per judgment (e-SCR's result HTML, file key, neutral citation)
 *   data/pdf/year=YYYY/english/<key>_EN.pdf
 * A year's catalogue (~5 MB) is read once and kept in our storage as a small index (`escr/catalog/YYYY.json`);
 * the current and previous year are read again after a week, since new judgments keep arriving.
 * Only a case name and year from a course pack, or the library's own titles, go into a lookup.
 */
import { escrDate, type EscrRecord } from '@nyaai/legal';
import type { Storage } from '../storage/index.ts';

export const ESCR_MIRROR = 'https://indian-supreme-court-judgments.s3.amazonaws.com';
const REFRESH_MS = 7 * 24 * 3600 * 1000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

export interface Escr {
  /** Every judgment the mirror lists for a year folder. */
  catalog(year: number): Promise<EscrRecord[]>;
  /** The year folders worth searching for a case decided in `year` (a December judgment may be reported next year). */
  candidates(year: number): Promise<EscrRecord[]>;
  /** The official PDF and the link it came from. */
  pdf(record: EscrRecord): Promise<{ bytes: Uint8Array; url: string }>;
}

export interface EscrConfig {
  storage: Storage;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface StoredCatalog {
  fetchedAt: number;
  records: EscrRecord[];
}

/** Files in a plain (ustar/pax) tar archive. */
export function untar(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  const text = new TextDecoder();
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= bytes.length) {
    const header = bytes.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, len: number) => text.decode(header.subarray(start, start + len)).replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const data = bytes.subarray(off + 512, off + 512 + size);
    longName = null;
    if (type === 'x') {
      // pax header: "NN path=…\n"
      const m = /\d+ path=([^\n]+)\n/.exec(text.decode(data));
      if (m) longName = m[1]!;
    } else if (type === 'L') {
      longName = text.decode(data).replace(/\0.*$/s, '');
    } else if (type === '0' || type === '' ) {
      out.push({ name, data });
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
const decode = (s: string) =>
  s.replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(Number(e.slice(1))) : (ENTITY[e.toLowerCase()] ?? m)));
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** One catalogue entry: e-SCR's own result HTML for the judgment, as the mirror stored it. */
export function parseCatalogEntry(json: { raw_html?: string; path?: string; citation_year?: string; nc_display?: string }, folder: string): EscrRecord | null {
  const html = json.raw_html ?? '';
  if (!json.path) return null;
  const title = /<strong>\s*([\s\S]*?)\s*<\/strong>\s*-\s*<span class='escrText'>/.exec(html);
  const label = /aria-label="\s*([\s\S]*?)\s+pdf"/.exec(html);
  const name = title ? strip(title[1]!) : label ? strip(label[1]!) : null;
  if (!name) return null;
  const citation = /<span class='escrText'>([^<]+)<\/span>/.exec(html)?.[1]?.trim() ?? null;
  const neutral = /<span class='ncDisplay'>([^<]+)<\/span>/.exec(html)?.[1]?.trim() ?? null;
  const date = /Decision Date :<\/span><font[^>]*>\s*([\d-]+)\s*<\/font>/.exec(html)?.[1] ?? null;
  const coram = /Coram\s*:\s*([^<]+)<\/strong>/.exec(html)?.[1]?.trim() ?? null;
  return {
    title: name,
    citation,
    neutralCitation: neutral,
    decidedOn: escrDate(date),
    path: json.path,
    year: folder,
    judges: coram ? decode(coram) : null,
    english: true,
  };
}

export function createEscr(cfg: EscrConfig): Escr {
  const base = (cfg.baseUrl ?? ESCR_MIRROR).replace(/\/$/, '');
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? Date.now;
  const memo = new Map<number, Promise<EscrRecord[]>>();

  async function get(url: string, limit: number): Promise<Uint8Array> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(180_000), headers: { 'user-agent': 'NYAAI-library-loader/0.1' } });
    if (!res.ok) throw new Error(`The Supreme Court Reports mirror returned HTTP ${res.status}.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error('The file is larger than expected.');
    return bytes;
  }

  async function load(year: number): Promise<EscrRecord[]> {
    const key = `escr/catalog/${year}.json`;
    const recent = year >= new Date(now()).getUTCFullYear() - 1;
    if (await cfg.storage.exists(key)) {
      const stored = JSON.parse(new TextDecoder().decode(await cfg.storage.get(key))) as StoredCatalog;
      if (!recent || now() - stored.fetchedAt < REFRESH_MS) return stored.records;
    }
    let tar: Uint8Array;
    try {
      tar = await get(`${base}/metadata/tar/year=${year}/metadata.tar`, 200 * 1024 * 1024);
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) return [];
      throw err;
    }
    const records = untar(tar)
      .filter((f) => f.name.endsWith('.json'))
      .map((f) => {
        try {
          return parseCatalogEntry(JSON.parse(new TextDecoder().decode(f.data)), String(year));
        } catch {
          return null;
        }
      })
      .filter((r): r is EscrRecord => r !== null);
    const stored: StoredCatalog = { fetchedAt: now(), records };
    await cfg.storage.put(key, new TextEncoder().encode(JSON.stringify(stored)), 'application/json');
    return records;
  }

  const catalog = (year: number) => {
    let p = memo.get(year);
    if (!p) {
      p = load(year);
      p.catch(() => memo.delete(year));
      memo.set(year, p);
    }
    return p;
  };

  return {
    catalog,
    async candidates(year) {
      const thisYear = new Date(now()).getUTCFullYear();
      const years = [year, year + 1, year - 1].filter((y) => y >= 1950 && y <= thisYear);
      return (await Promise.all(years.map(catalog))).flat();
    },
    async pdf(record) {
      const url = `${base}/data/pdf/year=${record.year}/english/${record.path}_EN.pdf`;
      const bytes = await get(url, MAX_PDF_BYTES);
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The mirror did not return a PDF.');
      return { bytes, url };
    },
  };
}
