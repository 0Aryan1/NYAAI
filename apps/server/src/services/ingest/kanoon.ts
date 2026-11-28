/**
 * Load one judgment from Indian Kanoon into the shared library (F2, HLD D25): provisional, with `expires_at`.
 * Stages 1–4 here (fetch, store, convert, split, metadata), then stages 5–7 in finish.ts.
 * Idempotent: the same Kanoon document (same content hash) updates the same source.
 * One case, one source: a Kanoon document whose link the library holds under another source (an official copy that
 * replaced it) is not loaded again (AlreadyHeldError).
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { casePartyWords, identifyCourt, kanoonToJudgment, splitJudgment, type HeldCase } from '@nyaai/legal';
import { PROMPTS, fence } from '@nyaai/prompts';
import type pg from 'pg';
import type { Gateway } from '../llm-gateway/index.ts';
import type { Kanoon } from '../kanoon/index.ts';
import type { Storage } from '../storage/index.ts';
import type { UsageSink } from '../usage/index.ts';
import { finishSource, type FinishDeps, type FinishResult } from './finish.ts';
import { sha256 } from '../../lib/hash.ts';

export interface KanoonIngestDeps extends FinishDeps {
  kanoon: Kanoon;
  storage: Storage;
  cacheDays: number;
}

export interface KanoonIngestResult extends FinishResult {
  sourceId: string;
  caseName: string;
  paragraphs: number;
  opinions: string[];
}

export const kanoonUrl = (tid: number | string) => `https://indiankanoon.org/doc/${tid}/`;

/** The case is already in the library, under another copy. */
export class AlreadyHeldError extends Error {
  constructor(readonly sourceId: string) {
    super(`This judgment is already in the library (source ${sourceId}), from another copy.`);
    this.name = 'AlreadyHeldError';
  }
}

/** Links the library holds (a source's own link, or a copy it keeps on record) → the source that holds each. */
export async function heldLinks(db: pg.Pool | pg.PoolClient, urls: string[]): Promise<Map<string, string>> {
  if (!urls.length) return new Map();
  const r = await db.query<{ url: string; source_id: string }>(
    `select s.url, s.id as source_id from sources s where s.url = any($1) and s.status <> 'retired'
     union
     select c.url, c.source_id from source_copies c join sources s on s.id = c.source_id where c.url = any($1) and s.status <> 'retired'`,
    [urls],
  );
  return new Map(r.rows.map((x) => [x.url, x.source_id]));
}

/** Every judgment the library holds, for the same-case check before a download. */
export async function heldJudgments(db: pg.Pool | pg.PoolClient): Promise<HeldCase[]> {
  const r = await db.query<{ id: string; title: string; decided_on: string | null; court_level: string | null }>(
    "select id, title, to_char(decided_on, 'YYYY-MM-DD') as decided_on, court_level from sources where type = 'judgment' and status <> 'retired'",
  );
  return r.rows.map((x) => ({ sourceId: x.id, title: x.title, decidedOn: x.decided_on, courtLevel: x.court_level }));
}
const FullName = z.object({ caseName: z.string().nullable() });

/** Kanoon shortens long titles with "...": ask the light model for the full name, and keep it only if it checks out. */
export async function fullCaseName(
  name: string,
  opening: string,
  gateway: Gateway | null,
  usage: UsageSink,
  knownName?: string,
  /** The caller already matched both parties of knownName against Kanoon's search title. */
  verified = false,
): Promise<string> {
  // Cut short: "…" at the end, a dangling "And"/"&", or no second party at all.
  const cut = /\.\.\.|…/.test(name) || /(?:\band|&)\s*$/i.test(name) || !/\s(?:v\.?|vs\.?)\s/i.test(name);
  if (!cut) return name;
  // A person named the case (a course pack): use that name when its first party is in Kanoon's title and its other
  // party is in the judgment's opening (or both were matched against Kanoon's search title). Checked in code.
  if (knownName) {
    const [first, second] = casePartyWords(knownName);
    const inTitle = !first || name.toLowerCase().includes(first);
    const inOpening = !second || opening.toLowerCase().includes(second);
    if ((first || second) && inTitle && (inOpening || verified))
      return knownName.replace(/\s+vs\.?\s+/i, ' v. ').trim();
  }
  if (!gateway) return name.replace(/\s*(\.\.\.|…)\s*$/, '');
  const prefix = name.split(/\s*(?:\.\.\.|…)/)[0]!.trim();
  const boundary = randomBytes(6).toString('hex');
  const r = await gateway.run(
    {
      prompt: PROMPTS['extract.metadata'],
      schema: FullName,
      task: `The title is cut short: "${name}".\n${fence('judgment opening', opening.slice(0, 6000), boundary)}`,
    },
    usage,
  );
  const full = r.data.caseName?.replace(/\s+vs\.?\s+/i, ' v. ').trim();
  // Validation in code (LLD §6.5): it must extend what we already know and name two parties.
  const ok =
    full &&
    / v\. /.test(full) &&
    full.toLowerCase().startsWith(prefix.toLowerCase().slice(0, 12)) &&
    opening.includes(full.split(' v. ')[1]!.slice(0, 12));
  return ok ? full : prefix;
}

export async function ingestKanoonJudgment(
  tid: number,
  deps: KanoonIngestDeps,
  opts: { knownName?: string; nameVerified?: boolean } = {},
): Promise<KanoonIngestResult> {
  const { library } = deps;
  const url = kanoonUrl(tid);
  // Held under another source (its official copy replaced this text): loading it again would make a second source.
  // The same source (its own link) is a refresh and goes ahead.
  const own = (await library.query("select 1 from sources where url = $1 and status <> 'retired'", [url])).rowCount;
  const holder = own ? null : (await heldLinks(library, [url])).get(url);
  if (holder) throw new AlreadyHeldError(holder);
  await deps.progress?.('reading');
  const doc = await deps.kanoon.doc(tid);
  const raw = JSON.stringify(doc);
  const hash = sha256(doc.doc);
  const key = `sources/indian_kanoon/${hash}.json`;
  if (!(await deps.storage.exists(key))) await deps.storage.put(key, new TextEncoder().encode(raw), 'application/json');

  await deps.progress?.('cleaning');
  const input = kanoonToJudgment(doc);
  const split = splitJudgment(input);
  const court = identifyCourt(input.court);
  const opening = split.chunks
    .filter((c) => c.kind !== 'headnote')
    .slice(0, 3)
    .map((c) => c.text)
    .join('\n');
  const caseName = await fullCaseName(
    input.caseName,
    opening,
    deps.gateway,
    deps.usage,
    opts.knownName,
    opts.nameVerified,
  );
  const year = input.decidedOn?.slice(0, 4);
  const base = year ? `${caseName} (${year})` : caseName;

  const client = await library.connect();
  let sourceId: string;
  try {
    await client.query('begin');
    sourceId = (
      await client.query<{ id: string }>(
        `insert into sources (college_id, visibility, type, origin, title, citation, court, court_level, bench_size, decided_on,
                              url, storage_key, content_hash, status, fetched_at, expires_at)
         values (global_college(), 'shared', 'judgment', 'indian_kanoon', $1, $2, $3, $4, $5, $6, $7, $8, $9, 'processing', now(),
                 now() + make_interval(days => $10))
         on conflict (origin, content_hash) do update
           set title = excluded.title, citation = excluded.citation, court = excluded.court, court_level = excluded.court_level,
               bench_size = excluded.bench_size, decided_on = excluded.decided_on, fetched_at = now(), expires_at = excluded.expires_at,
               -- the paragraphs are rebuilt and labelled again, so the editor's role check no longer applies
               roles_sampled = false
         returning id`,
        [
          caseName,
          input.citations.join('; ') || null,
          court?.court ?? null,
          court?.level ?? null,
          split.benchSize || null,
          input.decidedOn,
          url,
          key,
          hash,
          deps.cacheDays,
        ],
      )
    ).rows[0]!.id;
    await client.query('delete from chunks where source_id = $1', [sourceId]);
    for (const c of split.chunks) {
      // The splitter built headers from Kanoon's possibly shortened title; use the checked full name.
      const header = c.header.replace(/^.*? › /, `${base} › `).replace(/^[^›]*\(\d{4}\)$/, base);
      await client.query(
        `insert into chunks (college_id, owner_id, visibility, source_id, seq, kind, header, para_no, para_no_source, page_no,
                             opinion, judge, para_role, court, court_level, decided_on, source_type, text, content_hash, status)
         values (global_college(), null, 'shared', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'judgment', $14, $15, 'processing')`,
        [
          sourceId,
          c.seq,
          c.kind,
          header,
          c.paraNo,
          c.paraNoSource,
          c.pageNo,
          c.opinion,
          c.judge,
          c.role,
          court?.court ?? null,
          court?.level ?? null,
          input.decidedOn,
          c.text,
          sha256(`${header}\n${c.text}`),
        ],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  const finished = await finishSource(sourceId, deps);
  return {
    ...finished,
    sourceId,
    caseName,
    paragraphs: split.chunks.filter((c) => c.kind !== 'headnote').length,
    opinions: split.opinions.map((o) => `${o.type}${o.judge ? ` (${o.judge})` : ''}`),
  };
}
