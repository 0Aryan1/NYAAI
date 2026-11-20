/**
 * The ten checks for one part (LLD §8.3): C1–C8 in code (packages/checker-rules), then C9 support on the light tier
 * in batches of up to 10, then C10 on the heavy tier for high-risk claims only. A claim that fails code is not sent
 * to the AI checks (it is already yellow, or goes to repair). A missing verdict counts as "no": nothing passes
 * unchecked (rules §1).
 */
import { randomBytes } from 'node:crypto';
import { codeChecks, passedCode, spanContext, type CheckResult, type CheckSource, type ClaimInput, type MappingRow } from '@nyaai/checker-rules';
import { PROMPTS, fence } from '@nyaai/prompts';
import { SecondVerdicts, SupportVerdicts } from '@nyaai/shared';
import type { Gateway } from '../llm-gateway/index.ts';
import type { UsageSink } from '../usage.ts';

export interface CheckedClaim {
  id: string;
  claim: ClaimInput;
  results: CheckResult[];
  risk: 'normal' | 'high';
  chunkId: string | null;
  sourceId: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  /** Second check's suggested wording, kept for the teacher when C10 disagrees. */
  correctedClaim: string | null;
}

export interface CheckDeps {
  gateway: Gateway;
  usage: UsageSink;
  traceId?: string;
}

const C9_BATCH = 10;

/** Fenced source blocks, shared by the writer, the repair call and the second check (cacheable, LLD §17.1). */
export function sourcesBlock(sources: ReadonlyMap<string, CheckSource>, boundary: string): string {
  return ['SOURCES', ...[...sources.values()].map((s) => fence(`${s.tag} · ${s.header}`, s.text, boundary))].join('\n');
}

export async function checkClaims(items: { id: string; claim: ClaimInput }[], sources: ReadonlyMap<string, CheckSource>, mappings: MappingRow[], deps: CheckDeps): Promise<CheckedClaim[]> {
  const checked: CheckedClaim[] = items.map(({ id, claim }) => {
    const out = codeChecks(claim, sources, mappings);
    return { id, claim, results: out.results, risk: out.risk, chunkId: out.chunkId, sourceId: sources.get(claim.tag)?.sourceId ?? null, spanStart: out.spanStart, spanEnd: out.spanEnd, correctedClaim: null };
  });

  // C9: support, on claims that passed code.
  const forC9 = checked.filter((c) => passedCode(c.results));
  for (let i = 0; i < forC9.length; i += C9_BATCH) {
    const batch = forC9.slice(i, i + C9_BATCH);
    const boundary = randomBytes(6).toString('hex');
    const task = batch
      .map((c) => {
        const src = sources.get(c.claim.tag)!;
        const ctx = spanContext(c.claim.span, src.text);
        return [`ITEM id=${c.id}`, `CLAIM: ${c.claim.text}`, fence('before', ctx.before, boundary), fence('span', c.claim.span, boundary), fence('after', ctx.after, boundary)].join('\n');
      })
      .join('\n\n');
    const r = await deps.gateway.run({ prompt: PROMPTS['checker.support'], schema: SupportVerdicts, task: `Check each item.\n\n${task}`, traceId: deps.traceId }, deps.usage);
    const byId = new Map(r.data.verdicts.map((v) => [v.id, v]));
    for (const c of batch) {
      const v = byId.get(c.id);
      c.results.push(
        !v ? { name: 'C9', result: 'fail', detail: 'Not checked; please verify' } : v.verdict === 'yes' ? { name: 'C9', result: 'pass', detail: null } : { name: 'C9', result: 'fail', detail: v.reason || 'The source does not fully support this' },
      );
    }
  }
  for (const c of checked) if (!c.results.some((r) => r.name === 'C9')) c.results.push({ name: 'C9', result: 'skipped', detail: null });

  // C10: second check, high-risk claims that passed C9; the whole cited section or paragraph window is read.
  const forC10 = checked.filter((c) => c.risk === 'high' && c.results.find((r) => r.name === 'C9')?.result === 'pass');
  if (forC10.length) {
    const boundary = randomBytes(6).toString('hex');
    const used = new Map([...sources].filter(([tag]) => forC10.some((c) => c.claim.tag === tag)));
    for (let i = 0; i < forC10.length; i += C9_BATCH) {
      const batch = forC10.slice(i, i + C9_BATCH);
      const task = batch.map((c) => `ITEM id=${c.id} source=${c.claim.tag}\nCLAIM: ${c.claim.text}`).join('\n\n');
      const r = await deps.gateway.run(
        { prompt: PROMPTS['checker.second'], schema: SecondVerdicts, context: [sourcesBlock(used, boundary)], task: `Check each high-risk claim against its whole source.\n\n${task}`, traceId: deps.traceId },
        deps.usage,
      );
      const byId = new Map(r.data.verdicts.map((v) => [v.id, v]));
      for (const c of batch) {
        const v = byId.get(c.id);
        c.correctedClaim = v?.correctedClaim ?? null;
        c.results.push(
          !v ? { name: 'C10', result: 'fail', detail: 'Second check not done; please verify' } : v.verdict === 'yes' ? { name: 'C10', result: 'pass', detail: null } : { name: 'C10', result: 'fail', detail: v.reason || 'The second check found a difference' },
        );
      }
    }
  }
  for (const c of checked) if (!c.results.some((r) => r.name === 'C10')) c.results.push({ name: 'C10', result: 'skipped', detail: null });
  return checked;
}
