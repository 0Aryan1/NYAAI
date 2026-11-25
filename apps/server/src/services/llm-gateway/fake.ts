/**
 * A scripted stand-in for Claude, for the browser journeys (J1, J3) only: `E2E_FAKE_AI=true`, refused in production
 * (config.ts). It makes no network call and costs nothing. It answers each prompt from what the request carries:
 *
 *  - the planner plans two content parts (a recap first and a bridge last when the course memory asks for them);
 *  - the writer quotes the supplied SOURCES word for word, so the code checks pass on real library text; the first
 *    part also gets one teaching line that states law without a source, so the teacher has a yellow point to verify;
 *  - the checkers say "supported"; the repair writer leaves the planted line alone (it stays yellow);
 *  - the class memory is a short summary of the slides it is given.
 *
 * Every answer is validated against the request's own schema, as the real gateway does.
 */
import type { z } from 'zod';
import type { Gateway, GatewayRequest, GatewayResult } from './index.ts';

interface FencedSource {
  tag: string;
  header: string;
  text: string;
}

/** The SOURCES block: `<<<b S1 · header>>>\ntext\n<<<b end>>>`. */
export function fencedSources(block: string): FencedSource[] {
  const out: FencedSource[] = [];
  for (const m of block.matchAll(/<<<(\w+) (S\d) · ([^\n]*)>>>\n([\s\S]*?)\n<<<\1 end>>>/g)) out.push({ tag: m[2]!, header: m[3]!, text: m[4]! });
  return out;
}

/** A sentence of the source to quote: 40–300 characters, copied exactly. */
export function quotable(text: string): string | null {
  const clean = text.replace(/\[para [^\]]*\]\s*/g, '');
  const sentences = clean.split(/(?<=[.;:])\s+/).map((s) => s.trim());
  const pick = sentences.find((s) => s.length >= 40 && s.length <= 300 && !/\d{3,}/.test(s.slice(0, 4))) ?? clean.slice(0, 200).trim();
  if (pick.length < 12) return null;
  // The span must be in the source exactly: take it from the original text.
  const at = text.indexOf(pick.slice(0, 30));
  return at >= 0 ? text.slice(at, at + pick.length) : null;
}

function plan(task: string) {
  const topic = /TOPIC: (.*)/.exec(task)?.[1]?.trim() ?? 'the topic';
  const recap = /COURSE RECAP: yes/.test(task);
  const bridge = /COURSE BRIDGE: yes/.test(task);
  const must = /MUST-INCLUDE EXAMPLE/.test(task);
  const parts = [
    ...(recap ? [{ title: 'Recap of last class', minutes: 4, kind: 'recap', questions: ['What did we learn last time?'], mustInclude: false }] : []),
    { title: `What ${topic} means`, minutes: 20, kind: 'content', questions: [`What is ${topic}?`, `When does ${topic} apply?`], mustInclude: must },
    { title: `${topic} in the courts`, minutes: 20, kind: 'content', questions: [`How have courts applied ${topic}?`], mustInclude: false },
    ...(bridge ? [{ title: 'Next class', minutes: 3, kind: 'bridge', questions: ['What comes next?'], mustInclude: false }] : []),
  ];
  return { parts, leftOut: [] };
}

function write(task: string, context: string[]) {
  const partIndex = Number(/Fill "written" \(partIndex (\d+)\)/.exec(task)?.[1] ?? 0);
  const title = /PART \d+: ([^(]+)\(/.exec(task)?.[1]?.trim() ?? 'This part';
  const sources = fencedSources(context.join('\n'));
  const claims = sources
    .slice(0, 3)
    .map((s) => ({ s, span: quotable(s.text) }))
    .filter((x): x is { s: FencedSource; span: string } => !!x.span);
  const example = /<<<\w+ teacher example to use in this part>>>\n([\s\S]*?)\n<<<\w+ end>>>/.exec(task)?.[1];
  type Line = { lineKey: string; text: string; kind: 'claim' | 'teaching' | 'example' | 'question'; claims: { text: string; type: 'rule'; tag: 'S1'; span: string }[] };
  const lines: Line[] = [
    ...claims.map((c, i) => ({ lineKey: `l${i + 1}`, text: c.span, kind: 'claim' as const, claims: [{ text: c.span, type: 'rule' as const, tag: c.s.tag as 'S1', span: c.span }] })),
    { lineKey: 'q', text: 'Why might the law draw the line here?', kind: 'question' as const, claims: [] },
    ...(example ? [{ lineKey: 'ex', text: example.slice(0, 380), kind: 'example' as const, claims: [] }] : []),
  ];
  const slides: { layout: 'bullets'; title: string; lines: Line[]; notes: never[] }[] = [{ layout: 'bullets', title: title.slice(0, 90), lines: lines.slice(0, 7), notes: [] }];
  // The first part plants one unsourced statement of law: the checks flag it, and the teacher verifies it.
  if (partIndex === 0 || /, the first part/.test(task)) {
    slides.push({ layout: 'bullets' as const, title: 'A point to check', lines: [{ lineKey: 'y', text: 'Section 56 makes such an agreement void.', kind: 'teaching' as const, claims: [] }], notes: [] });
  }
  return { written: { partIndex, slides, notFound: [], leftOut: [] }, repairs: null };
}

const items = (task: string) => [...task.matchAll(/ITEM id=(\S+)/g)].map((m) => m[1]!);

export function createFakeGateway(): Gateway {
  return {
    async run<S extends z.ZodType>(req: GatewayRequest<S>, usage: Parameters<Gateway['run']>[1]): Promise<GatewayResult<z.infer<S>>> {
      await usage({ provider: 'anthropic', model: 'fake', purpose: req.prompt.id, costMicroUsd: 0 });
      const ctx = req.context ?? [];
      let data: unknown;
      switch (req.prompt.id) {
        case 'planner.lecture':
          data = plan(req.task);
          break;
        case 'writer.part':
          data = req.task.startsWith('TASK: REPAIR') ? { written: null, repairs: [] } : write(req.task, ctx);
          break;
        case 'writer.repair':
          data = { written: null, repairs: [] };
          break;
        case 'explore.answer': {
          const claims = fencedSources(ctx.join('\n'))
            .slice(0, 2)
            .map((s) => ({ s, span: quotable(s.text) }))
            .filter((x): x is { s: FencedSource; span: string } => !!x.span);
          data = { lines: claims.map((c) => ({ text: c.span, kind: 'claim', claims: [{ text: c.span, type: 'rule', tag: c.s.tag, span: c.span }] })), notFound: [] };
          break;
        }
        case 'research.gaps':
          data = { questions: [] };
          break;
        case 'checker.support':
          data = { verdicts: items(req.task).map((id) => ({ id, reason: 'The span says this.', verdict: 'yes' })) };
          break;
        case 'checker.second':
          data = { verdicts: items(req.task).map((id) => ({ id, reason: 'Supported.', verdict: 'yes', correctedClaim: null })) };
          break;
        case 'checker.unsourced':
          data = { verdicts: items(req.task).map((id) => ({ id, reason: 'States law.', statesLaw: true })) };
          break;
        case 'query.expand':
          data = { query: /Her search: (.*)/.exec(req.task)?.[1] ?? req.task.slice(0, 300) };
          break;
        case 'learn.summary':
          data = { summary: `The class covered ${/LECTURE: (.*)/.exec(req.task)?.[1] ?? 'the topic'}.`, terms: [], runningExample: null, openThreads: [] };
          break;
        default:
          throw new Error(`the fake gateway has no answer for ${req.prompt.id}`);
      }
      return { data: req.schema.parse(data), model: 'fake', tier: req.prompt.tier, escalated: false };
    },
  };
}
