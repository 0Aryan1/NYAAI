import {
  ApiError,
  AuthOptions,
  CONSENT_VERSION,
  HealthResponse,
  HomeResponse,
  Me,
  ResolveResponse,
  SuggestResponse,
  type ProfileRequest,
  type StyleRequest,
} from '@nyaai/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `Request failed (${status})`);
  }
}

/** The CSRF cookie is readable by design (double-submit); every change echoes it in a header (LLD §15.1). */
function csrfToken(): string {
  const raw = document.cookie.split('; ').find((c) => c.startsWith('nyaai_csrf='));
  return raw ? decodeURIComponent(raw.slice('nyaai_csrf='.length)) : '';
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  { body, parse, allowStatus = [] }: { body?: unknown; parse?: (v: unknown) => T; allowStatus?: number[] } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok && !allowStatus.includes(res.status)) {
    const err = ApiError.safeParse(data);
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  return parse ? parse(data) : (data as T);
}

export interface Processor {
  name: string;
  purpose: string;
  dataSent: string;
  region: string;
}

/** Typed client: responses are validated with the shared Zod schemas, so web and server cannot drift. */
export const api = {
  health: () => call('GET', '/health', { parse: (v) => HealthResponse.parse(v), allowStatus: [503] }),
  authOptions: () => call('GET', '/auth/options', { parse: (v) => AuthOptions.parse(v) }),
  devLogin: (email: string) => call<void>('POST', '/auth/dev-login', { body: { email } }),
  logout: () => call<void>('POST', '/auth/logout'),
  me: () => call('GET', '/me', { parse: (v) => Me.parse(v) }),
  consent: () => call<{ version: string; processors: Processor[]; accepted: boolean }>('GET', '/consents/current'),
  acceptConsent: () => call<void>('POST', '/consents', { body: { version: CONSENT_VERSION, accept: true } }),
  saveProfile: (body: ProfileRequest) => call<void>('PATCH', '/setup/profile', { body }),
  saveStyle: (body: StyleRequest) => call<void>('PATCH', '/setup/style', { body }),
  setupProgress: (step: number) => call<void>('PATCH', '/setup/progress', { body: { step } }),
  finishSetup: () => call<void>('POST', '/setup/finish', { body: {} }),
  home: () => call('GET', '/home', { parse: (v) => HomeResponse.parse(v) }),
  suggest: (q: string) => call('GET', `/suggest?q=${encodeURIComponent(q)}`, { parse: (v) => SuggestResponse.parse(v) }),
  /** 409 TOPIC_AMBIGUOUS carries `details.choices`; the caller shows the one-tap dialog. */
  resolveTopic: (topic: string, choice?: string) => call('POST', '/topics/resolve', { body: { topic, choice }, parse: (v) => ResolveResponse.parse(v) }),
};

export const queryKeys = {
  me: ['me'] as const,
  home: ['home'] as const,
  consent: ['consent'] as const,
  authOptions: ['auth-options'] as const,
  suggest: (q: string) => ['suggest', q] as const,
};
