/**
 * Library gaps and the live lookup (F2 "search or research gap → live lookup", BRD DATA-4, extended).
 *
 * When a search comes back `thin` or `not_found`:
 *  1. The gap is recorded for the library editor (record_library_gap: counts teachers, one review item per gap).
 *  2. The lookup tries trusted sources, each for what it is the right source of:
 *     - India Code → a central Act the question names that the library lacks. Loaded only on an exact, single,
 *       unrepealed match, and kept provisional until the editor confirms it is the right Act and edition.
 *     - Indian Kanoon → judgments (the named case, or the top judgments for the topic). Provisional, as before.
 *     - Web (Perplexity, allowlisted official domains) → links for the editor only, never library content.
 *  3. The caller searches again; the gap becomes `answered`, or stays `open` with what was tried.
 *
 * Runs as nyaai_library (shared rows only). The question that leaves the system is the teacher's own words, or an
 * Act or case name taken from them by code, never text from a retrieved document (LLD §17.6 rule 2).
 */
import type pg from 'pg';
import { classifyGap, matchHeldCase, pickAct, pickCaseHit, questionKey, sameAct, type GapClass } from '@nyaai/legal';
import type { IndiaCode } from '../india-code/index.ts';
import type { Kanoon } from '../kanoon/index.ts';
import type { Storage } from '../storage/index.ts';
import type { WebLead, WebSearch } from '../web-search/index.ts';
import type { FinishDeps } from '../ingest/finish.ts';
import { loadIndiaCodeAct } from '../ingest/india-code.ts';
import { heldJudgments, heldLinks, ingestKanoonJudgment, kanoonUrl } from '../ingest/kanoon.ts';
import { search, type SearchDeps, type SearchRequest, type SearchResult } from '../search/index.ts';

export type Provider = 'india_code' | 'indian_kanoon' | 'web';

export interface Attempt {
  at: string;
  provider: Provider;
  outcome: 'loaded' | 'nothing' | 'ambiguous' | 'repealed' | 'skipped' | 'failed';
  detail: string;
  sourceIds?: string[];
}

export interface Lead extends WebLead {
  provider: Provider;
}

export interface LookupResult {
  gapId: string;
  state: 'open' | 'loaded' | 'looking' | 'answered' | 'resolved' | 'wont_fill';
  loadedSourceIds: string[];
  attempts: Attempt[];
  leads: Lead[];
  /** Why nothing ran: closed by the editor, another lookup is running, or one ran recently. */
  skipped?: 'closed' | 'busy' | 'recent';
}

export interface LookupDeps extends FinishDeps {
  storage: Storage;
  kanoon: Kanoon | null;
  indiaCode: IndiaCode | null;
  web: WebSearch | null;
  cacheDays: number;
  /** Judgments loaded per topic gap (each costs a Kanoon document call plus labelling and embedding). */
  maxJudgments?: number;
  /** Don't start new work after this long; a lecture build aims to finish in 5 minutes. */
  budgetMs?: number;
  /** Don't repeat a lookup for the same gap within this many hours unless forced. */
  cooldownHours?: number;
}

export interface GapLookup {
  run(gapId: string, opts?: { force?: boolean }): Promise<LookupResult>;
  /** After the caller searched again: answered when the search is ok now, otherwise back to open. */
  settle(gapId: string, outcome: SearchResult['outcome']): Promise<void>;
}

interface GapRow {
  question: string;
  kind: GapClass['kind'];
  act_name: string | null;
  act_year: number | null;
  case_name: string | null;
  leads: Lead[];
  attempts: Attempt[];
}

const MAX_ATTEMPTS_KEPT = 30;
const MAX_LEADS_KEPT = 12;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 200);

export function createGapLookup(deps: LookupDeps): GapLookup {
  const { library } = deps;
  const maxJudgments = deps.maxJudgments ?? 3;
  const budgetMs = deps.budgetMs ?? 180_000;
  const cooldownHours = deps.cooldownHours ?? 24;

  async function current(gapId: string): Promise<LookupResult> {
    const r = (
      await library.query<{ state: LookupResult['state']; loaded_source_ids: string[]; attempts: Attempt[]; leads: Lead[] }>(
        'select state, loaded_source_ids, attempts, leads from library_gaps where id = $1',
        [gapId],
      )
    ).rows[0];
    if (!r) throw new Error(`library gap ${gapId} not found`);
    return { gapId, state: r.state, loadedSourceIds: r.loaded_source_ids, attempts: r.attempts, leads: r.leads };
  }

  /** India Code: load the named Act when exactly one unrepealed central Act matches. */
  async function actStep(gap: GapRow, deadline: number, attempts: Attempt[], leads: Lead[], loaded: string[]) {
    const at = () => new Date().toISOString();
    if (!gap.act_name) return;
    if (!deps.indiaCode) return void attempts.push({ at: at(), provider: 'india_code', outcome: 'skipped', detail: 'India Code lookup is not set up' });
    const have = (await library.query<{ act_name: string | null }>("select distinct act_name from sources where type = 'act' and status <> 'retired'")).rows;
    if (have.some((h) => h.act_name && sameAct(h.act_name, gap.act_name!))) {
      return void attempts.push({ at: at(), provider: 'india_code', outcome: 'skipped', detail: `${gap.act_name} is already in the library` });
    }
    const wanted = { name: gap.act_name, year: gap.act_year };
    const pick = pickAct(wanted, await deps.indiaCode.findCentralActs(wanted.name));
    if (pick.kind === 'none') return void attempts.push({ at: at(), provider: 'india_code', outcome: 'nothing', detail: `No central Act named "${wanted.name}"${wanted.year ? `, ${wanted.year}` : ''}` });
    if (pick.kind === 'repealed') {
      leads.push({ provider: 'india_code', title: pick.act.title, url: pick.act.pageUrl, lastUpdated: null, checked: true });
      return void attempts.push({ at: at(), provider: 'india_code', outcome: 'repealed', detail: `${pick.act.title} is marked repealed; not loaded` });
    }
    if (pick.kind === 'ambiguous') {
      for (const a of pick.acts) leads.push({ provider: 'india_code', title: a.title, url: a.pageUrl, lastUpdated: null, checked: true });
      return void attempts.push({ at: at(), provider: 'india_code', outcome: 'ambiguous', detail: `${pick.acts.length} Acts match "${wanted.name}"; the editor picks one` });
    }
    if (Date.now() > deadline) return void attempts.push({ at: at(), provider: 'india_code', outcome: 'skipped', detail: 'out of time for this lookup' });

    const act = pick.act;
    const r = await loadIndiaCodeAct(act, { ...deps, indiaCode: deps.indiaCode }, { provisional: true });
    if (r.kind === 'no_pdf') {
      leads.push({ provider: 'india_code', title: act.title, url: act.pageUrl, lastUpdated: null, checked: true });
      return void attempts.push({ at: at(), provider: 'india_code', outcome: 'failed', detail: `${act.title} has no English PDF on India Code` });
    }
    if (r.kind === 'duplicate') {
      return void attempts.push({ at: at(), provider: 'india_code', outcome: 'skipped', detail: `${act.title} is already in the library`, sourceIds: [r.sourceId] });
    }
    loaded.push(r.sourceId);
    attempts.push({ at: at(), provider: 'india_code', outcome: 'loaded', detail: `${act.title}: ${r.units} sections (not yet reviewed)`, sourceIds: [r.sourceId] });
  }

  /** Indian Kanoon: the named case, or the top judgments for the topic. */
  async function judgmentStep(gap: GapRow, deadline: number, attempts: Attempt[], loaded: string[]) {
    const at = () => new Date().toISOString();
    if (!deps.kanoon) return void attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'skipped', detail: 'Indian Kanoon is not set up' });
    const query = gap.kind === 'case' && gap.case_name ? gap.case_name : gap.question;
    let hits = await deps.kanoon.search(query, { doctypes: 'judgments' });
    if (gap.kind === 'case' && gap.case_name) {
      const named = pickCaseHit(gap.case_name, hits);
      hits = named ? [named] : [];
    }
    else hits = hits.slice(0, maxJudgments * 2);
    if (!hits.length) return void attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'nothing', detail: gap.kind === 'case' ? `No judgment titled like "${gap.case_name}"` : 'No judgments found' });

    // One case, one source: skip what the library holds by link (its own or a kept copy), then by case (parties,
    // decision date, court). A judgment that may be a held case is still loaded, and the editor is asked.
    const held = await heldLinks(library, hits.map((h) => kanoonUrl(h.tid)));
    const cases = await heldJudgments(library);
    const checked = hits.filter((h) => !held.has(kanoonUrl(h.tid))).map((h) => ({ h, match: matchHeldCase(h, cases) }));
    const sameCase = checked.filter((x) => x.match?.kind === 'same');
    const fresh = checked.filter((x) => x.match?.kind !== 'same').slice(0, gap.kind === 'case' ? 1 : maxJudgments);
    if (!fresh.length) {
      const names = sameCase.map((x) => x.match!.held.title);
      return void attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'skipped', detail: `The judgments found are already in the library${names.length ? `: ${names.join('; ')}` : ''}` });
    }
    if (Date.now() > deadline) return void attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'skipped', detail: 'out of time for this lookup' });

    const results = await Promise.allSettled(
      fresh.map(async ({ h, match }) => {
        const r = await ingestKanoonJudgment(h.tid, { ...deps, kanoon: deps.kanoon!, storage: deps.storage, cacheDays: deps.cacheDays });
        if (match?.kind === 'maybe' && match.held.sourceId !== r.sourceId) {
          await library.query('update sources set maybe_same_as = $2 where id = $1', [r.sourceId, match.held.sourceId]);
        }
        return { ...r, maybeSameAs: match?.kind === 'maybe' ? match.held.title : null };
      }),
    );
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [errText(r.reason)] : []));
    loaded.push(...ok.map((r) => r.sourceId));
    if (ok.length) attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'loaded', detail: `${ok.map((r) => (r.maybeSameAs ? `${r.caseName} (may be the same case as ${r.maybeSameAs})` : r.caseName)).join('; ')} (not yet reviewed)`, sourceIds: ok.map((r) => r.sourceId) });
    if (failed.length) attempts.push({ at: at(), provider: 'indian_kanoon', outcome: 'failed', detail: failed.join(' | ').slice(0, 300) });
  }

  /** Web: allowlisted official links for the editor. */
  async function webStep(gap: GapRow, attempts: Attempt[], leads: Lead[]) {
    const at = () => new Date().toISOString();
    if (!deps.web) return void attempts.push({ at: at(), provider: 'web', outcome: 'skipped', detail: 'Web search is not set up' });
    const query = gap.act_name && !gap.question.toLowerCase().includes(gap.act_name.toLowerCase()) ? `${gap.question} ${gap.act_name}` : gap.question;
    const found = await deps.web.findLeads(`${query} India law`);
    const checked = found.filter((l) => l.checked);
    leads.push(...checked.map((l) => ({ ...l, provider: 'web' as const })));
    attempts.push({
      at: at(),
      provider: 'web',
      outcome: checked.length ? 'loaded' : 'nothing',
      detail: checked.length ? `${checked.length} official link(s) for the editor (not added to the library)` : 'No official links that open',
    });
  }

  return {
    async run(gapId, opts = {}) {
      const claimed = (
        await library.query<GapRow>(
          `update library_gaps set state = 'looking', last_lookup_at = now()
            where id = $1 and state not in ('resolved', 'wont_fill')
              and (state <> 'looking' or last_lookup_at < now() - interval '15 minutes')
              and ($2::boolean or last_lookup_at is null or last_lookup_at < now() - make_interval(hours => $3))
           returning question, kind, act_name, act_year, case_name, leads, attempts`,
          [gapId, opts.force ?? false, cooldownHours],
        )
      ).rows[0];
      if (!claimed) {
        const now = await current(gapId);
        const skipped = now.state === 'resolved' || now.state === 'wont_fill' ? 'closed' : now.state === 'looking' ? 'busy' : 'recent';
        return { ...now, loadedSourceIds: [], skipped };
      }

      const deadline = Date.now() + budgetMs;
      const attempts: Attempt[] = [];
      const leads: Lead[] = [];
      const loaded: string[] = [];
      const guard = async (provider: Provider, step: () => Promise<void>) => {
        try {
          await step();
        } catch (err) {
          attempts.push({ at: new Date().toISOString(), provider, outcome: 'failed', detail: errText(err) });
        }
      };
      try {
        if (claimed.kind === 'act') await guard('india_code', () => actStep(claimed, deadline, attempts, leads, loaded));
        // Judgments for cases and topics; for an Act gap only when the Act itself could not be loaded.
        if (claimed.kind !== 'act' || loaded.length === 0) await guard('indian_kanoon', () => judgmentStep(claimed, deadline, attempts, loaded));
        if (loaded.length === 0 || claimed.kind === 'topic') await guard('web', () => webStep(claimed, attempts, leads));
      } finally {
        const mergedLeads = [...leads, ...claimed.leads.filter((old) => !leads.some((l) => l.url === old.url))].slice(0, MAX_LEADS_KEPT);
        const allAttempts = [...claimed.attempts, ...attempts].slice(-MAX_ATTEMPTS_KEPT);
        await library.query(
          `update library_gaps
              set state = $2, attempts = $3::jsonb, leads = $4::jsonb,
                  loaded_source_ids = array(select distinct unnest(loaded_source_ids || $5::uuid[]))
            where id = $1`,
          [gapId, loaded.length ? 'loaded' : 'open', JSON.stringify(allAttempts), JSON.stringify(mergedLeads), loaded],
        );
      }
      return { gapId, state: loaded.length ? 'loaded' : 'open', loadedSourceIds: loaded, attempts, leads };
    },

    async settle(gapId, outcome) {
      await library.query(
        `update library_gaps set state = case when $2 = 'ok' then 'answered'::gap_state else 'open'::gap_state end
          where id = $1 and state in ('loaded', 'open')`,
        [gapId, outcome],
      );
    },
  };
}

/** Records a thin or not-found search for the signed-in teacher; runs inside her tenant transaction. */
export async function recordGap(db: pg.PoolClient, question: string, cls: GapClass): Promise<string> {
  const r = await db.query<{ id: string }>('select record_library_gap($1, $2, $3, $4, $5, $6) as id', [
    question.trim().slice(0, 500),
    questionKey(question) || question.trim().toLowerCase().slice(0, 500),
    cls.kind,
    cls.act?.name ?? null,
    cls.act?.year ?? null,
    cls.caseName,
  ]);
  return r.rows[0]!.id;
}

/** Runs `fn` in one short tenant transaction (withTenant bound to the teacher). */
export type TenantRunner = <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>;

export interface SearchWithLookupResult extends SearchResult {
  gap: { id: string; lookup: LookupResult | null; recheck: SearchResult['outcome'] | null } | null;
}

/**
 * The search a lecture build (Day 3), Explore and Research use: search; if thin or not found, record the gap, run the
 * lookup (when given), and search once more. Each step runs in its own short tenant transaction, so no connection is
 * held while sources load. Callers without time for a lookup (an API request) pass `lookup = null` and queue
 * `ingest.lookup` for the gap instead.
 */
export async function searchWithLookup(
  tenant: TenantRunner,
  req: SearchRequest,
  /** Built per transaction, so query costs are logged inside the teacher's own transaction (usage RLS). */
  searchDeps: SearchDeps | ((c: pg.PoolClient) => SearchDeps),
  lookup: GapLookup | null,
): Promise<SearchWithLookupResult> {
  const depsFor = (c: pg.PoolClient) => (typeof searchDeps === 'function' ? searchDeps(c) : searchDeps);
  const first = await tenant((c) => search(c, req, depsFor(c)));
  if (first.outcome === 'ok' || req.purpose === 'eval' || req.purpose === 'suggest') return { ...first, gap: null };

  const gapId = await tenant(async (c) => {
    const acts = (await c.query<{ act_name: string }>("select distinct act_name from sources where type in ('act', 'constitution') and status in ('live', 'provisional') and act_name is not null")).rows;
    return recordGap(c, req.query, classifyGap(req.query, acts.map((a) => a.act_name)));
  });
  if (!lookup) return { ...first, gap: { id: gapId, lookup: null, recheck: null } };

  const ran = await lookup.run(gapId);
  if (ran.loadedSourceIds.length === 0) return { ...first, gap: { id: gapId, lookup: ran, recheck: null } };
  const again = await tenant((c) => search(c, req, depsFor(c)));
  await lookup.settle(gapId, again.outcome);
  return { ...again, gap: { id: gapId, lookup: ran, recheck: again.outcome } };
}
