/**
 * Search-facing endpoints: suggestions (HOME-2, no AI), topic resolution (HOME-9), the live event stream
 * (LLD §4.4) and a library-editor search for checking retrieval by hand.
 */
import express from 'express';
import type { Redis } from 'ioredis';
import { LibrarySearchRequest, ResolveRequest, ResolveResponse, SuggestResponse, type Suggestion } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { channelFor, eventsSince } from '../services/events.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import { search } from '../services/search/index.ts';
import { resolveConcept } from '../services/topics.ts';
import { usageSink, type UsageSink } from '../services/usage.ts';
import type { Voyage } from '../services/voyage/index.ts';

export interface SearchApiDeps {
  redis: Redis;
  /** Built per request with the teacher's usage sink; null when Voyage is not configured. */
  voyage: ((usage: UsageSink) => Voyage) | null;
  gateway: Gateway | null;
  minScore: number;
}

const HEARTBEAT_MS = 20_000;

export function searchRouter(deps: SearchApiDeps) {
  const r = express.Router();

  r.get('/suggest', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) return void res.json(SuggestResponse.parse({ suggestions: [] }));
    const started = Date.now();
    const rows = await req.db!(async (c) => {
      const like = `${q.replace(/[%_\\]/g, '\\$&')}%`;
      const concepts = await c.query<{ name: string; subject: string }>(
        `select name, subject from legal_concepts
          where name ilike $1 or name % $2 or exists (select 1 from unnest(aliases) a where a ilike $1 or a % $2)
          order by greatest(similarity(name, $2), (select max(similarity(a, $2)) from unnest(aliases) a)) desc nulls last limit 4`,
        [like, q],
      );
      const sections = await c.query<{
        header: string;
        act_name: string | null;
        section: string | null;
        article: string | null;
      }>(
        `select header, act_name, section, article from chunks
          where visibility = 'shared' and parent_id is null and source_type in ('act', 'constitution') and status in ('live', 'provisional')
            and law_status is distinct from 'repealed'
            and (header ilike '%' || $1 || '%' or section = upper($1) or article = upper($1))
          order by (section = upper($1) or article = upper($1)) desc, similarity(header, $1) desc limit 4`,
        [q],
      );
      const cases = await c.query<{ title: string; court: string | null; decided_on: Date | null }>(
        `select title, court, decided_on from sources
          where type = 'judgment' and status in ('live', 'provisional') and (title ilike '%' || $1 || '%' or title % $1)
          order by similarity(title, $1) desc limit 3`,
        [q],
      );
      const units = await c.query<{ title: string; course: string }>(
        `select u.title, co.name as course from course_units u join courses co on co.id = u.course_id
          where u.title ilike '%' || $1 || '%' order by u.position limit 3`,
        [q],
      );
      return { concepts: concepts.rows, sections: sections.rows, cases: cases.rows, units: units.rows };
    });
    const suggestions: Suggestion[] = [
      ...rows.concepts.map((x) => ({ kind: 'concept' as const, label: x.name, detail: x.subject, value: x.name })),
      ...rows.sections.map((x) => {
        const short = x.header.split(' › ').pop() ?? x.header;
        return { kind: 'section' as const, label: short, detail: x.act_name ?? null, value: short };
      }),
      ...rows.cases.map((x) => ({
        kind: 'case' as const,
        label: x.title,
        detail: [x.court, x.decided_on?.getFullYear()].filter(Boolean).join(', ') || null,
        value: x.title,
      })),
      ...rows.units.map((x) => ({ kind: 'unit' as const, label: x.title, detail: x.course, value: x.title })),
    ].slice(0, 8);
    res.setHeader('Server-Timing', `db;dur=${Date.now() - started}`);
    res.json(SuggestResponse.parse({ suggestions }));
  });

  r.post('/topics/resolve', async (req, res) => {
    const { topic, choice } = ResolveRequest.parse(req.body);
    const conceptId = await req.db!((c) => resolveConcept(c, topic, choice));
    res.json(ResolveResponse.parse({ conceptId }));
  });

  r.get('/events/stream', async (req, res) => {
    const userId = req.identity!.userId;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (id: number, data: string) => res.write(`id: ${id}\ndata: ${data}\n\n`);
    const last = Number(req.get('last-event-id') ?? req.query.lastEventId ?? 0);
    if (last > 0) for (const e of await eventsSince(deps.redis, userId, last)) send(e.id, JSON.stringify(e.event));
    res.write(': connected\n\n');

    const sub = deps.redis.duplicate();
    await sub.subscribe(channelFor(userId));
    sub.on('message', (_channel, payload: string) => {
      const { id, event } = JSON.parse(payload) as { id: number; event: unknown };
      send(id, JSON.stringify(event));
    });
    const beat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_MS);
    req.on('close', () => {
      clearInterval(beat);
      void sub.quit();
    });
  });

  r.post('/library/search', requireRole('library_editor', 'admin'), async (req, res) => {
    if (!deps.voyage) throw new AppError('SERVICE_UNAVAILABLE', 'Search is not set up yet.');
    const body = LibrarySearchRequest.parse(req.body);
    const result = await req.db!(async (c) => {
      const usage = usageSink(c, { collegeId: req.identity!.collegeId, ownerId: req.identity!.userId });
      return search(
        c,
        { query: body.query, purpose: 'explore', filters: { asOn: body.asOn }, noRerank: body.noRerank },
        {
          voyage: deps.voyage!(usage),
          gateway: deps.gateway,
          usage,
          minScore: deps.minScore,
        },
      );
    });
    res.json(result);
  });

  return r;
}
