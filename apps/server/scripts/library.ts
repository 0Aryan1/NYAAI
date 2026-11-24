/**
 * Library CLI (development and library-editor support). Runs as nyaai_library, like the worker.
 *   pnpm library finish --all                 stages 5–7 (label, embed, gate) for every source still processing
 *   pnpm library finish --source <uuid>       the same for one source
 *   pnpm library kanoon --tid 1214064 [--tid …]   load judgments from Indian Kanoon (provisional, expiring)
 *   pnpm library gaps [--state waiting|all|open|…]   the library-gap list, most teachers first
 *   pnpm library lookup --question "…" [--as teacher.a@cnlu.ac.in]
 *                                             search as that teacher; on a gap, record it, run the trusted-source
 *                                             lookup (India Code, Indian Kanoon, official links) and search again
 *   pnpm library lookup --gap <uuid>          run the lookup again for one gap (ignores the 24-hour cooldown)
 *   pnpm library reload --source <uuid>      split an Act again from its stored original (after a splitter fix) and
 *                                             finish it; its chunks are replaced
 *   pnpm library resplit [--source <uuid>]  split stored judgments again (after a splitter fix) from the copy in
 *                                             storage (Kanoon JSON or official PDF; nothing fetched); only judgments
 *                                             whose paragraphs change are rewritten (ids and labels kept where same)
 *   pnpm library pack --file packages/db/seeds/packs/adr.json [--only acts|cases] [--dry]
 *                                             load a course pack: its Acts from India Code (official → live) and its
 *                                             leading cases, each matched by name: the Supreme Court Reports first
 *                                             (official, kept), Indian Kanoon for gaps and where the official copy is
 *                                             a scan (provisional). --dry searches only (nothing fetched or loaded)
 *   pnpm library official [--source <uuid>] [--dry]
 *                                             replace Indian Kanoon copies of Supreme Court judgments with the
 *                                             official report: typeset copies replace the text in place (ids kept),
 *                                             scanned copies are kept beside the cleaner text with their citations
 *   pnpm library relink [--dry]             keep the Kanoon link of each official copy that replaced a Kanoon text
 *                                             (from the Kanoon file still in storage; nothing fetched), so a lookup
 *                                             never loads the same case again
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { caseMatches, kanoonToJudgment, matchHeldCase, pdfToJudgment, pickAct, pickCaseHit, pickEscrByDate, pickEscrRecord, sameAct, splitJudgment, titleQuery, type EscrRecord, type KanoonDoc } from '@nyaai/legal';
import type { Kanoon } from '../src/services/kanoon/index.ts';
import { createPool, withTenant } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { usageSink } from '../src/services/usage.ts';
import { escrFrom, gatewayFrom, indiaCodeFrom, kanoonFrom, storageFrom, voyageFrom, webSearchFrom } from '../src/services/factory.ts';
import type { Escr } from '../src/services/escr/index.ts';
import { pdfIsScanned, pdfLines } from '../src/services/ingest/extract.ts';
import { loadJudgmentPdf, type JudgmentPdfResult } from '../src/services/ingest/judgment-pdf.ts';
import { finishSource } from '../src/services/ingest/finish.ts';
import { heldJudgments, ingestKanoonJudgment, kanoonUrl } from '../src/services/ingest/kanoon.ts';
import { loadIndiaCodeAct } from '../src/services/ingest/india-code.ts';
import { ingestSource } from '../src/services/ingest/source.ts';
import { createGapLookup, searchWithLookup, type TenantRunner } from '../src/services/lookup/index.ts';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    all: { type: 'boolean' },
    source: { type: 'string', multiple: true },
    tid: { type: 'string', multiple: true },
    state: { type: 'string', default: 'waiting' },
    question: { type: 'string' },
    as: { type: 'string', default: 'teacher.a@cnlu.ac.in' },
    gap: { type: 'string' },
    file: { type: 'string' },
    only: { type: 'string' },
    dry: { type: 'boolean' },
  },
});

/** A course pack: the Acts and leading cases a course needs, listed by a person (reviewed by the library editor). */
const Pack = z.object({
  course: z.string(),
  outline: z.string(),
  acts: z.array(z.object({ name: z.string(), year: z.number().int(), units: z.array(z.string()).default([]), note: z.string().optional() })),
  cases: z.array(
    z.object({
      name: z.string(),
      year: z.number().int().nullable().default(null),
      court: z.enum(['SC', 'any']).default('SC'),
      /** Words that must all be in Kanoon's title, for a case with no "v." ("In Re: …"). */
      titleWords: z.array(z.string()).optional(),
      unit: z.string(),
      topic: z.string(),
      note: z.string().optional(),
    }),
  ),
});

const config = loadConfig();
if (!config.DATABASE_URL_LIBRARY) throw new Error('DATABASE_URL_LIBRARY is not set');
const library = createPool(config.DATABASE_URL_LIBRARY, 2);
const usage = usageSink(library, { collegeId: 'global', ownerId: null });
const deps = {
  library,
  voyage: voyageFrom(config, usage),
  gateway: gatewayFrom(config),
  usage,
  embedModel: config.VOYAGE_EMBED_MODEL,
  progress: (s: string) => void process.stdout.write(`  ${s}…\n`),
};

/** The official report's citations: "[2014] 13 S.C.R. 895; 2014 INSC 809". */
const escrCitation = (r: EscrRecord) => [r.citation, r.neutralCitation].filter(Boolean).join('; ') || null;
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
function describe(r: JudgmentPdfResult): string {
  if (r.kind === 'loaded')
    return `${r.replaced ? 'official text now in use' : 'loaded from the official report'}${r.scanned ? ' (SCANNED copy: check quotes)' : ''}, ${r.paragraphs} paragraphs, ${r.opinions.join(' + ')}${r.replaced ? `; ${r.keptIds} paragraph ids and ${r.keptRoles} labels kept; agrees ${pct(r.agreement)}` : ''}; ${r.status}`;
  if (r.kind === 'kept_existing') return `official copy is a scan: kept the cleaner text, added the official copy and citations (agrees ${pct(r.agreement)})`;
  if (r.kind === 'mismatch') return `NOT THE SAME TEXT: only ${pct(r.agreement)} of the current text is in the official copy; nothing changed`;
  return `already loaded as ${r.sourceId}`;
}
/** The official PDF of a record, loaded as a new source or in place of a Kanoon copy. */
async function loadOfficial(escr: Escr, record: EscrRecord, caseName: string, replace: string | null): Promise<JudgmentPdfResult> {
  const { bytes, url } = await escr.pdf(record);
  return loadJudgmentPdf(
    { bytes, url, origin: 'court_site', citation: escrCitation(record), hint: { caseName, decidedOn: record.decidedOn, court: 'Supreme Court of India' } },
    { ...deps, storage: storageFrom(config) },
    { replace },
  );
}

try {
  if (command === 'finish') {
    const ids = values.all
      ? (await library.query<{ id: string }>("select id from sources where status = 'processing' order by created_at")).rows.map((r) => r.id)
      : (values.source ?? []);
    for (const id of ids) {
      const t = Date.now();
      console.log(id, JSON.stringify(await finishSource(id, deps)), `${(Date.now() - t) / 1000}s`);
    }
  } else if (command === 'kanoon') {
    const kanoon = kanoonFrom(config, usage);
    for (const tid of values.tid ?? []) {
      const t = Date.now();
      const r = await ingestKanoonJudgment(Number(tid), { ...deps, kanoon, storage: storageFrom(config), cacheDays: config.KANOON_CACHE_DAYS });
      console.log(tid, JSON.stringify(r), `${(Date.now() - t) / 1000}s`);
    }
  } else if (command === 'gaps') {
    const states = values.state === 'waiting' ? ['open', 'looking', 'loaded'] : values.state === 'all' ? null : [values.state!];
    const rows = await library.query<{ id: string; state: string; kind: string; teachers: number; asks: number; question: string; act_name: string | null; leads: unknown[]; attempts: { provider: string; outcome: string; detail: string }[] }>(
      `select id, state, kind, teachers, asks, question, act_name, leads, attempts from library_gaps
        where ($1::gap_state[] is null or state = any($1)) order by teachers desc, asks desc, last_seen_at desc limit 50`,
      [states],
    );
    if (!rows.rows.length) console.log('No gaps.');
    for (const g of rows.rows) {
      console.log(`${g.id}  [${g.state}] ${g.kind}${g.act_name ? ` (${g.act_name})` : ''}  teachers ${g.teachers}, asked ${g.asks}×\n  "${g.question}"`);
      for (const a of g.attempts.slice(-4)) console.log(`    ${a.provider}: ${a.outcome} — ${a.detail}`);
      if (g.leads.length) console.log(`    ${g.leads.length} official link(s) for the editor`);
    }
  } else if (command === 'lookup') {
    const lookup = createGapLookup({
      ...deps,
      storage: storageFrom(config),
      kanoon: config.INDIAN_KANOON_TOKEN ? kanoonFrom(config, usage) : null,
      indiaCode: indiaCodeFrom(),
      web: webSearchFrom(config, usage),
      cacheDays: config.KANOON_CACHE_DAYS,
    });
    if (values.gap) {
      console.log(JSON.stringify(await lookup.run(values.gap, { force: true }), null, 2));
    } else if (values.question) {
      // Search exactly as the teacher would (her tenant, RLS on), on the app role.
      const app = createPool(config.DATABASE_URL, 2);
      try {
        // The library role cannot read users; the API's sign-in lookup can.
        const user = (await app.query<{ id: string; college_id: string; role: 'teacher' | 'admin' | 'library_editor' }>(
          'select id, college_id, role from auth_find_user($1)', [values.as],
        )).rows[0];
        if (!user) throw new Error(`No user ${values.as}; run pnpm db:seed`);
        const tenant: TenantRunner = (fn) => withTenant(app, { userId: user.id, collegeId: user.college_id, role: user.role }, fn);
        const t = Date.now();
        const r = await searchWithLookup(
          tenant,
          { query: values.question, purpose: 'explore' },
          (c) => {
            const teacherUsage = usageSink(c, { collegeId: user.college_id, ownerId: user.id });
            return { voyage: voyageFrom(config, teacherUsage), gateway: deps.gateway, usage: teacherUsage, minScore: config.RERANK_MIN_SCORE };
          },
          lookup,
        );
        console.log(`outcome: ${r.outcome} (${(Date.now() - t) / 1000}s)`);
        for (const s of r.sources) console.log(`  ${s.tag} ${s.rerankScore?.toFixed(2) ?? '—'} ${s.provisional ? '[not yet reviewed] ' : ''}${s.header}`);
        if (r.gap) console.log(JSON.stringify(r.gap, null, 2));
      } finally {
        await app.end();
      }
    } else {
      throw new Error('lookup needs --question "<text>" or --gap <id>');
    }
  } else if (command === 'reload') {
    // Read the status before the split marks the source as processing.
    for (const id of values.source ?? []) {
      const t = Date.now();
      const wasProvisional = (await library.query<{ status: string }>('select status from sources where id = $1', [id])).rows[0]?.status === 'provisional';
      const split = await ingestSource(id, { library, storage: storageFrom(config), allowFile: true, progress: deps.progress });
      if (split.kind === 'duplicate') {
        console.log(id, `duplicate of ${split.duplicateOf}`);
        continue;
      }
      // A source that was provisional (auto-loaded, not yet confirmed by the editor) stays provisional.
      const done = await finishSource(id, { ...deps, provisional: wasProvisional });
      console.log(id, `${split.units} units, ${split.removed} removed${split.missing.length ? `, MISSING sections ${split.missing.join(', ')}` : ''}`, JSON.stringify(done), `${(Date.now() - t) / 1000}s`);
    }
  } else if (command === 'resplit') {
    const storage = storageFrom(config);
    const rows = (
      await library.query<{ id: string; title: string; url: string; storage_key: string }>(
        `select id, title, url, storage_key from sources
          where type = 'judgment' and origin = 'indian_kanoon' and status <> 'retired' and storage_key is not null
            and ($1::uuid[] is null or id = any($1)) order by title`,
        [values.source?.length ? values.source : null],
      )
    ).rows;
    let changed = 0;
    for (const src of rows) {
      const raw = JSON.parse(new TextDecoder().decode(await storage.get(src.storage_key))) as KanoonDoc;
      const fresh = splitJudgment(kanoonToJudgment(raw)).chunks.map((c) => c.text);
      const stored = (await library.query<{ text: string }>('select text from chunks where source_id = $1 order by seq', [src.id])).rows.map((r) => r.text);
      if (fresh.length === stored.length && fresh.every((t, i) => t === stored[i])) continue;
      const tid = Number(/\/doc\/(\d+)\//.exec(src.url)?.[1]);
      // The stored copy stands in for Kanoon, so nothing is fetched or billed.
      const fromStorage = { search: async () => [], doc: async () => raw } satisfies Kanoon;
      const r = await ingestKanoonJudgment(tid, { ...deps, kanoon: fromStorage, storage, cacheDays: config.KANOON_CACHE_DAYS }, { knownName: src.title, nameVerified: true });
      changed++;
      console.log(`  ${src.title}: ${stored.length} → ${r.paragraphs} paragraphs`);
    }
    // Official and uploaded PDFs, read again from storage.
    const pdfs = (
      await library.query<{ id: string; title: string; url: string | null; storage_key: string; origin: 'court_site' | 'upload'; citation: string | null; court: string | null; decided: string | null; status: string }>(
        `select id, title, url, storage_key, origin, citation, court, to_char(decided_on, 'YYYY-MM-DD') as decided, status from sources
          where type = 'judgment' and origin in ('court_site', 'upload') and status <> 'retired' and storage_key like '%.pdf'
            and ($1::uuid[] is null or id = any($1)) order by title`,
        [values.source?.length ? values.source : null],
      )
    ).rows;
    for (const src of pdfs) {
      const bytes = await storage.get(src.storage_key);
      const hint = { caseName: src.title, decidedOn: src.decided, court: src.court };
      // Who wrote each paragraph matters as much as its words ("held" needs the majority).
      const fresh = splitJudgment(pdfToJudgment(await pdfLines(bytes), hint)).chunks.map((c) => `${c.text}|${c.opinion}|${c.judge}`);
      const stored = (await library.query<{ key: string }>("select text || '|' || coalesce(opinion::text, 'null') || '|' || coalesce(judge, 'null') as key from chunks where source_id = $1 order by seq", [src.id])).rows.map((r) => r.key);
      const same = fresh.length === stored.length && fresh.every((t, i) => t === stored[i]);
      if (same) continue;
      const r = await loadJudgmentPdf({ bytes, url: src.url, origin: src.origin, citation: src.citation, hint }, { ...deps, storage }, { replace: src.id, resplit: true, provisional: src.status === 'provisional' });
      changed++;
      console.log(`  ${src.title}: ${stored.length} → ${fresh.length} chunks; ${describe(r)}`);
    }
    console.log(`${changed} of ${rows.length + pdfs.length} judgments re-split.`);
  } else if (command === 'official') {
    const escr = escrFrom(storageFrom(config));
    const rows = (
      await library.query<{ id: string; title: string; year: number | null; decided: string | null }>(
        `select id, title, extract(year from decided_on)::int as year, to_char(decided_on, 'YYYY-MM-DD') as decided from sources
          where type = 'judgment' and origin = 'indian_kanoon' and status <> 'retired' and court_level = 'supreme_court'
            and ($1::uuid[] is null or id = any($1)) order by decided_on nulls last, title`,
        [values.source?.length ? values.source : null],
      )
    ).rows;
    const tally = new Map<string, number>();
    const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
    for (const src of rows) {
      const label = `${src.title}${src.year ? ` (${src.year})` : ''}`;
      if (!src.year) {
        count('no date');
        console.log(`  ${label}: no decision date; skipped`);
        continue;
      }
      const candidates = await escr.candidates(src.year);
      const record = pickEscrRecord(src.title, candidates, { year: src.year }) ?? (src.decided ? pickEscrByDate(src.title, candidates, src.decided) : null);
      if (!record) {
        count('not in the official report');
        console.log(`  ${label}: not found in the official report`);
        continue;
      }
      if (values.dry) {
        count('found');
        console.log(`  ${label}: ${record.citation ?? ''} ${record.neutralCitation ?? ''} — ${record.title}`);
        continue;
      }
      const t = Date.now();
      try {
        const r = await loadOfficial(escr, record, src.title, src.id);
        count(r.kind === 'loaded' ? (r.replaced ? 'official text in use' : 'loaded') : r.kind === 'kept_existing' ? 'scan kept beside' : r.kind);
        console.log(`  ${label}: ${describe(r)} (${(Date.now() - t) / 1000}s)`);
      } catch (err) {
        count('failed');
        console.log(`  ${label}: FAILED ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log([...tally.entries()].map(([k, n]) => `${n} ${k}`).join(', ') || 'Nothing to do.');
  } else if (command === 'relink') {
    // Upkeep (0012): official copies that replaced a Kanoon text before the Kanoon copy was kept on record forgot its
    // link, so a lookup could load the case again. The Kanoon files are still in storage: each one no source uses is
    // matched to its case (parties, date, court) and kept as a copy. Nothing is fetched or billed. --dry lists only.
    const storage = storageFrom(config);
    const used = new Set(
      (await library.query<{ key: string }>('select storage_key as key from sources where storage_key is not null union select storage_key from source_copies')).rows.map((r) => r.key),
    );
    const keys = (await storage.list('sources/indian_kanoon/')).filter((k) => k.endsWith('.json') && !used.has(k));
    const held = await heldJudgments(library);
    let linked = 0;
    for (const key of keys) {
      const doc = JSON.parse(new TextDecoder().decode(await storage.get(key))) as KanoonDoc;
      const match = matchHeldCase({ title: doc.title, docsource: doc.docsource ?? null, publishdate: doc.publishdate ?? null }, held);
      if (match?.kind !== 'same') {
        console.log(`  ${doc.title}: ${match ? `may be ${match.held.title}; not linked, check by hand` : 'no such case in the library'}`);
        continue;
      }
      console.log(`  ${doc.title} → ${match.held.title}`);
      if (values.dry) continue;
      const hash = path.basename(key, '.json');
      const r = await library.query(
        `insert into source_copies (college_id, source_id, origin, url, storage_key, content_hash, citation, scanned, agreement, in_use)
         values (global_college(), $1, 'indian_kanoon', $2, $3, $4, null, false, null, false)
         on conflict (source_id, content_hash) do nothing`,
        [match.held.sourceId, kanoonUrl(doc.tid), key, hash],
      );
      linked += r.rowCount ?? 0;
    }
    console.log(`${keys.length} Kanoon file(s) no source uses; ${values.dry ? 'dry run, nothing written' : `${linked} link(s) kept as copies`}.`);
  } else if (command === 'pack') {
    if (!values.file) throw new Error('pack needs --file <pack.json>');
    const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.file);
    const pack = Pack.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    console.log(`${pack.course} (${pack.outline}): ${pack.acts.length} Acts, ${pack.cases.length} cases${values.dry ? ' — dry run' : ''}`);
    const storage = storageFrom(config);
    let failures = 0;

    if (values.only !== 'cases') {
      const indiaCode = indiaCodeFrom();
      const have = (await library.query<{ act_name: string | null; act_year: number | null }>(
        "select distinct act_name, act_year from sources where type = 'act' and status <> 'retired'",
      )).rows;
      for (const a of pack.acts) {
        const label = `${a.name}, ${a.year}`;
        if (have.some((h) => h.act_name && sameAct(h.act_name, a.name) && (h.act_year === null || h.act_year === a.year))) {
          console.log(`  act  ${label}: already in the library`);
          continue;
        }
        const pick = pickAct({ name: a.name, year: a.year }, await indiaCode.findCentralActs(a.name));
        if (pick.kind !== 'one') {
          failures++;
          console.log(`  act  ${label}: NOT LOADED (${pick.kind})${pick.kind === 'ambiguous' ? ` ${pick.acts.map((x) => x.pageUrl).join(' ')}` : ''}`);
          continue;
        }
        if (values.dry) {
          console.log(`  act  ${label}: found ${pick.act.title} (${pick.act.pageUrl})`);
          continue;
        }
        const t = Date.now();
        // A person listed this Act by name and year, so the official text goes live like any official upload.
        const r = await loadIndiaCodeAct(pick.act, { ...deps, storage, indiaCode }, { provisional: false });
        const gaps = r.kind === 'loaded' && r.missing.length ? ` — MISSING sections ${r.missing.slice(0, 12).join(', ')}${r.missing.length > 12 ? '…' : ''}` : '';
        if (r.kind === 'no_pdf' || gaps) failures++;
        console.log(`  act  ${label}: ${r.kind === 'loaded' ? `${r.units} sections` : r.kind}${'sourceId' in r ? ` ${r.sourceId}` : ''}${gaps} (${(Date.now() - t) / 1000}s)`);
      }
    }

    if (values.only !== 'acts') {
      const kanoon = kanoonFrom(config, usage);
      const escr = escrFrom(storage);
      const have = (await library.query<{ title: string }>("select title from sources where type = 'judgment' and status <> 'retired'")).rows;
      for (const c of pack.cases) {
        const label = `${c.name}${c.year ? ` (${c.year})` : ''}`;
        if (have.some((h) => (c.titleWords?.length ? c.titleWords.every((w) => h.title.toLowerCase().includes(w.toLowerCase())) : caseMatches(c.name, h.title)) && !/\b(?:and|&)$/i.test(h.title.trim()))) {
          console.log(`  case ${label}: already in the library`);
          continue;
        }
        // The official report first (HLD D25). A typeset copy is loaded as it is; a scan has reading errors, so the
        // Kanoon text is preferred and the scan kept beside it (or, when Kanoon lacks the case, the scan is loaded).
        const caseName = c.name.replace(/\s+vs\.?\s+/i, ' v. ').trim();
        const record = c.court === 'SC' && c.year ? pickEscrRecord(c.name, await escr.candidates(c.year), { year: c.year, titleWords: c.titleWords }) : null;
        let scan: EscrRecord | null = null;
        if (record) {
          if (values.dry) {
            console.log(`  case ${label}: official ${record.citation ?? ''} ${record.neutralCitation ?? ''} — ${record.title}`);
            continue;
          }
          if (!(await pdfIsScanned((await escr.pdf(record)).bytes))) {
            const t = Date.now();
            try {
              const r = await loadOfficial(escr, record, caseName, null);
              have.push({ title: caseName });
              console.log(`  case ${label}: ${describe(r)} (${(Date.now() - t) / 1000}s)`);
            } catch (err) {
              failures++;
              console.log(`  case ${label}: FAILED ${err instanceof Error ? err.message : String(err)}`);
            }
            continue;
          }
          scan = record;
        }
        const q = c.titleWords?.length ? `title: ${c.titleWords.join(' ')}` : titleQuery(c.name);
        const doctypes = c.court === 'SC' ? 'supremecourt' : 'judgments';
        const pick = (h: Awaited<ReturnType<typeof kanoon.search>>) =>
          pickCaseHit(c.name, h, { year: c.year, court: c.court === 'SC' ? 'SC' : null, titleWords: c.titleWords });
        let hits = await kanoon.search(q, { doctypes });
        let hit = pick(hits);
        // Kanoon's title index misses some cases ("Vidya Devi"): try the same words as a full-text search.
        if (!hit) {
          hits = await kanoon.search(q.replace(/^title:\s*/, ''), { doctypes });
          hit = pick(hits);
        }
        if (!hit && scan) {
          const r = await loadOfficial(escr, scan, caseName, null);
          have.push({ title: caseName });
          console.log(`  case ${label}: not on Kanoon; ${describe(r)}`);
          continue;
        }
        if (!hit) {
          failures++;
          console.log(`  case ${label}: NOT FOUND in the official report or on Kanoon (${q}; ${hits.length} hits: ${hits.slice(0, 3).map((h) => h.title).join(' | ')})`);
          continue;
        }
        const yearOff = c.year && !hit.publishdate?.startsWith(String(c.year)) ? ` — YEAR ${hit.publishdate}` : '';
        if (values.dry) {
          console.log(`  case ${label}: ${hit.tid} ${hit.title}${yearOff}`);
          continue;
        }
        const t = Date.now();
        try {
          const r = await ingestKanoonJudgment(hit.tid, { ...deps, kanoon, storage, cacheDays: config.KANOON_CACHE_DAYS }, { knownName: c.name, nameVerified: !c.titleWords?.length });
          have.push({ title: r.caseName });
          console.log(`  case ${label}: ${r.caseName}, ${r.paragraphs} paragraphs${yearOff} (${(Date.now() - t) / 1000}s)`);
          if (scan) console.log(`    ${describe(await loadOfficial(escr, scan, r.caseName, r.sourceId))}`);
        } catch (err) {
          failures++;
          console.log(`  case ${label}: FAILED ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (failures) {
      console.log(`${failures} item(s) need the library editor.`);
      process.exitCode = 2;
    }
  } else {
    console.error('Usage: pnpm library finish (--all | --source <id>) | kanoon --tid <n> | gaps [--state …] | lookup (--question "…" [--as <email>] | --gap <id>) | pack --file <pack.json> [--only acts|cases] [--dry] | official [--source <id>] [--dry]');
    process.exitCode = 1;
  }
  const spent = await library.query<{ provider: string; calls: number; cost: string }>(
    "select provider, count(*)::int calls, sum(cost_micro_usd) cost from usage where created_at > now() - interval '1 hour' group by provider",
  );
  for (const r of spent.rows) console.log(`last hour: ${r.provider} ${r.calls} calls, US$${(Number(r.cost) / 1e6).toFixed(4)}`);
} finally {
  await library.end();
}
