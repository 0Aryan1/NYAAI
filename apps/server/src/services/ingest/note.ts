/**
 * A teacher's own notes (migration 0013, BRD DATA-5): read one upload into her private library, as her.
 *
 *  1. Read: Word (.docx: headings from the paragraph styles), PDF (headings from larger or numbered lines) or plain
 *     text / Markdown. A scanned PDF has no text to read: she is asked for a Word copy.
 *  2. Split: one chunk per heading block (packages/legal `splitNotes`), headers "Your notes: <title> › <heading>".
 *  3. Index: embedded like the library, so a lecture that attaches it can search it.
 *  4. Save: a private source (type teacher_note, origin upload) and its chunks, visible only to her (row security).
 *     A newer version marks the one it replaces as replaced and takes its text out of search.
 *
 * Runs as nyaai_worker inside her own transactions; the job carries ids only.
 */
import JSZip from 'jszip';
import type pg from 'pg';
import { withTenant, type TenantIdentity } from '@nyaai/db';
import { pdfBlocks, splitNotes, textBlocks, type NoteBlock } from '@nyaai/legal';
import { NOTE_MIME_TYPES, type NoteKind } from '@nyaai/shared';
import type { Storage } from '../storage/index.ts';
import { usageSink, type UsageSink } from '../usage.ts';
import { toVector, type Voyage } from '../voyage/index.ts';
import { NoTextLayerError, pdfLines } from './extract.ts';
import { sha256 } from '../../lib/hash.ts';

/** A reason she can act on, shown on her notes list. */
export class NoteReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoteReadError';
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, n, d, h) =>
    n ? XML_ENTITIES[n]! : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)),
  );

/** Word: each paragraph, with its heading level from the style ("Heading 2", "Title") or its outline level. */
export async function docxBlocks(bytes: Uint8Array): Promise<NoteBlock[]> {
  let xml: string | undefined;
  try {
    xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string');
  } catch {
    xml = undefined;
  }
  if (!xml) throw new NoteReadError('This is not a Word document we can read. Save it as .docx or PDF and try again.');
  const out: NoteBlock[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = unxml(
      (p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
        .map((r) => (r.startsWith('<w:t') && !r.startsWith('<w:tab') ? r.replace(/<[^>]+>/g, '') : ' '))
        .join(''),
    ).trim();
    if (!text) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const outline = /<w:outlineLvl w:val="(\d)"/.exec(p)?.[1];
    const level = /^title$/i.test(style)
      ? 1
      : Number(/heading\s*(\d)/i.exec(style)?.[1] ?? (outline !== undefined ? Number(outline) + 1 : NaN));
    out.push({ text, heading: Number.isFinite(level) ? level : null });
  }
  return out;
}

export async function readNote(bytes: Uint8Array, kind: NoteKind): Promise<NoteBlock[]> {
  if (kind === 'docx') return docxBlocks(bytes);
  if (kind === 'pdf') {
    try {
      return pdfBlocks(await pdfLines(bytes));
    } catch (err) {
      if (err instanceof NoTextLayerError)
        throw new NoteReadError('This PDF is a scan with no text in it. Upload a Word copy or a typed PDF.');
      throw err;
    }
  }
  return textBlocks(new TextDecoder().decode(bytes));
}

export interface NoteIngestDeps {
  worker: pg.Pool;
  storage: Storage;
  voyageFor: (usage: UsageSink) => Voyage;
  embedModel: string;
}

interface UploadRow {
  id: string;
  title: string | null;
  file_name: string;
  mime: string;
  storage_key: string;
  source_id: string | null;
  status: string;
  replaces: string | null;
}

/** Takes a source and its chunks out of search (a deleted or replaced upload). Citations keep their saved words. */
async function retire(c: pg.PoolClient, sourceId: string | null) {
  if (!sourceId) return;
  await c.query("update sources set status = 'retired' where id = $1", [sourceId]);
  await c.query("update chunks set status = 'retired' where source_id = $1", [sourceId]);
}

export type NoteIngestResult =
  | { kind: 'ready'; sourceId: string; sections: number }
  | { kind: 'removed' }
  | { kind: 'failed'; reason: string }
  | { kind: 'skipped' };

export async function ingestUpload(
  uploadId: string,
  who: TenantIdentity,
  deps: NoteIngestDeps,
): Promise<NoteIngestResult> {
  const tenant = <T>(fn: (c: pg.PoolClient) => Promise<T>) => withTenant(deps.worker, who, fn);
  const u = await tenant(
    async (c) =>
      (
        await c.query<UploadRow>(
          'select id, title, file_name, mime, storage_key, source_id, status, replaces from uploads where id = $1',
          [uploadId],
        )
      ).rows[0],
  );
  if (!u) return { kind: 'skipped' };
  if (u.status === 'deleted') {
    await tenant((c) => retire(c, u.source_id));
    return { kind: 'removed' };
  }
  if (u.status === 'ready' || u.status === 'replaced') return { kind: 'skipped' };
  await tenant((c) => c.query("update uploads set status = 'reading', error = null where id = $1", [uploadId]));

  const kind = NOTE_MIME_TYPES[u.mime as keyof typeof NOTE_MIME_TYPES];
  const title = u.title?.trim() || u.file_name.replace(/\.[a-z0-9]+$/i, '');
  try {
    if (!kind) throw new NoteReadError('Upload a Word document (.docx), a PDF or a text file.');
    const chunks = splitNotes(title, await readNote(await deps.storage.get(u.storage_key), kind));
    if (!chunks.length) throw new NoteReadError('We found no text in this document.');

    // Her indexing cost is logged as hers.
    const usage: UsageSink = (row) =>
      tenant((c) => usageSink(c, { collegeId: who.collegeId, ownerId: who.userId })(row));
    const voyage = deps.voyageFor(usage);
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += 64)
      vectors.push(
        ...(await voyage.embed(
          chunks.slice(i, i + 64).map((c) => `${c.header}\n${c.text}`),
          'document',
          'embed.notes',
        )),
      );

    const sourceId = await tenant(async (c) => {
      // One source per upload: the same file uploaded twice is two documents she can delete separately.
      const id = (
        await c.query<{ id: string }>(
          `insert into sources (college_id, owner_id, visibility, type, origin, title, storage_key, content_hash, status, fetched_at)
           values ($1, $2, 'private', 'teacher_note', 'upload', $3, $4, $5, 'live', now())
           on conflict (origin, content_hash) do update set title = excluded.title, status = 'live'
           returning id`,
          [who.collegeId, who.userId, title, u.storage_key, `upload:${uploadId}`],
        )
      ).rows[0]!.id;
      await c.query('delete from chunks where source_id = $1', [id]);
      for (const [i, ch] of chunks.entries()) {
        await c.query(
          `insert into chunks (college_id, owner_id, visibility, source_id, seq, kind, header, source_type, text, content_hash, status, embedding, embed_model)
           values ($1, $2, 'private', $3, $4, 'heading_block', $5, 'teacher_note', $6, $7, 'live', $8::vector, $9)`,
          [
            who.collegeId,
            who.userId,
            id,
            ch.seq,
            ch.header,
            ch.text,
            sha256(`${ch.header}\n${ch.text}`),
            toVector(vectors[i]!),
            deps.embedModel,
          ],
        );
      }
      await c.query("update uploads set status = 'ready', source_id = $2, sections = $3, error = null where id = $1", [
        uploadId,
        id,
        chunks.length,
      ]);
      // A newer version: the old one leaves search; lectures that attached it will use this one.
      if (u.replaces) {
        const old = (
          await c.query<{ source_id: string | null }>(
            "update uploads set status = 'replaced', replaced_by = $2 where id = $1 and status <> 'deleted' returning source_id",
            [u.replaces, uploadId],
          )
        ).rows[0];
        await retire(c, old?.source_id ?? null);
      }
      return id;
    });
    return { kind: 'ready', sourceId, sections: chunks.length };
  } catch (err) {
    const reason =
      err instanceof NoteReadError
        ? err.message
        : 'We could not read this document. Try again, or upload it as a Word document.';
    await tenant((c) => c.query("update uploads set status = 'failed', error = $2 where id = $1", [uploadId, reason]));
    if (err instanceof NoteReadError) return { kind: 'failed', reason };
    throw err;
  }
}

/**
 * The notes a lecture may use: each attached upload, followed to its newest version, if it is ready. Returns the
 * private source ids (the search filter) and their titles.
 */
export async function attachedNotes(
  c: pg.PoolClient,
  uploadIds: string[],
): Promise<{ uploadId: string; sourceId: string; title: string }[]> {
  if (!uploadIds.length) return [];
  const r = await c.query<{ id: string; source_id: string; title: string }>(
    `with recursive v as (
       select u.id as attached, u.id, u.replaced_by, 0 as depth from uploads u where u.id = any($1::uuid[])
       union all
       select v.attached, n.id, n.replaced_by, v.depth + 1 from v join uploads n on n.id = v.replaced_by where v.depth < 20)
     select distinct u.id, u.source_id, coalesce(s.title, u.title, u.file_name) as title
       from v join uploads u on u.id = v.id join sources s on s.id = u.source_id
      where v.replaced_by is null and u.status = 'ready' and s.status = 'live'`,
    [uploadIds],
  );
  return r.rows.map((x) => ({ uploadId: x.id, sourceId: x.source_id, title: x.title }));
}
