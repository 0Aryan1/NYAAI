import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { PROMPTS } from '@nyaai/prompts';
import { checkDeadline, JobTimeoutError, withDeadline } from '../src/jobs/deadline.ts';
import { createGateway, withSignal } from '../src/services/llm-gateway/index.ts';

const Schema = z.object({ role: z.enum(['facts', 'holding', 'unknown']) });
const noUsage = async () => {};

/** A Claude that never answers on its own: a call ends only when its signal is aborted (as the SDK does). */
function silentClient() {
  const started: number[] = [];
  const client = {
    messages: {
      create: (_params: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          started.push(Date.now());
          opts?.signal?.addEventListener('abort', () => reject(new Error('Request was aborted.')), { once: true });
        }),
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, started };
}

describe("a job's time limit really stops the work", () => {
  it('cancels the AI call in flight, runs no later step, and reports the time limit only once the work has stopped', async () => {
    const { client, started } = silentClient();
    const gateway = createGateway({ lightModel: 'claude-haiku-5-5', heavyModel: 'claude-sonnet-5-5', client });
    const steps: string[] = [];
    let workEnded = 0;
    const work = async (signal: AbortSignal) => {
      try {
        const gw = withSignal(gateway, signal);
        steps.push('plan');
        await gw.run({ prompt: PROMPTS['labeller.roles'], schema: Schema, task: 'x' }, noUsage);
        checkDeadline(signal);
        steps.push('write'); // must never happen: the plan call was stopped
      } finally {
        workEnded = Date.now();
      }
    };
    const err = await withDeadline(60, 'BUILD_TIMEOUT', work).catch((e: unknown) => e);
    const reported = Date.now();
    expect(err).toBeInstanceOf(JobTimeoutError);
    expect((err as JobTimeoutError).code).toBe('BUILD_TIMEOUT');
    expect(steps).toEqual(['plan']);
    expect(started).toHaveLength(1); // no retry of the stopped call
    expect(workEnded).toBeGreaterThan(0);
    expect(reported).toBeGreaterThanOrEqual(workEnded); // the job waited for the work to stop
  });

  it("a gateway retry wait (Claude busy) ends at once when the job's time is up", async () => {
    let calls = 0;
    const client = {
      messages: {
        create: async () => {
          calls += 1;
          throw new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>;
    // Waits of 2 s and more between retries; the job's limit is 80 ms.
    const gateway = createGateway({ lightModel: 'claude-haiku-5-5', heavyModel: 'claude-sonnet-5-5', client });
    const t0 = Date.now();
    const err = await withDeadline(80, 'RESEARCH_TIMEOUT', (signal) =>
      withSignal(gateway, signal).run(
        { prompt: PROMPTS['labeller.roles'], schema: Schema, task: 'x', forceHeavy: true },
        noUsage,
      ),
    ).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'RESEARCH_TIMEOUT' });
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('work that finishes in time is untouched', async () => {
    await expect(withDeadline(1_000, 'X', async (signal) => (checkDeadline(signal), 42))).resolves.toBe(42);
  });
});
