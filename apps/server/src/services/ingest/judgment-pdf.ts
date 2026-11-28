/**
 * Load a judgment from an official PDF: the Supreme Court Reports (e-SCR) or a PDF the library editor uploads
 * (HLD D25, BRD DATA-7). Stages 1–4 here (store, read, split, write), then stages 5–7 in finish.ts.
 *
 * With `replace` (the library already holds this case, from Indian Kanoon):
 * - the official copy must contain the text in use (≥ 60% of its word runs), or nothing changes (`mismatch`);
 * - a typeset official copy replaces the text in place: same source row, and each paragraph whose text is the same
 *   keeps its id (citations and concept links still point at it) and its role label; the source stops expiring;
 * - a scanned official copy (machine-read, with reading errors) does not replace cleaner text: it is kept beside it
 *   (`source_copies`) with how far the two agree, and its citations are added (`kept_existing`).
 * Without `replace`: a new source. A scanned copy stays provisional, marked `scanned`, for the editor to check.
 */
import { createHash } from 'node:crypto';
import {
  identifyCourt,
  matchChunks,
  pdfToJudgment,
  splitJudgment,
  textAgreement,
  type JudgmentChunk,
  type PdfJudgmentHint,
} from '@nyaai/legal';
import type pg from 'pg';
import type { Storage } from '../storage/index.ts';
import { pdfLines } from './extract.ts';
import { finishSource, type FinishDeps, type FinishResult } from './finish.ts';

export interface JudgmentPdfDeps extends FinishDeps {
  storage: Storage;
}

export interface JudgmentPdf {
  bytes: Uint8Array;
  /** Where the copy came from (the official report's link, or the page the editor downloaded it from). */
  url: string | null;
  origin: 'court_site' | 'upload';
  /** Official citations, "[2014] 13 S.C.R. 895; 2014 INSC 809". */
  citation: string | null;
  hint: PdfJudgmentHint;
}

export type JudgmentPdfResult =
  | ({
      kind: 'loaded';
      sourceId: string;
      paragraphs: number;
      opinions: string[];
      scanned: boolean;
      replaced: boolean;
      keptIds: number;
      keptRoles: number;
      agreement: number | null;
    } & FinishResult)
  | { kind: 'kept_existing'; sourceId: string; agreement: number }
  | { kind: 'mismatch'; sourceId: string; agreement: number }
  | { kind: 'duplicate'; sourceId: string };

/** Share of the text in use that the new copy must contain to be the same judgment. */
export const SAME_JUDGMENT = 0.6;

const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

interface OldChunk {
  id: string;
  kind: string;
  text: string;
  para_role: string | null;
}

export async function loadJudgmentPdf(
  pdf: JudgmentPdf,
  deps: JudgmentPdfDeps,
  /** `resplit`: the text in use already comes from this same file (a splitter fix), so a scan may replace it. */
  opts: { replace?: string | null; sourceId?: string | null; provisional?: boolean; resplit?: boolean } = {},
): Promise<JudgmentPdfResult> {
  const { library } = deps;
  await deps.progress?.('reading');
  const hash = sha256(pdf.bytes);
  const key = `sources/${pdf.origin}/${hash}.pdf`;
  if (!(await deps.storage.exists(key))) await deps.storage.put(key, pdf.bytes, 'application/pdf');

  await deps.progress?.('cleaning');
  const doc = await pdfLines(pdf.bytes);
  const input = pdfToJudgment(doc, pdf.hint);
  const split = splitJudgment(input);
  const court = identifyCourt(input.court);
  const body = (chunks: { kind: string; text: string }[]) =>
    chunks
      .filter((c) => c.kind !== 'headnote')
      .map((c) => c.text)
      .join('\n');
  const opinions = split.opinions.map((o) => `${o.type}${o.judge ? ` (${o.judge})` : ''}`);
  const paragraphs = split.chunks.filter((c) => c.kind !== 'headnote').length;

  const copyRow = (client: pg.PoolClient, sourceId: string, inUse: boolean, agreement: number | null) =>
    client.query(
      `insert into source_copies (college_id, source_id, origin, url, storage_key, content_hash, citation, scanned, agreement, in_use)
       values (global_college(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source_id, content_hash) do update
         set url = excluded.url, citation = excluded.citation, agreement = excluded.agreement, in_use = excluded.in_use`,
      [sourceId, pdf.origin, pdf.url, key, hash, pdf.citation, doc.scanned, agreement, inUse],
    );

  const client = await library.connect();
  let sourceId: string;
  let agreement: number | null = null;
  let keptIds = 0;
  let keptRoles = 0;
  let replaced = false;
  try {
    await client.query('begin');
    const taken = (
      await client.query<{ id: string }>(
        'select id from sources where origin = $1 and content_hash = $2 and id <> coalesce($3::uuid, gen_random_uuid())',
        [pdf.origin, hash, opts.replace ?? opts.sourceId ?? null],
      )
    ).rows[0];
    if (taken) {
      await client.query('rollback');
      return { kind: 'duplicate', sourceId: taken.id };
    }

    if (opts.replace) {
      sourceId = opts.replace;
      const old = (
        await client.query<OldChunk>('select id, kind, text, para_role from chunks where source_id = $1 order by seq', [
          sourceId,
        ])
      ).rows;
      agreement = Math.round(textAgreement(body(old), body(split.chunks)).aInB * 1000) / 1000;
      if (agreement < SAME_JUDGMENT || (doc.scanned && !opts.resplit)) {
        await copyRow(client, sourceId, false, agreement);
        if (agreement >= SAME_JUDGMENT && pdf.citation) {
          // The official citations belong on the case even when its scan is not used as the text.
          await client.query(
            `update sources set citation = case when citation is null or citation = '' then $2
                                               when position($2 in citation) > 0 then citation else citation || '; ' || $2 end
              where id = $1`,
            [sourceId, pdf.citation],
          );
        }
        await client.query('commit');
        return { kind: agreement < SAME_JUDGMENT ? 'mismatch' : 'kept_existing', sourceId, agreement };
      }
      await keepReplacedCopy(client, sourceId, agreement, hash);
      await client.query(
        `update sources set origin = $2, url = $3, storage_key = $4, content_hash = $5, citation = coalesce($6, citation),
                court = coalesce($7, court), court_level = coalesce($8, court_level), bench_size = coalesce($9, bench_size),
                decided_on = coalesce($10, decided_on), fetched_at = now(), expires_at = null, scanned = $11, status = 'processing'
          where id = $1`,
        [
          sourceId,
          pdf.origin,
          pdf.url,
          key,
          hash,
          pdf.citation,
          court?.court ?? null,
          court?.level ?? null,
          split.benchSize || null,
          input.decidedOn,
          doc.scanned,
        ],
      );
      const r = await writeChunks(client, sourceId, split.chunks, old, input.decidedOn, court);
      keptIds = r.keptIds;
      keptRoles = r.keptRoles;
      // The editor's "Labels checked" covered the old paragraphs; it still holds only if every one carried over.
      if (r.keptRoles < split.chunks.filter((c) => c.kind !== 'headnote').length || r.removed > 0) {
        await client.query('update sources set roles_sampled = false where id = $1', [sourceId]);
      }
      await client.query('update source_copies set in_use = false where source_id = $1', [sourceId]);
      replaced = true;
    } else {
      sourceId =
        opts.sourceId ??
        (
          await client.query<{ id: string }>(
            `insert into sources (college_id, visibility, type, origin, title, content_hash, status) values (global_college(), 'shared', 'judgment', $1, $2, $3, 'processing') returning id`,
            [pdf.origin, pdf.hint.caseName, hash],
          )
        ).rows[0]!.id;
      await client.query(
        `update sources set origin = $2, title = $3, citation = $4, court = $5, court_level = $6, bench_size = $7, decided_on = $8, url = $9,
                storage_key = $10, content_hash = $11, scanned = $12, fetched_at = now(), expires_at = null, status = 'processing'
          where id = $1`,
        [
          sourceId,
          pdf.origin,
          pdf.hint.caseName,
          pdf.citation,
          court?.court ?? null,
          court?.level ?? null,
          split.benchSize || null,
          input.decidedOn,
          pdf.url,
          key,
          hash,
          doc.scanned,
        ],
      );
      await writeChunks(client, sourceId, split.chunks, [], input.decidedOn, court);
    }
    await copyRow(client, sourceId, true, agreement);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  // A scanned copy is never official-and-live by itself: its reading errors need the editor's eye.
  const finished = await finishSource(sourceId, { ...deps, provisional: opts.provisional || doc.scanned });
  return {
    kind: 'loaded',
    sourceId,
    paragraphs,
    opinions,
    scanned: doc.scanned,
    replaced,
    keptIds,
    keptRoles,
    agreement,
    ...finished,
  };
}

/**
 * The copy being replaced stays on record, not in use (its Kanoon link most of all), so a later lookup knows the case
 * is held and does not load it again (0012).
 */
export async function keepReplacedCopy(
  client: pg.PoolClient,
  sourceId: string,
  agreement: number | null,
  newHash: string,
): Promise<void> {
  await client.query(
    `insert into source_copies (college_id, source_id, origin, url, storage_key, content_hash, citation, scanned, agreement, in_use)
     select global_college(), id, origin, url, storage_key, content_hash, citation, scanned, $2, false
       from sources where id = $1 and storage_key is not null and content_hash <> $3
     on conflict (source_id, content_hash) do nothing`,
    [sourceId, agreement, newHash],
  );
}

/**
 * Write the new chunks. A new paragraph that matches an old one takes over its id; its role label carries over when
 * the text is the same paragraph (else the rules' label, or none for the labeller). Changed text loses its embedding.
 * Old chunks with no match are deleted.
 */
async function writeChunks(
  client: pg.PoolClient,
  sourceId: string,
  chunks: JudgmentChunk[],
  old: OldChunk[],
  decidedOn: string | null,
  court: { court: string; level: string } | null,
): Promise<{ keptIds: number; keptRoles: number; removed: number }> {
  const oldBody = old.filter((c) => c.kind !== 'headnote');
  const freshBody = chunks.filter((c) => c.kind !== 'headnote');
  const matches = matchChunks(
    oldBody,
    freshBody.map((c) => c.text),
  );
  const byChunk = new Map(freshBody.map((c, i) => [c, matches[i]!]));
  const oldHeadnote = old.find((c) => c.kind === 'headnote');
  // Hashes are unique per source: clear the old ones first, so a paragraph that moves cannot collide mid-way.
  if (old.length)
    await client.query("update chunks set content_hash = 'replacing:' || id where source_id = $1", [sourceId]);
  const used = new Set<string>();
  let keptIds = 0;
  let keptRoles = 0;
  for (const c of chunks) {
    const m =
      c.kind === 'headnote'
        ? oldHeadnote
          ? { id: oldHeadnote.id, same: false }
          : { id: null, same: false }
        : byChunk.get(c)!;
    const prior = m.id ? old.find((o) => o.id === m.id) : undefined;
    const role = c.kind === 'headnote' ? 'headnote' : m.same && prior?.para_role ? prior.para_role : c.role;
    const values = [
      c.seq,
      c.kind,
      c.header,
      c.paraNo,
      c.paraNoSource,
      c.pageNo,
      c.opinion,
      c.judge,
      role,
      court?.court ?? null,
      court?.level ?? null,
      decidedOn,
      c.text,
      sha256(`${c.header}\n${c.text}`),
    ];
    if (m.id && prior) {
      used.add(m.id);
      keptIds++;
      if (m.same && prior.para_role) keptRoles++;
      await client.query(
        `update chunks set seq = $2, kind = $3, header = $4, para_no = $5, para_no_source = $6, page_no = $7, opinion = $8, judge = $9,
                para_role = $10, court = $11, court_level = $12, decided_on = $13, text = $14, content_hash = $15, status = 'processing',
                embedding = case when text = $14 and header is not distinct from $4 then embedding end,
                embed_model = case when text = $14 and header is not distinct from $4 then embed_model end
          where id = $1`,
        [m.id, ...values],
      );
    } else {
      await client.query(
        `insert into chunks (college_id, owner_id, visibility, source_id, seq, kind, header, para_no, para_no_source, page_no,
                             opinion, judge, para_role, court, court_level, decided_on, source_type, text, content_hash, status)
         values (global_college(), null, 'shared', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'judgment', $14, $15, 'processing')`,
        [sourceId, ...values],
      );
    }
  }
  const removed = old.filter((o) => !used.has(o.id)).map((o) => o.id);
  if (removed.length) await client.query('delete from chunks where id = any($1::uuid[])', [removed]);
  return { keptIds, keptRoles, removed: removed.length };
}
