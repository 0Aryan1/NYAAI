/**
 * The one way the web app talks to the API (`/api/v1`, proxied by Vite in development). Every response is parsed
 * with a shared schema by the caller; every error becomes an `ApiRequestError` with the server's plain message.
 *  - CSRF: every change echoes the readable `nyaai_csrf` cookie in a header (double-submit, LLD §15.1).
 *  - 429: the "too many requests" banner is started here, once, for every kind of request.
 *  - No connection: a fetch that never reached the server is status 0, so callers (pending saves) can tell
 *    "offline, try again" from "the server refused".
 */
import { ApiError } from '@nyaai/shared';
import { noteRateLimited } from './rate-limit';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(
      body?.error.message ??
        (status === 0
          ? 'We could not reach NYAAI. Check your connection and try again.'
          : status === 429
            ? 'Too many requests. Please wait a minute and try again.'
            : `Request failed (${status})`),
    );
  }

  /** The server's error code (e.g. COVERAGE_CHANGED), when it sent one. */
  get code(): string | undefined {
    return this.body?.error.code;
  }
}

/** The CSRF cookie is readable by design (double-submit); every change echoes it in a header. */
function csrfToken(): string {
  const raw = document.cookie.split('; ').find((c) => c.startsWith('nyaai_csrf='));
  return raw ? decodeURIComponent(raw.slice('nyaai_csrf='.length)) : '';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** fetch, with "no connection" turned into status 0 and a refused answer into an ApiRequestError. */
async function send(method: Method, path: string, init: { headers: Record<string, string>; body?: BodyInit }) {
  const headers = { ...init.headers, ...(method === 'GET' ? {} : { 'x-csrf-token': csrfToken() }) };
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, credentials: 'include', headers, body: init.body });
  } catch {
    throw new ApiRequestError(0, null);
  }
  if (!res.ok) {
    const parsed = ApiError.safeParse(await res.json().catch(() => null));
    if (res.status === 429) noteRateLimited();
    throw new ApiRequestError(res.status, parsed.success ? parsed.data : null);
  }
  return res;
}

/** A JSON request. `parse` checks the answer against its shared schema; 204 gives undefined. */
export async function call<T>(
  method: Method,
  path: string,
  { body, parse }: { body?: unknown; parse?: (v: unknown) => T } = {},
): Promise<T> {
  const res = await send(method, path, {
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  return parse ? parse(data) : (data as T);
}

/** A file sent as the request body (its type says what it is); the answer is JSON. */
export async function sendFile<T>(path: string, file: Blob, contentType: string, parse: (v: unknown) => T): Promise<T> {
  const res = await send('POST', path, {
    headers: { accept: 'application/json', 'content-type': contentType },
    body: file,
  });
  return parse(await res.json().catch(() => null));
}

/** A request whose answer is a file to save, named by the server. */
export async function downloadFile(
  path: string,
  body: unknown,
  fallbackName: string,
): Promise<{ blob: Blob; fileName: string; headers: Headers }> {
  const res = await send('POST', path, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const fileName = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  return { blob: await res.blob(), fileName, headers: res.headers };
}
