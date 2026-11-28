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
import { reciprocalRankFusion, standing, understandQuery, type Standing } from '@nyaai/legal';
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
  /** Her notes attached to the lecture: the only private sources this search may return. None by default. */
  notes?: string[];
  /**
   * The Act a bare "s. 20" means when the question names none (a lecture part: the Act of its topic's key sections).
   * Without it a bare section number matches that section of every Act.
   */
  contextAct?: string;
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
    /** A teacher's own note (private): usable only in a lecture she attached it to. */
    private?: boolean;
  };
  status: { law?: string; case?: string };
  provisional: boolean;
  rerankScore: number | null;
  /** Relevance plus authority (court, bench, official copy, the court's own reasoning): what sources are ordered by. */
  standing: Standing;
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
  court_level: string | null;
  bench_size: number | null;
  visibility: string;
}

const Expanded = z.object({ query: z.string().min(1).max(600) });

/**
 * The filters every candidate query shares (LLD §7.3). $1 jurisdictions, $2 as-on date, $3 historical, $4 court
 * levels, $5 acts, $6 private sources allowed. Row security lets a teacher read all her own notes; a search reads only
 * the notes the caller names (those attached to the lecture), so an old note never slips into a new lecture.
 */
const FILTERS = `
  c.status in ('live', 'provisional')
  and (c.visibility = 'shared' or c.source_id = any($6::uuid[]))
  and c.jurisdiction = any($1)
  and c.source_type not in ('news', 'web')
  and (c.valid_from is null or c.valid_from <= $2::date)
  and (c.valid_to is null or c.valid_to > $2::date)
  and ($3::boolean or c.law_status is distinct from 'repealed')
  and ($4::text[] is null or c.court_level is null or c.court_level = any($4))
  and ($5::text[] is null or c.act_name is null or c.act_name = any($5))`;

const ROW_COLUMNS = `c.id, c.source_id, c.parent_id, c.seq, c.kind, c.header, c.text, c.act_name, c.section, c.article, c.para_no,
  c.opinion, c.para_role, c.court, c.decided_on, c.law_status, c.source_type, c.status, s.origin, s.roles_sampled,
  s.status as source_status, cs.status as case_status, s.court_level, s.bench_size, c.visibility`;
const ROW_JOINS = `join sources s on s.id = c.source_id left join case_status_v cs on cs.source_id = c.source_id`;

export async function search(db: pg.PoolClient, req: SearchRequest, deps: SearchDeps): Promise<SearchResult> {
  const t0 = Date.now();
  const f = req.filters ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const asOn = f.asOn ?? today;
  const understood = understandQuery(req.query);
  const acts = f.acts ?? (understood.acts.length ? understood.acts : null);
  // $6: her notes attached to this lecture, the only private sources searched (none unless the caller names them).
  const params = [f.jurisdiction ?? ['IN'], asOn, asOn < today, f.courts ?? null, acts, req.notes ?? []];
  const max = req.maxSources ?? 8;

  await db.query('set local hnsw.ef_search = 100');
  await db.query("set local hnsw.iterative_scan = 'relaxed_order'");
  await db.query('set local hnsw.max_scan_tuples = 20000');

  // 1. Exact references, pinned first: the section or Article itself (its top-level chunk).
  const pinned: string[] = [];
  /** Pinned chunks whose Act is known: kept whatever the reranker says (a bare "s. 20" of every Act is not). */
  const named: string[] = [];
  for (const ref of understood.refs) {
    const act = ref.act ?? (ref.kind === 'section' && !understood.acts.length ? (req.contextAct ?? null) : null);
    const r = await db.query<{ id: string }>(
      `select c.id from chunks c where ${FILTERS}
         and c.parent_id is null and ${ref.kind === 'article' ? 'c.article = $7' : 'c.section = $7'}
         and ($8::text is null or c.act_name = $8)
       order by c.created_at desc limit 3`,
      [...params, ref.number, act],
    );
    pinned.push(...r.rows.map((x) => x.id));
    if (act || ref.kind === 'article') named.push(...r.rows.map((x) => x.id));
  }
  // Case names: paragraphs of a matching case join the candidate pool (the reranker picks which ones matter).
  const caseCandidates: string[] = [];
  for (const name of understood.caseNames) {
    const r = await db.query<{ id: string }>(
      `select c.id from chunks c join sources s on s.id = c.source_id
        where ${FILTERS} and s.type = 'judgment' and similarity(s.title, $7) >= 0.35
        order by similarity(s.title, $7) desc, c.seq limit 60`,
      [...params, name],
    );
    caseCandidates.push(...r.rows.map((x) => x.id));
  }
  // Concepts: key sections linked to a matching concept are added as candidates (confirmed links only for cases).
  const concept = await db.query<{ id: string }>(
    `select distinct c.id from legal_concepts lc
       join concept_links cl on cl.concept_id = lc.id
       join chunks c on c.source_id = cl.source_id and (cl.chunk_id is null or c.id = cl.chunk_id)
      where (lc.name % $7 or exists (select 1 from unnest(lc.aliases) a where a % $7) or $7 ilike '%' || lc.name || '%'
             -- a doctrine named inside a longer question ("… under the doctrine of lis pendens?"), as whole words
             or exists (select 1 from unnest(lc.aliases) a
                         where length(a) >= 5
                           and ' ' || regexp_replace(lower($7), '[^a-z0-9]+', ' ', 'g') || ' '
                               like '% ' || trim(regexp_replace(lower(a), '[^a-z0-9]+', ' ', 'g')) || ' %'))
        and (cl.kind = 'key_section' or cl.confirmed_at is not null)
        and c.parent_id is null and ${FILTERS}
      limit 20`,
    [...params, req.query],
  );

  // 2. Haiku rewrite for the embedding query only.
  let expandedQuery: string | null = null;
  if (deps.gateway && !req.noExpand) {
    try {
      const r = await deps.gateway.run(
        { prompt: PROMPTS['query.expand'], schema: Expanded, task: `Her search: ${req.query}` },
        deps.usage,
      );
      expandedQuery = r.data.query;
    } catch {
      expandedQuery = null; // the rewrite is a help, not a requirement
    }
  }
  const [qv] = await deps.voyage.embed([expandedQuery ?? req.query], 'query', `search.${req.purpose}`);
  const vector = (
    await db.query<{ id: string }>(
      `with vec as materialized (
         select c.id, c.embedding <=> $7::vector as dist from chunks c
          where c.embedding is not null and ${FILTERS}
          order by c.embedding <=> $7::vector limit 50)
       select id from vec order by dist + 0`,
      [...params, toVector(qv!)],
    )
  ).rows.map((r) => r.id);
  const words = (
    await db.query<{ id: string }>(
      `select c.id from chunks c, websearch_to_tsquery('english', $7) q
        where c.tsv @@ q and ${FILTERS}
        order by ts_rank_cd(c.tsv, q) desc limit 50`,
      [...params, req.query],
    )
  ).rows.map((r) => r.id);

  // 3. Fuse, then rerank.
  const fused = reciprocalRankFusion([vector, words, caseCandidates, concept.rows.map((r) => r.id)], pinned).slice(
    0,
    50,
  );
  const rows = await loadRows(
    db,
    fused.map((x) => x.id),
  );
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

  // A section or Article the question names is always among the sources, first: a part asking what s. 20 says must
  // see s. 20, however much longer the judgments discussing it are.
  const pinnedSet = new Set(named);
  // The relevance floor applies to relevance alone; above it, sources are ordered by standing (relevance first, then
  // authority), so a Supreme Court ruling is not pushed out by a weaker source that matches the words a little better.
  const relevant = ranked.filter((r) => !pinnedSet.has(r.row.id) && (r.score === null || r.score >= deps.minScore));
  if (!fallback) relevant.sort((a, b) => standingOfRow(b.row, b.score).score - standingOfRow(a.row, a.score).score);
  const above = [...ranked.filter((r) => pinnedSet.has(r.row.id)), ...relevant];
  const outcome: SearchResult['outcome'] = fallback
    ? above.length
      ? 'ok'
      : 'not_found'
    : above.length >= 3
      ? 'ok'
      : above.length > 0
        ? 'thin'
        : 'not_found';

  // 4. Parent expansion and S-tags.
  const sources = await expand(db, above, max);
  return {
    sources,
    outcome,
    trace: { understood, expandedQuery, pinned, vector, words, reranked, fallback, ms: Date.now() - t0 },
  };
}

function standingOfRow(row: Row, relevance: number | null): Standing {
  return standing(
    {
      sourceType: row.source_type,
      courtLevel: row.court_level,
      benchSize: row.bench_size,
      origin: row.origin,
      provisional: row.status === 'provisional' || row.source_status === 'provisional',
      caseStatus: row.source_type === 'judgment' ? (row.case_status ?? 'not_verified') : null,
      paraRole: row.para_role,
      kind: row.kind,
    },
    relevance,
  );
}

async function loadRows(db: pg.PoolClient, ids: string[]): Promise<Map<string, Row>> {
  if (!ids.length) return new Map();
  const r = await db.query<Row>(`select ${ROW_COLUMNS} from chunks c ${ROW_JOINS} where c.id = any($1)`, [ids]);
  return new Map(r.rows.map((x) => [x.id, x]));
}

async function expand(
  db: pg.PoolClient,
  ranked: { row: Row; score: number | null }[],
  max: number,
): Promise<RetrievedSource[]> {
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
      const p = (
        await db.query<{ id: string; header: string | null; text: string }>(
          'select id, header, text from chunks where id = $1',
          [row.parent_id],
        )
      ).rows[0];
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
        private: row.visibility === 'private',
      },
      status: {
        law: row.law_status ?? undefined,
        case: row.source_type === 'judgment' ? (row.case_status ?? 'not_verified') : undefined,
      },
      provisional: row.status === 'provisional' || row.source_status === 'provisional',
      rerankScore: score,
      standing: standingOfRow(row, score),
    };
    seen.set(key, src);
    out.push(src);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------
 * Reads the build and the Studio need. Chunks are read only here (one door, rules §3), always under the caller's
 * tenant transaction, so row-level security still decides what is visible.
 * ---------------------------------------------------------------------------------------------------------- */

export interface Piece {
  chunkId: string;
  sourceId: string;
  text: string;
  paraNo: string | null;
  opinion: string | null;
  paraRole: string | null;
  kind: string;
}

/** The paragraphs or statute chunks a retrieved source carries, in order, for the checks (C2 location, C7 role). */
export async function loadPieces(db: pg.PoolClient, chunkIds: string[]): Promise<Piece[]> {
  if (!chunkIds.length) return [];
  const r = await db.query<{
    id: string;
    source_id: string;
    text: string;
    para_no: string | null;
    opinion: string | null;
    para_role: string | null;
    kind: string;
  }>(
    'select id, source_id, text, para_no, opinion, para_role, kind from chunks where id = any($1) order by source_id, seq',
    [chunkIds],
  );
  return r.rows.map((x) => ({
    chunkId: x.id,
    sourceId: x.source_id,
    text: x.text,
    paraNo: x.para_no,
    opinion: x.opinion,
    paraRole: x.para_role,
    kind: x.kind,
  }));
}

export interface SourceDetail {
  id: string;
  type: string;
  title: string;
  url: string | null;
  holdingNote: string | null;
  rolesSampled: boolean;
  status: string;
}

export async function sourceDetails(db: pg.PoolClient, sourceIds: string[]): Promise<Map<string, SourceDetail>> {
  if (!sourceIds.length) return new Map();
  const r = await db.query<{
    id: string;
    type: string;
    title: string;
    url: string | null;
    holding_note: string | null;
    roles_sampled: boolean;
    status: string;
  }>('select id, type, title, url, holding_note, roles_sampled, status from sources where id = any($1)', [sourceIds]);
  return new Map(
    r.rows.map((x) => [
      x.id,
      {
        id: x.id,
        type: x.type,
        title: x.title,
        url: x.url,
        holdingNote: x.holding_note,
        rolesSampled: x.roles_sampled,
        status: x.status,
      },
    ]),
  );
}

export interface StatuteUnit {
  chunkId: string;
  sourceId: string;
  sourceType: 'act' | 'constitution';
  actName: string;
  number: string;
  header: string;
  text: string;
}

/** The whole section or Article (top-level chunk) each cited statute chunk belongs to, for the must-cover list. */
export async function statuteUnits(db: pg.PoolClient, chunkIds: string[]): Promise<StatuteUnit[]> {
  if (!chunkIds.length) return [];
  const r = await db.query<{
    id: string;
    source_id: string;
    source_type: 'act' | 'constitution';
    act_name: string | null;
    section: string | null;
    article: string | null;
    header: string | null;
    text: string;
  }>(
    `select distinct p.id, p.source_id, p.source_type, p.act_name, p.section, p.article, p.header, p.text
       from chunks c join chunks p on p.id = coalesce(c.parent_id, c.id)
      where c.id = any($1) and c.source_type in ('act', 'constitution')`,
    [chunkIds],
  );
  return r.rows
    .filter((x) => x.section ?? x.article)
    .map((x) => ({
      chunkId: x.id,
      sourceId: x.source_id,
      sourceType: x.source_type,
      actName: x.act_name ?? '',
      number: (x.section ?? x.article)!,
      header: x.header ?? '',
      text: x.text,
    }));
}

/**
 * A whole section or Article (its top-level chunk) as a retrieved source, for the research stage: a key section of the
 * topic that no part's search found is added to the notes directly. Null when it is not visible or not live.
 */
export async function statuteSource(db: pg.PoolClient, chunkId: string): Promise<RetrievedSource | null> {
  const rows = await loadRows(db, [chunkId]);
  const row = rows.get(chunkId);
  if (!row || !['live', 'provisional'].includes(row.status) || !['act', 'constitution'].includes(row.source_type))
    return null;
  return (await expand(db, [{ row, score: null }], 1))[0] ?? null;
}

/** Every section of her attached notes, in order (the build makes sure an attached document is used). */
export async function noteSources(db: pg.PoolClient, sourceIds: string[]): Promise<RetrievedSource[]> {
  if (!sourceIds.length) return [];
  const ids = (
    await db.query<{ id: string }>(
      "select id from chunks where source_id = any($1::uuid[]) and visibility = 'private' and status = 'live' order by source_id, seq",
      [sourceIds],
    )
  ).rows.map((r) => r.id);
  const rows = await loadRows(db, ids);
  return expand(
    db,
    ids.flatMap((id) => (rows.has(id) ? [{ row: rows.get(id)!, score: null }] : [])),
    ids.length,
  );
}

/** The topic's key sections (chunk ids) and its confirmed leading cases (source ids and titles), for the must-cover list. */
export async function conceptMustCover(
  db: pg.PoolClient,
  conceptId: string,
): Promise<{ sectionChunkIds: string[]; cases: { sourceId: string; title: string }[] }> {
  const r = await db.query<{ kind: string; chunk_id: string | null; source_id: string; title: string }>(
    `select cl.kind, cl.chunk_id, cl.source_id, s.title from concept_links cl join sources s on s.id = cl.source_id
      where cl.concept_id = $1 and s.status in ('live', 'provisional')
        and ((cl.kind = 'key_section' and cl.chunk_id is not null) or (cl.kind = 'leading_case' and cl.confirmed_at is not null))`,
    [conceptId],
  );
  return {
    sectionChunkIds: [...new Set(r.rows.filter((x) => x.kind === 'key_section').map((x) => x.chunk_id!))],
    cases: r.rows.filter((x) => x.kind === 'leading_case').map((x) => ({ sourceId: x.source_id, title: x.title })),
  };
}

/** A concept's key sections (their headers) and leading cases (titles), as hints for the planner. */
export async function conceptHints(
  db: pg.PoolClient,
  conceptId: string,
): Promise<{ name: string; sections: string[]; cases: string[]; acts: string[] } | null> {
  const r = await db.query<{ name: string; sections: string[] | null; cases: string[] | null; acts: string[] | null }>(
    `select lc.name,
            array_agg(distinct ch.act_name) filter (where cl.kind = 'key_section' and ch.act_name is not null) as acts,
            array_agg(distinct coalesce(ch.header, s.title)) filter (where cl.kind = 'key_section') as sections,
            array_agg(distinct s.title) filter (where cl.kind = 'leading_case') as cases
       from legal_concepts lc left join concept_links cl on cl.concept_id = lc.id
       left join sources s on s.id = cl.source_id left join chunks ch on ch.id = cl.chunk_id
      where lc.id = $1 group by lc.name`,
    [conceptId],
  );
  const row = r.rows[0];
  return row ? { name: row.name, sections: row.sections ?? [], cases: row.cases ?? [], acts: row.acts ?? [] } : null;
}

/** One chunk's words and header for the Source drawer; null when it has expired or is not visible. */
export async function chunkForDrawer(
  db: pg.PoolClient,
  chunkId: string,
): Promise<{ header: string | null; text: string; parentText: string | null } | null> {
  const r = await db.query<{ header: string | null; text: string; parent_text: string | null }>(
    'select c.header, c.text, p.text as parent_text from chunks c left join chunks p on p.id = c.parent_id where c.id = $1',
    [chunkId],
  );
  const row = r.rows[0];
  return row ? { header: row.header, text: row.text, parentText: row.parent_text } : null;
}

/* ------------------------------------------------------------------------------------------------------------
 * Library editor review (HLD 5.2 b, f): paragraphs of a judgment with their labels; label corrections; approval.
 * Runs as the editor (nyaai_app); migration 0006 lets her change only para_role, opinion and status on shared rows.
 * ---------------------------------------------------------------------------------------------------------- */

export interface ReviewParagraph {
  chunkId: string;
  seq: number;
  paraNo: string | null;
  kind: string;
  opinion: string | null;
  judge: string | null;
  role: string | null;
  text: string;
}

export async function judgmentParagraphs(db: pg.PoolClient, sourceId: string): Promise<ReviewParagraph[]> {
  const r = await db.query<{
    id: string;
    seq: number;
    para_no: string | null;
    kind: string;
    opinion: string | null;
    judge: string | null;
    para_role: string | null;
    text: string;
  }>(
    "select id, seq, para_no, kind, opinion, judge, para_role, text from chunks where source_id = $1 and source_type = 'judgment' order by seq",
    [sourceId],
  );
  return r.rows.map((x) => ({
    chunkId: x.id,
    seq: x.seq,
    paraNo: x.para_no,
    kind: x.kind,
    opinion: x.opinion,
    judge: x.judge,
    role: x.para_role,
    text: x.text,
  }));
}

/** The editor's correction of one paragraph's role (and opinion, when the split was wrong). */
export async function setParagraphLabel(
  db: pg.PoolClient,
  chunkId: string,
  label: { role: string; opinion?: string },
): Promise<boolean> {
  const r = await db.query(
    "update chunks set para_role = $2::para_role, opinion = coalesce($3::opinion_type, opinion) where id = $1 and source_type = 'judgment' and kind <> 'headnote'",
    [chunkId, label.role, label.opinion ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Approving a live lookup: the source and its chunks go from provisional to live (rows needing review stay). */
export async function approveSourceChunks(db: pg.PoolClient, sourceId: string): Promise<void> {
  await db.query("update chunks set status = 'live' where source_id = $1 and status = 'provisional'", [sourceId]);
}

/** A source taken out of the library (a second copy of a case it holds): its chunks leave search. */
export async function retireSourceChunks(db: pg.PoolClient, sourceId: string): Promise<void> {
  await db.query("update chunks set status = 'retired' where source_id = $1 and status <> 'retired'", [sourceId]);
}

/** Children of one statute section, and paragraphs within one window, collapse into one source. */
function groupKey(r: Row): string {
  if (r.parent_id) return `parent:${r.parent_id}`;
  if (r.source_type === 'judgment' && r.kind !== 'headnote')
    return `para:${r.source_id}:${r.opinion}:${Math.floor(r.seq / 5)}`;
  return `chunk:${r.id}`;
}
