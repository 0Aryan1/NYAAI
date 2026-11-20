/**
 * LLM gateway (LLD §17.1–17.2): the only module that talks to Claude.
 *
 * - Two tiers: light = MODEL_CHECKER (Haiku), heavy = MODEL_WRITER (Sonnet). The prompt chooses its tier.
 * - Every data-returning call uses JSON-schema structured output (`output_config.format` from a Zod schema),
 *   and the reply is validated again with Zod: a schema shapes the output, it does not make it true.
 * - A light call escalates to heavy after two schema failures, or when the light model is down.
 * - A heavy call is never downgraded: when it is down, the gateway waits and retries.
 * - Every call writes a `usage` row with tokens and cost (integer micro-USD).
 * - Prompt order is stable → variable; a cache breakpoint is set only on blocks long enough to be cached.
 * Day 3 adds the writer/checker prompts, the budget gate and the per-tier cache TTLs.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import type { PromptDefinition, Tier } from '@nyaai/prompts';
import type { UsageSink } from '../usage.ts';

/** US$ per million tokens (first-party API rates). Cache write = 1.25× input, cache read = 0.1× input. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
};
/** Blocks shorter than this are sent without a cache breakpoint (a write that can't be read is wasted money). */
const MIN_CACHE_CHARS = 16_000;
const HEAVY_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly kind: 'schema' | 'refusal' | 'unavailable' | 'request',
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface GatewayRequest<S extends z.ZodType> {
  prompt: PromptDefinition;
  schema: S;
  /** Cacheable context after the system prompt (teacher block, sources block), stable first. */
  context?: string[];
  /** The variable task for this call. */
  task: string;
  /** Start on heavy (e.g. a high-risk claim is expected). Never used to downgrade. */
  forceHeavy?: boolean;
  traceId?: string;
}

export interface GatewayResult<T> {
  data: T;
  model: string;
  tier: Tier;
  escalated: boolean;
}

export interface Gateway {
  run<S extends z.ZodType>(req: GatewayRequest<S>, usage: UsageSink): Promise<GatewayResult<z.infer<S>>>;
}

export interface GatewayConfig {
  apiKey?: string;
  lightModel: string;
  heavyModel: string;
  /** Injected in tests. */
  client?: Pick<Anthropic, 'messages'>;
  sleep?: (ms: number) => Promise<void>;
}

const isOutage = (err: unknown) =>
  err instanceof Anthropic.APIConnectionError ||
  err instanceof Anthropic.InternalServerError ||
  (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500));

export function costMicroUsd(model: string, u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  const input = u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return Math.ceil(input * p.in + u.output_tokens * p.out); // $/M tokens = µ$/token
}

export function createGateway(cfg: GatewayConfig): Gateway {
  const client = cfg.client ?? new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2 });
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const modelFor = (tier: Tier) => (tier === 'heavy' ? cfg.heavyModel : cfg.lightModel);

  return {
    async run(req, usage) {
      let tier: Tier = req.forceHeavy ? 'heavy' : req.prompt.tier;
      let escalated = req.forceHeavy === true && req.prompt.tier === 'light';
      let schemaFailures = 0;
      let heavyOutages = 0;

      const system: Anthropic.TextBlockParam[] = [
        { type: 'text', text: req.prompt.system, ...(req.prompt.system.length >= MIN_CACHE_CHARS ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } } : {}) },
      ];
      const content: Anthropic.TextBlockParam[] = [
        ...(req.context ?? []).map((text) => ({ type: 'text' as const, text, ...(text.length >= MIN_CACHE_CHARS ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
        { type: 'text', text: req.task },
      ];

      for (;;) {
        const model = modelFor(tier);
        let response;
        try {
          response = await client.messages.parse({
            model,
            max_tokens: req.prompt.maxOutputTokens + 2_000, // room for adaptive thinking on top of the answer cap
            system,
            messages: [{ role: 'user', content }],
            output_config: { format: zodOutputFormat(req.schema), effort: req.prompt.effort },
          });
        } catch (err) {
          if (isOutage(err) || err instanceof Anthropic.RateLimitError) {
            if (tier === 'light' && !(err instanceof Anthropic.RateLimitError)) {
              tier = 'heavy'; // light down → heavy (cost may rise; accuracy never drops)
              escalated = true;
              continue;
            }
            const delay = HEAVY_RETRY_DELAYS_MS[heavyOutages++];
            if (delay === undefined) throw new GatewayError(`${model} unavailable after retries`, 'unavailable');
            await sleep(delay); // heavy down → wait; never fall back to light
            continue;
          }
          throw new GatewayError(err instanceof Error ? err.message : String(err), 'request');
        }

        await usage({
          provider: 'anthropic',
          model,
          purpose: req.prompt.id,
          promptId: req.prompt.id,
          promptVersion: req.prompt.version,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? undefined,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
          tier,
          escalated,
          costMicroUsd: costMicroUsd(model, response.usage),
          traceId: req.traceId,
        });

        if (response.stop_reason === 'refusal') throw new GatewayError(`${model} declined the request`, 'refusal');
        const parsed = response.stop_reason === 'max_tokens' ? null : response.parsed_output;
        const valid = parsed == null ? null : req.schema.safeParse(parsed);
        if (valid?.success) return { data: valid.data, model, tier, escalated };

        schemaFailures++;
        if (tier === 'light' && schemaFailures >= 2) {
          tier = 'heavy';
          escalated = true;
          schemaFailures = 0;
          continue;
        }
        if (tier === 'heavy' && schemaFailures >= 2) throw new GatewayError(`${req.prompt.id}: reply did not match its schema`, 'schema');
      }
    },
  };
}
