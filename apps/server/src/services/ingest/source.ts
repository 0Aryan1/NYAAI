/**
 * `ingest.source` for the shared library (LLD §6.1), stages 1–4: fetch → extract → clean → split.
 * Runs as nyaai_library, which may write shared rows only. Idempotent: a re-run replaces the source's chunks.
 * Stages 5–7 (labels, Voyage embeddings, quality gate → live) are Day 2, so chunks stay `processing`.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { cleanPages, missingSections, splitStatute, type StatuteChunk } from '@nyaai/legal';
import type { IngestStage } from '@nyaai/shared';
import type { Storage } from '../storage/index.ts';
import { extractPages, fetchOriginal } from './extract.ts';

export interface IngestDeps {
  library: pg.Pool;
  storage: Storage;
  /** Progress for the chip that started it (ingest.progress). */
  progress?: (stage: IngestStage) => Promise<void> | void;
  allowFile?: boolean;
}

export type IngestResult =
  | {
      kind: 'done';
      chunks: number;
      units: number;
      pages: number;
      hash: string;
      /** Section numbers absent between 1 and the last: lost text. */
      missing: number[];
      /** Chunks of an earlier load that the new split no longer has. */
      removed: number;
    }
  | { kind: 'duplicate'; duplicateOf: string };

interface SourceRow {
  id: string;
  college_id: string;
  type: string;
  origin: string;
  title: string;
  url: string | null;
  act_name: string | null;
  act_year: number | null;
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

export async function ingestSource(sourceId: string, deps: IngestDeps): Promise<IngestResult> {
  const { library, storage } = deps;
  const progress = async (s: IngestStage) => deps.progress?.(s);

  const src = (await library.query<SourceRow>('select id, college_id, type, origin, title, url, act_name, act_year from sources where id = $1', [sourceId]))
    .rows[0];
  if (!src) throw new Error(`source ${sourceId} not found (or not a shared source)`);
  if (!src.url) throw new Error(`source ${sourceId} has no url`);
  if (src.type !== 'act' && src.type !== 'constitution') throw new Error(`no splitter yet for source type ${src.type}`);

  // 1. Fetch, hash, store; stop if this exact document is already in the library.
  await progress('reading');
  const original = await fetchOriginal(src.url, { allowFile: deps.allowFile });
  const hash = sha256(original.bytes);
  const twin = (await library.query<{ id: string }>('select id from sources where origin = $1 and content_hash = $2 and id <> $3', [src.origin, hash, src.id]))
    .rows[0];
  if (twin) {
    await library.query("update sources set status = 'retired', holding_note = $2 where id = $1", [src.id, `Duplicate of ${twin.id}`]);
    return { kind: 'duplicate', duplicateOf: twin.id };
  }
  const key = `sources/${src.origin}/${hash}.${original.ext}`;
  if (!(await storage.exists(key))) await storage.put(key, original.bytes, original.contentType);

  // 2–3. Extract and clean.
  await progress('cleaning');
  const pages = await extractPages(original, src.url);
  const lines = cleanPages(pages);

  // 4. Split by legal structure.
  await progress('indexing');
  const units = splitStatute(lines, {
    actName: src.act_name ?? src.title,
    actYear: src.act_year ?? undefined,
    kind: src.type === 'constitution' ? 'constitution' : 'act',
    wholeDocument: true,
  });
  if (units.length === 0) throw new Error('No sections were found; the document may not be a statute.');

  let removed: number;
  const client = await library.connect();
  try {
    await client.query('begin');
    // Re-loading a source (after a splitter fix) keeps each section's chunk id, so citations, concept links and the
    // Studio's source drawer still point at it. Changed text loses its embedding and is embedded again.
    const existing = new Map(
      (
        await client.query<{ id: string; kind: string; section: string | null; article: string | null; header: string | null }>(
          'select id, kind, section, article, header from chunks where source_id = $1',
          [src.id],
        )
      ).rows.map((r) => [existingKey(src, r), r.id]),
    );
    const ids = new Map<string, string>();
    for (const u of units) {
      const id = existing.get(u.key);
      if (id) {
        await updateChunk(client, src, u, id, ids);
        existing.delete(u.key);
        ids.set(u.key, id);
      } else ids.set(u.key, await insertChunk(client, src, u, ids));
    }
    // Sections the new split no longer has (a footnote once taken for a section): children first.
    if (existing.size) {
      const gone = [...existing.values()];
      await client.query('delete from chunks where id = any($1) and parent_id is not null', [gone]);
      await client.query('delete from chunks where id = any($1)', [gone]);
    }
    removed = existing.size;
    await client.query(
      "update sources set content_hash = $2, storage_key = $3, fetched_at = now(), status = 'processing' where id = $1",
      [src.id, hash, key],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
  return {
    kind: 'done',
    chunks: units.length,
    units: units.filter((u) => u.parentKey === null).length,
    pages: pages.length,
    hash,
    missing: src.type === 'act' ? missingSections(units) : [],
    removed,
  };
}

/** The splitter's key ("s56", "s56(2)", "a19(1)") for a stored chunk. */
function existingKey(src: SourceRow, r: { kind: string; section: string | null; article: string | null; header: string | null }): string {
  const base = `${src.type === 'constitution' ? 'a' : 's'}${r.section ?? r.article}`;
  const sub = r.kind === 'subsection' ? /\(([^()]+)\)\s*$/.exec(r.header ?? '')?.[1] : null;
  return sub ? `${base}(${sub})` : base;
}

async function updateChunk(c: pg.PoolClient, src: SourceRow, u: StatuteChunk, id: string, ids: Map<string, string>): Promise<void> {
  const hash = sha256(`${u.header}\n${u.text}`);
  await c.query(
    `update chunks set parent_id = $2, seq = $3, kind = $4, header = $5, act_name = $6, act_year = $7, chapter = $8, page_no = $9,
                       law_status = $10, valid_from = $11, amendments = $12::jsonb, text = $13, content_hash = $14, status = 'processing',
                       embedding = case when content_hash = $14 then embedding end,
                       embed_model = case when content_hash = $14 then embed_model end
      where id = $1`,
    [
      id,
      u.parentKey ? (ids.get(u.parentKey) ?? null) : null,
      u.seq,
      u.kind,
      u.header,
      src.act_name ?? src.title,
      src.act_year,
      u.chapter,
      u.pageNo,
      u.lawStatus,
      u.validFrom,
      JSON.stringify(u.amendments),
      u.text,
      hash,
    ],
  );
}

async function insertChunk(c: pg.PoolClient, src: SourceRow, u: StatuteChunk, ids: Map<string, string>): Promise<string> {
  const isConst = src.type === 'constitution';
  const r = await c.query<{ id: string }>(
    `insert into chunks (college_id, owner_id, visibility, source_id, parent_id, seq, kind, header,
                         act_name, act_year, chapter, section, article, page_no, law_status, valid_from, amendments,
                         source_type, language, text, content_hash, status)
     values ($1, null, 'shared', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, 'en', $17, $18, 'processing')
     returning id`,
    [
      src.college_id,
      src.id,
      u.parentKey ? (ids.get(u.parentKey) ?? null) : null,
      u.seq,
      u.kind,
      u.header,
      src.act_name ?? src.title,
      src.act_year,
      u.chapter,
      isConst ? null : u.number,
      isConst ? u.number : null,
      u.pageNo,
      u.lawStatus,
      u.validFrom,
      JSON.stringify(u.amendments),
      src.type,
      u.text,
      sha256(`${u.header}\n${u.text}`),
    ],
  );
  return r.rows[0]!.id;
}
