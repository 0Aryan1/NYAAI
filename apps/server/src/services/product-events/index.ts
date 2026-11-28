/**
 * Product events: what people use, for the pilot's own measures (e.g. how often a brief is exported, and with how
 * many lines still to verify). Names and small numbers only, never lecture text. Written as the user (RLS).
 */
import type pg from 'pg';

export async function recordProductEvent(
  c: pg.PoolClient,
  who: { collegeId: string; userId: string },
  name: string,
  props: Record<string, unknown>,
): Promise<void> {
  await c.query('insert into product_events (college_id, user_id, name, props) values ($1, $2, $3, $4)', [
    who.collegeId,
    who.userId,
    name,
    props,
  ]);
}
