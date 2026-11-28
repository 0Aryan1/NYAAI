/**
 * The background check of lines she changed (`check.lines`, LLD §5, §8.6): C9, and C10 for high-risk lines, run
 * after her edit is saved, so checking never blocks her typing. Runs as a worker job acting for her.
 */
import type pg from 'pg';
import { decide } from '@nyaai/checker-rules';
import { checkClaims } from '../build/checking.ts';
import type { Gateway } from '../llm-gateway/index.ts';
import type { UsageSink } from '../usage/index.ts';
import { CHANGED, mappings, sourcesFor, type CitationRow } from './index.ts';

/**
 * check.lines (LLD §5, §8.6): C9 for each changed line still waiting, and C10 for high-risk ones, against the words it
 * rests on. A pass turns the line supported; anything else keeps it yellow with the reason. Never blocks her typing.
 */
export async function checkEditedLines(
  tenant: <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>,
  citationIds: string[],
  deps: { gateway: Gateway; usage: UsageSink },
): Promise<number> {
  const loaded = await tenant(async (c) => {
    const rows = (
      await c.query<CitationRow & { claim_text: string }>(
        "select id, line_key, claim_type, source_id, chunk_id, span_text, source_label, source_relevance, tag, risk, part_index, claim_text from citations where id = any($1::uuid[]) and check_status = 'open' and flag_reason = $2",
        [citationIds, CHANGED],
      )
    ).rows;
    return {
      rows,
      sources: await sourcesFor(c, rows.map((r) => r.chunk_id!).filter(Boolean)),
      maps: await mappings(c),
    };
  });
  let done = 0;
  for (const r of loaded.rows) {
    const src = loaded.sources.get(r.chunk_id!);
    if (!src) continue;
    const [checked] = await checkClaims(
      [{ id: r.id, claim: { text: r.claim_text, type: r.claim_type, tag: src.tag, span: r.span_text } }],
      new Map([[src.tag, src]]),
      loaded.maps,
      deps,
    );
    const d = decide(checked!.results);
    await tenant((c) =>
      c.query(
        "update citations set check_status = $2, checks = $3, flag_kind = $4, flag_reason = $5 where id = $1 and check_status = 'open' and flag_reason = $6",
        [r.id, d.status, JSON.stringify(checked!.results), d.flag, d.reason, CHANGED],
      ),
    );
    done += 1;
  }
  return done;
}
