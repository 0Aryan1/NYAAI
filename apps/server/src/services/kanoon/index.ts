/**
 * Indian Kanoon API (HLD D25: used only for gaps; content is provisional and expires after KANOON_CACHE_DAYS).
 * Queries are built only from a teacher's own words or a library editor's input, never from retrieved text, so
 * a planted instruction in a document can't send anything out (LLD §17.6 rule 2).
 */
import type { KanoonDoc } from '@nyaai/legal';
import type { UsageSink } from '../usage.ts';

export interface KanoonConfig {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Cost per call in micro-USD, for the usage log (Kanoon bills in rupees per request). */
  searchCostMicroUsd?: number;
  docCostMicroUsd?: number;
}

export interface KanoonHit {
  tid: number;
  title: string;
  publishdate: string | null;
  docsource: string | null;
  docsize: number | null;
}

export interface Kanoon {
  search(query: string, opts?: { doctypes?: string; page?: number }): Promise<KanoonHit[]>;
  doc(tid: number): Promise<KanoonDoc>;
}

export class KanoonError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KanoonError';
  }
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');

export function createKanoon(cfg: KanoonConfig, usage: UsageSink): Kanoon {
  const base = cfg.baseUrl ?? 'https://api.indiankanoon.org';
  const doFetch = cfg.fetchImpl ?? fetch;

  async function post<T>(path: string, purpose: string, cost: number): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Token ${cfg.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new KanoonError(`Indian Kanoon ${path.split('?')[0]} failed: HTTP ${res.status}`, res.status);
    const body = (await res.json()) as T & { errmsg?: string };
    if (body.errmsg) throw new KanoonError(`Indian Kanoon: ${body.errmsg}`, 200);
    await usage({ provider: 'indian_kanoon', purpose, units: 1, costMicroUsd: cost });
    return body;
  }

  return {
    async search(query, opts = {}) {
      const q = opts.doctypes ? `${query} doctypes:${opts.doctypes}` : query;
      const r = await post<{ docs?: { tid: number; title: string; publishdate?: string; docsource?: string; docsize?: number }[] }>(
        `/search/?formInput=${encodeURIComponent(q)}&pagenum=${opts.page ?? 0}`,
        'kanoon.search',
        cfg.searchCostMicroUsd ?? 6_000,
      );
      return (r.docs ?? []).map((d) => ({
        tid: d.tid,
        title: stripTags(d.title),
        publishdate: d.publishdate ?? null,
        docsource: d.docsource ?? null,
        docsize: typeof d.docsize === 'number' ? d.docsize : null,
      }));
    },
    async doc(tid) {
      return post<KanoonDoc>(`/doc/${tid}/`, 'kanoon.doc', cfg.docCostMicroUsd ?? 6_000);
    },
  };
}
