import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, call } from './http';

afterEach(() => vi.restoreAllMocks());

describe('talking to the API', () => {
  it('no connection is status 0 with a plain message (so pending saves wait and try again)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await call('GET', '/home').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 0, message: 'We could not reach NYAAI. Check your connection and try again.' });
  });

  it("a refused request carries the server's code and message", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'We could not find that lecture.', traceId: 't' } }),
        {
          status: 404,
        },
      ),
    );
    const err = (await call('GET', '/lectures/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'We could not find that lecture.' });
  });

  it('every change carries the CSRF token from the cookie', async () => {
    document.cookie = 'nyaai_csrf=tok.sig';
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await call('POST', '/auth/logout');
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)['x-csrf-token']).toBe('tok.sig');
  });
});
