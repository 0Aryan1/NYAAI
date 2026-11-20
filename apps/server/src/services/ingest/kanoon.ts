/**
 * Load one judgment from Indian Kanoon into the shared library (F2, HLD D25): provisional, with `expires_at`.
 * Stages 1–4 here (fetch, store, convert, split, metadata), then stages 5–7 in finish.ts.
 * Idempotent: the same Kanoon document (same content hash) updates the same source.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { identifyCourt, kanoonToJudgment, splitJudgment } from '@nyaai/legal';
import { PROMPTS, fence } from '@nyaai/prompts';
import type { Gateway } from '../llm-gateway/index.ts';
import type { Kanoon } from '../kanoon/index.ts';
import type { Storage } from '../storage/index.ts';
import type { UsageSink } from '../usage.ts';
import { finishSource, type FinishDeps, type FinishResult } from './finish.ts';

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

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const FullName = z.object({ caseName: z.string().nullable() });

/** Kanoon shortens long titles with "...": ask the light model for the full name, and keep it only if it checks out. */
async function fullCaseName(name: string, opening: string, gateway: Gateway | null, usage: UsageSink): Promise<string> {
  if (!/\.\.\.|…/.test(name) || !gateway) return name.replace(/\s*(\.\.\.|…)\s*$/, '');
  const prefix = name.split(/\s*(?:\.\.\.|…)/)[0]!.trim();
  const boundary = randomBytes(6).toString('hex');
  const r = await gateway.run(
    { prompt: PROMPTS['extract.metadata'], schema: FullName, task: `The title is cut short: "${name}".\n${fence('judgment opening', opening.slice(0, 6000), boundary)}` },
    usage,
  );
  const full = r.data.caseName?.replace(/\s+vs\.?\s+/i, ' v. ').trim();
  // Validation in code (LLD §6.5): it must extend what we already know and name two parties.
  const ok = full && / v\. /.test(full) && full.toLowerCase().startsWith(prefix.toLowerCase().slice(0, 12)) && opening.includes(full.split(' v. ')[1]!.slice(0, 12));
  return ok ? full : prefix;
}

export async function ingestKanoonJudgment(tid: number, deps: KanoonIngestDeps): Promise<KanoonIngestResult> {
  const { library } = deps;
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
  const opening = split.chunks.filter((c) => c.kind !== 'headnote').slice(0, 3).map((c) => c.text).join('\n');
  const caseName = await fullCaseName(input.caseName, opening, deps.gateway, deps.usage);
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
               bench_size = excluded.bench_size, decided_on = excluded.decided_on, fetched_at = now(), expires_at = excluded.expires_at
         returning id`,
        [caseName, input.citations.join('; ') || null, court?.court ?? null, court?.level ?? null, split.benchSize || null,
         input.decidedOn, `https://indiankanoon.org/doc/${tid}/`, key, hash, deps.cacheDays],
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
        [sourceId, c.seq, c.kind, header, c.paraNo, c.paraNoSource, c.pageNo, c.opinion, c.judge, c.role,
         court?.court ?? null, court?.level ?? null, input.decidedOn, c.text, sha256(`${header}\n${c.text}`)],
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
