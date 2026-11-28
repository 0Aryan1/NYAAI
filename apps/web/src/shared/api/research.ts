/** Research: start a run, "My research", one run, and the brief as Word or PDF (RES-1 to RES-5). */
import { Created, ResearchList, ResearchRunView, type StartResearch } from '@nyaai/shared';
import { call, downloadFile } from './http';

export const researchApi = {
  startResearch: (body: StartResearch) => call('POST', '/research', { body, parse: (v) => Created.parse(v) }),
  researchList: () => call('GET', '/research', { parse: (v) => ResearchList.parse(v) }),
  researchRun: (id: string) => call('GET', `/research/${id}`, { parse: (v) => ResearchRunView.parse(v) }),
  /** The brief as Word or PDF, its flags written in; how many lines are marked to verify. */
  exportBrief: async (runId: string, format: 'docx' | 'pdf') => {
    const r = await downloadFile(`/research/${runId}/export`, { format }, `research.${format}`);
    return { blob: r.blob, fileName: r.fileName, toVerify: Number(r.headers.get('x-lines-to-verify') ?? 0) };
  },
};

/** The list and each run have their own keys: refreshing the list does not refetch every run. */
export const researchKeys = {
  research: ['research', 'list'] as const,
  researchRun: (id: string) => ['research', 'run', id] as const,
};
