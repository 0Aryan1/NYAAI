import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { withTenant } from './index.ts';

function fakePool(fail = false) {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      if (fail && sql.startsWith('select 1')) throw new Error('boom');
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client } as unknown as pg.Pool, calls, client };
}

const who = {
  userId: '00000000-0000-0000-0000-000000000001',
  collegeId: '00000000-0000-0000-0000-000000000002',
  role: 'teacher' as const,
};

describe('withTenant', () => {
  it('sets identity transaction-locally before running the work, then commits', async () => {
    const { pool, calls, client } = fakePool();
    await withTenant(pool, who, (c) => c.query('select 1'));
    expect(calls).toEqual(['begin', "select set_config('app.user_id',", 'select 1', 'commit']);
    expect(client.query.mock.calls[1]?.[0]).toContain("set_config('app.role', $3, true)");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases on error', async () => {
    const { pool, calls, client } = fakePool(true);
    await expect(withTenant(pool, who, (c) => c.query('select 1'))).rejects.toThrow('boom');
    expect(calls.at(-1)).toBe('rollback');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
