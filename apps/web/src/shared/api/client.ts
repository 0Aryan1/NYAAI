import { ApiError, HealthResponse } from '@nyaai/shared';

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly body: ApiError | null) {
    super(body?.error.message ?? `Request failed (${status})`);
  }
}

/** Typed fetch: responses are validated with the shared Zod schemas, so web and server cannot drift. */
async function getJson<T>(path: string, parse: (v: unknown) => T, { allowStatus = [] as number[] } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'include', headers: { accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok && !allowStatus.includes(res.status)) {
    const err = ApiError.safeParse(body);
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  return parse(body);
}

export const api = {
  health: () => getJson('/health', (v) => HealthResponse.parse(v), { allowStatus: [503] }),
};
