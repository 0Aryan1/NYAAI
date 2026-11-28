import { describe, expect, it } from 'vitest';
import type { ReviewJudgment, ReviewJudgmentList } from '@nyaai/shared';
import { checklistSteps, citationsOf, filterJudgments, reviewCounts, stillToDo } from './review';

type Item = ReviewJudgmentList['judgments'][number];
const item = (over: Partial<Item>): Item =>
  ({
    id: 'j',
    title: 'Some case',
    rolesChecked: true,
    caseStatus: 'good_law',
    status: 'approved',
    maybeSame: false,
    ...over,
  }) as Item;

describe('library review rules', () => {
  const list = [
    item({ id: 'a', title: 'Renusagar v. GE' }),
    item({ id: 'b', title: 'Bhatia v. Bulk', caseStatus: 'not_verified' }),
    item({ id: 'c', title: 'Venture v. Satyam', rolesChecked: false, maybeSame: true }),
  ];

  it('to do is any check left; the list filters and counts by it, and by title words', () => {
    expect(filterJudgments(list, 'todo', '').map((x) => x.id)).toEqual(['b', 'c']);
    expect(filterJudgments(list, 'done', '').map((x) => x.id)).toEqual(['a']);
    expect(filterJudgments(list, 'all', '  bhatia ').map((x) => x.id)).toEqual(['b']);
    expect(reviewCounts(list)).toEqual({ todo: 2, done: 1, all: 3 });
    expect(stillToDo(list[2]!)).toEqual(['same case?', 'labels']);
  });

  it('puts the official report citations first and drops repeats', () => {
    expect(citationsOf('(2019) 15 SCC 131; 2019 INSC 512; [2019] 8 S.C.R. 1; 2019 INSC 512')).toEqual([
      '[2019] 8 S.C.R. 1',
      '2019 INSC 512',
      '(2019) 15 SCC 131',
    ]);
    expect(citationsOf(null)).toEqual([]);
  });

  it('asks the second-copy question first, and an official copy needs no approval', () => {
    const j = {
      caseStatus: 'not_verified',
      rolesChecked: true,
      status: 'live',
      origin: 'court_site',
    } as unknown as ReviewJudgment;
    expect(checklistSteps({ ...j, maybeSameAs: { id: 'x' } } as unknown as ReviewJudgment)[0]!.target).toBe(
      'step-same',
    );
    const steps = checklistSteps(j);
    expect(steps.map((s) => s.done)).toEqual([false, true, true]);
    expect(steps[2]!.hint).toBe('Not needed: official copy.');
  });
});
