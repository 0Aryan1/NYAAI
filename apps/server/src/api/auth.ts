/**
 * Auth group (LLD §4.2): Google sign-in, the development-only stub login, logout, and the options the
 * login page needs. Users are looked up through the narrow security-definer helpers, because no identity
 * exists yet at sign-in (LLD §3.7).
 */
import express, { type Response } from 'express';
import type pg from 'pg';
import type { Redis } from 'ioredis';
import { AuthOptions, DevLoginRequest } from '@nyaai/shared';
import type { TenantIdentity } from '@nyaai/db';
import type { Config } from '../config.ts';
import { AppError } from '../errors.ts';
import { readSession, SESSION_COOKIE, sessionCookieOptions, signSession } from '../auth/session.ts';
import { CSRF_COOKIE, csrfValid, issueCsrf } from '../auth/csrf.ts';
import { FLOW_COOKIE, checkGoogleClaims, type GoogleSignIn } from '../auth/google.ts';
import { signInLimit } from '../middleware/rate-limit.ts';

interface FoundUser {
  id: string;
  college_id: string;
  role: TenantIdentity['role'];
  status: string;
}

type SignInResult = { ok: true; who: TenantIdentity } | { ok: false; reason: 'not_invited' | 'removed' };

/** Existing user, or an open invite turned into a user on first sign-in. */
async function findOrAcceptUser(
  pool: pg.Pool,
  email: string,
  name: string,
  googleSub: string | null,
): Promise<SignInResult> {
  let row = (await pool.query<FoundUser>('select * from auth_find_user($1)', [email])).rows[0];
  row ??= (await pool.query<FoundUser>('select * from auth_accept_invite($1, $2, $3)', [email, name, googleSub]))
    .rows[0];
  if (!row) return { ok: false, reason: 'not_invited' };
  if (row.status !== 'active') return { ok: false, reason: 'removed' };
  return { ok: true, who: { userId: row.id, collegeId: row.college_id, role: row.role } };
}

export function domainAllowed(email: string, allowed: string[]): boolean {
  const domain = email.toLowerCase().split('@')[1] ?? '';
  return allowed.length === 0 || allowed.map((d) => d.toLowerCase()).includes(domain);
}

export interface AuthRouterDeps {
  config: Config;
  pool: pg.Pool;
  redis: Redis;
  google: GoogleSignIn | null;
}

export function authRouter({ config, pool, redis, google }: AuthRouterDeps) {
  const r = express.Router();
  const production = config.NODE_ENV === 'production';
  const devLogin = config.DEV_LOGIN && config.NODE_ENV === 'development';

  async function startSession(res: Response, who: TenantIdentity) {
    res.cookie(SESSION_COOKIE, await signSession(who, config.SESSION_SECRET), sessionCookieOptions(production));
    issueCsrf(res, who.userId, config.CSRF_SECRET, production);
  }

  r.get('/auth/options', (_req, res) => {
    res.json(AuthOptions.parse({ google: google !== null, devLogin }));
  });

  if (devLogin) {
    r.post('/auth/dev-login', signInLimit(redis, config.SIGNIN_LIMIT_PER_MIN), async (req, res) => {
      const { email } = DevLoginRequest.parse(req.body);
      if (!domainAllowed(email, config.ALLOWED_EMAIL_DOMAINS)) {
        throw new AppError('FORBIDDEN', 'Please use your college email address.');
      }
      const result = await findOrAcceptUser(pool, email, email.split('@')[0]!, null);
      if (!result.ok) {
        throw new AppError(
          'FORBIDDEN',
          result.reason === 'removed' ? 'Your access has ended.' : 'This email has not been invited yet.',
        );
      }
      await startSession(res, result.who);
      res.status(204).end();
    });
  }

  r.get('/auth/google', signInLimit(redis, config.SIGNIN_LIMIT_PER_MIN), async (_req, res) => {
    if (!google) throw new AppError('SERVICE_UNAVAILABLE', "Google sign-in isn't set up yet.");
    const { url, flowCookie } = await google.start();
    res.cookie(FLOW_COOKIE, flowCookie, {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(302, url);
  });

  r.get('/auth/google/callback', signInLimit(redis, config.SIGNIN_LIMIT_PER_MIN), async (req, res) => {
    const fail = (reason: string) =>
      res.redirect(302, `${config.WEB_ORIGIN}/login?error=${encodeURIComponent(reason)}`);
    if (!google) return fail('not_configured');
    const flow = req.cookies?.[FLOW_COOKIE] as string | undefined;
    res.clearCookie(FLOW_COOKIE, { path: '/api/v1/auth' });
    if (!flow) return fail('expired');
    let claims;
    try {
      claims = await google.finish(new URL(req.originalUrl, config.WEB_ORIGIN), flow);
    } catch (err) {
      req.log?.warn({ err }, 'google sign-in failed');
      return fail('google_failed');
    }
    const check = checkGoogleClaims(claims, config.ALLOWED_EMAIL_DOMAINS, { requireHd: !config.GOOGLE_SKIP_HD_CHECK });
    if (!check.ok) return fail(check.reason);
    const result = await findOrAcceptUser(pool, check.email, check.name, check.sub);
    if (!result.ok) return fail(result.reason);
    await startSession(res, result.who);
    res.redirect(302, `${config.WEB_ORIGIN}/`);
  });

  /**
   * Sign out. While her session is valid, the CSRF token must come with it (another site cannot sign her out); a
   * session that has already expired or is gone has nothing to protect, so its cookies are simply cleared.
   */
  r.post('/auth/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const session = token ? await readSession(token, config.SESSION_SECRET) : null;
    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (
      session &&
      (!cookie || req.get('x-csrf-token') !== cookie || !csrfValid(cookie, session.userId, config.CSRF_SECRET))
    )
      throw new AppError('FORBIDDEN', 'Your page is out of date. Please reload and try again.');
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    res.status(204).end();
  });

  return r;
}
