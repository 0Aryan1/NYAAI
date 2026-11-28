/**
 * Search-facing endpoints: suggestions (HOME-2, no AI), topic resolution (HOME-9), the live event stream
 * (LLD §4.4) and a library-editor search for checking retrieval by hand.
 */
import express from 'express';
import type { Redis } from 'ioredis';
import {
  LibrarySearchRequest,
  LibrarySearchResponse,
  ResolveRequest,
  ResolveResponse,
  SuggestResponse,
} from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { channelFor, eventsSince } from '../services/events.ts';
import type { Gateway } from '../services/llm-gateway/index.ts';
import { search } from '../services/search/index.ts';
import { resolveConcept } from '../services/topics/index.ts';
import { suggest } from '../services/suggest/index.ts';
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
    const suggestions = await req.db!((c) => suggest(c, q));
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
    res.json(LibrarySearchResponse.parse(result));
  });

  return r;
}
