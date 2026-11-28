import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { checkGoogleClaims } from '../src/auth/google.ts';
import { csrfValid, issueCsrf } from '../src/auth/csrf.ts';
import { readSession, signSession } from '../src/auth/session.ts';
import { domainAllowed } from '../src/api/auth.ts';

const ok = { email: 'Teacher@CNLU.ac.in', email_verified: true, hd: 'cnlu.ac.in', sub: '123', name: 'Dr. Teacher' };

describe('Google claim checks (LLD §15.1)', () => {
  it('accepts a verified CNLU Workspace account', () => {
    expect(checkGoogleClaims(ok, ['cnlu.ac.in'])).toEqual({
      ok: true,
      email: 'teacher@cnlu.ac.in',
      name: 'Dr. Teacher',
      sub: '123',
    });
  });
  it('rejects unverified emails, other domains, and a missing or different hd claim', () => {
    expect(checkGoogleClaims({ ...ok, email_verified: false }, ['cnlu.ac.in'])).toMatchObject({
      reason: 'email_unverified',
    });
    expect(checkGoogleClaims({ ...ok, email: 'x@gmail.com', hd: undefined }, ['cnlu.ac.in'])).toMatchObject({
      reason: 'domain_not_allowed',
    });
    expect(checkGoogleClaims({ ...ok, hd: undefined }, ['cnlu.ac.in'])).toMatchObject({ reason: 'hd_mismatch' });
    expect(checkGoogleClaims({ ...ok, hd: 'other.ac.in' }, ['cnlu.ac.in'])).toMatchObject({ reason: 'hd_mismatch' });
    expect(checkGoogleClaims({ email_verified: true }, ['cnlu.ac.in'])).toMatchObject({ reason: 'missing_claims' });
  });
  it('skips only the hd check when told to (development), never the domain or verification checks', () => {
    const gmail = { email: 'tester@gmail.com', email_verified: true, sub: '9' };
    expect(checkGoogleClaims(gmail, ['gmail.com'], { requireHd: false })).toMatchObject({
      ok: true,
      email: 'tester@gmail.com',
    });
    expect(checkGoogleClaims(gmail, ['gmail.com'])).toMatchObject({ reason: 'hd_mismatch' });
    expect(checkGoogleClaims(gmail, ['cnlu.ac.in'], { requireHd: false })).toMatchObject({
      reason: 'domain_not_allowed',
    });
    expect(checkGoogleClaims({ ...gmail, email_verified: false }, ['gmail.com'], { requireHd: false })).toMatchObject({
      reason: 'email_unverified',
    });
  });

  it('checks the dev-login domain the same way', () => {
    expect(domainAllowed('a@cnlu.ac.in', ['cnlu.ac.in'])).toBe(true);
    expect(domainAllowed('a@gmail.com', ['cnlu.ac.in'])).toBe(false);
  });
});

describe('session and CSRF tokens', () => {
  const secret = 's'.repeat(32);
  const who = {
    userId: '00000000-0000-4000-8000-00000000000a',
    collegeId: '00000000-0000-4000-8000-000000000002',
    role: 'teacher' as const,
  };

  it('round-trips a session and rejects a tampered or foreign one', async () => {
    const token = await signSession(who, secret);
    expect(await readSession(token, secret)).toMatchObject(who);
    expect(await readSession(token, 't'.repeat(32))).toBeNull();
    expect(await readSession(`${token.slice(0, -2)}xx`, secret)).toBeNull();
  });

  it('binds the CSRF token to the user it was issued for', () => {
    let cookie = '';
    const res = { cookie: (_name: string, value: string) => (cookie = value) } as unknown as Response;
    issueCsrf(res, who.userId, secret, false);
    expect(csrfValid(cookie, who.userId, secret)).toBe(true);
    expect(csrfValid(cookie, '00000000-0000-4000-8000-00000000000b', secret)).toBe(false);
    expect(csrfValid(cookie, who.userId, 'x'.repeat(32))).toBe(false);
    expect(csrfValid(undefined, who.userId, secret)).toBe(false);
    expect(csrfValid('abc', who.userId, secret)).toBe(false);
    expect(csrfValid('abc.def', who.userId, secret)).toBe(false);
  });
});
