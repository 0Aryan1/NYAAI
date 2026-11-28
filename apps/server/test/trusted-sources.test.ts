/** India Code and web-search clients with a fake fetch: request shape, parsing, and the allowlist and link checks. */
import { describe, expect, it } from 'vitest';
import { createIndiaCode } from '../src/services/india-code/index.ts';
import { createWebSearch } from '../src/services/web-search/index.ts';
import type { UsageRow } from '../src/services/usage.ts';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const md = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [{ value: v }]]));

describe('India Code client', () => {
  it('searches central Acts by exact title, and takes the year from the title (India Code may file it under another)', async () => {
    const urls: string[] = [];
    const ic = createIndiaCode({
      fetchImpl: (async (url: string) => {
        urls.push(url);
        return json({
          _embedded: {
            searchResult: {
              _embedded: {
                objects: [
                  {
                    _embedded: {
                      indexableObject: {
                        uuid: '76ce35a9-34b1-4929-8e21-82befadea2f8',
                        name: 'The Sale of Goods Act, 1930',
                        handle: '123456789/496436',
                        metadata: md({
                          'dc.title': 'The Sale of Goods Act, 1930',
                          'dc.date.act_year': '1931',
                          'dc.identifier.act_number': '3',
                          'dc.identifier.repealed': 'false',
                        }),
                      },
                    },
                  },
                ],
              },
            },
          },
        });
      }) as typeof fetch,
    });
    const acts = await ic.findCentralActs('The "Sale of Goods" Act');
    expect(decodeURIComponent(urls[0]!)).toContain(
      'dc.identifier.collection:ACT AND dc.identifier.state_name:CENTRAL AND dc.title:"Sale of Goods Act"&',
    );
    expect(acts).toEqual([
      {
        itemId: '76ce35a9-34b1-4929-8e21-82befadea2f8',
        title: 'The Sale of Goods Act, 1930',
        year: 1930,
        actNumber: '3',
        repealed: false,
        pageUrl: 'https://indiacode.gov.in/handle/123456789/496436',
      },
    ]);
  });

  it('picks the English PDF, not the Hindi one', async () => {
    const ic = createIndiaCode({
      fetchImpl: (async () =>
        json({
          _embedded: {
            bundles: {
              _embedded: {
                bundles: [
                  {
                    name: 'TEXT',
                    _embedded: { bitstreams: { _embedded: { bitstreams: [{ uuid: 't', name: 'a1930-03.pdf.txt' }] } } },
                  },
                  {
                    name: 'ORIGINAL',
                    _embedded: {
                      bitstreams: {
                        _embedded: {
                          bitstreams: [
                            { uuid: 'hin', name: 'H1930-3.pdf' },
                            { uuid: 'eng', name: 'a1930-03.pdf' },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        })) as typeof fetch,
    });
    expect(await ic.englishPdf('76ce35a9-34b1-4929-8e21-82befadea2f8')).toBe(
      'https://indiacode.gov.in/server/api/core/bitstreams/eng/content',
    );
    await expect(ic.englishPdf('../../etc')).rejects.toThrow(/uuid/);
  });
});

describe('web search (leads for the editor)', () => {
  it('asks only allowlisted domains, drops anything else, keeps only links that open, and logs the cost', async () => {
    const usage: UsageRow[] = [];
    let sent: { search_domain_filter?: string[] } = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/search')) {
        sent = JSON.parse(String(init?.body));
        return json({
          results: [
            {
              title: 'Sale of Goods Act, 1930 - India Code',
              url: 'https://www.indiacode.nic.in/handle/123456789/2390',
              last_updated: '2026-09-20',
            },
            { title: 'Blog', url: 'https://lawblog.example.com/sga' },
            { title: 'Look-alike', url: 'https://gov.in.evil.example/x' },
            { title: 'Gone', url: 'https://old.gov.in/missing' },
          ],
        });
      }
      if (url.includes('missing')) return new Response('', { status: 404 });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;
    const web = createWebSearch(
      { apiKey: 'k', allowlist: ['gov.in', 'nic.in'], fetchImpl },
      async (u) => void usage.push(u),
    );
    const leads = await web.findLeads('passing of property Sale of Goods Act');
    expect(sent.search_domain_filter).toEqual(['gov.in', 'nic.in']);
    expect(leads.map((l) => [l.url, l.checked])).toEqual([
      ['https://www.indiacode.nic.in/handle/123456789/2390', true],
      ['https://old.gov.in/missing', false],
    ]);
    expect(usage).toEqual([{ provider: 'perplexity', purpose: 'web.leads', units: 1, costMicroUsd: 5_000 }]);
  });
});
