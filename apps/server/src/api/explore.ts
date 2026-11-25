/**
 * Explore (BRD EXP-1, EXP-2, EXP-6; LLD §4 /explore). Library only.
 *   GET  /explore/concepts?q=        the concept list (search box and browse)
 *   GET  /explore/topic/:conceptId   the topic map
 *   POST /explore/ask                a follow-up question: answered closed-book from the library, every claim checked
 * "Turn into a lecture" is the Prepare screen with the topic and concept filled in (web).
 */
import express from 'express';
import { z } from 'zod';
import { ConceptList, ExploreAnswer, ExploreAsk, TopicMap } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireConsent } from '../middleware/consent.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import { answerQuestion, listConcepts, topicMap } from '../services/explore/index.ts';
import { usageSink, type UsageSink } from '../services/usage.ts';
import type { Voyage } from '../services/voyage/index.ts';

export interface ExploreApiDeps {
  voyage: ((usage: UsageSink) => Voyage) | null;
  gateway: Gateway | null;
  minScore: number;
}

export function exploreRouter(deps: ExploreApiDeps) {
  const r = express.Router();

  r.get('/explore/concepts', async (req, res) => {
    const q = z.string().trim().min(1).max(100).optional().catch(undefined).parse(req.query.q) ?? null;
    res.json(ConceptList.parse({ concepts: await req.db!((c) => listConcepts(c, q)) }));
  });

  r.get('/explore/topic/:conceptId', async (req, res) => {
    const id = z.uuid().parse(req.params.conceptId);
    const map = await req.db!((c) => topicMap(c, id));
    if (!map) throw new AppError('NOT_FOUND', 'We could not find that topic.');
    res.json(TopicMap.parse(map));
  });

  r.post('/explore/ask', requireConsent, async (req, res) => {
    if (!deps.gateway || !deps.voyage) throw new AppError('SERVICE_UNAVAILABLE', 'Answers are not available right now. Try again later.');
    const body = ExploreAsk.parse(req.body);
    const who = req.identity!;
    // Her monthly budget, as for a lecture (LLD §5.1): refused before any AI call.
    const { left, concept } = await req.db!(async (c) => {
      const b = (
        await c.query<{ budget: string; spent: string | null }>(
          `select p.monthly_budget_micro_usd::text budget,
                  (select sum(cost_micro_usd)::text from usage u where u.owner_id = p.owner_id
                     and u.created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') spent
             from teacher_profiles p where p.owner_id = app_user()`,
        )
      ).rows[0];
      const concept = body.conceptId ? (await c.query<{ name: string }>('select name from legal_concepts where id = $1', [body.conceptId])).rows[0]?.name ?? null : null;
      return { left: b ? Number(b.budget) - Number(b.spent ?? 0) : 1, concept };
    });
    if (left <= 0) throw new AppError('BUDGET_EXHAUSTED', 'Your monthly limit is reached; your administrator can raise it.');
    const gateway = deps.gateway;
    const voyage = deps.voyage;
    const answer = await answerQuestion(body.question, concept, {
      tenant: (fn) => req.db!(fn),
      searchDeps: (c) => {
        const usage = usageSink(c, { collegeId: who.collegeId, ownerId: who.userId });
        return { voyage: voyage(usage), gateway, usage, minScore: deps.minScore };
      },
      gateway,
      // The answer's AI cost is hers, logged in its own short transaction.
      usage: (row) => req.db!((c) => usageSink(c, { collegeId: who.collegeId, ownerId: who.userId })(row)),
    });
    res.json(ExploreAnswer.parse(answer));
  });

  return r;
}
