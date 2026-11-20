import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PROMPTS } from '@nyaai/prompts';
import { costMicroUsd, createGateway, GatewayError } from '../src/services/llm-gateway/index.ts';
import type { UsageRow } from '../src/services/usage.ts';

const Schema = z.object({ role: z.enum(['facts', 'holding', 'unknown']) });
const usageBlock = { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

type Step = { parsed?: unknown; stop?: string } | Error;

function fakeClient(steps: Step[]) {
  const calls: string[] = [];
  const client = {
    messages: {
      parse: async (params: { model: string }) => {
        calls.push(params.model);
        const step = steps.shift();
        if (!step) throw new Error('no more steps');
        if (step instanceof Error) throw step;
        return { parsed_output: step.parsed ?? null, stop_reason: step.stop ?? 'end_turn', usage: usageBlock };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const gateway = (steps: Step[]) => {
  const f = fakeClient(steps);
  const usage: UsageRow[] = [];
  const g = createGateway({ lightModel: 'claude-haiku-5-5', heavyModel: 'claude-sonnet-5-5', client: f.client, sleep: async () => {} });
  const run = (forceHeavy = false) =>
    g.run({ prompt: PROMPTS['labeller.roles'], schema: Schema, task: 'label', forceHeavy }, async (u) => void usage.push(u));
  return { run, calls: f.calls, usage };
};

const outage = () => new Anthropic.InternalServerError(500, undefined, 'down', new Headers());

describe('LLM gateway (LLD §17.2)', () => {
  it('answers on the light tier and records cost', async () => {
    const g = gateway([{ parsed: { role: 'holding' } }]);
    await expect(g.run()).resolves.toMatchObject({ data: { role: 'holding' }, tier: 'light', escalated: false });
    expect(g.usage[0]).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', promptId: 'labeller.roles', promptVersion: '1', tier: 'light' });
    expect(g.usage[0]!.costMicroUsd).toBe(costMicroUsd('claude-haiku-5-5', usageBlock));
  });

  it('escalates to heavy after two schema failures on light', async () => {
    const g = gateway([{ parsed: { role: 'nonsense' } }, { parsed: null }, { parsed: { role: 'facts' } }]);
    await expect(g.run()).resolves.toMatchObject({ data: { role: 'facts' }, tier: 'heavy', escalated: true });
    expect(g.calls).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(g.usage).toHaveLength(3);
  });

  it('moves to heavy when light is down', async () => {
    const g = gateway([outage(), { parsed: { role: 'unknown' } }]);
    await expect(g.run()).resolves.toMatchObject({ tier: 'heavy', escalated: true });
  });

  it('never downgrades: heavy down means wait and retry on heavy', async () => {
    const g = gateway([outage(), outage(), { parsed: { role: 'facts' } }]);
    await expect(g.run(true)).resolves.toMatchObject({ tier: 'heavy' });
    expect(g.calls).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
  });

  it('gives up with "unavailable" only after the heavy retries run out, still without downgrading', async () => {
    const g = gateway(Array.from({ length: 6 }, outage));
    await expect(g.run(true)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(new Set(g.calls)).toEqual(new Set(['claude-sonnet-5-5']));
  });

  it('treats a refusal and a cut-off reply as failures, never as answers', async () => {
    await expect(gateway([{ stop: 'refusal' }]).run()).rejects.toBeInstanceOf(GatewayError);
    const g = gateway([{ parsed: { role: 'facts' }, stop: 'max_tokens' }, { parsed: { role: 'facts' }, stop: 'max_tokens' }, { parsed: { role: 'facts' } }]);
    await expect(g.run()).resolves.toMatchObject({ tier: 'heavy' });
  });
});
