import { describe, expect, it } from 'vitest';
import { BUILD_STEPS, initialBuild, reduceBuild } from './BuildPage';

const L = '00000000-0000-4000-8000-0000000000aa';

describe('Build screen state (LLD §4.4)', () => {
  it('moves through the real steps from events and counts parts', () => {
    let s = reduceBuild(initialBuild, { type: 'build.step', lectureId: L, step: 'sources' }, L);
    expect(s.current).toBe('sources');
    s = reduceBuild(s, { type: 'build.step', lectureId: L, step: 'writing', partsTotal: 4 }, L);
    expect([...s.done]).toEqual(['sources', 'planning']);
    s = reduceBuild(s, { type: 'build.part_ready', lectureId: L, partIndex: 0 }, L);
    expect(s.parts).toEqual({ ready: 1, total: 4 });
    s = reduceBuild(s, { type: 'build.done', lectureId: L }, L);
    expect(s.finished).toBe(true);
    expect(s.done.size).toBe(BUILD_STEPS.length);
  });

  it('ignores events for other lectures and other kinds of events', () => {
    const other = reduceBuild(initialBuild, { type: 'build.step', lectureId: '00000000-0000-4000-8000-0000000000bb', step: 'checking' }, L);
    expect(other).toBe(initialBuild);
    expect(reduceBuild(initialBuild, { type: 'notify', kind: 'x', title: 'y' }, L)).toBe(initialBuild);
  });
});
