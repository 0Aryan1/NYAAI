/**
 * One lecture part (LLD §5.2 step 3, §8): write closed-book from the part's research notes → ten checks → one repair
 * round → checks again. Returns the checked slides; saving is the caller's (one transaction per part). The notes come
 * from the research stage (`research.ts`), which searched every part at once and filled the gaps before writing.
 */
import { randomBytes } from 'node:crypto';
import { REPAIRABLE, looksLegal, type CheckSource, type ClaimInput, type MappingRow } from '@nyaai/checker-rules';
import { PROMPTS, fence } from '@nyaai/prompts';
import {
  UnsourcedVerdicts,
  WriterReplyRepair,
  WriterReplyWrite,
  type LecturePlan,
  type WrittenLine,
} from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import type { TenantRunner } from '../lookup/index.ts';
import { loadPieces, sourceDetails, type RetrievedSource } from '../search/index.ts';
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
  /** Relevance per tag (the reranker's score), saved with each citation: part of why the source was chosen. */
  relevance: Map<string, number | null>;
  searchOutcome: 'ok' | 'thin' | 'not_found';
}

export interface PartContext {
  topic: string;
  level: string;
  filters: { jurisdiction?: string; asOn?: string };
  teacherBlock: string;
  mustIncludeText: string | null;
  mappings: MappingRow[];
  /** Every part of the plan, so each part is written as one piece of a single class (FLOW). */
  outline?: string;
  /** Fenced course memory when the lecture is in a course (HLD F8.3). */
  courseMemory?: string | null;
  /** The Act a bare "s. 20" in a part's questions means (the topic's key sections are in it). */
  contextAct?: string;
}

export interface PartDeps {
  tenant: TenantRunner;
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
  // Her notes are always named as hers, so nobody takes them for the Act or a judgment.
  if (s.meta.sourceType === 'teacher_note') return s.header.split(' › ').slice(0, 2).join(' › ');
  if (s.meta.article) return `Art. ${s.meta.article}`;
  if (s.meta.section) return `s. ${s.meta.section} ${ACT_SHORT[s.meta.act ?? ''] ?? s.meta.act ?? ''}`.trim();
  const name = (title ?? s.header.split(' › ')[0] ?? '')
    .split(/\s+v\.?\s+/i)[0]!
    .replace(/^(M\/s\.?|The)\s+/i, '')
    .trim();
  return s.meta.paraNo ? `${name} ¶${s.meta.paraNo}` : name;
}

/**
 * Retrieved sources as the ten checks see them (pieces: the paragraphs or statute chunks each covers; source
 * details), with their short labels and relevance. Shared by the lecture writer and Explore answers.
 */
export async function checkSourcesFor(
  tenant: TenantRunner,
  found: RetrievedSource[],
): Promise<{ sources: Map<string, CheckSource>; labels: Map<string, string>; relevance: Map<string, number | null> }> {
  const { pieces, details } = await tenant(async (c) => ({
    pieces: await loadPieces(
      c,
      found.flatMap((s) => s.coveredChunkIds),
    ),
    details: await sourceDetails(c, [...new Set(found.map((s) => s.sourceId))]),
  }));
  const sources = new Map<string, CheckSource>();
  const labels = new Map<string, string>();
  const relevance = new Map<string, number | null>();
  for (const s of found) {
    const d = details.get(s.sourceId);
    const mine = pieces.filter((p) => s.coveredChunkIds.includes(p.chunkId));
    sources.set(s.tag, {
      tag: s.tag,
      sourceId: s.sourceId,
      sourceType: s.meta.sourceType,
      title: d?.title ?? null,
      header: s.header,
      text: s.text,
      pieces: mine.length
        ? mine
        : [
            {
              chunkId: s.chunkId,
              text: s.text,
              paraNo: s.meta.paraNo ?? null,
              opinion: s.meta.opinion ?? null,
              paraRole: s.meta.paraRole ?? null,
              kind: 'section',
            },
          ],
      court: s.meta.court ?? null,
      decidedOn: s.meta.decidedOn ?? null,
      section: s.meta.section ?? null,
      article: s.meta.article ?? null,
      caseStatus: s.status.case ?? null,
      rolesSampled: s.meta.rolesSampled,
      holdingNote: d?.holdingNote ?? null,
    });
    labels.set(s.tag, sourceLabel(s, d?.title ?? null));
    relevance.set(s.tag, s.standing?.relevance ?? s.rerankScore);
  }
  return { sources, labels, relevance };
}

export function partQuery(topic: string, part: LecturePlan['parts'][number]): string {
  return `${topic}: ${part.title}. ${part.questions.join(' ')}`.slice(0, 500);
}

/** What the research stage hands one part's writer. */
export interface PartBrief {
  sources: RetrievedSource[];
  outcome: 'ok' | 'thin' | 'not_found';
  /** Provisos, exceptions and explanations this part must teach, with the section they sit in. */
  mustCover: { label: string; act: string; number: string }[];
  /** Cases another part teaches in full: mention them here only briefly. */
  elsewhere: string[];
}

export async function runPart(
  partIndex: number,
  part: LecturePlan['parts'][number],
  ctx: PartContext,
  deps: PartDeps,
  brief: PartBrief,
): Promise<PartOutput> {
  // 1. The part's research notes, tagged S1…S8 for this writer.
  const found = {
    outcome: brief.outcome,
    sources: brief.sources.slice(0, 8).map((s, i) => ({ ...s, tag: `S${i + 1}` })),
  };
  // A recap or bridge the library has nothing for is still written, from the outline and course memory alone: its
  // lines are questions and teaching lines, and any legal statement in them is flagged like any other.
  const framing = part.kind === 'recap' || part.kind === 'bridge';
  if ((found.outcome === 'not_found' || found.sources.length === 0) && !framing) {
    return {
      partIndex,
      slides: [
        {
          layout: 'question',
          title: part.title,
          lines: part.questions.map((q, i) => ({
            lineKey: `p${partIndex}-s1-l${i + 1}`,
            text: q,
            kind: 'question' as const,
            yourExample: false,
            claims: [],
            lineFlag: 'Not found in the library',
          })),
          notes: [],
        },
      ],
      notFound: part.questions,
      leftOut: [],
      labels: new Map(),
      relevance: new Map(),
      searchOutcome: 'not_found',
    };
  }

  // 2. Sources as the checks see them: pieces (paragraphs or statute chunks) and source details.
  const { sources, labels, relevance } = await checkSourcesFor(deps.tenant, found.sources);

  // 3. Write, closed-book. Teacher block and sources block are the cacheable prefix (LLD §17.1).
  const boundary = randomBytes(6).toString('hex');
  const srcBlock = sourcesBlock(sources, boundary);
  const task = [
    'TASK: WRITE',
    `TOPIC: ${ctx.topic}`,
    `LEVEL: ${ctx.level}`,
    ctx.outline ? `OUTLINE (the whole class):\n${ctx.outline}` : '',
    `PART ${partIndex + 1}: ${part.title} (${part.minutes} minutes, kind ${part.kind})${partIndex === 0 ? ', the first part' : ''}`,
    `QUESTIONS THIS PART MUST ANSWER:\n${part.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
    mustCoverLines(brief.mustCover, found.sources),
    brief.elsewhere.length
      ? `CASES TAUGHT IN FULL IN ANOTHER PART (mention them here only briefly, without retelling the facts):\n${brief.elsewhere.map((e) => `- ${e}`).join('\n')}`
      : '',
    part.mustInclude && ctx.mustIncludeText
      ? fence('teacher example to use in this part', ctx.mustIncludeText, boundary)
      : '',
    ctx.courseMemory ?? '',
    `Fill "written" (partIndex ${partIndex}) and set "repairs" to null. Tags available: ${sources.size ? [...sources.keys()].join(', ') : 'none (the library holds nothing for this part: write questions and teaching lines only)'}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const written = (
    await deps.gateway.run(
      {
        prompt: PROMPTS['writer.part'],
        schema: WriterReplyWrite,
        context: [ctx.teacherBlock, srcBlock],
        task,
        traceId: deps.traceId,
      },
      deps.usage,
    )
  ).data.written!;

  // 4. Stable line keys, then the ten checks.
  const slides: BuiltSlide[] = written.slides.map((s, si) => ({
    // The recap and bridge slides carry their own layouts (LLD §8.1) so the deck and the Studio mark them.
    layout: framing && si === 0 && s.layout !== 'question' ? part.kind : s.layout,
    title: s.title,
    lines: s.lines.map((l, li) =>
      toLine(`p${partIndex}-s${si + 1}-l${li + 1}`, l.text, l.kind, l.claims, ctx, part.mustInclude),
    ),
    notes: s.notes.map((n, ni) =>
      toLine(
        `p${partIndex}-s${si + 1}-n${ni + 1}`,
        n.text,
        n.claims.length ? 'claim' : 'teaching',
        n.claims,
        ctx,
        false,
      ),
    ),
  }));
  await flagUnsourcedLaw(
    slides.flatMap((s) => [...s.lines, ...s.notes]),
    deps,
  );
  const pending = new Map<string, ClaimInput>();
  const all = slides.flatMap((s) => [...s.lines, ...s.notes]);
  for (const line of all)
    (line as BuiltLine & { raw?: ClaimInput[] }).raw?.forEach((c, i) => pending.set(`${line.lineKey}#${i}`, c));
  const checked = await checkClaims(
    [...pending].map(([id, claim]) => ({ id, claim })),
    sources,
    ctx.mappings,
    { gateway: deps.gateway, usage: deps.usage, traceId: deps.traceId },
  );
  attach(all, checked);

  // 5. One repair round for lines whose claims failed C1–C4, C7 or C9.
  // Also lines that state law with no source at all: give them a source, turn them into a question, or drop them.
  const UNSOURCED = 'No source for this statement';
  const broken = all.filter(
    (l) =>
      l.lineFlag === UNSOURCED ||
      l.claims.some((c) => c.results.some((r) => r.result === 'fail' && REPAIRABLE.has(r.name))),
  );
  if (broken.length) {
    const task2 = broken
      .map((l) =>
        [
          `LINE id=${l.lineKey}`,
          `TEXT: ${l.text}`,
          ...(l.lineFlag === UNSOURCED && !l.claims.length
            ? [
                'problem: this line states law but cites no source. Give it claims with exact spans from SOURCES, or rewrite it as a question to the class that states no law, or drop it.',
              ]
            : []),
          ...l.claims.map(
            (c) =>
              `CLAIM [${c.claim.tag}] ${c.claim.text}\n  span: ${c.claim.span}\n  problem: ${
                c.results
                  .filter((r) => r.result === 'fail')
                  .map((r) => r.detail)
                  .join('; ') || 'none'
              }`,
          ),
        ].join('\n'),
      )
      .join('\n\n');
    const repairs = (
      await deps.gateway.run(
        {
          prompt: PROMPTS['writer.repair'],
          schema: WriterReplyRepair,
          context: [ctx.teacherBlock, srcBlock],
          task: `TASK: REPAIR. Fix or drop each line. Fill "repairs" and set "written" to null.\n\n${task2}`,
          traceId: deps.traceId,
        },
        deps.usage,
      )
    ).data.repairs!;
    const byId = new Map(repairs.map((r) => [r.id, r]));
    const redo: { id: string; claim: ClaimInput }[] = [];
    const rephrased: BuiltLine[] = [];
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
      l.lineFlag = fix.claims.length ? null : looksLegal(l.text) ? UNSOURCED : null;
      if (!fix.claims.length && !l.lineFlag) rephrased.push(l);
    }
    // A line rewritten without a source is read again by the unsourced-line check.
    await flagUnsourcedLaw(rephrased, deps);
    if (redo.length)
      attach(
        all,
        await checkClaims(redo, sources, ctx.mappings, {
          gateway: deps.gateway,
          usage: deps.usage,
          traceId: deps.traceId,
        }),
      );
    for (const s of slides) {
      s.lines = s.lines.filter((l) => !(l as BuiltLine & { dropped?: boolean }).dropped);
      s.notes = s.notes.filter((l) => !(l as BuiltLine & { dropped?: boolean }).dropped);
    }
  }

  return {
    partIndex,
    slides: slides.filter((s) => s.lines.length || s.notes.length),
    notFound: written.notFound,
    leftOut: written.leftOut,
    labels,
    relevance,
    searchOutcome: found.outcome,
  };
}

/** "MUST COVER" for the writer: each item with the tag of the source that holds its section. */
function mustCoverLines(items: PartBrief['mustCover'], sources: RetrievedSource[]): string {
  const lines = items.flatMap((m) => {
    const s = sources.find((x) => x.meta.act === m.act && (x.meta.section ?? x.meta.article) === m.number);
    return s ? [`- ${m.label} (in ${s.tag})`] : [];
  });
  return lines.length
    ? `MUST COVER IN THIS PART (provisos, exceptions and explanations of the sections in SOURCES; teach each one in plain words as a claim citing its source, or put it in leftOut with the reason):\n${lines.join('\n')}`
    : '';
}

function toLine(
  lineKey: string,
  text: string,
  kind: WrittenLine['kind'],
  claims: ClaimInput[],
  ctx: PartContext,
  mustIncludePart: boolean,
): BuiltLine & { raw: ClaimInput[] } {
  const yourExample =
    kind === 'example' &&
    claims.length === 0 &&
    mustIncludePart &&
    !!ctx.mustIncludeText &&
    overlaps(text, ctx.mustIncludeText);
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

/**
 * Lines with no source that still state law ("So the seat court alone hears challenges", written as a teaching line)
 * are flagged like any unsourced statement. The word rules (`looksLegal`) catch the obvious ones; one Haiku call per
 * part reads the rest (rule 1: nothing that states law goes out unchecked). If the call fails the line keeps the
 * word-rule result and the build goes on: this check only ever adds flags.
 */
async function flagUnsourcedLaw(
  candidates: BuiltLine[],
  deps: Pick<PartDeps, 'gateway' | 'usage' | 'traceId'>,
): Promise<void> {
  const lines = candidates.filter(
    (l) =>
      !l.lineFlag &&
      !l.yourExample &&
      !(l as BuiltLine & { raw?: ClaimInput[] }).raw?.length &&
      l.text.trim().length > 12,
  );
  if (!lines.length) return;
  const boundary = randomBytes(6).toString('hex');
  const task = lines.map((l) => `ITEM id=${l.lineKey}\n${fence('line', l.text, boundary)}`).join('\n\n');
  try {
    const { verdicts } = (
      await deps.gateway.run(
        { prompt: PROMPTS['checker.unsourced'], schema: UnsourcedVerdicts, task, traceId: deps.traceId },
        deps.usage,
      )
    ).data;
    const says = new Map(verdicts.map((v) => [v.id, v.statesLaw]));
    for (const l of lines) if (says.get(l.lineKey)) l.lineFlag = 'No source for this statement';
  } catch {
    /* word rules already ran; never block the build on an extra check */
  }
}
