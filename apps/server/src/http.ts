import type pg from 'pg';
import type { TenantIdentity } from '@nyaai/db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth from the session cookie. */
      identity?: TenantIdentity;
      /** Runs `fn` in one transaction with the teacher's identity set by SET LOCAL (LLD §3.7). */
      db?: <T>(fn: (c: pg.PoolClient) => Promise<T>) => Promise<T>;
    }
  }
}

export {};
