import { describe, expect, it } from 'vitest';
import type { ResearchRunView } from '@nyaai/shared';
import { NOT_VERIFIED, briefFileName, planBrief, renderDocx, renderPdf, winAnsi } from '../src/services/export/brief.ts';

const line = (text: string, over: Partial<NonNullable<ResearchRunView['brief']>['shortAnswer'][number]> = {}) => ({
  text,
  kind: 'claim' as const,
  status: 'supported' as const,
  flag: null,
  reason: null,
  sources: [{ tag: 'S1', label: 's. 34 Arbitration and Conciliation Act, 1996' }],
  ...over,
});
export const sampleRun: Pick<ResearchRunView, 'question' | 'scope' | 'brief' | 'createdAt'> = {
  question: 'When can a court set aside an arbitral award on grounds of public policy?',
  scope: { comparative: false, fromYear: 2015 },
  createdAt: '2026-11-26T09:00:00.000Z',
  brief: {
    shortAnswer: [line('A court may set aside an award that conflicts with the public policy of India.')],
    keyPoints: [
      line('An award is in conflict with public policy only if it was induced by fraud or corruption, contravenes the fundamental policy of Indian law, or conflicts with the most basic notions of morality or justice.'),
      line('Ssangyong narrowed the patent illegality ground for international awards.', { flag: 'grey', reason: 'Case status not verified', sources: [{ tag: 'S2', label: 'Ssangyong Engineering v. NHAI (2019)' }] }),
      line('A court must decide the application within one year.', { status: 'open', flag: 'yellow', reason: 'These words are not in the source' }),
    ],
    conflicts: [],
    openQuestions: ['Does the 2015 amendment apply to proceedings begun before it?'],
    notFound: [],
    evidence: [
      {
        tag: 'S1', label: 's. 34 Arbitration and Conciliation Act, 1996', header: 's. 34', text: 'An arbitral award may be set aside by the Court only if… the award is in conflict with the public policy of India.',
        spans: ['the award is in conflict with the public policy of India'], relation: 'supports', statusLabel: 'In force', caseStatus: null, court: null, decidedOn: null, subQuestion: 1, provisional: false,
      },
      {
        tag: 'S2', label: 'Ssangyong Engineering v. NHAI (2019)', header: 'Ssangyong', text: 'Patent illegality… ₹ 10 lakh…', spans: [], relation: 'limits', statusLabel: 'Status not verified',
        caseStatus: 'not_verified', court: 'Supreme Court of India', decidedOn: '2019-05-08', subQuestion: 2, provisional: true,
      },
    ],
  },
};

describe('a research brief as a file (RES-5)', () => {
  it('numbers every line to verify, marks grey cases in the text, and keeps the page order', () => {
    const p = planBrief(sampleRun, '2026-11-27');
    expect(p.sections.map((s) => s.heading)).toEqual(['Short answer', 'Key points', 'Open questions']);
    const kp = p.sections[1]!.lines!;
    expect(kp[1]!.text).toBe(`Ssangyong narrowed the patent illegality ground for international awards. ${NOT_VERIFIED}`);
    expect(kp[1]!.note).toBeNull();
    expect(kp[2]!.note).toBe(1);
    expect(p.notes).toEqual([{ n: 1, text: 'Please verify: These words are not in the source', line: 'A court must decide the application within one year.' }]);
    expect(p.subtitle).toBe('Research brief · India only · judgments 2015–now · asked 2026-11-26 · exported 2026-11-27');
    expect(p.evidence[1]).toMatchObject({ relation: 'Limits', status: 'Status not verified', meta: 'Supreme Court of India · 2019-05-08 · found for question 2 · not yet reviewed by the library team' });
  });

  it('an empty brief says so honestly', () => {
    const p = planBrief({ ...sampleRun, brief: { ...sampleRun.brief!, shortAnswer: [], keyPoints: [], evidence: [], openQuestions: [], notFound: ['x?'] } }, '2026-11-27');
    expect(p.sections[0]!.bullets![0]).toMatch(/does not hold enough/);
    expect(p.sections.at(-1)).toEqual({ heading: 'Not found in the sources', bullets: ['x?'] });
  });

  it('names the file from the question and the date', () => {
    expect(briefFileName('When can a court set aside an award? (s. 34)', '2026-11-27', 'pdf')).toBe('Research_When_Can_A_Court_Set_Aside_An_Award_2026-11-27.pdf');
  });

  it('PDF text stays readable in the built-in fonts', () => {
    expect(winAnsi('Fine of ₹ 10,000 — “quoted” … § 34')).toBe('Fine of Rs. 10,000 — “quoted” … § 34');
    expect(winAnsi('धारा 34')).toBe('???? 34');
  });

  it('renders Word and PDF', async () => {
    const p = planBrief(sampleRun, '2026-11-27');
    expect((await renderDocx(p)).subarray(0, 2).toString()).toBe('PK');
    expect((await renderPdf(p)).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
