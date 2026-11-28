import { ApiRequestError } from '@/shared/api/http';

/**
 * What to tell her when something did not work: the server's plain message (or "check your connection" when the
 * request never reached it), otherwise the screen's own fallback. Never a raw browser message ("Failed to fetch").
 */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiRequestError ? err.message : fallback;
}

/** The monthly AI limit is reached (BUDGET_EXHAUSTED): the same words on every screen that can hit it. */
export const BUDGET_EXHAUSTED_TEXT = 'Your monthly limit is reached; your administrator can raise it.';
