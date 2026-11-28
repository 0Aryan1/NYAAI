/**
 * A course plan's rules, without the screen: topics from a pasted list, moving a lecture up or down, a lecture's
 * "builds on" list, and the plan's counts. Each change is sent as the one request the server takes (UpdateUnits).
 */
import type { CourseUnitView, UpdateUnits } from '@nyaai/shared';
/** One topic per line; numbering and bullets from a pasted syllabus are dropped. */
export function topicsFrom(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\(?\d{1,3}[.)]|L\d{1,3}[:.)-]?|Unit\s+\d+[:.)-]?)\s*/i, '').trim())
    .filter((l) => l.length >= 2)
    .slice(0, 80);
}

/** The plan's order with lecture `i` swapped with its neighbour (`dir` -1 up, 1 down). */
export function moved(units: readonly Pick<CourseUnitView, 'id'>[], i: number, dir: -1 | 1): UpdateUnits {
  const order = units.map((u) => u.id);
  [order[i], order[i + dir]] = [order[i + dir]!, order[i]!];
  return { order };
}

/** Lecture `u` builds on `pre`, or no longer does. */
export function togglePrerequisite(u: Pick<CourseUnitView, 'id' | 'prerequisites'>, pre: string): UpdateUnits {
  return {
    prerequisites: [
      {
        id: u.id,
        prerequisites: u.prerequisites.includes(pre)
          ? u.prerequisites.filter((x) => x !== pre)
          : [...u.prerequisites, pre],
      },
    ],
  };
}

/** Taught, planned (all but skipped), and the next lecture to prepare. */
export function planProgress<U extends Pick<CourseUnitView, 'status'>>(units: readonly U[]) {
  return {
    taught: units.filter((u) => u.status === 'taught').length,
    planned: units.filter((u) => u.status !== 'skipped').length,
    next: units.find((u) => u.status === 'planned'),
  };
}
