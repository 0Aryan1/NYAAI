/**
 * One lecture part (LLD §5.2 step 3, §8): retrieve → write closed-book → ten checks → one repair round → checks
 * again. Returns the checked slides; saving is the caller's (one transaction per part).
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { REPAIRABLE, looksLegal, type CheckSource, type ClaimInput, type MappingRow } from '@nyaai/checker-rules';
import { PROMPTS, fence } from '@nyaai/prompts';
import { WriterReplyRepair, WriterReplyWrite, type LecturePlan, type WrittenLine } from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import { searchWithLookup, type GapLookup, type TenantRunner } from '../lookup/index.ts';
import { loadPieces, sourceDetails, type RetrievedSource, type SearchDeps } from '../search/index.ts';
import type { UsageSink } from '../usage.ts';
import { checkClaims, sourcesBlock, type CheckedClaim } from './checking.ts';

export interface BuiltLine {
  lineKey: string;
  text: string;
  kind: WrittenLine['kind'];
  /** The teacher's own must-include example (no legal claim inside). */
  yourExample: boolean;
  claims: CheckedClaim[];
  /** Set when the line itself is flagged: a legal statement with no source, or a question the library can't answer. */
  lineFlag: string | null;
}

export interface BuiltSlide {
  layout: string;
  title: string;
  lines: BuiltLine[];
  notes: BuiltLine[];
}

export interface PartOutput {
  partIndex: number;
  slides: BuiltSlide[];
  notFound: string[];
  leftOut: { item: string; reason: string }[];
  /** Label per tag, for the source chips ("s. 56 ICA", "Satyabrata Ghose ¶12"). */
  labels: Map<string, string>;
  searchOutcome: 'ok' | 'thin' | 'not_found';
}

export interface PartContext {
  topic: string;
  level: string;
  filters: { jurisdiction?: string; asOn?: string };
  teacherBlock: string;
  mustIncludeText: string | null;
  mappings: MappingRow[];
}

export interface PartDeps {
  tenant: TenantRunner;
  searchDeps: (c: pg.PoolClient) => SearchDeps;
  lookup: GapLookup | null;
  gateway: Gateway;
  usage: UsageSink;
  traceId?: string;
}

const ACT_SHORT: Record<string, string> = {
  'Indian Contract Act': 'ICA',
  'Constitution of India': 'Const.',
  'Sale of Goods Act': 'SGA',
  'Specific Relief Act': 'SRA',
  'Indian Penal Code': 'IPC',
  'Bharatiya Nyaya Sanhita': 'BNS',
  'Transfer of Property Act': 'TPA',
};

/** "s. 56 ICA", "Art. 19 Const.", "Satyabrata Ghose ¶12". */
export function sourceLabel(s: RetrievedSource, title: string | null): string {
  if (s.meta.article) return `Art. ${s.meta.article}`;
  if (s.meta.section) return `s. ${s.meta.section} ${ACT_SHORT[s.meta.act ?? ''] ?? s.meta.act ?? ''}`.trim();
  const name = (title ?? s.header.split(' › ')[0] ?? '').split(/\s+v\.?\s+/i)[0]!.replace(/^(M\/s\.?|The)\s+/i, '').trim();
  return s.meta.paraNo ? `${name} ¶${s.meta.paraNo}` : name;
}

function partQuery(topic: string, part: LecturePlan['parts'][number]): string {
  return `${topic}: ${part.title}. ${part.questions.join(' ')}`.slice(0, 500);
}

export async function runPart(partIndex: number, part: LecturePlan['parts'][number], ctx: PartContext, deps: PartDeps): Promise<PartOutput> {
  // 1. Retrieve (with the gap lookup when the library is thin).
  const found = await searchWithLookup(
    deps.tenant,
    { query: partQuery(ctx.topic, part), purpose: 'lecture_part', filters: { jurisdiction: ctx.filters.jurisdiction ? [ctx.filters.jurisdiction] : undefined, asOn: ctx.filters.asOn }, maxSources: 6 },
    deps.searchDeps,
    deps.lookup,
  );
  if (found.outcome === 'not_found' || found.sources.length === 0) {
    return {
      partIndex,
      slides: [
        {
          layout: 'question',
          title: part.title,
          lines: part.questions.map((q, i) => ({ lineKey: `p${partIndex}-s1-l${i + 1}`, text: q, kind: 'question' as const, yourExample: false, claims: [], lineFlag: 'Not found in the library' })),
          notes: [],
        },
      ],
      notFound: part.questions,
      leftOut: [],
      labels: new Map(),
      searchOutcome: 'not_found',
    };
  }

  // 2. Sources as the checks see them: pieces (paragraphs or statute chunks) and source details.
  const { pieces, details } = await deps.tenant(async (c) => ({
    pieces: await loadPieces(c, found.sources.flatMap((s) => s.coveredChunkIds)),
    details: await sourceDetails(c, [...new Set(found.sources.map((s) => s.sourceId))]),
  }));
  const sources = new Map<string, CheckSource>();
  const labels = new Map<string, string>();
  for (const s of found.sources) {
    const d = details.get(s.sourceId);
    const mine = pieces.filter((p) => s.coveredChunkIds.includes(p.chunkId));
    sources.set(s.tag, {
      tag: s.tag,
      sourceId: s.sourceId,
      sourceType: s.meta.sourceType,
      title: d?.title ?? null,
      header: s.header,
      text: s.text,
      pieces: mine.length ? mine : [{ chunkId: s.chunkId, text: s.text, paraNo: s.meta.paraNo ?? null, opinion: s.meta.opinion ?? null, paraRole: s.meta.paraRole ?? null, kind: 'section' }],
      court: s.meta.court ?? null,
      decidedOn: s.meta.decidedOn ?? null,
      section: s.meta.section ?? null,
      article: s.meta.article ?? null,
      caseStatus: s.status.case ?? null,
      rolesSampled: s.meta.rolesSampled,
      holdingNote: d?.holdingNote ?? null,
    });
    labels.set(s.tag, sourceLabel(s, d?.title ?? null));
  }

  // 3. Write, closed-book. Teacher block and sources block are the cacheable prefix (LLD §17.1).
  const boundary = randomBytes(6).toString('hex');
  const srcBlock = sourcesBlock(sources, boundary);
  const task = [
    'TASK: WRITE',
    `TOPIC: ${ctx.topic}`,
    `LEVEL: ${ctx.level}`,
    `PART ${partIndex + 1}: ${part.title} (${part.minutes} minutes, kind ${part.kind})`,
    `QUESTIONS THIS PART MUST ANSWER:\n${part.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
    part.mustInclude && ctx.mustIncludeText ? fence('teacher example to use in this part', ctx.mustIncludeText, boundary) : '',
    `Fill "written" (partIndex ${partIndex}) and set "repairs" to null. Tags available: ${[...sources.keys()].join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const written = (await deps.gateway.run({ prompt: PROMPTS['writer.part'], schema: WriterReplyWrite, context: [ctx.teacherBlock, srcBlock], task, traceId: deps.traceId }, deps.usage)).data.written!;

  // 4. Stable line keys, then the ten checks.
  const slides: BuiltSlide[] = written.slides.map((s, si) => ({
    layout: s.layout,
    title: s.title,
    lines: s.lines.map((l, li) => toLine(`p${partIndex}-s${si + 1}-l${li + 1}`, l.text, l.kind, l.claims, ctx, part.mustInclude)),
    notes: s.notes.map((n, ni) => toLine(`p${partIndex}-s${si + 1}-n${ni + 1}`, n.text, n.claims.length ? 'claim' : 'teaching', n.claims, ctx, false)),
  }));
  const pending = new Map<string, ClaimInput>();
  const all = slides.flatMap((s) => [...s.lines, ...s.notes]);
  for (const line of all) (line as BuiltLine & { raw?: ClaimInput[] }).raw?.forEach((c, i) => pending.set(`${line.lineKey}#${i}`, c));
  const checked = await checkClaims([...pending].map(([id, claim]) => ({ id, claim })), sources, ctx.mappings, { gateway: deps.gateway, usage: deps.usage, traceId: deps.traceId });
  attach(all, checked);

  // 5. One repair round for lines whose claims failed C1–C4, C7 or C9.
  const broken = all.filter((l) => l.claims.some((c) => c.results.some((r) => r.result === 'fail' && REPAIRABLE.has(r.name))));
  if (broken.length) {
    const task2 = broken
      .map((l) =>
        [
          `LINE id=${l.lineKey}`,
          `TEXT: ${l.text}`,
          ...l.claims.map((c) => `CLAIM [${c.claim.tag}] ${c.claim.text}\n  span: ${c.claim.span}\n  problem: ${c.results.filter((r) => r.result === 'fail').map((r) => r.detail).join('; ') || 'none'}`),
        ].join('\n'),
      )
      .join('\n\n');
    const repairs = (await deps.gateway.run({ prompt: PROMPTS['writer.repair'], schema: WriterReplyRepair, context: [ctx.teacherBlock, srcBlock], task: `TASK: REPAIR. Fix or drop each line. Fill "repairs" and set "written" to null.\n\n${task2}`, traceId: deps.traceId }, deps.usage)).data.repairs!;
    const byId = new Map(repairs.map((r) => [r.id, r]));
    const redo: { id: string; claim: ClaimInput }[] = [];
    for (const l of broken) {
      const fix = byId.get(l.lineKey);
      if (!fix) continue; // no answer: the line stays flagged
      if (fix.action === 'drop' || !fix.lineText) {
        (l as BuiltLine & { dropped?: boolean }).dropped = true;
        continue;
      }
      l.text = fix.lineText;
      l.claims = [];
      fix.claims.forEach((c, i) => redo.push({ id: `${l.lineKey}#r${i}`, claim: c }));
      if (!fix.claims.length) l.lineFlag = looksLegal(l.text) ? 'No source for this statement' : null;
    }
    if (redo.length) attach(all, await checkClaims(redo, sources, ctx.mappings, { gateway: deps.gateway, usage: deps.usage, traceId: deps.traceId }));
    for (const s of slides) {
      s.lines = s.lines.filter((l) => !(l as BuiltLine & { dropped?: boolean }).dropped);
      s.notes = s.notes.filter((l) => !(l as BuiltLine & { dropped?: boolean }).dropped);
    }
  }

  return { partIndex, slides: slides.filter((s) => s.lines.length || s.notes.length), notFound: written.notFound, leftOut: written.leftOut, labels, searchOutcome: found.outcome };
}

function toLine(lineKey: string, text: string, kind: WrittenLine['kind'], claims: ClaimInput[], ctx: PartContext, mustIncludePart: boolean): BuiltLine & { raw: ClaimInput[] } {
  const yourExample = kind === 'example' && claims.length === 0 && mustIncludePart && !!ctx.mustIncludeText && overlaps(text, ctx.mustIncludeText);
  let lineFlag: string | null = null;
  if (claims.length === 0 && !yourExample) {
    if (kind === 'claim') lineFlag = 'No source for this statement';
    else if (looksLegal(text)) lineFlag = 'No source for this statement';
  }
  return { lineKey, text, kind, yourExample, claims: [], lineFlag, raw: claims };
}

/** Claims come back keyed "<lineKey>#<n>"; put each on its line. */
function attach(lines: BuiltLine[], checked: CheckedClaim[]) {
  const byLine = new Map<string, CheckedClaim[]>();
  for (const c of checked) {
    const key = c.id.split('#')[0]!;
    byLine.set(key, [...(byLine.get(key) ?? []), c]);
  }
  for (const l of lines) {
    const mine = byLine.get(l.lineKey);
    if (mine) l.claims.push(...mine);
  }
}

/** The example line uses her example when they share most of its distinctive words. */
function overlaps(line: string, example: string): boolean {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const a = words(line);
  const b = words(example);
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / Math.min(a.size, b.size) >= 0.4;
}
