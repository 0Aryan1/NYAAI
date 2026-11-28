/**
 * Each teacher's monthly AI budget (BRD Section 9, LLD §5.1). The month is the calendar month in India. Every call
 * to an outside AI service records its cost in `usage`; a new lecture, research run or Explore question is refused
 * once the month's spend reaches the budget. Work already under way (a build past planning) is allowed to finish.
 */
import type pg from 'pg';
import { AppError } from '../../errors.ts';
import { TIMEZONE } from '../../lib/time.ts';

const BUDGET_EXHAUSTED_MESSAGE = 'Your monthly limit is reached; your administrator can raise it.';

export interface MonthlyBudget {
  /** The teacher's budget for the month, in micro-US$. */
  budget: number;
  /** Spent so far this month (India time). */
  spent: number;
  left: number;
}

/** Her budget and this month's spend; null when she has no teacher profile (an editor or admin). */
export async function monthlyBudget(c: pg.PoolClient, ownerId: string): Promise<MonthlyBudget | null> {
  const r = (
    await c.query<{ budget: string; spent: string }>(
      `select p.monthly_budget_micro_usd::text budget,
              (select coalesce(sum(u.cost_micro_usd), 0)::text from usage u
                where u.owner_id = p.owner_id
                  and u.created_at >= date_trunc('month', now() at time zone $2) at time zone $2) spent
         from teacher_profiles p where p.owner_id = $1`,
      [ownerId, TIMEZONE],
    )
  ).rows[0];
  if (!r) return null;
  const budget = Number(r.budget);
  const spent = Number(r.spent);
  return { budget, spent, left: budget - spent };
}

export const isExhausted = (b: MonthlyBudget | null): boolean => !!b && b.left <= 0;

/** For a request: refuses with BUDGET_EXHAUSTED before any AI call. */
export async function assertWithinBudget(c: pg.PoolClient, ownerId: string): Promise<void> {
  if (isExhausted(await monthlyBudget(c, ownerId))) throw new AppError('BUDGET_EXHAUSTED', BUDGET_EXHAUSTED_MESSAGE);
}
