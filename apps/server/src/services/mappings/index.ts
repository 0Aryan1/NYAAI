/**
 * Old ↔ new criminal law mapping rows (DATA-6, HLD 5.2 g, LIB-1): the table the checker reads (C5). Many-to-many;
 * each row has a relation, a note and its official source, and is used only once the criminal-law expert has signed
 * it. Changing a signed row removes the signature. When a SIGNED row is changed, un-signed or removed, the lines that
 * passed C5 on it no longer rest on a signed row: `onSignedChange` is called inside the same transaction (the route
 * queues `ops.mapping_changed`, which re-flags them; see ./reflag.ts). Runs as the library editor (RLS).
 */
import type pg from 'pg';
import { LawMapping, MAPPING_PAIRS, type LawMappingList, type SaveLawMapping } from '@nyaai/shared';
import { AppError } from '../../errors.ts';

export { MAPPING_REASONS, reflagMappingLines, type MappingReflag } from './reflag.ts';

/** Called with the row as lines relied on it, when a signed row changes. */
export type OnSignedChange = (was: LawMapping, change: 'changed' | 'unsigned' | 'removed') => Promise<void>;

interface Row {
  id: string;
  old_act: string;
  new_act: string;
  relation: LawMapping['relation'];
  note: string;
  source_url: string;
  reviewed_at: Date | null;
  signed_by: string | null;
  created_at: Date;
  old: string[] | null;
  new: string[] | null;
}

const SELECT = `select m.id, m.old_act, m.new_act, m.relation, m.note, m.source_url, m.reviewed_at, u.name as signed_by, m.created_at,
                       array_agg(i.section order by i.section) filter (where i.side = 'old') as old,
                       array_agg(i.section order by i.section) filter (where i.side = 'new') as new
                  from law_mappings m left join law_mapping_items i on i.mapping_id = m.id left join users u on u.id = m.reviewed_by`;

const toView = (r: Row): LawMapping =>
  LawMapping.parse({
    id: r.id,
    pair: MAPPING_PAIRS.find((p) => p.old === r.old_act && p.new === r.new_act)?.label ?? `${r.old_act} → ${r.new_act}`,
    oldAct: r.old_act,
    newAct: r.new_act,
    relation: r.relation,
    oldSections: r.old ?? [],
    newSections: r.new ?? [],
    note: r.note,
    sourceUrl: r.source_url,
    signedBy: r.reviewed_at ? (r.signed_by ?? 'Library editor') : null,
    signedAt: r.reviewed_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  });

export async function one(c: pg.PoolClient, id: string): Promise<LawMapping> {
  const r = (await c.query<Row>(`${SELECT} where m.id = $1 group by m.id, u.name`, [id])).rows[0];
  if (!r) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  return toView(r);
}

/** The same pair, the same old sections and the same new sections: one row is enough. */
async function duplicateOf(c: pg.PoolClient, body: SaveLawMapping, except: string | null): Promise<string | null> {
  const pair = MAPPING_PAIRS.find((p) => p.label === body.pair)!;
  const rows = (
    await c.query<Row>(
      `${SELECT} where m.old_act = $1 and m.new_act = $2 and m.id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000') group by m.id, u.name`,
      [pair.old, pair.new, except],
    )
  ).rows;
  const key = (a: string[]) => [...new Set(a)].sort().join(',');
  return (
    rows.find((r) => key(r.old ?? []) === key(body.oldSections) && key(r.new ?? []) === key(body.newSections))?.id ??
    null
  );
}

async function writeItems(c: pg.PoolClient, id: string, body: SaveLawMapping) {
  await c.query('delete from law_mapping_items where mapping_id = $1', [id]);
  for (const [side, list] of [
    ['old', body.oldSections],
    ['new', body.newSections],
  ] as const) {
    for (const s of new Set(list))
      await c.query('insert into law_mapping_items (mapping_id, side, section) values ($1, $2, $3)', [id, side, s]);
  }
}

/** The row as lines relied on it, read and locked in the change's transaction; null when it was not signed. */
async function signedBefore(c: pg.PoolClient, id: string): Promise<LawMapping | null> {
  const r = await c.query('select 1 from law_mappings where id = $1 and reviewed_at is not null for update', [id]);
  return r.rowCount ? one(c, id) : null;
}

const pairOf = (label: SaveLawMapping['pair']) => MAPPING_PAIRS.find((p) => p.label === label)!;

export async function listMappings(c: pg.PoolClient, show: 'unsigned' | 'all'): Promise<LawMappingList> {
  const rows = (
    await c.query<Row>(
      `${SELECT} where ($1 = 'all' or m.reviewed_at is null) group by m.id, u.name order by m.created_at desc`,
      [show],
    )
  ).rows;
  const unsigned = (await c.query<{ n: number }>('select count(*)::int n from law_mappings where reviewed_at is null'))
    .rows[0]!.n;
  return { mappings: rows.map(toView), unsigned };
}

/** A new row, unsigned. The same pair with the same sections is refused. */
export async function createMapping(c: pg.PoolClient, body: SaveLawMapping): Promise<LawMapping> {
  if (await duplicateOf(c, body, null))
    throw new AppError('ALREADY_IN_LIBRARY', 'A row with these sections is already in the table.');
  const pair = pairOf(body.pair);
  const id = (
    await c.query<{ id: string }>(
      'insert into law_mappings (old_act, new_act, relation, note, source_url) values ($1, $2, $3, $4, $5) returning id',
      [pair.old, pair.new, body.relation, body.note, body.sourceUrl],
    )
  ).rows[0]!.id;
  await writeItems(c, id, body);
  return one(c, id);
}

/** A changed row is a new statement of the law: the signature goes, and the expert signs it again. */
export async function changeMapping(
  c: pg.PoolClient,
  id: string,
  body: SaveLawMapping,
  onSignedChange: OnSignedChange,
): Promise<LawMapping> {
  if (await duplicateOf(c, body, id))
    throw new AppError('ALREADY_IN_LIBRARY', 'A row with these sections is already in the table.');
  const was = await signedBefore(c, id);
  const pair = pairOf(body.pair);
  const n = (
    await c.query(
      'update law_mappings set old_act = $2, new_act = $3, relation = $4, note = $5, source_url = $6, reviewed_by = null, reviewed_at = null where id = $1',
      [id, pair.old, pair.new, body.relation, body.note, body.sourceUrl],
    )
  ).rowCount;
  if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  await writeItems(c, id, body);
  if (was) await onSignedChange(was, 'changed');
  return one(c, id);
}

/** The criminal-law expert signs the row (who and when are kept). */
export async function signMapping(c: pg.PoolClient, id: string): Promise<LawMapping> {
  const n = (await c.query('update law_mappings set reviewed_by = app_user(), reviewed_at = now() where id = $1', [id]))
    .rowCount;
  if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  return one(c, id);
}

export async function unsignMapping(c: pg.PoolClient, id: string, onSignedChange: OnSignedChange): Promise<LawMapping> {
  const was = await signedBefore(c, id);
  const n = (await c.query('update law_mappings set reviewed_by = null, reviewed_at = null where id = $1', [id]))
    .rowCount;
  if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  if (was) await onSignedChange(was, 'unsigned');
  return one(c, id);
}

export async function removeMapping(c: pg.PoolClient, id: string, onSignedChange: OnSignedChange): Promise<void> {
  const was = await signedBefore(c, id);
  const n = (await c.query('delete from law_mappings where id = $1', [id])).rowCount;
  if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  if (was) await onSignedChange(was, 'removed');
}
