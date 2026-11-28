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
import { requireRole } from '../middleware/auth.ts';
import { confirmLink, listTopicCases, removeLink, restoreLink, unconfirmLink } from '../services/topics/review.ts';

const Id = z.uuid();

export function topicsReviewRouter() {
  const r = express.Router();
  r.use('/library/topics', requireRole('library_editor'));

  r.get('/library/topics', async (req, res) => {
    const show = z.enum(['unconfirmed', 'all']).catch('unconfirmed').parse(req.query.show);
    res.json(TopicCases.parse(await req.db!((c) => listTopicCases(c, show))));
  });

  const link = (req: express.Request) => ({
    concept: Id.parse(req.params.conceptId),
    source: Id.parse(req.params.sourceId),
  });

  r.post('/library/topics/:conceptId/cases/:sourceId/confirm', async (req, res) => {
    const { concept, source } = link(req);
    await req.db!((c) => confirmLink(c, concept, source));
    res.status(204).end();
  });

  r.delete('/library/topics/:conceptId/cases/:sourceId/confirm', async (req, res) => {
    const { concept, source } = link(req);
    await req.db!((c) => unconfirmLink(c, concept, source));
    res.status(204).end();
  });

  r.post('/library/topics/:conceptId/cases/:sourceId', async (req, res) => {
    const { concept, source } = link(req);
    await req.db!((c) => restoreLink(c, concept, source));
    res.status(204).end();
  });

  r.delete('/library/topics/:conceptId/cases/:sourceId', async (req, res) => {
    const { concept, source } = link(req);
    await req.db!((c) => removeLink(c, concept, source));
    res.status(204).end();
  });

  return r;
}
