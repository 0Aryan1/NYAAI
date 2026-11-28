import { describe, expect, it } from 'vitest';
import { moved, planProgress, topicsFrom, togglePrerequisite } from './plan';

describe('course plan changes', () => {
  it('moves a lecture by swapping it with its neighbour', () => {
    const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(moved(units, 1, -1)).toEqual({ order: ['b', 'a', 'c'] });
    expect(moved(units, 1, 1)).toEqual({ order: ['a', 'c', 'b'] });
  });

  it('adds or removes one "builds on" link, keeping the others', () => {
    expect(togglePrerequisite({ id: 'u', prerequisites: ['p1'] }, 'p2')).toEqual({
      prerequisites: [{ id: 'u', prerequisites: ['p1', 'p2'] }],
    });
    expect(togglePrerequisite({ id: 'u', prerequisites: ['p1', 'p2'] }, 'p1').prerequisites![0]!.prerequisites).toEqual(
      ['p2'],
    );
  });

  it('counts taught and planned (skipped lectures are not planned), and finds the next one', () => {
    const units = [
      { id: '1', status: 'taught' },
      { id: '2', status: 'skipped' },
      { id: '3', status: 'planned' },
    ] as const;
    expect(planProgress(units)).toMatchObject({ taught: 1, planned: 2, next: { id: '3' } });
  });
});

describe('a pasted syllabus', () => {
  it('becomes one lecture per line, without numbers or bullets', () => {
    expect(
      topicsFrom(
        '1. Arbitration agreement\n2) Composition of the tribunal\n\n- Interim measures\nUnit 4: Setting aside an award\nL05 Enforcement\n• x',
      ),
    ).toEqual([
      'Arbitration agreement',
      'Composition of the tribunal',
      'Interim measures',
      'Setting aside an award',
      'Enforcement',
    ]);
  });
});
