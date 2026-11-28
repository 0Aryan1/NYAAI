/**
 * Sign-in, CSRF and setup against the real database and Redis (`pnpm db:up && pnpm db:migrate`).
 * Creates its own college and invites, and removes them afterwards. Skipped when the stack is not running.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import pino from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { CONSENT_VERSION, Me } from '@nyaai/shared';
import { createApp } from '../../src/app.ts';
import { parseConfig } from '../../src/config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.resolve(here, '../../../../.env'));
} catch {
  /* CI passes env directly */
}

async function stackUp(): Promise<boolean> {
  if (!process.env.DATABASE_URL_MIGRATE || !process.env.REDIS_URL) return false;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_MIGRATE, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return (await c.query("select to_regclass('public.users') is not null as ok")).rows[0]?.ok === true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const up = await stackUp();

const base = {
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  SESSION_SECRET: 'a'.repeat(32),
  CSRF_SECRET: 'b'.repeat(32),
  ALLOWED_EMAIL_DOMAINS: 'it.test',
  LOG_LEVEL: 'silent',
};

const cookieValue = (res: request.Response, name: string) => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
  return raw ? decodeURIComponent(raw.split(';')[0]!.slice(name.length + 1)) : undefined;
};

describe.skipIf(!up)('sign-in, CSRF and setup (integration)', () => {
  let owner: pg.Pool, pool: pg.Pool, redis: Redis;
  const college = randomUUID();
  const emailA = `a-${college.slice(0, 8)}@it.test`;
  const emailB = `b-${college.slice(0, 8)}@it.test`;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_MIGRATE, max: 1 });
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    await owner.query("insert into colleges (id, name, slug) values ($1, 'Integration College', $2)", [
      college,
      `it-${college}`,
    ]);
    await owner.query('insert into invite_allowlist (college_id, email) values ($1, $2), ($1, $3)', [
      college,
      emailA,
      emailB,
    ]);
    const config = parseConfig({ ...base, NODE_ENV: 'development', DEV_LOGIN: 'true' });
    app = createApp({ config, logger: pino({ level: 'silent' }), pool, redis });
  });

  afterAll(async () => {
    if (!owner) return;
    await owner.query('delete from consents where college_id = $1', [college]);
    await owner.query('delete from teacher_profiles where college_id = $1', [college]);
    await owner.query('delete from invite_allowlist where college_id = $1', [college]);
    await owner.query('delete from users where college_id = $1', [college]);
    await owner.query('delete from colleges where id = $1', [college]);
    await redis.del('rl_signin:::ffff:127.0.0.1', 'rl_signin:127.0.0.1', 'rl_signin:::1');
    await Promise.all([owner.end(), pool.end(), redis.quit()]);
  });

  it('refuses /me without a session, and an email that was never invited', async () => {
    await request(app).get('/api/v1/me').expect(401);
    const res = await request(app)
      .post('/api/v1/auth/dev-login')
      .send({ email: `nobody-${college.slice(0, 8)}@it.test` })
      .expect(403);
    expect(res.body.error.message).toMatch(/not been invited/);
    await request(app).post('/api/v1/auth/dev-login').send({ email: 'someone@gmail.com' }).expect(403);
  });

  it('accepts an invite on first sign-in, then walks setup with CSRF on every change', async () => {
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/dev-login').send({ email: emailA }).expect(204);
    const csrf = cookieValue(login, 'nyaai_csrf')!;
    expect(csrf).toBeTruthy();

    const me = Me.parse((await agent.get('/api/v1/me').expect(200)).body);
    expect(me).toMatchObject({ setupStep: 1, setupDone: false, user: { email: emailA, role: 'teacher' } });

    // A change without the CSRF header is refused.
    await agent.post('/api/v1/consents').send({ version: CONSENT_VERSION, accept: true }).expect(403);
    const send = <T extends object>(method: 'post' | 'patch', url: string, body: T) =>
      agent[method](url).set('x-csrf-token', csrf).send(body);

    // Steps can't be skipped ahead.
    await send('patch', '/api/v1/setup/progress', { step: 4 }).expect(400);
    await send('post', '/api/v1/consents', { version: CONSENT_VERSION, accept: true }).expect(204);
    await send('patch', '/api/v1/setup/profile', {
      name: 'Dr. A',
      department: 'Contract law',
      subjects: ['Law of Contract I'],
      teachingLanguage: 'en',
    }).expect(204);
    await send('patch', '/api/v1/setup/progress', { step: 4 }).expect(204);
    await send('post', '/api/v1/setup/finish', {}).expect(400); // style still missing
    await send('patch', '/api/v1/setup/style', {
      density: 'balanced',
      case_first: 'case_first',
      structure: 'irac',
      language_mix: 'english',
      example_kind: 'indian_cases',
    }).expect(204);
    await send('patch', '/api/v1/setup/progress', { step: 6 }).expect(204);
    await send('post', '/api/v1/setup/finish', {}).expect(204);

    const done = Me.parse((await agent.get('/api/v1/me').expect(200)).body);
    expect(done).toMatchObject({
      setupDone: true,
      user: { name: 'Dr. A' },
      profile: { department: 'Contract law', subjects: ['Law of Contract I'] },
    });
    expect(done.budget.leftMicroUsd).toBe(12_000_000);

    expect((await agent.get('/api/v1/home').expect(200)).body).toEqual({ courses: [] });
    // A teacher can't load library sources.
    await send('post', '/api/v1/library/sources', {}).expect(403);
  });

  it('keeps teacher B apart from teacher A, and B cannot reuse A’s CSRF token', async () => {
    const a = request.agent(app);
    const csrfA = cookieValue(
      await a.post('/api/v1/auth/dev-login').send({ email: emailA }).expect(204),
      'nyaai_csrf',
    )!;
    const b = request.agent(app);
    await b.post('/api/v1/auth/dev-login').send({ email: emailB }).expect(204);
    expect((await b.get('/api/v1/consents/current').expect(200)).body.accepted).toBe(false);
    await b
      .post('/api/v1/consents')
      .set('x-csrf-token', csrfA)
      .set('cookie', `nyaai_csrf=${encodeURIComponent(csrfA)}`)
      .send({ version: CONSENT_VERSION, accept: true })
      .expect(403);
  });

  it('signing out needs the CSRF token while signed in; a signed-out browser just has its cookies cleared', async () => {
    const a = request.agent(app);
    const csrf = cookieValue(
      await a.post('/api/v1/auth/dev-login').set('x-forwarded-for', '10.77.0.9').send({ email: emailA }).expect(204),
      'nyaai_csrf',
    )!;
    await a.post('/api/v1/auth/logout').expect(403); // another site cannot sign her out
    await a.get('/api/v1/me').expect(200); // still signed in
    await a.post('/api/v1/auth/logout').set('x-csrf-token', csrf).expect(204);
    await a.get('/api/v1/me').expect(401);
    await request(app).post('/api/v1/auth/logout').expect(204); // no session: nothing to protect
  });

  it('has no dev login outside development', async () => {
    const config = parseConfig({
      ...base,
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      ANTHROPIC_API_KEY: 'x',
      VOYAGE_API_KEY: 'x',
      INDIAN_KANOON_TOKEN: 'x',
    });
    const prod = createApp({ config, logger: pino({ level: 'silent' }), pool, redis });
    await request(prod).post('/api/v1/auth/dev-login').send({ email: emailA }).expect(404);
    expect((await request(prod).get('/api/v1/auth/options').expect(200)).body).toEqual({
      google: true,
      devLogin: false,
    });
  });
});
