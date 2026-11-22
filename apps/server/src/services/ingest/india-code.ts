/**
 * Load one central Act from India Code into the shared library: the official English PDF, stages 1–7.
 * Used by the gap lookup (provisional: no person chose the Act) and by course packs (a person listed the Act by
 * name and year, so the official text goes live like any official upload).
 */
import { libraryActName } from '@nyaai/legal';
import type { IndiaCode, IndiaCodeAct } from '../india-code/index.ts';
import type { Storage } from '../storage/index.ts';
import { finishSource, type FinishDeps } from './finish.ts';
import { ingestSource } from './source.ts';

export interface IndiaCodeLoadDeps extends FinishDeps {
  storage: Storage;
  indiaCode: IndiaCode;
}

export type IndiaCodeLoad =
  | { kind: 'loaded'; sourceId: string; units: number; missing: number[] }
  | { kind: 'duplicate'; sourceId: string }
  | { kind: 'no_pdf' };

export async function loadIndiaCodeAct(act: IndiaCodeAct, deps: IndiaCodeLoadDeps, opts: { provisional: boolean }): Promise<IndiaCodeLoad> {
  const { library } = deps;
  const pdf = await deps.indiaCode.englishPdf(act.itemId);
  if (!pdf) return { kind: 'no_pdf' };
  const sourceId =
    (await library.query<{ id: string }>("select id from sources where origin = 'india_code' and url = $1 and status <> 'retired' limit 1", [pdf])).rows[0]?.id ??
    (
      await library.query<{ id: string }>(
        `insert into sources (college_id, visibility, type, origin, title, act_name, act_year, url, content_hash)
         values (global_college(), 'shared', 'act', 'india_code', $1, $2, $3, $4, 'pending:' || gen_random_uuid()) returning id`,
        [act.title, libraryActName(act.title), act.year, pdf],
      )
    ).rows[0]!.id;
  const split = await ingestSource(sourceId, { library, storage: deps.storage, progress: deps.progress });
  if (split.kind === 'duplicate') return { kind: 'duplicate', sourceId: split.duplicateOf };
  await finishSource(sourceId, { ...deps, provisional: opts.provisional });
  return { kind: 'loaded', sourceId, units: split.units, missing: split.missing };
}
