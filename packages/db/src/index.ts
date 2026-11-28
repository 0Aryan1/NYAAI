import pg from 'pg';

export interface TenantIdentity {
  userId: string;
  collegeId: string;
  role: 'teacher' | 'admin' | 'library_editor';
}

/** Creates a pooled connection. All teacher data access must go through `withTenant` (LLD §3.7). */
export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

/**
 * Runs `fn` inside one transaction whose first statement sets the tenant identity with
 * set_config(..., true) — i.e. SET LOCAL — so a pooled connection never carries one teacher's
 * identity into another request. Queries outside this wrapper see no teacher rows under RLS.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  who: TenantIdentity,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      "select set_config('app.user_id', $1, true), set_config('app.college_id', $2, true), set_config('app.role', $3, true)",
      [who.userId, who.collegeId, who.role],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
