import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PROMPTS } from '@nyaai/prompts';
import { costMicroUsd, createGateway, GatewayError } from '../src/services/llm-gateway/index.ts';
import type { UsageRow } from '../src/services/usage.ts';

const Schema = z.object({ role: z.enum(['facts', 'holding', 'unknown']) });
const usageBlock = {
  input_tokens: 1000,
  output_tokens: 100,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

type Step = { parsed?: unknown; stop?: string } | Error;

function fakeClient(steps: Step[]) {
  const calls: string[] = [];
  const client = {
    messages: {
      create: async (params: { model: string }) => {
        calls.push(params.model);
        const step = steps.shift();
        if (!step) throw new Error('no more steps');
        if (step instanceof Error) throw step;
        return {
          content: [{ type: 'text', text: JSON.stringify(step.parsed ?? null) }],
          stop_reason: step.stop ?? 'end_turn',
          usage: usageBlock,
        };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

const gateway = (steps: Step[]) => {
  const f = fakeClient(steps);
  const usage: UsageRow[] = [];
  const g = createGateway({
    lightModel: 'claude-haiku-5-5',
    heavyModel: 'claude-sonnet-5-5',
    client: f.client,
    sleep: async () => {},
  });
  const run = (forceHeavy = false) =>
    g.run(
      { prompt: PROMPTS['labeller.roles'], schema: Schema, task: 'label', forceHeavy },
      async (u) => void usage.push(u),
    );
  return { run, calls: f.calls, usage };
};

const outage = () => new Anthropic.InternalServerError(500, undefined, 'down', new Headers());

describe('LLM gateway (LLD §17.2)', () => {
  it('answers on the light tier and records cost', async () => {
    const g = gateway([{ parsed: { role: 'holding' } }]);
    await expect(g.run()).resolves.toMatchObject({ data: { role: 'holding' }, tier: 'light', escalated: false });
    expect(g.usage[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      promptId: 'labeller.roles',
      promptVersion: '1',
      tier: 'light',
    });
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
    const g = gateway([
      { parsed: { role: 'facts' }, stop: 'max_tokens' },
      { parsed: { role: 'facts' }, stop: 'max_tokens' },
      { parsed: { role: 'facts' } },
    ]);
    await expect(g.run()).resolves.toMatchObject({ tier: 'heavy' });
  });
});

describe('cache breakpoints (LLD §17.1)', () => {
  it('marks the end of a long shared prefix, never a prefix too short to cache, and never the task', async () => {
    const seen: {
      system: { cache_control?: unknown }[];
      messages: { content: { text: string; cache_control?: unknown }[] }[];
    }[] = [];
    const client = {
      messages: {
        create: async (params: (typeof seen)[number]) => {
          seen.push(params);
          return {
            content: [{ type: 'text', text: JSON.stringify({ role: 'facts' }) }],
            stop_reason: 'end_turn',
            usage: usageBlock,
          };
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    const g = createGateway({
      lightModel: 'claude-haiku-5-5',
      heavyModel: 'claude-sonnet-5-5',
      client,
      sleep: async () => {},
    });
    const teacher = 'TEACHER style';
    const sources = 'SOURCES '.repeat(500);
    await g.run(
      { prompt: PROMPTS['writer.part'], schema: Schema, context: [teacher, sources], task: 'TASK: WRITE' },
      async () => {},
    );
    await g.run(
      { prompt: PROMPTS['writer.repair'], schema: Schema, context: [teacher, sources], task: 'TASK: REPAIR' },
      async () => {},
    );
    for (const req of seen) {
      const blocks = req.messages[0]!.content;
      expect(blocks.map((b) => !!b.cache_control)).toEqual([
        PROMPTS['writer.part'].system.length + teacher.length >= 2400,
        true,
        false,
      ]);
    }
    // Writer and repair send byte-identical prefixes, so the repair can read the writer's cache entry.
    expect(PROMPTS['writer.repair'].system).toBe(PROMPTS['writer.part'].system);
    expect(PROMPTS['writer.repair'].effort).toBe(PROMPTS['writer.part'].effort);
    expect(JSON.stringify(seen[1]!.messages[0]!.content.slice(0, 2))).toBe(
      JSON.stringify(seen[0]!.messages[0]!.content.slice(0, 2)),
    );
    // A short prompt with no context gets no marker at all.
    seen.length = 0;
    await g.run({ prompt: PROMPTS['query.expand'], schema: Schema, task: 'expand' }, async () => {});
    expect(seen[0]!.messages[0]!.content.some((b) => b.cache_control)).toBe(false);
  });
});

describe('writer and repair share one output schema (cache prefix)', () => {
  it('sends byte-identical JSON schemas; the refinements stay on our side', async () => {
    const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
    const { WriterReplyRepair, WriterReplyWrite } = await import('@nyaai/shared');
    expect(JSON.stringify(zodOutputFormat(WriterReplyWrite).schema)).toBe(
      JSON.stringify(zodOutputFormat(WriterReplyRepair).schema),
    );
    expect(WriterReplyWrite.safeParse({ written: null, repairs: [] }).success).toBe(false);
    expect(WriterReplyRepair.safeParse({ written: null, repairs: [] }).success).toBe(true);
  });

  it('logs the cost of a reply that breaks a rule, then retries it as a schema failure', async () => {
    const tooLong = { role: 'nonsense' };
    const { run, calls, usage } = gateway([{ parsed: tooLong }, { parsed: { role: 'facts' } }]);
    await expect(run()).resolves.toMatchObject({ data: { role: 'facts' } });
    expect(calls).toHaveLength(2);
    expect(usage).toHaveLength(2);
  });
});
