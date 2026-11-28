import { describe, expect, it } from 'vitest';
import {
  courseContext,
  courseMemoryText,
  exampleOnSlides,
  hasMemory,
  orderParts,
  seriesChecks,
  termsOnSlides,
  type CourseUnit,
  type SeriesUnit,
} from './course.ts';

const unit = (position: number, title: string, o: Partial<SeriesUnit> = {}): SeriesUnit => ({
  id: `u${position}`,
  position,
  title,
  status: 'planned',
  taughtOn: null,
  prerequisites: [],
  memory: {},
  ...o,
});

const satyabrata = { sourceId: 's-sat', name: 'Satyabrata Ghose v. Mugneeram Bangur' };
const energy = { sourceId: 's-ew', name: 'Energy Watchdog v. CERC' };

const plan: CourseUnit[] = [
  unit(1, 'Offer and acceptance', {
    status: 'taught',
    taughtOn: '2026-11-03',
    memory: {
      summary: 'What an offer is and when acceptance is complete.',
      terms: ['offer', 'acceptance'],
      openThreads: ['Revocation of an offer'],
    },
  }),
  unit(2, 'Consideration', {
    status: 'taught',
    taughtOn: '2026-11-10',
    memory: {
      summary: 'Consideration and its exceptions under s. 25.',
      terms: ['consideration', 'Offer'],
      cases: [satyabrata],
      runningExample: 'Ravi sells his bicycle to Meena',
    },
  }),
  unit(3, 'Void agreements', {
    status: 'taught',
    taughtOn: '2026-11-17',
    memory: {
      summary: 'Agreements the Act declares void.',
      terms: ['void agreement'],
      cases: [energy],
      openThreads: ['Wagering agreements'],
    },
  }),
  unit(4, 'Frustration', { prerequisites: ['u3'] }),
  unit(5, 'Remedies'),
];

describe('course memory for a new lecture', () => {
  const ctx = courseContext(plan, 'u4');

  it('reads the last two taught lectures, every term and case taught, and the running example', () => {
    expect(ctx.earlier.map((e) => e.position)).toEqual([2, 3]);
    expect(ctx.terms).toEqual(['offer', 'acceptance', 'consideration', 'void agreement']); // "Offer" once
    expect(ctx.cases.map((c) => [c.name, c.position])).toEqual([
      [satyabrata.name, 2],
      [energy.name, 3],
    ]);
    expect(ctx.runningExample).toBe('Ravi sells his bicycle to Meena');
    expect(ctx.openThreads).toEqual(['Wagering agreements']); // L1's thread is older than the last two
    expect(ctx.next).toEqual({ position: 5, title: 'Remedies' });
    expect(ctx.untaughtPrerequisites).toEqual([]);
    expect(hasMemory(ctx)).toBe(true);
  });

  it('names lectures before it that are not taught, and prerequisites not taught (HOME-10)', () => {
    const skipped = plan.map((u) => (u.id === 'u3' ? { ...u, status: 'planned' as const, memory: {} } : u));
    const c = courseContext(skipped, 'u4');
    expect(c.untaughtEarlier).toEqual([{ position: 3, title: 'Void agreements' }]);
    expect(c.untaughtPrerequisites).toEqual([{ position: 3, title: 'Void agreements' }]);
    expect(courseMemoryText(c)).toContain('not taught yet (do not assume the class knows them): L03 Void agreements');
  });

  it('a first lecture has nothing to recap; the last one has no next lecture', () => {
    const first = courseContext([unit(1, 'Intro'), unit(2, 'Next')], 'u1');
    expect(hasMemory(first)).toBe(false);
    expect(courseMemoryText(first)).toContain('No lecture of this course has been marked taught yet.');
    expect(courseContext(plan, 'u5').next).toBeNull();
  });

  it('a lecture with no planned slot reads every taught lecture and bridges to the first one still planned', () => {
    const c = courseContext(plan, null);
    expect(c.earlier.map((e) => e.position)).toEqual([2, 3]);
    expect(c.next?.position).toBe(4);
  });
});

describe('series checks (suggestions only)', () => {
  it('a case taught again, a prerequisite not taught, a lecture taught out of order, too many lectures', () => {
    const units: SeriesUnit[] = [
      unit(1, 'Offer', { status: 'taught', memory: { cases: [satyabrata] } }),
      unit(2, 'Consideration'),
      unit(3, 'Frustration', { status: 'taught', prerequisites: ['u2'], memory: { cases: [satyabrata, energy] } }),
      unit(4, 'Remedies', { lectureCases: [energy], hasLecture: true }),
    ];
    const checks = seriesChecks(units, 3);
    expect(checks.map((c) => [c.kind, c.unitId])).toEqual([
      ['repeated_case', 'u3'],
      ['untaught_prerequisite', 'u3'],
      ['out_of_order', 'u3'],
      ['repeated_case', 'u4'],
      ['too_many_lectures', null],
    ]);
    expect(checks[0]!.message).toBe(
      'L03 teaches Satyabrata Ghose v. Mugneeram Bangur, which L01 (Offer) also uses. A short recap may be enough.',
    );
    expect(checks[2]!.message).toContain('L03 was taught before L02 (Consideration)');
  });

  it('a skipped lecture neither repeats cases nor counts as out of order', () => {
    const units: SeriesUnit[] = [
      unit(1, 'A', { status: 'skipped', memory: { cases: [satyabrata] } }),
      unit(2, 'B', { status: 'taught', memory: { cases: [satyabrata] } }),
    ];
    expect(seriesChecks(units)).toEqual([]);
  });
});

describe('course memory from a taught lecture keeps only what is on the slides', () => {
  const slides =
    'Frustration of contract. Section 56 makes an agreement to do an impossible act void. Supervening impossibility. Ravi hires a hall that burns down.';

  it('drops terms the slides never use', () => {
    expect(termsOnSlides(['supervening impossibility', 'Frustration', 'force majeure', 'frustration'], slides)).toEqual(
      ['supervening impossibility', 'Frustration'],
    );
  });

  it('keeps the running example only when it is on the slides', () => {
    expect(exampleOnSlides('Ravi hires a hall that burns down', slides)).toBe('Ravi hires a hall that burns down');
    expect(exampleOnSlides('A ship is stuck in the Suez Canal', slides)).toBeNull();
    expect(exampleOnSlides(null, slides)).toBeNull();
  });
});

describe('plan order', () => {
  it('puts the recap first and the bridge last', () => {
    const parts = [
      { kind: 'content', t: 'a' },
      { kind: 'bridge', t: 'z' },
      { kind: 'recap', t: 'r' },
      { kind: 'example', t: 'b' },
    ];
    expect(orderParts(parts).map((p) => p.t)).toEqual(['r', 'a', 'b', 'z']);
  });
});
