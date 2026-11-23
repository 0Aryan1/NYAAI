/**
 * Saving a built part (one transaction) and finishing the lecture: must-cover list, coverage, counts, cost.
 * Runs inside the teacher's tenant transaction (worker role), so every row is hers under RLS.
 */
import type pg from 'pg';
import { coverageScore, decide, matchCoverage, openGroups, type CheckResult, type MustCoverItem } from '@nyaai/checker-rules';
import { mustCoverParts } from '@nyaai/legal';
import { statuteUnits } from '../search/index.ts';
import type { BuiltLine, PartOutput } from './part.ts';

export interface Owner {
  ownerId: string;
  collegeId: string;
}

/** Tiptap-shaped document: one `claimLine` node per line, carrying its stable key (LLD §11.4). */
const doc = (lines: BuiltLine[]) => ({
  type: 'doc',
  content: lines.map((l) => ({ type: 'claimLine', attrs: { lineKey: l.lineKey, kind: l.kind, yourExample: l.yourExample }, content: [{ type: 'text', text: l.text }] })),
});

const SLIDE_STRIDE = 100; // positions: part 0 → 0…99, part 1 → 100…

export async function savePart(c: pg.PoolClient, lectureId: string, who: Owner, out: PartOutput): Promise<void> {
  // Idempotent: a retried part replaces what it saved before.
  await c.query('delete from citations where lecture_id = $1 and part_index = $2', [lectureId, out.partIndex]);
  await c.query('delete from slides where lecture_id = $1 and part_index = $2', [lectureId, out.partIndex]);

  for (const [i, s] of out.slides.entries()) {
    const body = doc(s.lines);
    const notes = doc(s.notes);
    const slideId = (
      await c.query<{ id: string }>(
        `insert into slides (college_id, owner_id, lecture_id, position, part_index, layout, title, body, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [who.collegeId, who.ownerId, lectureId, out.partIndex * SLIDE_STRIDE + i, out.partIndex, s.layout, s.title, body, notes],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into slide_versions (slide_id, college_id, owner_id, version, title, body, notes, reason, created_by)
       values ($1, $2, $3, 1, $4, $5, $6, 'build', $3)`,
      [slideId, who.collegeId, who.ownerId, s.title, body, notes],
    );
    for (const line of [...s.lines, ...s.notes]) await saveLine(c, lectureId, slideId, who, out, line);
  }
}

async function saveLine(c: pg.PoolClient, lectureId: string, slideId: string, who: Owner, out: PartOutput, line: BuiltLine) {
  if (line.lineFlag) {
    // A legal statement with no source, or a question the library could not answer: one open row for the line.
    const checks: CheckResult[] = [{ name: 'C1', result: 'fail', detail: line.lineFlag }];
    await c.query(
      `insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, risk, span_text,
                              check_status, checks, flag_kind, flag_reason, part_index)
       values ($1, $2, $3, $4, $5, $6, 'fact', 'normal', '', 'open', $7, 'yellow', $8, $9)`,
      [who.collegeId, who.ownerId, lectureId, slideId, line.lineKey, line.text, JSON.stringify(checks), line.lineFlag, out.partIndex],
    );
  }
  for (const cl of line.claims) {
    const d = decide(cl.results);
    await c.query(
      `insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, risk, source_id, chunk_id,
                              span_text, span_start, span_end, check_status, checks, flag_kind, flag_reason, tag, source_label, part_index, source_relevance)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        who.collegeId, who.ownerId, lectureId, slideId, line.lineKey, cl.claim.text, cl.claim.type, cl.risk, cl.sourceId, cl.chunkId,
        cl.claim.span, cl.spanStart, cl.spanEnd, d.status, JSON.stringify(cl.results.map((r) => ({ ...r, ...(r.name === 'C10' && cl.correctedClaim ? { corrected: cl.correctedClaim } : {}) }))),
        d.flag, d.reason, cl.claim.tag, out.labels.get(cl.claim.tag) ?? cl.claim.tag, out.partIndex, out.relevance.get(cl.claim.tag) ?? null,
      ],
    );
  }
}

export interface FinalCounts {
  yellow: number;
  grey: number;
  coverage: number;
  score: number | null;
  costMicroUsd: number;
}

/**
 * Coverage over the whole lecture (LLD §8.5) and the header counts. Teacher ticks ("leave out") survive a rebuild:
 * an item she ticked keeps that state when the same section and label come back.
 */
export async function finaliseLecture(
  c: pg.PoolClient,
  lectureId: string,
  who: Owner,
  opts: { conceptId: string | null; leftOut: { item: string; reason: string }[] },
): Promise<FinalCounts> {
  const cited = (
    await c.query<{ id: string; source_id: string | null; chunk_id: string | null; span_text: string }>(
      "select id, source_id, chunk_id, span_text from citations where lecture_id = $1 and span_text <> ''",
      [lectureId],
    )
  ).rows;

  // Must-cover: parts of every section or Article the lecture states, plus confirmed leading cases of the concept.
  const units = await statuteUnits(c, [...new Set(cited.map((x) => x.chunk_id).filter((x): x is string => !!x))]);
  const items: MustCoverItem[] = [];
  for (const u of units) {
    const sectionKey = `${u.actName}:${u.sourceType === 'constitution' ? 'a' : 's'}${u.number}`;
    for (const p of mustCoverParts(u.text, u.sourceType === 'constitution' ? 'constitution' : 'act', u.number)) {
      items.push({ key: `${sectionKey}|${p.label}`, sectionKey, kind: p.kind, label: p.label, text: p.text, ref: u.chunkId });
    }
  }
  if (opts.conceptId) {
    const cases = (
      await c.query<{ source_id: string; title: string; name: string }>(
        `select cl.source_id, s.title, lc.name from concept_links cl join sources s on s.id = cl.source_id join legal_concepts lc on lc.id = cl.concept_id
          where cl.concept_id = $1 and cl.kind = 'leading_case' and cl.confirmed_at is not null and s.status in ('live', 'provisional')`,
        [opts.conceptId],
      )
    ).rows;
    for (const k of cases) items.push({ key: `concept:${opts.conceptId}|${k.source_id}`, sectionKey: `Leading cases: ${k.name}`, kind: 'leading_case', label: k.title, text: null, ref: k.source_id });
  }
  const covered = matchCoverage(items, cited.map((x) => ({ citationId: x.id, sourceId: x.source_id, chunkId: x.chunk_id, span: x.span_text })));

  const ticked = new Set(
    (await c.query<{ section_key: string; item_label: string }>("select section_key, item_label from coverage_items where lecture_id = $1 and state = 'left_out_by_teacher'", [lectureId])).rows.map(
      (r) => `${r.section_key}|${r.item_label}`,
    ),
  );
  await c.query("delete from coverage_items where lecture_id = $1 and state <> 'left_out_by_teacher'", [lectureId]);
  const states: ('covered' | 'missing' | 'left_out_by_teacher')[] = [];
  const kept: { sectionKey: string; state: string }[] = [];
  for (const it of items) {
    if (ticked.has(`${it.sectionKey}|${it.label}`)) {
      states.push('left_out_by_teacher');
      continue;
    }
    const by = covered.get(it.key) ?? null;
    const state = by ? 'covered' : 'missing';
    states.push(state);
    kept.push({ sectionKey: it.sectionKey, state });
    await c.query(
      `insert into coverage_items (college_id, owner_id, lecture_id, section_key, item_kind, item_ref, item_label, item_text, state, covered_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [who.collegeId, who.ownerId, lectureId, it.sectionKey, it.kind, it.ref, it.label, it.text, state, by],
    );
  }
  // The planner's and writer's "left out" items: shown, never cleared automatically.
  for (const lo of opts.leftOut) {
    if (ticked.has(`Left out of this lecture|${lo.item}`)) continue;
    await c.query(
      `insert into coverage_items (college_id, owner_id, lecture_id, section_key, item_kind, item_label, reason, state)
       values ($1, $2, $3, 'Left out of this lecture', 'left_out', $4, $5, 'missing')`,
      [who.collegeId, who.ownerId, lectureId, lo.item, lo.reason],
    );
  }

  // Counts: yellow and grey per line (a line with any open claim is one yellow point), coverage per section group.
  const lines = (
    await c.query<{ slide_id: string; line_key: string; statuses: string[]; flags: (string | null)[] }>(
      'select slide_id, line_key, array_agg(check_status::text) statuses, array_agg(flag_kind::text) flags from citations where lecture_id = $1 group by slide_id, line_key',
      [lectureId],
    )
  ).rows;
  const yellow = lines.filter((l) => l.statuses.includes('open')).length;
  const grey = lines.filter((l) => !l.statuses.includes('open') && l.flags.includes('grey')).length;
  const coverage = openGroups(kept);
  const score = coverageScore(states);
  const cost = Number((await c.query<{ sum: string | null }>('select sum(cost_micro_usd) sum from usage where lecture_id = $1', [lectureId])).rows[0]?.sum ?? 0);

  await c.query(
    `update lectures set yellow_open = $2, grey_open = $3, coverage_open = $4, coverage_score = $5, cost_micro_usd = $6,
            status = 'ready', ready_at = now(), error_code = null where id = $1`,
    [lectureId, yellow, grey, coverage, score, cost],
  );
  return { yellow, grey, coverage, score, costMicroUsd: cost };
}
