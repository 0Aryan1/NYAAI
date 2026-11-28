import { describe, expect, it } from 'vitest';
import type { LecturePlan } from '@nyaai/shared';
import type { RetrievedSource, StatuteUnit } from '../src/services/search/index.ts';
import {
  MAX_SOURCES,
  addTo,
  assignMustCover,
  bestPart,
  dedupe,
  elsewhere,
  gapTask,
  mainPart,
  onlyAttached,
  type PartNotes,
} from '../src/services/build/research.ts';

const ACT = 'Arbitration and Conciliation Act';
const S34_TEXT = [
  '34. Application for setting aside arbitral award.—(1) Recourse to a Court against an arbitral award may be made only by an application.',
  '(2) An arbitral award may be set aside by the Court only if—',
  'Explanation 1.—For the avoidance of any doubt, it is clarified that an award is in conflict with the public policy of India, only if fraud or corruption.',
  'Explanation 2.—For the avoidance of doubt, the test as to whether there is a contravention with the fundamental policy of Indian law shall not entail a review on the merits.',
  '(3) An application for setting aside may not be made after three months have elapsed:',
  'Provided that if the Court is satisfied that the applicant was prevented by sufficient cause from making the application within the said period of three months it may entertain the application within a further period of thirty days.',
].join('\n');

let n = 0;
function statute(section: string, score = 0.9): RetrievedSource {
  n++;
  return {
    tag: 'S1',
    chunkId: `c-s${section}-${n}`,
    sourceId: 'act-1',
    header: `${ACT} › s. ${section}`,
    text: section === '34' ? S34_TEXT : `${section}. Some section.`,
    coveredChunkIds: [`c-s${section}-${n}`, `unit-${section}`],
    meta: { act: ACT, section, rolesSampled: false, sourceType: 'act', origin: 'india_code' },
    status: {},
    provisional: false,
    rerankScore: score,
    standing: { score, relevance: score, reasons: [] },
  };
}
function para(sourceId: string, chunk: string, score: number, covered: string[] = [chunk]): RetrievedSource {
  return {
    tag: 'S1',
    chunkId: chunk,
    sourceId,
    header: `${sourceId} v. State › ¶1`,
    text: `[para 1] ${sourceId} reasoning`,
    coveredChunkIds: covered,
    meta: { paraNo: '1', paraRole: 'holding', rolesSampled: false, sourceType: 'judgment', origin: 'court_site' },
    status: { case: 'not_verified' },
    provisional: false,
    rerankScore: score,
    standing: { score, relevance: score, reasons: [] },
  };
}
const plan: LecturePlan = {
  parts: [
    { title: 'Recap: seat', minutes: 4, kind: 'recap', questions: ['What is the seat?'], mustInclude: false },
    {
      title: 'Grounds of challenge',
      minutes: 20,
      kind: 'content',
      questions: [
        'When is an award against the public policy of India?',
        'What is the fundamental policy of Indian law?',
      ],
      mustInclude: false,
    },
    {
      title: 'Time limit',
      minutes: 14,
      kind: 'content',
      questions: [
        'Within how many months must the application be made, and can the court condone delay for sufficient cause?',
      ],
      mustInclude: false,
    },
    { title: 'Next class', minutes: 2, kind: 'bridge', questions: ['What comes next?'], mustInclude: false },
  ],
  leftOut: [],
};
const unit34: StatuteUnit = {
  chunkId: 'unit-34',
  sourceId: 'act-1',
  sourceType: 'act',
  actName: ACT,
  number: '34',
  header: `${ACT} › s. 34`,
  text: S34_TEXT,
};

describe('research notes (merge and gap rules)', () => {
  it('drops a duplicate: the same section twice, or overlapping paragraphs of one judgment', () => {
    const a = statute('34');
    const b = statute('34', 0.5);
    const p1 = para('Ssangyong', 'p1', 0.8, ['p1', 'p2', 'p3']);
    const p2 = para('Ssangyong', 'p3', 0.6, ['p3', 'p4']);
    const p3 = para('Ssangyong', 'p9', 0.6, ['p9']);
    expect(dedupe([a, b, p1, p2, p3])).toEqual([a, p1, p3]);
  });

  it('adds up to S8; a key section makes room by dropping the lowest judgment paragraph, never a section', () => {
    const part: PartNotes = {
      sources: [statute('34'), ...Array.from({ length: MAX_SOURCES - 1 }, (_, i) => para(`Case${i}`, `x${i}`, 0.5))],
      outcome: 'ok',
    };
    expect(addTo(part, [statute('35')], false)).toBe(0);
    expect(addTo(part, [statute('36')], true)).toBe(1);
    expect(part.sources).toHaveLength(MAX_SOURCES);
    expect(part.sources.some((s) => s.chunkId === 'x6')).toBe(false); // the last judgment paragraph went
    expect(part.sources[0]!.meta.section).toBe('34');
  });

  it('places a text in the teaching part it fits best, never the recap or bridge', () => {
    expect(bestPart(plan, 'application within three months, sufficient cause, thirty days')).toBe(2);
    expect(bestPart(plan, 'public policy of India fundamental policy')).toBe(1);
    expect(bestPart(plan, 'the seat of arbitration', [0, 3])).toBeNull();
  });

  it('gives each proviso and explanation to one part that holds its section, by fit', () => {
    const parts: PartNotes[] = [
      { sources: [statute('34')], outcome: 'ok' },
      { sources: [statute('34')], outcome: 'ok' },
      { sources: [statute('34')], outcome: 'ok' },
      { sources: [], outcome: 'not_found' },
    ];
    const must = assignMustCover(plan, parts, [unit34]);
    const at = Object.fromEntries(must.map((m) => [m.label, m.partIndex]));
    expect(at).toEqual({ 'Explanation 1 to s. 34': 1, 'Explanation 2 to s. 34': 1, 'Proviso to s. 34(3)': 2 });
    expect(must.every((m) => m.act === ACT && m.number === '34')).toBe(true);
  });

  it('marks an item not found when no part holds its section', () => {
    const parts: PartNotes[] = plan.parts.map(() => ({ sources: [], outcome: 'not_found' }));
    expect(assignMustCover(plan, parts, [unit34]).every((m) => m.partIndex === null)).toBe(true);
  });

  it('a case in two parts is taught in full where it ranked highest and only mentioned in the other', () => {
    const parts: PartNotes[] = [
      { sources: [], outcome: 'not_found' },
      { sources: [para('Ssangyong', 'a', 0.9)], outcome: 'thin' },
      { sources: [para('Ssangyong', 'b', 0.4)], outcome: 'thin' },
      { sources: [], outcome: 'not_found' },
    ];
    expect(mainPart(parts, 'Ssangyong')).toBe(1);
    expect(elsewhere(plan, parts, () => 'Ssangyong Engineering v. NHAI')).toEqual({
      '2': ['Ssangyong Engineering v. NHAI: taught in full in Part 2 (Grounds of challenge)'],
    });
  });

  it('the gap check reads labels, fenced as library data, never the source text', () => {
    const parts: PartNotes[] = [
      { sources: [], outcome: 'not_found' },
      { sources: [statute('34'), para('Ssangyong', 'a', 0.9)], outcome: 'ok' },
      { sources: [], outcome: 'not_found' },
      { sources: [], outcome: 'not_found' },
    ];
    const must = assignMustCover(plan, parts, [unit34]);
    const task = gapTask(
      { plan, topic: 'Setting aside an award', level: 'standard' },
      parts,
      must,
      [{ round: 1, partIndex: 2, question: 'Time limit under s. 34(3)?', why: 'w', added: 0 }],
      (id) => (id === 'Ssangyong' ? 'Ssangyong Engineering v. NHAI' : null),
    );
    expect(task).toContain('Part 1: Recap: seat (recap, 4 min)');
    expect(task).toMatch(/Part 2: s\. 34 Arbitration and Conciliation Act; Ssangyong Engineering ¶1 \[holding\]/);
    expect(task).toContain('Part 3: nothing found');
    expect(task).toContain('Proviso to s. 34(3): in Part 2');
    expect(task).toContain('- Part 3: Time limit under s. 34(3)? (nothing new)');
    expect(task).toMatch(/<<<[0-9a-f]{12} research>>>/);
    expect(task).not.toContain('avoidance of any doubt');
  });

  it('her notes: a note not attached to the lecture is dropped; an attached one is never pushed out', () => {
    const note = (id: string): RetrievedSource => ({
      ...para(id, `n-${id}`, 0.1),
      header: `Your notes: ${id} › Seat`,
      meta: { rolesSampled: false, sourceType: 'teacher_note', origin: 'upload', private: true },
    });
    const list = [statute('34'), note('attached'), note('old')];
    expect(onlyAttached(list, ['attached']).map((x) => x.sourceId)).toEqual(['act-1', 'attached']);
    expect(onlyAttached(list, []).some((x) => x.meta.private)).toBe(false);
    // A full part: a forced key section pushes out a judgment paragraph, never her attached note.
    const part: PartNotes = {
      sources: [note('attached'), ...Array.from({ length: MAX_SOURCES - 1 }, (_, i) => para(`j${i}`, `p${i}`, 0.5))],
      outcome: 'ok',
    };
    addTo(part, [statute('35')], true);
    expect(part.sources.some((x) => x.sourceId === 'attached')).toBe(true);
    expect(part.sources).toHaveLength(MAX_SOURCES);
  });
});
