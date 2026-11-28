/**
 * Web search (HLD D9: Perplexity Search API, raw results we check ourselves). The only module that calls Perplexity.
 *
 * Used now only to find *leads* for the library editor: links on allowlisted official sites (WEB_ALLOWLIST) that may
 * hold a missing source. A lead is never library content and never supports a claim (rules: news and web ≠ law);
 * the editor opens it and, if it is the right official document, loads it through the normal ingestion.
 * Every link is checked: the host must be on the allowlist (asked of Perplexity and checked again here), and the
 * page must open (HTTP 2xx after redirects, still on the allowlist). Snippets are not kept.
 */
import { onAllowlist } from '@nyaai/legal';
import type { UsageSink } from '../usage.ts';

export interface WebLead {
  title: string;
  url: string;
  lastUpdated: string | null;
  /** The link opened with HTTP 2xx, and the final address is still on the allowlist. */
  checked: boolean;
}

export interface WebSearch {
  findLeads(query: string, max?: number): Promise<WebLead[]>;
}

export interface WebSearchConfig {
  apiKey: string;
  allowlist: string[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Perplexity lists the Search API at US$5 per 1,000 requests. */
  costMicroUsd?: number;
}

/** Perplexity accepts at most 20 domains in `search_domain_filter`. */
const MAX_DOMAINS = 20;

export function createWebSearch(cfg: WebSearchConfig, usage: UsageSink): WebSearch {
  const base = cfg.baseUrl ?? 'https://api.perplexity.ai';
  const doFetch = cfg.fetchImpl ?? fetch;
  const allow = cfg.allowlist.filter(Boolean);
  if (allow.length === 0) throw new Error('WEB_ALLOWLIST is empty; web leads need at least one allowed domain.');

  async function opens(url: string): Promise<boolean> {
    try {
      const res = await doFetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'NYAAI-link-check/0.1', range: 'bytes=0-1023' },
        signal: AbortSignal.timeout(15_000),
      });
      await res.body?.cancel().catch(() => {});
      return res.ok && onAllowlist(res.url || url, allow);
    } catch {
      return false;
    }
  }

  return {
    async findLeads(query, max = 5) {
      const res = await doFetch(`${base}/search`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          query: query.slice(0, 400),
          max_results: Math.min(max * 2, 20),
          max_tokens_per_page: 256,
          search_domain_filter: allow.slice(0, MAX_DOMAINS),
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`Web search failed: HTTP ${res.status}`);
      await usage({ provider: 'perplexity', purpose: 'web.leads', units: 1, costMicroUsd: cfg.costMicroUsd ?? 5_000 });
      const body = (await res.json()) as {
        results?: { title?: string; url?: string; last_updated?: string; date?: string }[];
      };
      const seen = new Set<string>();
      const candidates = (body.results ?? []).filter(
        (r): r is { title?: string; url: string; last_updated?: string; date?: string } => {
          if (!r.url || seen.has(r.url) || !onAllowlist(r.url, allow)) return false;
          seen.add(r.url);
          return true;
        },
      );
      const picked = candidates.slice(0, max);
      const checks = await Promise.all(picked.map((r) => opens(r.url)));
      return picked.map((r, i) => ({
        title: (r.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || new URL(r.url).hostname,
        url: r.url,
        lastUpdated: r.last_updated ?? r.date ?? null,
        checked: checks[i]!,
      }));
    },
  };
}
