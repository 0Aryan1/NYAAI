/**
 * Editing in the Studio (F7; LLD §8.6). Every write keeps the accuracy promise:
 *  - an edited line keeps the sources it had; C1–C8 run on the new words at once (code, no AI), and the line stays
 *    yellow "Changed by you" until `check.lines` (C9, and C10 for high-risk lines) confirms it in the background;
 *  - a new line that states law with no source is yellow "Not found in the library, please verify";
 *  - her example is "Your example"; a case or section it names must be in the library, or it is yellow;
 *  - nothing is deleted: a removed or replaced line's citations are marked removed with the status they had, so a
 *    restore brings the line back with its checked sources (migration 0009).
 * Runs inside her own transaction (RLS); the background check runs as a worker job acting for her.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { codeChecks, decide, looksLegal, passedCode, type CheckResult, type CheckSource, type ClaimInput, type ClaimType, type MappingRow } from '@nyaai/checker-rules';
import { understandQuery } from '@nyaai/legal';
import type { CoverageChangedItem, EditLine, EditSlide } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { checkClaims } from '../build/checking.ts';
import type { Gateway } from '../llm-gateway/index.ts';
import { loadPieces, sourceDetails } from '../search/index.ts';
import type { UsageSink } from '../usage.ts';
import type { LineNode } from '../studio/index.ts';
import { canAddFor, rerunCoverage } from '../coverage/index.ts';

export const CHANGED = 'Changed by you: being checked against the source';
export const NOT_FOUND = 'Not found in the library, please verify';
/** C9/C10 for a line NYAAI added word for word from the Act: the quote is the source, so no AI reading is needed. */
export const VERBATIM = 'The Act’s own words, quoted in full; added by NYAAI from the source';
const EXAMPLE_NAMES = 'Your example names a case or section not found in the library; please verify';

interface Who {
  userId: string;
  collegeId: string;
}

interface SlideRow {
  id: string;
  lecture_id: string;
  title: string;
  body: { type: string; content?: LineNode[] };
  notes: { type: string; content?: LineNode[] };
  current_version: number;
}

interface CitationRow {
  id: string;
  line_key: string;
  claim_type: ClaimType;
  source_id: string | null;
  chunk_id: string | null;
  span_text: string;
  source_label: string | null;
  source_relevance: string | null;
  tag: string | null;
  risk: 'normal' | 'high';
  part_index: number | null;
}

const lineText = (n: LineNode) => (n.content ?? []).map((t) => t.text ?? '').join('');
const newKey = () => `e-${randomBytes(4).toString('hex')}`;

/** Tiptap-shaped document, as the build saves it (LLD §11.4). */
const doc = (lines: { lineKey: string; kind: string; yourExample: boolean; edited: boolean; text: string }[]) => ({
  type: 'doc',
  content: lines.map((l) => ({ type: 'claimLine', attrs: { lineKey: l.lineKey, kind: l.kind, yourExample: l.yourExample, edited: l.edited }, content: [{ type: 'text', text: l.text }] })),
});

export async function loadSlide(c: pg.PoolClient, slideId: string): Promise<SlideRow> {
  const s = (await c.query<SlideRow>('select id, lecture_id, title, body, notes, current_version from slides where id = $1', [slideId])).rows[0];
  if (!s) throw new AppError('NOT_FOUND', 'We could not find that slide.');
  return s;
}

/** Signed old/new law mappings for C5 (as the build reads them). */
async function mappings(c: pg.PoolClient): Promise<MappingRow[]> {
  return (
    await c.query<{ old_act: string; new_act: string; relation: MappingRow['relation']; old: string[] | null; new: string[] | null; signed: boolean }>(
      `select m.old_act, m.new_act, m.relation, m.reviewed_at is not null as signed,
              array_agg(i.section) filter (where i.side = 'old') as old, array_agg(i.section) filter (where i.side = 'new') as new
         from law_mappings m left join law_mapping_items i on i.mapping_id = m.id group by m.id`,
    )
  ).rows.map((m) => ({ oldAct: m.old_act, newAct: m.new_act, relation: m.relation, oldSections: m.old ?? [], newSections: m.new ?? [], signed: m.signed }));
}

/**
 * The sources a set of citations rest on, as the checks see them: one S-tag per chunk (the paragraph or section the
 * span sits in, with its parent section for a sub-section).
 */
export async function sourcesFor(c: pg.PoolClient, chunkIds: string[]): Promise<Map<string, CheckSource & { chunkId: string }>> {
  const ids = [...new Set(chunkIds)];
  const out = new Map<string, CheckSource & { chunkId: string }>();
  if (!ids.length) return out;
  const rows = (
    await c.query<{ id: string; source_id: string; header: string | null; text: string; parent_text: string | null; section: string | null; article: string | null; source_type: string; court: string | null; decided_on: Date | null; case_status: string | null }>(
      `select k.id, k.source_id, k.header, k.text, p.text as parent_text, k.section, k.article, k.source_type::text, s.court, s.decided_on, cs.status as case_status
         from chunks k join sources s on s.id = k.source_id left join chunks p on p.id = k.parent_id left join case_status_v cs on cs.source_id = k.source_id
        where k.id = any($1::uuid[])`,
      [ids],
    )
  ).rows;
  const pieces = await loadPieces(c, ids);
  const details = await sourceDetails(c, [...new Set(rows.map((r) => r.source_id))]);
  rows.forEach((r, i) => {
    const d = details.get(r.source_id);
    const tag = `S${(i % 8) + 1}`;
    out.set(r.id, {
      chunkId: r.id,
      tag,
      sourceId: r.source_id,
      sourceType: r.source_type,
      title: d?.title ?? null,
      header: r.header ?? d?.title ?? '',
      text: r.parent_text ?? r.text,
      pieces: pieces.filter((p) => p.chunkId === r.id),
      court: r.court,
      decidedOn: r.decided_on ? r.decided_on.toISOString().slice(0, 10) : null,
      section: r.section,
      article: r.article,
      caseStatus: r.case_status,
      rolesSampled: d?.rolesSampled ?? false,
      holdingNote: d?.holdingNote ?? null,
    });
  });
  return out;
}

/** Marks a line's active citations removed, keeping the status they had (for restore). */
async function retire(c: pg.PoolClient, slideId: string, lineKeys: string[]) {
  if (!lineKeys.length) return;
  await c.query(
    "update citations set prev_status = check_status, check_status = 'removed', removed_at = clock_timestamp() where slide_id = $1 and line_key = any($2::text[]) and check_status <> 'removed'",
    [slideId, lineKeys],
  );
}

/** Is every case and section named in her example in the library? */
async function namesFound(c: pg.PoolClient, text: string): Promise<boolean> {
  const q = understandQuery(text);
  for (const name of q.caseNames) {
    const hit = await c.query("select 1 from sources where type = 'judgment' and status <> 'retired' and similarity(title, $1) >= 0.35 limit 1", [name]);
    if (!hit.rowCount) return false;
  }
  for (const ref of q.refs) {
    const hit = await c.query(
      `select 1 from chunks where status <> 'retired' and ${ref.kind === 'article' ? 'article = $1' : 'section = $1'} and ($2::text is null or act_name = $2) limit 1`,
      [ref.number, ref.act],
    );
    if (!hit.rowCount) return false;
  }
  return true;
}

/**
 * Checks for a line she changed or added, in code only (fast). Returns the ids of citations left for the
 * background check (C9/C10).
 */
async function checkLine(
  c: pg.PoolClient,
  who: Who,
  slide: SlideRow,
  line: { lineKey: string; text: string; kind: string; yourExample: boolean },
  previous: CitationRow[],
  maps: MappingRow[],
): Promise<string[]> {
  const insert = async (row: { claimType: ClaimType; risk: 'normal' | 'high'; sourceId: string | null; chunkId: string | null; span: string; status: string; checks: CheckResult[]; flag: string | null; reason: string | null; tag: string | null; label: string | null; partIndex: number | null; relevance?: string | null }) =>
    (
      await c.query<{ id: string }>(
        `insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, risk, source_id, chunk_id, span_text,
                                check_status, checks, flag_kind, flag_reason, tag, source_label, part_index, source_relevance)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) returning id`,
        [who.collegeId, who.userId, slide.lecture_id, slide.id, line.lineKey, line.text, row.claimType, row.risk, row.sourceId, row.chunkId, row.span, row.status, JSON.stringify(row.checks), row.flag, row.reason, row.tag, row.label, row.partIndex, row.relevance ?? null],
      )
    ).rows[0]!.id;

  // Her example: no source needed; a case or section it names must exist (STUDIO-6).
  if (line.yourExample) {
    if (!(await namesFound(c, line.text))) {
      await insert({ claimType: 'example', risk: 'normal', sourceId: null, chunkId: null, span: '', status: 'open', checks: [{ name: 'C3', result: 'fail', detail: EXAMPLE_NAMES }], flag: 'yellow', reason: EXAMPLE_NAMES, tag: null, label: null, partIndex: previous[0]?.part_index ?? null });
    }
    return [];
  }

  // The sources the line rested on: one claim per chunk, checked against the new words.
  const sourced = previous.filter((p) => p.chunk_id && p.span_text);
  const byChunk = new Map(sourced.map((p) => [p.chunk_id!, p]));
  if (byChunk.size) {
    const sources = await sourcesFor(c, [...byChunk.keys()]);
    const pending: string[] = [];
    for (const [chunkId, prev] of byChunk) {
      const src = sources.get(chunkId);
      if (!src) continue;
      const claim: ClaimInput = { text: line.text, type: prev.claim_type, tag: src.tag, span: prev.span_text };
      const out = codeChecks(claim, new Map([[src.tag, src]]), maps);
      const ok = passedCode(out.results);
      const d = decide(out.results);
      const id = await insert({
        claimType: prev.claim_type,
        risk: out.risk,
        sourceId: src.sourceId,
        chunkId: out.chunkId ?? chunkId,
        span: prev.span_text,
        status: 'open',
        checks: out.results,
        flag: ok ? 'yellow' : (d.flag ?? 'yellow'),
        reason: ok ? CHANGED : (d.reason ?? 'Please verify'),
        tag: prev.tag,
        label: prev.source_label,
        partIndex: prev.part_index,
        relevance: prev.source_relevance,
      });
      if (ok) pending.push(id);
    }
    return pending;
  }

  // No source: a line that states law is yellow; a question, a signpost or an analogy is fine as it is.
  if (line.kind === 'claim' || looksLegal(line.text)) {
    await insert({ claimType: 'fact', risk: 'normal', sourceId: null, chunkId: null, span: '', status: 'open', checks: [{ name: 'C1', result: 'fail', detail: NOT_FOUND }], flag: 'yellow', reason: NOT_FOUND, tag: null, label: null, partIndex: previous[0]?.part_index ?? null });
  }
  return [];
}

/** A new slide version (STUDIO-7), and the edit event her style learning reads (F10). */
async function writeVersion(c: pg.PoolClient, who: Who, slide: SlideRow, next: { title: string; body: unknown; notes: unknown }, reason: 'edit' | 'add_example' | 'restore' | 'remove_unverified') {
  const version = slide.current_version + 1;
  await c.query('update slides set title = $2, body = $3, notes = $4, current_version = $5 where id = $1', [slide.id, next.title, next.body, next.notes, version]);
  await c.query(
    `insert into slide_versions (slide_id, college_id, owner_id, version, title, body, notes, reason, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $3)`,
    [slide.id, who.collegeId, who.userId, version, next.title, next.body, next.notes, reason],
  );
  await c.query('insert into edit_events (college_id, owner_id, lecture_id, slide_id, kind, before, after) values ($1, $2, $3, $4, $5, $6, $7)', [
    who.collegeId,
    who.userId,
    slide.lecture_id,
    slide.id,
    reason,
    { title: slide.title, body: slide.body, notes: slide.notes },
    { title: next.title, body: next.body, notes: next.notes },
  ]);
  await flagDependents(c, slide.lecture_id);
  return version;
}

/**
 * HLD F8.6: a change to a taught lecture may leave later lectures of the course out of date. Those prepared after it
 * was taught used its course memory (recap, terms, cases, running example), so each gets "may need update", naming
 * the lecture that changed. A lecture prepared before it was taught never read it, and is left alone.
 */
async function flagDependents(c: pg.PoolClient, lectureId: string): Promise<void> {
  await c.query(
    `update lectures b
        set may_need_update_since = coalesce(b.may_need_update_since, now()),
            may_need_update_from = case when $1::uuid = any(b.may_need_update_from) then b.may_need_update_from else b.may_need_update_from || $1::uuid end
       from lectures a join course_units ua on ua.id = a.unit_id
       join course_units ub on ub.course_id = ua.course_id
      where a.id = $1 and a.status = 'taught' and ua.status = 'taught' and ua.taught_on is not null
        and ub.position > ua.position and ub.lecture_id = b.id
        and b.status in ('ready', 'taught') and (b.ready_at at time zone 'Asia/Kolkata')::date >= ua.taught_on`, // taught_on is a date in India
    [lectureId],
  );
}

/** PATCH /slides/:id (LLD §8.6). Returns the lecture and the citations left for the background check. */
export async function saveSlideEdit(c: pg.PoolClient, who: Who, slideId: string, edit: EditSlide, reason: 'edit' | 'remove_unverified' = 'edit'): Promise<{ lectureId: string; pending: string[] }> {
  const slide = await loadSlide(c, slideId);
  if (edit.version !== slide.current_version) {
    throw new AppError('VERSION_CONFLICT', 'This slide was changed elsewhere (another tab?). Reload it to see the newest version.', { version: slide.current_version });
  }
  const before = new Map([...(slide.body.content ?? []), ...(slide.notes.content ?? [])].map((n) => [n.attrs?.lineKey ?? '', n]));
  const cits = (
    await c.query<CitationRow>(
      "select id, line_key, claim_type, source_id, chunk_id, span_text, source_label, source_relevance, tag, risk, part_index from citations where slide_id = $1 and check_status <> 'removed'",
      [slideId],
    )
  ).rows;
  const citsOf = (key: string) => cits.filter((x) => x.line_key === key);
  const maps = await mappings(c);

  const pending: string[] = [];
  const kept = new Set<string>();
  const build = async (lines: EditLine[]) => {
    const out: { lineKey: string; kind: string; yourExample: boolean; edited: boolean; text: string }[] = [];
    for (const l of lines) {
      const old = l.lineKey ? before.get(l.lineKey) : undefined;
      const lineKey = old ? l.lineKey! : newKey();
      const yourExample = l.yourExample ?? old?.attrs?.yourExample ?? false;
      const unchanged = old && lineText(old) === l.text && (old.attrs?.kind ?? 'teaching') === l.kind;
      if (unchanged) {
        kept.add(lineKey);
        out.push({ lineKey, kind: l.kind, yourExample, edited: old.attrs?.edited === true, text: l.text });
        continue;
      }
      const previous = old ? citsOf(lineKey) : [];
      if (old) await retire(c, slideId, [lineKey]);
      kept.add(lineKey);
      pending.push(...(await checkLine(c, who, slide, { lineKey, text: l.text, kind: l.kind, yourExample }, previous, maps)));
      out.push({ lineKey, kind: l.kind, yourExample, edited: true, text: l.text });
    }
    return out;
  };
  const lines = await build(edit.lines);
  const notes = await build(edit.notes);
  // Lines she removed: their citations are kept, marked removed.
  await retire(
    c,
    slideId,
    [...before.keys()].filter((k) => k && !kept.has(k)),
  );
  await writeVersion(c, who, slide, { title: edit.title, body: doc(lines), notes: doc(notes) }, reason);
  return { lectureId: slide.lecture_id, pending };
}

/** POST /slides/:id/verify: she has checked the line herself (STUDIO-4); recorded with who and when. */
export async function verifyLine(c: pg.PoolClient, slideId: string, lineKey: string): Promise<string> {
  const slide = await loadSlide(c, slideId);
  const r = await c.query(
    "update citations set check_status = 'verified_by_you', verified_by = app_user(), verified_at = now() where slide_id = $1 and line_key = $2 and check_status = 'open'",
    [slideId, lineKey],
  );
  if (!r.rowCount) throw new AppError('NOT_FOUND', 'There is nothing to verify on that line.');
  return slide.lecture_id;
}

/** POST /slides/:id/examples (STUDIO-6): her example at the end of the slide, optionally saved to her bank (PERS-3). */
export async function addExample(c: pg.PoolClient, who: Who, slideId: string, text: string, save: boolean): Promise<string> {
  const slide = await loadSlide(c, slideId);
  const lines = (slide.body.content ?? []).map((n) => ({ lineKey: n.attrs?.lineKey ?? newKey(), kind: n.attrs?.kind ?? 'teaching', yourExample: n.attrs?.yourExample === true, edited: n.attrs?.edited === true, text: lineText(n) }));
  const lineKey = newKey();
  await checkLine(c, who, slide, { lineKey, text, kind: 'example', yourExample: true }, [], []);
  lines.push({ lineKey, kind: 'example', yourExample: true, edited: true, text });
  await writeVersion(c, who, slide, { title: slide.title, body: doc(lines), notes: slide.notes }, 'add_example');
  if (save) await c.query('insert into examples (college_id, owner_id, text) values ($1, $2, $3)', [who.collegeId, who.userId, text]);
  return slide.lecture_id;
}

/**
 * POST /slides/:id/restore (STUDIO-7): the slide as it was at `version`, with its citations as they were then. A
 * restore is itself a new version, so it can be undone too.
 */
export async function restoreSlide(c: pg.PoolClient, who: Who, slideId: string, version: number): Promise<string> {
  const slide = await loadSlide(c, slideId);
  const v = (
    await c.query<{ title: string; body: SlideRow['body']; notes: SlideRow['notes']; created_at: Date }>('select title, body, notes, created_at from slide_versions where slide_id = $1 and version = $2', [slideId, version])
  ).rows[0];
  if (!v || version >= slide.current_version) throw new AppError('NOT_FOUND', 'That version of the slide is not there.');
  // Citations that were active at that moment come back; those added since are set aside (kept, for a redo).
  await c.query(
    `update citations set check_status = prev_status, prev_status = null, removed_at = null
      where slide_id = $1 and check_status = 'removed' and prev_status is not null and created_at <= $2 and removed_at > $2`,
    [slideId, v.created_at],
  );
  await c.query(
    "update citations set prev_status = check_status, check_status = 'removed', removed_at = clock_timestamp() where slide_id = $1 and check_status <> 'removed' and created_at > $2",
    [slideId, v.created_at],
  );
  await writeVersion(c, who, slide, { title: v.title, body: v.body, notes: v.notes }, 'restore');
  return slide.lecture_id;
}

/**
 * POST /coverage/:id/add ("Add this for me"): a missing proviso, exception, explanation or clause goes on the slide
 * that already teaches its section (the last slide when none does), as the Act's own words in quotation marks, with
 * the section as its source. The code checks run as on any line; only when every one passes is the quote supported,
 * since a word-for-word quote needs no AI reading (C9/C10). Otherwise the line is yellow with the reason.
 */
export async function addCoverageLine(c: pg.PoolClient, who: Who, itemId: string): Promise<{ lectureId: string; slideId: string; lineKey: string }> {
  const item = (
    await c.query<{ lecture_id: string; item_kind: string; item_ref: string | null; item_label: string | null; item_text: string | null; state: string; section_key: string }>(
      'select lecture_id, item_kind, item_ref, item_label, item_text, state, section_key from coverage_items where id = $1',
      [itemId],
    )
  ).rows[0];
  if (!item || item.state !== 'missing' || !canAddFor(item)) throw new AppError('NOT_FOUND', 'That item is not open, or it needs your own teaching (a leading case).');
  const chunkId = item.item_ref!;
  const home = (
    await c.query<{ id: string; source_label: string | null }>(
      `select s.id, ci.source_label from citations ci join slides s on s.id = ci.slide_id
        where ci.lecture_id = $1 and ci.chunk_id = $2 and ci.check_status <> 'removed' order by s.position, ci.created_at limit 1`,
      [item.lecture_id, chunkId],
    )
  ).rows[0];
  const slideId = home?.id ?? (await c.query<{ id: string }>('select id from slides where lecture_id = $1 order by position desc limit 1', [item.lecture_id])).rows[0]?.id;
  if (!slideId) throw new AppError('NOT_FOUND', 'This lecture has no slides yet.');
  const src = (await sourcesFor(c, [chunkId])).get(chunkId);
  if (!src) throw new AppError('NOT_FOUND', 'The section this item comes from is no longer in the library.');

  const slide = await loadSlide(c, slideId);
  const words = item.item_text!.trim().replace(/\s+/g, ' ');
  const text = `${item.item_label ?? item.section_key}: “${words}”`;
  const claim: ClaimInput = { text, type: 'quote', tag: src.tag, span: words };
  const out = codeChecks(claim, new Map([[src.tag, src]]), await mappings(c));
  const verbatim: CheckResult = { name: 'C9', result: 'pass', detail: VERBATIM };
  const results = passedCode(out.results) ? [...out.results, verbatim, ...(out.risk === 'high' ? [{ ...verbatim, name: 'C10' as const }] : [])] : out.results;
  const d = decide(results);
  const lineKey = newKey();
  await c.query(
    `insert into citations (college_id, owner_id, lecture_id, slide_id, line_key, claim_text, claim_type, risk, source_id, chunk_id, span_text, span_start, span_end,
                            check_status, checks, flag_kind, flag_reason, tag, source_label, part_index)
     values ($1, $2, $3, $4, $5, $6, 'quote', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, (select part_index from slides where id = $4))`,
    [who.collegeId, who.userId, item.lecture_id, slideId, lineKey, text, out.risk, src.sourceId, out.chunkId ?? chunkId, words, out.spanStart, out.spanEnd, d.status, JSON.stringify(results), d.flag, d.reason, src.tag, home?.source_label ?? src.header],
  );
  const lines = (slide.body.content ?? []).map((n) => ({ lineKey: n.attrs?.lineKey ?? newKey(), kind: n.attrs?.kind ?? 'teaching', yourExample: n.attrs?.yourExample === true, edited: n.attrs?.edited === true, text: lineText(n) }));
  lines.push({ lineKey, kind: 'claim', yourExample: false, edited: true, text });
  await writeVersion(c, who, slide, { title: slide.title, body: doc(lines), notes: slide.notes }, 'edit');
  return { lectureId: item.lecture_id, slideId, lineKey };
}

/**
 * Live yellow/grey counts are computed on read; the stored ones are kept roughly current for lists. Coverage is
 * matched again too (LLD §8.5 step 6); the items a change left uncovered are returned.
 */
export async function refreshCounts(c: pg.PoolClient, lectureId: string): Promise<CoverageChangedItem[]> {
  await c.query(
    `with lines as (
       select ci.slide_id, ci.line_key, bool_or(ci.check_status = 'open') yellow, bool_or(ci.flag_kind = 'grey') grey
         from citations ci where ci.lecture_id = $1 and ci.check_status <> 'removed' group by 1, 2)
     update lectures set yellow_open = (select count(*) from lines where yellow), grey_open = (select count(*) from lines where grey and not yellow)
      where id = $1`,
    [lectureId],
  );
  return rerunCoverage(c, lectureId);
}

/**
 * check.lines (LLD §5, §8.6): C9 for each changed line still waiting, and C10 for high-risk ones, against the words it
 * rests on. A pass turns the line supported; anything else keeps it yellow with the reason. Never blocks her typing.
 */
export async function checkEditedLines(tenant: <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>, citationIds: string[], deps: { gateway: Gateway; usage: UsageSink }): Promise<number> {
  const loaded = await tenant(async (c) => {
    const rows = (
      await c.query<CitationRow & { claim_text: string }>(
        "select id, line_key, claim_type, source_id, chunk_id, span_text, source_label, source_relevance, tag, risk, part_index, claim_text from citations where id = any($1::uuid[]) and check_status = 'open' and flag_reason = $2",
        [citationIds, CHANGED],
      )
    ).rows;
    return { rows, sources: await sourcesFor(c, rows.map((r) => r.chunk_id!).filter(Boolean)), maps: await mappings(c) };
  });
  let done = 0;
  for (const r of loaded.rows) {
    const src = loaded.sources.get(r.chunk_id!);
    if (!src) continue;
    const [checked] = await checkClaims([{ id: r.id, claim: { text: r.claim_text, type: r.claim_type, tag: src.tag, span: r.span_text } }], new Map([[src.tag, src]]), loaded.maps, deps);
    const d = decide(checked!.results);
    await tenant((c) =>
      c.query("update citations set check_status = $2, checks = $3, flag_kind = $4, flag_reason = $5 where id = $1 and check_status = 'open' and flag_reason = $6", [
        r.id,
        d.status,
        JSON.stringify(checked!.results),
        d.flag,
        d.reason,
        CHANGED,
      ]),
    );
    done += 1;
  }
  return done;
}
