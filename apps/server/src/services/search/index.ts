/**
 * Search service (LLD §7): the only module that queries chunks. It runs inside the caller's tenant transaction,
 * so row-level security already limits every row to the shared library plus the teacher's own material.
 *
 * 1. Understand: exact references (pinned first), acts, case names, concept key sections; optional Haiku rewrite of
 *    the embedding query only (`query.expand`), never of the filters.
 * 2. Candidates two ways, same filters: vector top 50 (HNSW, iterative scan) and full-text top 50.
 * 3. Reciprocal rank fusion (k = 60), pins first; top 50 → Voyage rerank-2.5.
 *    ok: ≥ 3 at or above RERANK_MIN_SCORE → top 8; thin: 1–2; not_found: none. Reranker down → fused order, top 6.
 * 4. Parent expansion: statute child → its section; judgment paragraph → ±2 paragraphs of the same opinion.
 *    Children of one parent collapse; S1–S8 tags count parents.
 */
import type pg from 'pg';
import { z } from 'zod';
import { PROMPTS } from '@nyaai/prompts';
import { reciprocalRankFusion, understandQuery } from '@nyaai/legal';
import type { Gateway } from '../llm-gateway/index.ts';
import type { UsageSink } from '../usage.ts';
import { toVector, type Voyage } from '../voyage/index.ts';

export interface SearchRequest {
  query: string;
  purpose: 'lecture_part' | 'research' | 'explore' | 'suggest' | 'eval';
  filters?: {
    jurisdiction?: string[];
    /** ISO date; a past date is a historical question (repealed law allowed). */
    asOn?: string;
    courts?: ('supreme_court' | 'high_court' | 'tribunal' | 'foreign')[];
    acts?: string[];
  };
  maxSources?: number;
  /** Eval only: skip the reranker to measure it. */
  noRerank?: boolean;
  /** Skip the Haiku rewrite (tests, eval A/B). */
  noExpand?: boolean;
}

export interface RetrievedSource {
  tag: string;
  chunkId: string;
  sourceId: string;
  header: string;
  text: string;
  /** Every chunk whose words this source carries (child + parent, or the paragraph window). */
  coveredChunkIds: string[];
  meta: {
    court?: string;
    decidedOn?: string;
    act?: string;
    section?: string;
    article?: string;
    paraNo?: string;
    opinion?: string;
    paraRole?: string;
    rolesSampled: boolean;
    sourceType: string;
    origin: string;
  };
  status: { law?: string; case?: string };
  provisional: boolean;
  rerankScore: number | null;
}

export interface SearchTrace {
  understood: ReturnType<typeof understandQuery>;
  expandedQuery: string | null;
  pinned: string[];
  vector: string[];
  words: string[];
  reranked: { id: string; score: number }[];
  fallback: string | null;
  ms: number;
}

export interface SearchResult {
  sources: RetrievedSource[];
  outcome: 'ok' | 'thin' | 'not_found';
  trace: SearchTrace;
}

export interface SearchDeps {
  voyage: Voyage;
  gateway: Gateway | null;
  usage: UsageSink;
  minScore: number;
}

interface Row {
  id: string;
  source_id: string;
  parent_id: string | null;
  seq: number;
  kind: string;
  header: string | null;
  text: string;
  act_name: string | null;
  section: string | null;
  article: string | null;
  para_no: string | null;
  opinion: string | null;
  para_role: string | null;
  court: string | null;
  decided_on: Date | null;
  law_status: string | null;
  source_type: string;
  status: string;
  origin: string;
  roles_sampled: boolean;
  source_status: string;
  case_status: string | null;
}

const Expanded = z.object({ query: z.string().min(1).max(600) });

/** The filters both candidate queries share (LLD §7.3). $1 jurisdictions, $2 as-on date, $3 historical, $4 court levels, $5 acts. */
const FILTERS = `
  c.status in ('live', 'provisional')
  and c.jurisdiction = any($1)
  and c.source_type not in ('news', 'web')
  and (c.valid_from is null or c.valid_from <= $2::date)
  and (c.valid_to is null or c.valid_to > $2::date)
  and ($3::boolean or c.law_status is distinct from 'repealed')
  and ($4::text[] is null or c.court_level is null or c.court_level = any($4))
  and ($5::text[] is null or c.act_name is null or c.act_name = any($5))`;

const ROW_COLUMNS = `c.id, c.source_id, c.parent_id, c.seq, c.kind, c.header, c.text, c.act_name, c.section, c.article, c.para_no,
  c.opinion, c.para_role, c.court, c.decided_on, c.law_status, c.source_type, c.status, s.origin, s.roles_sampled,
  s.status as source_status, cs.status as case_status`;
const ROW_JOINS = `join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id`;

export async function search(db: pg.PoolClient, req: SearchRequest, deps: SearchDeps): Promise<SearchResult> {
  const t0 = Date.now();
  const f = req.filters ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const asOn = f.asOn ?? today;
  const understood = understandQuery(req.query);
  const acts = f.acts ?? (understood.acts.length ? understood.acts : null);
  const params = [f.jurisdiction ?? ['IN'], asOn, asOn < today, f.courts ?? null, acts];
  const max = req.maxSources ?? 8;

  await db.query('set local hnsw.ef_search = 100');
  await db.query("set local hnsw.iterative_scan = 'relaxed_order'");
  await db.query('set local hnsw.max_scan_tuples = 20000');

  // 1. Exact references, pinned first: the section or Article itself (its top-level chunk).
  const pinned: string[] = [];
  for (const ref of understood.refs) {
    const r = await db.query<{ id: string }>(
      `select c.id from chunks c where ${FILTERS}
         and c.parent_id is null and ${ref.kind === 'article' ? 'c.article = $6' : 'c.section = $6'}
         and ($7::text is null or c.act_name = $7)
       order by c.created_at desc limit 3`,
      [...params, ref.number, ref.act],
    );
    pinned.push(...r.rows.map((x) => x.id));
  }
  // Case names: paragraphs of a matching case join the candidate pool (the reranker picks which ones matter).
  const caseCandidates: string[] = [];
  for (const name of understood.caseNames) {
    const r = await db.query<{ id: string }>(
      `select c.id from chunks c join sources s on s.id = c.source_id
        where ${FILTERS} and s.type = 'judgment' and similarity(s.title, $6) >= 0.35
        order by similarity(s.title, $6) desc, c.seq limit 60`,
      [...params, name],
    );
    caseCandidates.push(...r.rows.map((x) => x.id));
  }
  // Concepts: key sections linked to a matching concept are added as candidates (confirmed links only for cases).
  const concept = await db.query<{ id: string }>(
    `select distinct c.id from legal_concepts lc
       join concept_links cl on cl.concept_id = lc.id
       join chunks c on c.source_id = cl.source_id and (cl.chunk_id is null or c.id = cl.chunk_id)
      where (lc.name % $6 or exists (select 1 from unnest(lc.aliases) a where a % $6) or $6 ilike '%' || lc.name || '%')
        and (cl.kind = 'key_section' or cl.confirmed_at is not null)
        and c.parent_id is null and ${FILTERS}
      limit 20`,
    [...params, req.query],
  );

  // 2. Haiku rewrite for the embedding query only.
  let expandedQuery: string | null = null;
  if (deps.gateway && !req.noExpand) {
    try {
      const r = await deps.gateway.run({ prompt: PROMPTS['query.expand'], schema: Expanded, task: `Her search: ${req.query}` }, deps.usage);
      expandedQuery = r.data.query;
    } catch {
      expandedQuery = null; // the rewrite is a help, not a requirement
    }
  }
  const [qv] = await deps.voyage.embed([expandedQuery ?? req.query], 'query', `search.${req.purpose}`);
  const vector = (
    await db.query<{ id: string }>(
      `with vec as materialized (
         select c.id, c.embedding <=> $6::vector as dist from chunks c
          where c.embedding is not null and ${FILTERS}
          order by c.embedding <=> $6::vector limit 50)
       select id from vec order by dist + 0`,
      [...params, toVector(qv!)],
    )
  ).rows.map((r) => r.id);
  const words = (
    await db.query<{ id: string }>(
      `select c.id from chunks c, websearch_to_tsquery('english', $6) q
        where c.tsv @@ q and ${FILTERS}
        order by ts_rank_cd(c.tsv, q) desc limit 50`,
      [...params, req.query],
    )
  ).rows.map((r) => r.id);

  // 3. Fuse, then rerank.
  const fused = reciprocalRankFusion([vector, words, caseCandidates, concept.rows.map((r) => r.id)], pinned).slice(0, 50);
  const rows = await loadRows(db, fused.map((x) => x.id));
  // Present-day questions drop cases whose confirmed status is overruled or reversed (kept, labelled, for history).
  const usable = fused
    .map((x) => rows.get(x.id))
    .filter((r): r is Row => !!r && (asOn < today || !['overruled', 'reversed'].includes(r.case_status ?? '')));

  let ranked: { row: Row; score: number | null }[];
  let fallback: string | null = null;
  let reranked: { id: string; score: number }[] = [];
  if (req.noRerank) {
    ranked = usable.slice(0, 6).map((row) => ({ row, score: null }));
    fallback = 'rerank skipped (eval)';
  } else {
    try {
      const hits = await deps.voyage.rerank(
        `${PROMPTS['rerank.instruction'].system}\nQuestion: ${req.query}`,
        usable.map((r) => `${r.header ?? ''}\n${r.text}`.slice(0, 6000)),
        `rerank.${req.purpose}`,
      );
      reranked = hits.map((h) => ({ id: usable[h.index]!.id, score: h.score }));
      ranked = hits.map((h) => ({ row: usable[h.index]!, score: h.score }));
    } catch (err) {
      fallback = `reranker unavailable: ${(err as Error).message.slice(0, 120)}`;
      ranked = usable.slice(0, 6).map((row) => ({ row, score: null }));
    }
  }

  const above = ranked.filter((r) => r.score === null || r.score >= deps.minScore);
  const outcome: SearchResult['outcome'] = fallback ? (above.length ? 'ok' : 'not_found') : above.length >= 3 ? 'ok' : above.length > 0 ? 'thin' : 'not_found';

  // 4. Parent expansion and S-tags.
  const sources = await expand(db, above, max);
  return { sources, outcome, trace: { understood, expandedQuery, pinned, vector, words, reranked, fallback, ms: Date.now() - t0 } };
}

async function loadRows(db: pg.PoolClient, ids: string[]): Promise<Map<string, Row>> {
  if (!ids.length) return new Map();
  const r = await db.query<Row>(`select ${ROW_COLUMNS} from chunks c ${ROW_JOINS} where c.id = any($1)`, [ids]);
  return new Map(r.rows.map((x) => [x.id, x]));
}

async function expand(db: pg.PoolClient, ranked: { row: Row; score: number | null }[], max: number): Promise<RetrievedSource[]> {
  const out: RetrievedSource[] = [];
  const seen = new Map<string, RetrievedSource>();
  for (const { row, score } of ranked) {
    if (out.length >= max && !seen.has(groupKey(row))) continue;
    const key = groupKey(row);
    const existing = seen.get(key);
    if (existing) {
      if (!existing.coveredChunkIds.includes(row.id)) existing.coveredChunkIds.push(row.id);
      continue;
    }
    let text = row.text;
    let header = row.header ?? '';
    const covered = [row.id];
    if (row.parent_id) {
      // Statute child → the whole section, provisos and explanations included.
      const p = (await db.query<{ id: string; header: string | null; text: string }>('select id, header, text from chunks where id = $1', [row.parent_id])).rows[0];
      if (p) {
        text = p.text;
        header = p.header ?? header;
        covered.push(p.id);
      }
    } else if (row.source_type === 'judgment' && row.kind !== 'headnote') {
      // Judgment paragraph → two paragraphs either side, same opinion.
      const win = await db.query<{ id: string; text: string; para_no: string | null }>(
        `select id, text, para_no from chunks
          where source_id = $1 and opinion is not distinct from $2 and kind <> 'headnote' and seq between $3 - 2 and $3 + 2
          order by seq`,
        [row.source_id, row.opinion, row.seq],
      );
      text = win.rows.map((w) => `[para ${w.para_no ?? '?'}] ${w.text}`).join('\n\n');
      covered.push(...win.rows.map((w) => w.id).filter((id) => id !== row.id));
    } else {
      // A section without children may itself be the parent of searched children; include them as covered.
      const kids = await db.query<{ id: string }>('select id from chunks where parent_id = $1', [row.id]);
      covered.push(...kids.rows.map((k) => k.id));
    }
    const src: RetrievedSource = {
      tag: `S${out.length + 1}`,
      chunkId: row.id,
      sourceId: row.source_id,
      header,
      text,
      coveredChunkIds: covered,
      meta: {
        court: row.court ?? undefined,
        decidedOn: row.decided_on ? row.decided_on.toISOString().slice(0, 10) : undefined,
        act: row.act_name ?? undefined,
        section: row.section ?? undefined,
        article: row.article ?? undefined,
        paraNo: row.para_no ?? undefined,
        opinion: row.opinion ?? undefined,
        paraRole: row.para_role ?? undefined,
        rolesSampled: row.roles_sampled,
        sourceType: row.source_type,
        origin: row.origin,
      },
      status: {
        law: row.law_status ?? undefined,
        case: row.source_type === 'judgment' ? (row.case_status ?? 'not_verified') : undefined,
      },
      provisional: row.status === 'provisional' || row.source_status === 'provisional',
      rerankScore: score,
    };
    seen.set(key, src);
    out.push(src);
  }
  return out;
}

/** Children of one statute section, and paragraphs within one window, collapse into one source. */
function groupKey(r: Row): string {
  if (r.parent_id) return `parent:${r.parent_id}`;
  if (r.source_type === 'judgment' && r.kind !== 'headnote') return `para:${r.source_id}:${r.opinion}:${Math.floor(r.seq / 5)}`;
  return `chunk:${r.id}`;
}
