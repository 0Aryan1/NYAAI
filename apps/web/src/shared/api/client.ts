import {
  ApiError,
  AuthOptions,
  CONSENT_VERSION,
  HealthResponse,
  HomeResponse,
  Me,
  ResolveResponse,
  SuggestResponse,
  CitationSource,
  CoverageResponse,
  LectureSummary,
  PrepareResponse,
  StudioSlides,
  ReviewJudgment,
  ReviewJudgmentList,
  UploadJudgmentResponse,
  UploadJudgmentStatus,
  CourseDetail,
  CourseList,
  MarkTaughtResponse,
  SlideVersions,
  SlideWriteResponse,
  type EditSlide,
  type DownloadRequest,
  type CreateCourse,
  type SetCaseStatus,
  type UpdateUnits,
  type ParaRole,
  type UploadJudgmentQuery,
  type PrepareLecture,
  type ProfileRequest,
  type StyleRequest,
  TeacherNote,
  TeacherNoteList,
  SyllabusPreview,
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

/** POST /lectures/:id/download: the .pptx as a file to save, named by the server (PPT-3). */
async function downloadDeck(lectureId: string, body: DownloadRequest): Promise<{ blob: Blob; fileName: string; removed: number }> {
  const res = await fetch(`/api/v1/lectures/${lectureId}/download`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = ApiError.safeParse(await res.json().catch(() => null));
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'lecture.pptx';
  return { blob: await res.blob(), fileName: name, removed: Number(res.headers.get('x-removed-lines') ?? 0) };
}

/** Upload a judgment PDF as the request body; its details travel in the query string (POST /library/uploads/judgment). */
async function uploadPdf(query: UploadJudgmentQuery, file: File): Promise<UploadJudgmentResponse> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  const res = await fetch(`/api/v1/library/uploads/judgment?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': 'application/pdf', 'x-csrf-token': csrfToken() },
    body: file,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(data);
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  return UploadJudgmentResponse.parse(data);
}

/** Her own document, sent as it is (its media type says what it is); read in the worker as hers. */
async function uploadNote(file: File, title: string, replaces?: string): Promise<TeacherNote> {
  const params = new URLSearchParams({ title, fileName: file.name });
  if (replaces) params.set('replaces', replaces);
  const type = file.type || (/\.md$/i.test(file.name) ? 'text/markdown' : /\.txt$/i.test(file.name) ? 'text/plain' : 'application/octet-stream');
  const res = await fetch(`/api/v1/notes?${params.toString()}`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': type, 'x-csrf-token': csrfToken() },
    body: file,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(data);
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  return TeacherNote.parse(data);
}

/** Her syllabus file, read into units and topics (nothing is kept on the server). */
async function readSyllabus(file: File, classCount?: number): Promise<SyllabusPreview> {
  const type = file.type || (/\.md$/i.test(file.name) ? 'text/markdown' : /\.txt$/i.test(file.name) ? 'text/plain' : 'application/octet-stream');
  const res = await fetch(`/api/v1/courses/syllabus${classCount ? `?classCount=${classCount}` : ''}`, {
    method: 'POST',
    credentials: 'include',
    headers: { accept: 'application/json', 'content-type': type, 'x-csrf-token': csrfToken() },
    body: file,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(data);
    throw new ApiRequestError(res.status, err.success ? err.data : null);
  }
  return SyllabusPreview.parse(data);
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
  deleteMyData: (confirmEmail: string) => call<unknown>('POST', '/me/delete-data', { body: { confirmEmail } }),
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
  /** 202 { lectureId, jobId }; 409 TOPIC_AMBIGUOUS carries the choices; 422 BUDGET_EXHAUSTED. */
  prepare: (body: PrepareLecture) => call('POST', '/lectures', { body, parse: (v) => PrepareResponse.parse(v) }),
  retryBuild: (id: string) => call('POST', `/lectures/${id}/retry`, { parse: (v) => PrepareResponse.parse(v) }),
  lecture: (id: string) => call('GET', `/lectures/${id}`, { parse: (v) => LectureSummary.parse(v) }),
  slides: (id: string) => call('GET', `/lectures/${id}/slides`, { parse: (v) => StudioSlides.parse(v) }),
  citationSource: (id: string) => call('GET', `/citations/${id}/source`, { parse: (v) => CitationSource.parse(v) }),
  coverage: (id: string) => call('GET', `/lectures/${id}/coverage`, { parse: (v) => CoverageResponse.parse(v) }),
  leaveOut: (itemId: string) => call<void>('POST', `/coverage/${itemId}/leave-out`),
  // Library editor review (role E)
  reviewJudgments: () => call('GET', '/library/judgments', { parse: (v) => ReviewJudgmentList.parse(v) }),
  reviewJudgment: (id: string) => call('GET', `/library/judgments/${id}`, { parse: (v) => ReviewJudgment.parse(v) }),
  setParagraphRole: (chunkId: string, role: ParaRole) => call<void>('PATCH', `/library/paragraphs/${chunkId}`, { body: { role } }),
  rolesChecked: (id: string) => call<void>('POST', `/library/judgments/${id}/roles-checked`),
  approveJudgment: (id: string) => call<void>('POST', `/library/judgments/${id}/approve`),
  sameCase: ({ id, same }: { id: string; same: boolean }) => call<void>('POST', `/library/judgments/${id}/same-case`, { body: { same } }),
  setCaseStatus: (id: string, body: SetCaseStatus) => call<void>('POST', `/library/judgments/${id}/status`, { body }),
  uploadJudgment: uploadPdf,
  notes: () => call('GET', '/notes', { parse: (v) => TeacherNoteList.parse(v) }),
  uploadNote,
  deleteNote: (id: string) => call<void>('DELETE', `/notes/${id}`),
  uploadStatus: (jobId: string) => call('GET', `/library/uploads/${encodeURIComponent(jobId)}`, { parse: (v) => UploadJudgmentStatus.parse(v) }),
  courses: () => call('GET', '/courses', { parse: (v) => CourseList.parse(v) }),
  course: (id: string) => call('GET', `/courses/${id}`, { parse: (v) => CourseDetail.parse(v) }),
  readSyllabus,
  createCourse: (body: CreateCourse) => call('POST', '/courses', { body, parse: (v) => CourseDetail.parse(v) }),
  updateUnits: (id: string, body: UpdateUnits) => call('PATCH', `/courses/${id}/units`, { body, parse: (v) => CourseDetail.parse(v) }),
  markTaught: (lectureId: string, taughtOn: string) => call('POST', `/lectures/${lectureId}/taught`, { body: { taughtOn }, parse: (v) => MarkTaughtResponse.parse(v) }),
  undoTaught: (lectureId: string) => call<void>('DELETE', `/lectures/${lectureId}/taught`),
  downloadDeck,
  saveSlide: (id: string, body: EditSlide) => call('PATCH', `/slides/${id}`, { body, parse: (v) => SlideWriteResponse.parse(v) }),
  verifyLine: (id: string, lineKey: string) => call('POST', `/slides/${id}/verify`, { body: { lineKey }, parse: (v) => SlideWriteResponse.parse(v) }),
  addExample: (id: string, text: string, save: boolean) => call('POST', `/slides/${id}/examples`, { body: { text, save }, parse: (v) => SlideWriteResponse.parse(v) }),
  slideVersions: (id: string) => call('GET', `/slides/${id}/versions`, { parse: (v) => SlideVersions.parse(v) }),
  restoreSlide: (id: string, version: number) => call('POST', `/slides/${id}/restore`, { body: { version }, parse: (v) => SlideWriteResponse.parse(v) }),
};

export const queryKeys = {
  me: ['me'] as const,
  home: ['home'] as const,
  notes: ['notes'] as const,
  consent: ['consent'] as const,
  authOptions: ['auth-options'] as const,
  suggest: (q: string) => ['suggest', q] as const,
  lecture: (id: string) => ['lecture', id] as const,
  slides: (id: string) => ['lecture', id, 'slides'] as const,
  coverage: (id: string) => ['lecture', id, 'coverage'] as const,
  citationSource: (id: string) => ['citation', id, 'source'] as const,
  reviewJudgments: ['review', 'judgments'] as const,
  reviewJudgment: (id: string) => ['review', 'judgment', id] as const,
  uploadStatus: (jobId: string) => ['review', 'upload', jobId] as const,
  courses: ['courses'] as const,
  course: (id: string) => ['courses', id] as const,
};
