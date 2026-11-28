/**
 * The library editor confirms the leading cases of each topic (concept_links, kind leading_case; HLD D28, LIB-1).
 * A confirmed link makes the case must-cover in lectures on the topic; Explore shows it without the grey chip.
 * Every action here is undoable from the screen (confirm ↔ undo, remove ↔ put back). Runs as the editor (RLS).
 */
import type pg from 'pg';
import type { TopicCases } from '@nyaai/shared';
import { AppError } from '../../errors.ts';

const notLinked = () => new AppError('NOT_FOUND', 'That case is not linked to this topic.');

/** Topics with their leading cases: those still to confirm, or all. */
export async function listTopicCases(c: pg.PoolClient, show: 'unconfirmed' | 'all'): Promise<TopicCases> {
  const rows = (
    await c.query<{
      concept_id: string;
      name: string;
      subject: string;
      source_id: string;
      title: string;
      court: string | null;
      decided_on: Date | null;
      confirmed_at: Date | null;
      confirmed_by: string | null;
    }>(
      `select lc.id as concept_id, lc.name, lc.subject, s.id as source_id, s.title, s.court, s.decided_on, l.confirmed_at, u.name as confirmed_by
         from concept_links l join legal_concepts lc on lc.id = l.concept_id join sources s on s.id = l.source_id
         left join users u on u.id = l.confirmed_by
        where l.kind = 'leading_case' and s.status <> 'retired' and ($1 = 'all' or l.confirmed_at is null)
        order by lc.subject, lc.name, s.decided_on nulls last, s.title`,
      [show],
    )
  ).rows;
  const unconfirmed = (
    await c.query<{ n: number }>(
      "select count(*)::int n from concept_links l join sources s on s.id = l.source_id where l.kind = 'leading_case' and l.confirmed_at is null and s.status <> 'retired'",
    )
  ).rows[0]!.n;
  const topics = new Map<string, TopicCases['topics'][number]>();
  for (const x of rows) {
    const t = topics.get(x.concept_id) ?? { conceptId: x.concept_id, name: x.name, subject: x.subject, cases: [] };
    t.cases.push({
      sourceId: x.source_id,
      title: x.title,
      court: x.court,
      year: x.decided_on ? x.decided_on.getFullYear() : null,
      confirmedAt: x.confirmed_at?.toISOString() ?? null,
      confirmedBy: x.confirmed_by,
    });
    topics.set(x.concept_id, t);
  }
  return { topics: [...topics.values()], unconfirmed };
}

/** She confirms the case belongs to the topic (who and when are kept). */
export async function confirmLink(c: pg.PoolClient, conceptId: string, sourceId: string): Promise<void> {
  const r = await c.query(
    "update concept_links set confirmed_by = app_user(), confirmed_at = now() where concept_id = $1 and source_id = $2 and kind = 'leading_case'",
    [conceptId, sourceId],
  );
  if (!r.rowCount) throw notLinked();
}

export async function unconfirmLink(c: pg.PoolClient, conceptId: string, sourceId: string): Promise<void> {
  const r = await c.query(
    "update concept_links set confirmed_by = null, confirmed_at = null where concept_id = $1 and source_id = $2 and kind = 'leading_case'",
    [conceptId, sourceId],
  );
  if (!r.rowCount) throw notLinked();
}

/** "Not this topic": the link is removed (it can be put back). */
export async function removeLink(c: pg.PoolClient, conceptId: string, sourceId: string): Promise<void> {
  const r = await c.query(
    "delete from concept_links where concept_id = $1 and source_id = $2 and kind = 'leading_case'",
    [conceptId, sourceId],
  );
  if (!r.rowCount) throw notLinked();
}

/** A removed link put back (a click by mistake): as it was, unconfirmed. */
export async function restoreLink(c: pg.PoolClient, conceptId: string, sourceId: string): Promise<void> {
  const known = (
    await c.query(
      "select 1 from legal_concepts lc, sources s where lc.id = $1 and s.id = $2 and s.type = 'judgment' and s.status <> 'retired'",
      [conceptId, sourceId],
    )
  ).rowCount;
  if (!known) throw new AppError('NOT_FOUND', 'We could not find that topic or case.');
  await c.query(
    "insert into concept_links (concept_id, source_id, kind) values ($1, $2, 'leading_case') on conflict do nothing",
    [conceptId, sourceId],
  );
}
