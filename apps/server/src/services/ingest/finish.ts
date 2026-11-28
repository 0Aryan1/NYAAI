/**
 * Ingestion stages 5–7 (LLD §6.1): label → embed → gate. Runs as nyaai_library on a shared source whose chunks
 * were written by stages 1–4. Idempotent: labels and embeddings already present are kept.
 *
 * - Label: judgment paragraphs the rules left unlabelled go to `labeller.roles` (Haiku, fixed answers); anything
 *   still unclear stays 'unknown'.
 * - Embed: Voyage `voyage-law-2` on `header + text`. A section split into children is searched through its
 *   children, so the parent is not embedded (it is still what the writer receives, LLD §7.5).
 * - Gate (LLD §6.6): required labels; official origin → live (plus a "sample this source" item for the library
 *   editor); Indian Kanoon → provisional ("not yet reviewed"); a chunk missing required labels → needs_review.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { PROMPTS, fence } from '@nyaai/prompts';
import type { IngestStage } from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import type { Voyage } from '../voyage/index.ts';
import { toVector } from '../voyage/index.ts';
import type { UsageSink } from '../usage.ts';

const OFFICIAL = new Set(['india_code', 'egazette', 'court_site', 'admin']);
const LABEL_BATCH_CHARS = 24_000;
const LABEL_PARA_CHARS = 4_000;

const Labels = z.object({
  labels: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['facts', 'arguments', 'lower_court_summary', 'discussion', 'holding', 'unknown']),
    }),
  ),
});

export interface FinishDeps {
  library: pg.Pool;
  voyage: Voyage;
  gateway: Gateway | null;
  usage: UsageSink;
  embedModel: string;
  progress?: (stage: IngestStage) => Promise<void> | void;
  /**
   * Keep an official source provisional ("not yet reviewed") instead of live. Set for sources the gap lookup found
   * by itself: the text is official, but which Act (and which edition) was picked has not been checked by a person.
   */
  provisional?: boolean;
}

export interface FinishResult {
  labelled: number;
  embedded: number;
  needsReview: number;
  status: 'live' | 'provisional' | 'needs_review';
}

interface ChunkRow {
  id: string;
  kind: string;
  header: string | null;
  text: string;
  source_type: string;
  act_name: string | null;
  section: string | null;
  article: string | null;
  court: string | null;
  decided_on: Date | null;
  para_no: string | null;
  para_role: string | null;
  has_children: boolean;
  embedded: boolean;
}

/** Required labels per chunk (LLD §6.6). Returns what is missing. */
function missingLabels(
  c: Pick<ChunkRow, 'source_type' | 'kind' | 'act_name' | 'section' | 'article' | 'court' | 'decided_on' | 'para_no'>,
): string[] {
  const missing: string[] = [];
  if (c.source_type === 'act' && (!c.act_name || !c.section)) missing.push('act and section');
  if (c.source_type === 'constitution' && !c.article) missing.push('article');
  if (c.source_type === 'judgment' && c.kind !== 'headnote') {
    if (!c.court) missing.push('court');
    if (!c.decided_on) missing.push('date');
    if (!c.para_no) missing.push('paragraph number');
  }
  return missing;
}

export async function finishSource(sourceId: string, deps: FinishDeps): Promise<FinishResult> {
  const { library } = deps;
  const src = (
    await library.query<{ id: string; origin: string; type: string; college_id: string }>(
      'select id, origin, type, college_id from sources where id = $1',
      [sourceId],
    )
  ).rows[0];
  if (!src) throw new Error(`source ${sourceId} not found`);
  const chunks = (
    await library.query<ChunkRow>(
      `select c.id, c.kind, c.header, c.text, c.source_type, c.act_name, c.section, c.article, c.court, c.decided_on, c.para_no, c.para_role,
              exists (select 1 from chunks k where k.parent_id = c.id) as has_children, c.embedding is not null as embedded
         from chunks c where c.source_id = $1 order by c.seq`,
      [sourceId],
    )
  ).rows;

  // 5. Label: judgment paragraphs the rules could not place.
  let labelled = 0;
  const unlabelled = chunks.filter(
    (c) => c.source_type === 'judgment' && c.kind !== 'headnote' && c.para_role === null,
  );
  if (unlabelled.length && deps.gateway) {
    for (const batch of batchByChars(unlabelled, LABEL_BATCH_CHARS)) {
      const boundary = randomBytes(6).toString('hex');
      const task = `Label each paragraph. Answer with one label per paragraph id.\n${batch
        .map((c) => fence(`paragraph id=${c.id}`, c.text.slice(0, LABEL_PARA_CHARS), boundary))
        .join('\n')}`;
      const r = await deps.gateway.run({ prompt: PROMPTS['labeller.roles'], schema: Labels, task }, deps.usage);
      const byId = new Map(r.data.labels.map((l) => [l.id, l.role]));
      for (const c of batch) {
        const role = byId.get(c.id) ?? 'unknown';
        await library.query('update chunks set para_role = $2 where id = $1', [c.id, role]);
        c.para_role = role;
        labelled++;
      }
    }
  }
  // Without the labeller (no key), unplaced paragraphs are honestly 'unknown'.
  for (const c of chunks.filter((c) => c.source_type === 'judgment' && c.kind !== 'headnote' && c.para_role === null)) {
    await library.query("update chunks set para_role = 'unknown' where id = $1", [c.id]);
    c.para_role = 'unknown';
  }

  // 6. Embed.
  await deps.progress?.('indexing');
  const toEmbed = chunks.filter((c) => !c.embedded && !c.has_children);
  let embedded = 0;
  for (const batch of batchByChars(toEmbed, 200_000)) {
    const vectors = await deps.voyage.embed(
      batch.map((c) => `${c.header ?? ''}\n${c.text}`),
      'document',
      'embed.library',
    );
    for (let i = 0; i < batch.length; i++) {
      await library.query('update chunks set embedding = $2::vector, embed_model = $3 where id = $1', [
        batch[i]!.id,
        toVector(vectors[i]!),
        deps.embedModel,
      ]);
      embedded++;
    }
  }

  // 7. Gate.
  const official = OFFICIAL.has(src.origin) && !deps.provisional;
  const goodStatus = official ? 'live' : 'provisional';
  let needsReview = 0;
  for (const c of chunks) {
    const missing = missingLabels(c);
    if (missing.length) needsReview++;
    await library.query('update chunks set status = $2 where id = $1', [
      c.id,
      missing.length ? 'needs_review' : goodStatus,
    ]);
  }
  const status = needsReview === chunks.length ? 'needs_review' : goodStatus;
  await library.query('update sources set status = $2 where id = $1', [sourceId, status]);

  // Review items for the library editor (one open item per kind per source).
  const items: { kind: string; priority: number }[] = [{ kind: 'provisional_source', priority: official ? 3 : 2 }];
  if (src.type === 'judgment') items.push({ kind: 'role_sample', priority: 2 });
  for (const it of items) {
    await library.query(
      `insert into review_queue (college_id, kind, ref_id, priority)
       select global_college(), $1, $2, $3
        where not exists (select 1 from review_queue where ref_id = $2 and kind = $1 and state in ('open', 'in_progress'))`,
      [it.kind, sourceId, it.priority],
    );
  }
  await deps.progress?.(status === 'needs_review' ? 'needs_review' : 'live');
  return { labelled, embedded, needsReview, status };
}

function batchByChars<T extends { text: string }>(items: T[], maxChars: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    const n = Math.min(it.text.length, LABEL_PARA_CHARS * 4) + 200;
    if (cur.length && size + n > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
