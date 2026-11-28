/**
 * Shared helpers for the server tests: a word-overlap fake of Voyage (no network, no cost), and the CSRF token from
 * a sign-in's cookies. The fake's embedding is the one the browser journeys use; its reranker scores a passage by
 * the plain share of the question's words it holds, which the tests' expected orders are written against.
 */
import type request from 'supertest';
import { bagOfWordsVector, words } from '../src/services/voyage/fake.ts';
import type { Voyage } from '../src/services/voyage/index.ts';

export { words };
export const fakeVector = bagOfWordsVector;

export const fakeVoyage: Voyage = {
  embed: async (texts) => texts.map(fakeVector),
  rerank: async (query, docs) => {
    const q = new Set(words(query.split('Question:').pop() ?? query));
    return docs
      .map((d, index) => {
        const w = new Set(words(d));
        return { index, score: q.size ? [...q].filter((x) => w.has(x)).length / q.size : 0 };
      })
      .sort((a, b) => b.score - a.score);
  },
};

/** The CSRF token the server set at sign-in (the `nyaai_csrf` cookie), for the `x-csrf-token` header. */
export function csrfFrom(res: request.Response): string {
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('nyaai_csrf='));
  if (!cookie) throw new Error('no CSRF cookie in the response');
  return decodeURIComponent(cookie.split(';')[0]!.slice('nyaai_csrf='.length));
}
