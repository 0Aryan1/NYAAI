/**
 * Old ↔ new criminal law mapping rows, kept by the library editor (DATA-6, HLD 5.2 g, LIB-1).
 *   GET    /library/mappings?show=unsigned|all   rows, newest first; unsigned count
 *   POST   /library/mappings                     a new row (unsigned)
 *   PATCH  /library/mappings/:id                 change a row: its signature is removed, it must be signed again
 *   POST   /library/mappings/:id/sign            the criminal-law expert signs it (who and when are kept)
 *   DELETE /library/mappings/:id/sign            undo a signature
 *   DELETE /library/mappings/:id                 remove a row
 * The checker (C5) uses signed rows only: an unsigned or missing row makes an old/new line "Mapping not confirmed".
 * When a SIGNED row is changed, un-signed or removed, lines that passed C5 on it no longer rest on a signed row: the
 * change queues `ops.mapping_changed` (after the commit), which turns them yellow for their teachers (migration 0021).
 */
import express from 'express';
import type { Queue } from 'bullmq';
import type pg from 'pg';
import { z } from 'zod';
import { LawMapping, LawMappingList, MAPPING_PAIRS, SaveLawMapping } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { requireRole } from '../middleware/auth.ts';
import { MAPPING_JOB_OPTIONS, type OpsJobData } from '../jobs/queues.ts';

const Id = z.uuid();

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

async function one(c: pg.PoolClient, id: string): Promise<LawMapping> {
  const r = (await c.query<Row>(`${SELECT} where m.id = $1 group by m.id, u.name`, [id])).rows[0];
  if (!r) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
  return toView(r);
}

/** The same pair, the same old sections and the same new sections: one row is enough. */
async function duplicateOf(c: pg.PoolClient, body: SaveLawMapping, except: string | null): Promise<string | null> {
  const pair = MAPPING_PAIRS.find((p) => p.label === body.pair)!;
  const rows = (await c.query<Row>(`${SELECT} where m.old_act = $1 and m.new_act = $2 and m.id <> coalesce($3::uuid, '00000000-0000-0000-0000-000000000000') group by m.id, u.name`, [pair.old, pair.new, except])).rows;
  const key = (a: string[]) => [...new Set(a)].sort().join(',');
  return rows.find((r) => key(r.old ?? []) === key(body.oldSections) && key(r.new ?? []) === key(body.newSections))?.id ?? null;
}

async function writeItems(c: pg.PoolClient, id: string, body: SaveLawMapping) {
  await c.query('delete from law_mapping_items where mapping_id = $1', [id]);
  for (const [side, list] of [['old', body.oldSections], ['new', body.newSections]] as const) {
    for (const s of new Set(list)) await c.query('insert into law_mapping_items (mapping_id, side, section) values ($1, $2, $3)', [id, side, s]);
  }
}

export function mappingsRouter(opsQueue?: Queue<OpsJobData>) {
  const r = express.Router();
  r.use('/library/mappings', requireRole('library_editor'));

  /**
   * The row as lines relied on it, read and locked in the change's own transaction; null when it was not signed (an
   * unsigned row supported nothing).
   */
  const signedBefore = async (c: pg.PoolClient, id: string): Promise<LawMapping | null> =>
    (await c.query('select 1 from law_mappings where id = $1 and reviewed_at is not null for update', [id])).rowCount ? one(c, id) : null;
  /**
   * Queued inside the change's transaction, before it commits. If the commit then fails, lines are only checked again
   * without need (the safe side); a job lost after a commit would leave lines green with no signed row under them.
   */
  const reflag = async (req: express.Request, was: LawMapping | null, change: 'changed' | 'unsigned' | 'removed') => {
    if (!was) return;
    if (!opsQueue) throw new AppError('SERVICE_UNAVAILABLE', 'Lectures that rely on this row cannot be told right now, so nothing was changed. Try again in a minute.');
    const who = req.identity!;
    await opsQueue.add(
      'ops.mapping_changed',
      { userId: who.userId, collegeId: who.collegeId, mapping: { oldSections: was.oldSections, newSections: was.newSections, relation: was.relation, change } },
      MAPPING_JOB_OPTIONS,
    );
  };

  r.get('/library/mappings', async (req, res) => {
    const show = z.enum(['unsigned', 'all']).catch('unsigned').parse(req.query.show);
    const out = await req.db!(async (c) => ({
      rows: (await c.query<Row>(`${SELECT} where ($1 = 'all' or m.reviewed_at is null) group by m.id, u.name order by m.created_at desc`, [show])).rows,
      unsigned: (await c.query<{ n: number }>('select count(*)::int n from law_mappings where reviewed_at is null')).rows[0]!.n,
    }));
    res.json(LawMappingList.parse({ mappings: out.rows.map(toView), unsigned: out.unsigned }));
  });

  r.post('/library/mappings', async (req, res) => {
    const body = SaveLawMapping.parse(req.body);
    const pair = MAPPING_PAIRS.find((p) => p.label === body.pair)!;
    const row = await req.db!(async (c) => {
      if (await duplicateOf(c, body, null)) throw new AppError('ALREADY_IN_LIBRARY', 'A row with these sections is already in the table.');
      const id = (
        await c.query<{ id: string }>('insert into law_mappings (old_act, new_act, relation, note, source_url) values ($1, $2, $3, $4, $5) returning id', [pair.old, pair.new, body.relation, body.note, body.sourceUrl])
      ).rows[0]!.id;
      await writeItems(c, id, body);
      return one(c, id);
    });
    res.status(201).json(row);
  });

  r.patch('/library/mappings/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const body = SaveLawMapping.parse(req.body);
    const pair = MAPPING_PAIRS.find((p) => p.label === body.pair)!;
    const row = await req.db!(async (c) => {
      if (await duplicateOf(c, body, id)) throw new AppError('ALREADY_IN_LIBRARY', 'A row with these sections is already in the table.');
      const was = await signedBefore(c, id);
      // A changed row is a new statement of the law: the signature goes, and the expert signs it again.
      const n = (
        await c.query('update law_mappings set old_act = $2, new_act = $3, relation = $4, note = $5, source_url = $6, reviewed_by = null, reviewed_at = null where id = $1', [id, pair.old, pair.new, body.relation, body.note, body.sourceUrl])
      ).rowCount;
      if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
      await writeItems(c, id, body);
      await reflag(req, was, 'changed');
      return one(c, id);
    });
    res.json(row);
  });

  r.post('/library/mappings/:id/sign', async (req, res) => {
    const id = Id.parse(req.params.id);
    const row = await req.db!(async (c) => {
      const n = (await c.query('update law_mappings set reviewed_by = app_user(), reviewed_at = now() where id = $1', [id])).rowCount;
      if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
      return one(c, id);
    });
    res.json(row);
  });

  r.delete('/library/mappings/:id/sign', async (req, res) => {
    const id = Id.parse(req.params.id);
    const row = await req.db!(async (c) => {
      const was = await signedBefore(c, id);
      const n = (await c.query('update law_mappings set reviewed_by = null, reviewed_at = null where id = $1', [id])).rowCount;
      if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
      await reflag(req, was, 'unsigned');
      return one(c, id);
    });
    res.json(row);
  });

  r.delete('/library/mappings/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    await req.db!(async (c) => {
      const was = await signedBefore(c, id);
      const n = (await c.query('delete from law_mappings where id = $1', [id])).rowCount;
      if (!n) throw new AppError('NOT_FOUND', 'We could not find that mapping row.');
      await reflag(req, was, 'removed');
    });
    res.status(204).end();
  });

  return r;
}
