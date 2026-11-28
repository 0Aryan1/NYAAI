/** Home, Prepare, the lecture, its slides and coverage, editing, reports on lines, and the .pptx (LLD §4.3). */
import {
  CitationSource,
  Created,
  CoverageAdded,
  CoverageResponse,
  HomeResponse,
  LectureReports,
  LectureSummary,
  MarkTaughtResponse,
  PrepareResponse,
  SlideWriteResponse,
  StudioSlides,
  SuggestResponse,
  type DownloadRequest,
  type EditSlide,
  type PrepareLecture,
  type ReportLine,
} from '@nyaai/shared';
import { call, downloadFile } from './http';

export const lecturesApi = {
  home: () => call('GET', '/home', { parse: (v) => HomeResponse.parse(v) }),
  suggest: (q: string) =>
    call('GET', `/suggest?q=${encodeURIComponent(q)}`, { parse: (v) => SuggestResponse.parse(v) }),
  /** 202 { lectureId, jobId }; 409 TOPIC_AMBIGUOUS carries the choices; 422 BUDGET_EXHAUSTED. */
  prepare: (body: PrepareLecture) => call('POST', '/lectures', { body, parse: (v) => PrepareResponse.parse(v) }),
  retryBuild: (id: string) => call('POST', `/lectures/${id}/retry`, { parse: (v) => PrepareResponse.parse(v) }),
  lecture: (id: string) => call('GET', `/lectures/${id}`, { parse: (v) => LectureSummary.parse(v) }),
  slides: (id: string) => call('GET', `/lectures/${id}/slides`, { parse: (v) => StudioSlides.parse(v) }),
  citationSource: (id: string) => call('GET', `/citations/${id}/source`, { parse: (v) => CitationSource.parse(v) }),
  coverage: (id: string) => call('GET', `/lectures/${id}/coverage`, { parse: (v) => CoverageResponse.parse(v) }),
  leaveOut: (itemId: string) => call<void>('POST', `/coverage/${itemId}/leave-out`),
  addCoverage: (itemId: string) => call('POST', `/coverage/${itemId}/add`, { parse: (v) => CoverageAdded.parse(v) }),
  stillRight: (lectureId: string) => call<void>('DELETE', `/lectures/${lectureId}/may-need-update`),
  markTaught: (lectureId: string, taughtOn: string) =>
    call('POST', `/lectures/${lectureId}/taught`, { body: { taughtOn }, parse: (v) => MarkTaughtResponse.parse(v) }),
  undoTaught: (lectureId: string) => call<void>('DELETE', `/lectures/${lectureId}/taught`),
  saveSlide: (id: string, body: EditSlide) =>
    call('PATCH', `/slides/${id}`, { body, parse: (v) => SlideWriteResponse.parse(v) }),
  verifyLine: (id: string, lineKey: string) =>
    call('POST', `/slides/${id}/verify`, { body: { lineKey }, parse: (v) => SlideWriteResponse.parse(v) }),
  addExample: (id: string, text: string, save: boolean) =>
    call('POST', `/slides/${id}/examples`, { body: { text, save }, parse: (v) => SlideWriteResponse.parse(v) }),
  restoreSlide: (id: string, version: number) =>
    call('POST', `/slides/${id}/restore`, { body: { version }, parse: (v) => SlideWriteResponse.parse(v) }),
  reportLine: (lectureId: string, body: ReportLine) =>
    call('POST', `/lectures/${lectureId}/reports`, { body, parse: (v) => Created.parse(v) }),
  lectureReports: (lectureId: string) =>
    call('GET', `/lectures/${lectureId}/reports`, { parse: (v) => LectureReports.parse(v) }),
  /** The .pptx, named by the server (PPT-3); how many unverified lines were removed first. */
  downloadDeck: async (lectureId: string, body: DownloadRequest) => {
    const r = await downloadFile(`/lectures/${lectureId}/download`, body, 'lecture.pptx');
    return { blob: r.blob, fileName: r.fileName, removed: Number(r.headers.get('x-removed-lines') ?? 0) };
  },
};

/**
 * A lecture's keys: `lectureAll(id)` covers everything about it (summary, slides, coverage); the others are exact,
 * so refreshing the header does not refetch every slide.
 */
export const lectureKeys = {
  home: ['home'] as const,
  suggest: (q: string) => ['suggest', q] as const,
  lectureAll: (id: string) => ['lecture', id] as const,
  lecture: (id: string) => ['lecture', id, 'summary'] as const,
  slides: (id: string) => ['lecture', id, 'slides'] as const,
  coverage: (id: string) => ['lecture', id, 'coverage'] as const,
  citationSource: (id: string) => ['citation', id, 'source'] as const,
  lectureReports: (id: string) => ['lecture-reports', id] as const,
};
