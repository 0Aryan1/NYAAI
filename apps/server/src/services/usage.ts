/**
 * Cost logging (LLD §17.1): every outside AI or search call writes one `usage` row. Money is integer micro-USD.
 * The sink is passed in, so services never need to know which database role or tenant they run under.
 */
import type pg from 'pg';

export interface UsageRow {
  provider: 'anthropic' | 'voyage' | 'indian_kanoon' | 'perplexity';
  model?: string;
  purpose: string;
  promptId?: string;
  promptVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  tier?: 'light' | 'heavy';
  escalated?: boolean;
  units?: number;
  costMicroUsd: number;
  traceId?: string;
  lectureId?: string;
  researchRunId?: string;
}

export type UsageSink = (row: UsageRow) => Promise<void>;

/** Writes through any client that is allowed to insert usage (worker under a tenant, library role, app). */
export function usageSink(
  db: Pick<pg.Pool | pg.PoolClient, 'query'>,
  who: { collegeId: string | 'global'; ownerId: string | null },
): UsageSink {
  return async (u) => {
    await db.query(
      `insert into usage (college_id, owner_id, lecture_id, research_run_id, provider, model, purpose, prompt_id, prompt_version,
                          input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, tier, escalated, units, cost_micro_usd, trace_id)
       values (${who.collegeId === 'global' ? 'global_college()' : '$18'}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        who.ownerId,
        u.lectureId ?? null,
        u.researchRunId ?? null,
        u.provider,
        u.model ?? null,
        u.purpose,
        u.promptId ?? null,
        u.promptVersion ?? null,
        u.inputTokens ?? null,
        u.outputTokens ?? null,
        u.cacheWriteTokens ?? null,
        u.cacheReadTokens ?? null,
        u.tier ?? null,
        u.escalated ?? false,
        u.units ?? null,
        Math.ceil(u.costMicroUsd),
        u.traceId ?? null,
        ...(who.collegeId === 'global' ? [] : [who.collegeId]),
      ],
    );
  };
}

/** A sink that drops rows (tests, dry runs). */
export const noUsage: UsageSink = async () => {};
