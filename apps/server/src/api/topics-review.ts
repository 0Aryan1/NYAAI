/**
 * The library editor confirms the leading cases of each topic (concept_links, kind leading_case; HLD D28, LIB-1).
 *   GET    /library/topics?show=unconfirmed|all             topics with their leading cases
 *   POST   /library/topics/:conceptId/cases/:sourceId/confirm  she confirms the link (who and when are kept)
 *   DELETE /library/topics/:conceptId/cases/:sourceId/confirm  undo a confirmation
 *   DELETE /library/topics/:conceptId/cases/:sourceId          not this topic: the link is removed
 *   POST   /library/topics/:conceptId/cases/:sourceId          put a removed link back (unconfirmed)
 * A confirmed link makes the case must-cover in lectures on the topic; Explore shows it without the grey chip.
 */
import express from 'express';
import { z } from 'zod';
import { TopicCases } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';

const Id = z.uuid();

export function topicsReviewRouter() {
  const r = express.Router();
  r.use('/library/topics', requireRole('library_editor'));

  r.get('/library/topics', async (req, res) => {
    const show = z.enum(['unconfirmed', 'all']).catch('unconfirmed').parse(req.query.show);
    const out = await req.db!(async (c) => {
      const rows = (
        await c.query<{ concept_id: string; name: string; subject: string; source_id: string; title: string; court: string | null; decided_on: Date | null; confirmed_at: Date | null; confirmed_by: string | null }>(
          `select lc.id as concept_id, lc.name, lc.subject, s.id as source_id, s.title, s.court, s.decided_on, l.confirmed_at, u.name as confirmed_by
             from concept_links l join legal_concepts lc on lc.id = l.concept_id join sources s on s.id = l.source_id
             left join users u on u.id = l.confirmed_by
            where l.kind = 'leading_case' and s.status <> 'retired' and ($1 = 'all' or l.confirmed_at is null)
            order by lc.subject, lc.name, s.decided_on nulls last, s.title`,
          [show],
        )
      ).rows;
      const unconfirmed = (await c.query<{ n: number }>("select count(*)::int n from concept_links l join sources s on s.id = l.source_id where l.kind = 'leading_case' and l.confirmed_at is null and s.status <> 'retired'")).rows[0]!.n;
      return { rows, unconfirmed };
    });
    const topics = new Map<string, TopicCases['topics'][number]>();
    for (const x of out.rows) {
      const t = topics.get(x.concept_id) ?? { conceptId: x.concept_id, name: x.name, subject: x.subject, cases: [] };
      t.cases.push({ sourceId: x.source_id, title: x.title, court: x.court, year: x.decided_on ? x.decided_on.getFullYear() : null, confirmedAt: x.confirmed_at?.toISOString() ?? null, confirmedBy: x.confirmed_by });
      topics.set(x.concept_id, t);
    }
    res.json(TopicCases.parse({ topics: [...topics.values()], unconfirmed: out.unconfirmed }));
  });

  const link = (req: express.Request) => ({ concept: Id.parse(req.params.conceptId), source: Id.parse(req.params.sourceId) });

  r.post('/library/topics/:conceptId/cases/:sourceId/confirm', async (req, res) => {
    const { concept, source } = link(req);
    const n = await req.db!(async (c) => (await c.query("update concept_links set confirmed_by = app_user(), confirmed_at = now() where concept_id = $1 and source_id = $2 and kind = 'leading_case'", [concept, source])).rowCount);
    if (!n) throw new AppError('NOT_FOUND', 'That case is not linked to this topic.');
    res.status(204).end();
  });

  r.delete('/library/topics/:conceptId/cases/:sourceId/confirm', async (req, res) => {
    const { concept, source } = link(req);
    const n = await req.db!(async (c) => (await c.query("update concept_links set confirmed_by = null, confirmed_at = null where concept_id = $1 and source_id = $2 and kind = 'leading_case'", [concept, source])).rowCount);
    if (!n) throw new AppError('NOT_FOUND', 'That case is not linked to this topic.');
    res.status(204).end();
  });

  /** A removed link put back (a click by mistake): as it was, unconfirmed. */
  r.post('/library/topics/:conceptId/cases/:sourceId', async (req, res) => {
    const { concept, source } = link(req);
    const ok = await req.db!(async (c) => {
      const known = (await c.query("select 1 from legal_concepts lc, sources s where lc.id = $1 and s.id = $2 and s.type = 'judgment' and s.status <> 'retired'", [concept, source])).rowCount;
      if (!known) return false;
      await c.query("insert into concept_links (concept_id, source_id, kind) values ($1, $2, 'leading_case') on conflict do nothing", [concept, source]);
      return true;
    });
    if (!ok) throw new AppError('NOT_FOUND', 'We could not find that topic or case.');
    res.status(204).end();
  });

  r.delete('/library/topics/:conceptId/cases/:sourceId', async (req, res) => {
    const { concept, source } = link(req);
    const n = await req.db!(async (c) => (await c.query("delete from concept_links where concept_id = $1 and source_id = $2 and kind = 'leading_case'", [concept, source])).rowCount);
    if (!n) throw new AppError('NOT_FOUND', 'That case is not linked to this topic.');
    res.status(204).end();
  });

  return r;
}
