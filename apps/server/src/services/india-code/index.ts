/**
 * India Code (indiacode.gov.in, DSpace 7 public REST API): finds a central Act by its name and returns the link to
 * its official English PDF. Free and official; the only module that talks to India Code.
 *
 * - Search: discover/search/objects with `collection:ACT AND state_name:CENTRAL AND title:"…"` (each section is
 *   also an item, so the ACT collection filter matters).
 * - File: the item's ORIGINAL bundle; the English PDF is `a<year>-<no>.pdf` (`H…pdf` is the Hindi text).
 * Queries carry only an Act name taken from the teacher's own words (LLD §17.6 rule 2).
 */
import type { ActCandidate } from '@nyaai/legal';

export interface IndiaCodeAct extends ActCandidate {
  itemId: string;
  actNumber: string | null;
  /** Human page for the editor. */
  pageUrl: string;
}

export interface IndiaCode {
  /** Central Acts whose title contains the name; `year` is the year in the Act's title (the caller compares it). */
  findCentralActs(name: string): Promise<IndiaCodeAct[]>;
  /** https link to the English PDF, or null when the item has none. */
  englishPdf(itemId: string): Promise<string | null>;
}

export interface IndiaCodeConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface MetaValue {
  value: string;
}
interface SearchBody {
  _embedded?: {
    searchResult?: {
      _embedded?: { objects?: { _embedded?: { indexableObject?: { uuid: string; name: string; handle?: string; metadata?: Record<string, MetaValue[]> } } }[] };
    };
  };
}
interface ItemBody {
  _embedded?: { bundles?: { _embedded?: { bundles?: { name: string; _embedded?: { bitstreams?: { _embedded?: { bitstreams?: { uuid: string; name: string }[] } } } }[] } } };
}

const first = (md: Record<string, MetaValue[]> | undefined, key: string) => md?.[key]?.[0]?.value ?? null;
/** Keep the words of a name only: no quotes, colons or query syntax reach the search. */
const safeName = (s: string) => s.replace(/^the\s+/i, '').replace(/[^A-Za-z0-9 ()&'-]+/g, ' ').replace(/\s+/g, ' ').trim();

export function createIndiaCode(cfg: IndiaCodeConfig = {}): IndiaCode {
  const base = cfg.baseUrl ?? 'https://indiacode.gov.in';
  const doFetch = cfg.fetchImpl ?? fetch;

  async function getJson<T>(path: string): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      headers: { accept: 'application/json', 'user-agent': 'NYAAI-library-loader/0.1' },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`India Code ${path.split('?')[0]} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async findCentralActs(name) {
      const title = safeName(name);
      if (title.length < 3) return [];
      // No act_year filter: India Code files some Acts under the year of their Act number, not the year in their
      // name (the Gram Nyayalayas Act, 2008 is Act 4 of 2009, filed as 2009). The year is read from the title
      // instead, and pickAct compares it.
      const q = ['dc.identifier.collection:ACT', 'dc.identifier.state_name:CENTRAL', `dc.title:"${title}"`].join(' AND ');
      const body = await getJson<SearchBody>(`/server/api/discover/search/objects?query=${encodeURIComponent(q)}&dsoType=ITEM&size=20`);
      return (body._embedded?.searchResult?._embedded?.objects ?? []).flatMap((o) => {
        const it = o._embedded?.indexableObject;
        if (!it) return [];
        const md = it.metadata;
        const actTitle = first(md, 'dc.title') ?? it.name;
        const titleYear = /,?\s*((?:1[789]|20)\d\d)\.?\s*$/.exec(actTitle)?.[1];
        const y = Number(titleYear ?? first(md, 'dc.date.act_year'));
        return [
          {
            itemId: it.uuid,
            title: actTitle,
            year: Number.isFinite(y) && y > 0 ? y : null,
            actNumber: first(md, 'dc.identifier.act_number'),
            repealed: first(md, 'dc.identifier.repealed') === 'true',
            pageUrl: it.handle ? `${base}/handle/${it.handle}` : `${base}/items/${it.uuid}`,
          },
        ];
      });
    },

    async englishPdf(itemId) {
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new Error('India Code item id is not a uuid');
      const body = await getJson<ItemBody>(`/server/api/core/items/${itemId}?embed=bundles/bitstreams`);
      const original = body._embedded?.bundles?._embedded?.bundles?.find((b) => b.name === 'ORIGINAL');
      const files = original?._embedded?.bitstreams?._embedded?.bitstreams ?? [];
      const english = files.find((f) => /^a\d{4}-\d+\.pdf$/i.test(f.name)) ?? files.find((f) => /\.pdf$/i.test(f.name) && !/^h/i.test(f.name));
      return english ? `${base}/server/api/core/bitstreams/${english.uuid}/content` : null;
    },
  };
}
