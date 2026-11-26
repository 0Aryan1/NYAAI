/**
 * A signed law-mapping row was changed, un-signed or removed: the lecture lines that passed C5 on it turn yellow for
 * their teachers (migration 0021). Runs in the `ops.mapping_changed` job as the library editor who made the change.
 */
import type pg from 'pg';
import { withTenant } from '@nyaai/db';
import type { MappingRelation } from '@nyaai/shared';

export interface MappingReflag {
  linesFlagged: number;
  lectures: number;
}

export const MAPPING_REASONS = {
  changed: 'The library changed the old-to-new law mapping this line relied on; check this line again',
  unsigned: 'The old-to-new law mapping this line relied on is no longer signed by the expert; check this line again',
  removed: 'The library removed the old-to-new law mapping this line relied on; check this line again',
} as const;

export async function reflagMappingLines(
  worker: pg.Pool,
  editor: { userId: string; collegeId: string },
  row: { oldSections: string[]; newSections: string[]; relation: MappingRelation; change: keyof typeof MAPPING_REASONS },
): Promise<MappingReflag> {
  return withTenant(worker, { ...editor, role: 'library_editor' }, async (c) => {
    const r = await c.query<{ out: MappingReflag }>('select reflag_mapping_lines($1::text[], $2::text[], $3::mapping_relation, $4) as out', [
      row.oldSections.map((s) => s.toUpperCase()),
      row.newSections.map((s) => s.toUpperCase()),
      row.relation,
      MAPPING_REASONS[row.change],
    ]);
    return r.rows[0]!.out;
  });
}
