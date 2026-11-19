/**
 * CSRF (LLD §15.1): signed double-submit cookie. The cookie `nyaai_csrf` holds `token.signature`, where the
 * signature is an HMAC of the token and the signed-in user id, so a token planted by another site or another
 * account is rejected. Every mutating request must echo the cookie value in `X-CSRF-Token`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { AppError } from '../errors.ts';

export const CSRF_COOKIE = 'nyaai_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const sign = (token: string, userId: string, secret: string) => createHmac('sha256', secret).update(`${token}:${userId}`).digest('base64url');

export function issueCsrf(res: Response, userId: string, secret: string, production: boolean): string {
  const token = randomBytes(24).toString('base64url');
  const value = `${token}.${sign(token, userId, secret)}`;
  res.cookie(CSRF_COOKIE, value, { httpOnly: false, secure: production, sameSite: 'lax', path: '/' });
  return value;
}

export function csrfValid(value: string | undefined, userId: string, secret: string): boolean {
  if (!value) return false;
  const [token, sig] = value.split('.');
  if (!token || !sig) return false;
  const expected = Buffer.from(sign(token, userId, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Runs after requireAuth: mutating requests need a header equal to the cookie, signed for this user. */
export function requireCsrf(secret: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = req.get(CSRF_HEADER);
    if (!req.identity || !cookie || header !== cookie || !csrfValid(cookie, req.identity.userId, secret)) {
      return next(new AppError('FORBIDDEN', 'Your page is out of date. Please reload and try again.'));
    }
    next();
  };
}
