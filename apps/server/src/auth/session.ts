/**
 * Session (LLD §15.1): a jose HS256 JWT in an HTTP-only cookie, valid 12 h, refreshed at half-life.
 * `chk` records when the user's status was last read from the database (re-read every 5 minutes).
 */
import { SignJWT, jwtVerify } from 'jose';
import type { CookieOptions } from 'express';
import type { TenantIdentity } from '@nyaai/db';

export const SESSION_COOKIE = 'nyaai_session';
export const SESSION_TTL_S = 12 * 60 * 60;
export const STATUS_RECHECK_S = 5 * 60;

export interface Session extends TenantIdentity {
  /** Unix seconds: issued at. */
  iat: number;
  /** Unix seconds: last time status and role were read from the database. */
  chk: number;
}

const key = (secret: string) => new TextEncoder().encode(secret);
const now = () => Math.floor(Date.now() / 1000);

export async function signSession(who: TenantIdentity, secret: string, chk = now()): Promise<string> {
  return new SignJWT({ col: who.collegeId, role: who.role, chk })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(who.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .setAudience('nyaai')
    .sign(key(secret));
}

export async function readSession(token: string, secret: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], audience: 'nyaai' });
    const role = payload.role;
    if (typeof payload.sub !== 'string' || typeof payload.col !== 'string' || typeof payload.iat !== 'number') return null;
    if (role !== 'teacher' && role !== 'admin' && role !== 'library_editor') return null;
    return { userId: payload.sub, collegeId: payload.col, role, iat: payload.iat, chk: Number(payload.chk) || 0 };
  } catch {
    return null;
  }
}

export const needsRefresh = (s: Session) => now() - s.iat > SESSION_TTL_S / 2;
export const needsStatusCheck = (s: Session) => now() - s.chk > STATUS_RECHECK_S;

export function sessionCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_S * 1000 };
}
