import { describe, expect, it } from 'vitest';
import { createEscr, parseCatalogEntry, untar } from '../src/services/escr/index.ts';
import type { Storage } from '../src/services/storage/index.ts';

/** A minimal ustar archive (what the mirror's metadata.tar is). */
function tar(files: { name: string; body: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const body = enc.encode(f.body);
    const h = new Uint8Array(512);
    h.set(enc.encode(f.name), 0);
    h.set(enc.encode(body.length.toString(8).padStart(11, '0') + '\0'), 124);
    h.set(enc.encode('0'), 156);
    h.set(enc.encode('ustar\0'), 257);
    parts.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const ENTRY = {
  raw_html:
    "<button type='button' role='link' aria-label=\" ASSOCIATE BUILDERS versus DELHI DEVELOPMENT AUTHORITY pdf\" onclick=open_pdf('1','2014','2014_13_895_956','2014INSC809');><font size='4'> <strong>ASSOCIATE BUILDERS <span class='fst-italic'> versus </span>DELHI DEVELOPMENT AUTHORITY</strong>- <span class='escrText'>[2014] 13 S.C.R. 895</span><span class='ncDisplay'>2014 INSC 809</span></button></font><br><strong>Coram : RANJAN GOGOI, ROHINTON FALI NARIMAN</strong><br><strong class='caseDetailsTD' ><span style='color:#212F3D' > Decision Date :</span><font color='green'> 25-11-2014</font>",
  path: '2014_13_895_956',
  citation_year: '2014',
  nc_display: '2014INSC809',
};

describe('Supreme Court Reports mirror', () => {
  it('reads a catalogue entry: name, citations, date, Bench', () => {
    expect(parseCatalogEntry(ENTRY, '2014')).toEqual({
      title: 'ASSOCIATE BUILDERS versus DELHI DEVELOPMENT AUTHORITY',
      citation: '[2014] 13 S.C.R. 895',
      neutralCitation: '2014 INSC 809',
      decidedOn: '2014-11-25',
      path: '2014_13_895_956',
      year: '2014',
      judges: 'RANJAN GOGOI, ROHINTON FALI NARIMAN',
      english: true,
    });
  });

  it('reads the files of a tar archive', () => {
    const files = untar(tar([{ name: 'a.json', body: '{"x":1}' }, { name: 'b.json', body: 'y'.repeat(700) }]));
    expect(files.map((f) => [f.name, f.data.length])).toEqual([
      ['a.json', 7],
      ['b.json', 700],
    ]);
  });

  it('reads a year once, keeps a small index in storage, and fetches PDFs by file key', async () => {
    const mem = new Map<string, Uint8Array>();
    const storage: Storage = { put: async (k, b) => void mem.set(k, b), get: async (k) => mem.get(k)!, exists: async (k) => mem.has(k) };
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.endsWith('metadata.tar')) return new Response(new Uint8Array(tar([{ name: '2014_13_895_956.json', body: JSON.stringify(ENTRY) }])));
      if (url.endsWith('_EN.pdf')) return new Response('%PDF-1.7 …');
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const escr = createEscr({ storage, fetchImpl, baseUrl: 'https://mirror.test', now: () => Date.UTC(2026, 10, 22) });
    const records = await escr.catalog(2014);
    expect(records).toHaveLength(1);
    expect(mem.has('escr/catalog/2014.json')).toBe(true);
    // A second client reads the stored index, not the archive (2014 is not a recent year).
    await createEscr({ storage, fetchImpl, baseUrl: 'https://mirror.test', now: () => Date.UTC(2026, 10, 22) }).catalog(2014);
    expect(urls.filter((u) => u.endsWith('metadata.tar'))).toHaveLength(1);
    const pdf = await escr.pdf(records[0]!);
    expect(pdf.url).toBe('https://mirror.test/data/pdf/year=2014/english/2014_13_895_956_EN.pdf');
  });
});
