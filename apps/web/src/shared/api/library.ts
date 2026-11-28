/** The library team's screens: judgments, uploads, gaps, topics, old → new law, wrong-fact reports. */
import {
  GapLookupResponse,
  LawMapping,
  LawMappingList,
  LibraryGap,
  LibraryGapList,
  ReportQueue,
  ResolveReportResponse,
  ReviewJudgment,
  ReviewJudgmentList,
  TopicCases,
  UploadJudgmentResponse,
  UploadJudgmentStatus,
  type ParaRole,
  type ResolveReport,
  type SaveLawMapping,
  type SetCaseStatus,
  type UpdateGapRequest,
  type UploadJudgmentQuery,
} from '@nyaai/shared';
import { call, sendFile } from './http';

export const libraryApi = {
  reviewJudgments: () => call('GET', '/library/judgments', { parse: (v) => ReviewJudgmentList.parse(v) }),
  reviewJudgment: (id: string) => call('GET', `/library/judgments/${id}`, { parse: (v) => ReviewJudgment.parse(v) }),
  setParagraphRole: (chunkId: string, role: ParaRole) =>
    call<void>('PATCH', `/library/paragraphs/${chunkId}`, { body: { role } }),
  rolesChecked: (id: string) => call<void>('POST', `/library/judgments/${id}/roles-checked`),
  approveJudgment: (id: string) => call<void>('POST', `/library/judgments/${id}/approve`),
  sameCase: ({ id, same }: { id: string; same: boolean }) =>
    call<void>('POST', `/library/judgments/${id}/same-case`, { body: { same } }),
  setCaseStatus: (id: string, body: SetCaseStatus) => call<void>('POST', `/library/judgments/${id}/status`, { body }),
  /** A judgment PDF as the request body; its details travel in the query string. */
  uploadJudgment: (query: UploadJudgmentQuery, file: File) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    return sendFile(`/library/uploads/judgment?${params.toString()}`, file, 'application/pdf', (v) =>
      UploadJudgmentResponse.parse(v),
    );
  },
  uploadStatus: (jobId: string) =>
    call('GET', `/library/uploads/${encodeURIComponent(jobId)}`, { parse: (v) => UploadJudgmentStatus.parse(v) }),
  libraryGaps: (state: 'waiting' | 'answered' | 'all') =>
    call('GET', `/library/gaps?state=${state}`, { parse: (v) => LibraryGapList.parse(v) }),
  lookupGap: (id: string) => call('POST', `/library/gaps/${id}/lookup`, { parse: (v) => GapLookupResponse.parse(v) }),
  updateGap: (id: string, body: UpdateGapRequest) =>
    call('PATCH', `/library/gaps/${id}`, { body, parse: (v) => LibraryGap.parse(v) }),
  topicCases: (show: 'unconfirmed' | 'all') =>
    call('GET', `/library/topics?show=${show}`, { parse: (v) => TopicCases.parse(v) }),
  confirmTopicCase: (conceptId: string, sourceId: string) =>
    call<void>('POST', `/library/topics/${conceptId}/cases/${sourceId}/confirm`),
  unconfirmTopicCase: (conceptId: string, sourceId: string) =>
    call<void>('DELETE', `/library/topics/${conceptId}/cases/${sourceId}/confirm`),
  removeTopicCase: (conceptId: string, sourceId: string) =>
    call<void>('DELETE', `/library/topics/${conceptId}/cases/${sourceId}`),
  restoreTopicCase: (conceptId: string, sourceId: string) =>
    call<void>('POST', `/library/topics/${conceptId}/cases/${sourceId}`),
  lawMappings: (show: 'unsigned' | 'all') =>
    call('GET', `/library/mappings?show=${show}`, { parse: (v) => LawMappingList.parse(v) }),
  addLawMapping: (body: SaveLawMapping) =>
    call('POST', '/library/mappings', { body, parse: (v) => LawMapping.parse(v) }),
  editLawMapping: (id: string, body: SaveLawMapping) =>
    call('PATCH', `/library/mappings/${id}`, { body, parse: (v) => LawMapping.parse(v) }),
  signLawMapping: (id: string) => call('POST', `/library/mappings/${id}/sign`, { parse: (v) => LawMapping.parse(v) }),
  unsignLawMapping: (id: string) =>
    call('DELETE', `/library/mappings/${id}/sign`, { parse: (v) => LawMapping.parse(v) }),
  removeLawMapping: (id: string) => call<void>('DELETE', `/library/mappings/${id}`),
  reportQueue: (state: 'open' | 'resolved') =>
    call('GET', `/library/reports?state=${state}`, { parse: (v) => ReportQueue.parse(v) }),
  resolveReport: (id: string, body: ResolveReport) =>
    call('POST', `/library/reports/${id}/resolve`, { body, parse: (v) => ResolveReportResponse.parse(v) }),
};

/** Everything under `reviewAll` is the library team's; each screen's lists have their own prefix. */
export const libraryKeys = {
  reviewAll: ['review'] as const,
  reviewJudgments: ['review', 'judgments'] as const,
  reviewJudgment: (id: string) => ['review', 'judgment', id] as const,
  uploadStatus: (jobId: string) => ['review', 'upload', jobId] as const,
  gapsAll: ['review', 'gaps'] as const,
  gaps: (state: string) => ['review', 'gaps', state] as const,
  topicCasesAll: ['review', 'topics'] as const,
  topicCases: (show: string) => ['review', 'topics', show] as const,
  lawMappingsAll: ['review', 'mappings'] as const,
  lawMappings: (show: string) => ['review', 'mappings', show] as const,
  reportQueue: (state: string) => ['review', 'reports', state] as const,
};
