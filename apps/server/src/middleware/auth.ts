/**
 * requireAuth: reads the session cookie, re-reads status and role every 5 minutes (a removed teacher loses
 * access quickly), refreshes the cookie at half-life, and gives the request its tenant transaction helper
 * `req.db`, which sets the identity with SET LOCAL inside every transaction (LLD §3.7, §4.1).
 */
import type { RequestHandler } from 'express';
import type pg from 'pg';
import { withTenant, type TenantIdentity } from '@nyaai/db';
import type { Role } from '@nyaai/shared';
import { AppError } from '../errors.ts';
import { SESSION_COOKIE, needsRefresh, needsStatusCheck, readSession, sessionCookieOptions, signSession } from '../auth/session.ts';

export interface AuthDeps {
  pool: pg.Pool;
  sessionSecret: string;
  production: boolean;
}

export function requireAuth({ pool, sessionSecret, production }: AuthDeps): RequestHandler {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = token ? await readSession(token, sessionSecret) : null;
    if (!session) return next(new AppError('NOT_SIGNED_IN', 'Please sign in.'));

    let who: TenantIdentity = { userId: session.userId, collegeId: session.collegeId, role: session.role };
    let reissue = needsRefresh(session);
    if (needsStatusCheck(session)) {
      const row = await withTenant(pool, who, async (c) =>
        (await c.query<{ status: string; role: TenantIdentity['role'] }>('select status, role from users where id = app_user()')).rows[0],
      );
      if (!row || row.status !== 'active') {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return next(new AppError('NOT_SIGNED_IN', 'Your access has ended. Please contact your college admin.'));
      }
      who = { ...who, role: row.role };
      reissue = true;
    }
    if (reissue) res.cookie(SESSION_COOKIE, await signSession(who, sessionSecret), sessionCookieOptions(production));

    req.identity = who;
    req.db = (fn) => withTenant(pool, who, fn);
    next();
  };
}

/** Second lock after RLS: the handler checks the role too (LLD §4.1, "enforced twice"). */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.identity || !roles.includes(req.identity.role)) {
      return next(new AppError('FORBIDDEN', 'You do not have access to this.'));
    }
    next();
  };
}
