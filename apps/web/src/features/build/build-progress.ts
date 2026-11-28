/**
 * A build's progress as the live events report it (BUILD-1, LLD §12.3): the real steps, no fake progress bar, and
 * plain words for a failure. `reduceBuild` folds one event into the state; events for other lectures are ignored.
 */
import type { LiveEvent } from '@nyaai/shared';
import { BUDGET_EXHAUSTED_TEXT } from '@/shared/lib/errors';

/** The real steps (BUILD-1, LLD §12.3): no fake progress bar, only what the build reports. */
export const BUILD_STEPS = [
  { key: 'sources', label: 'Reading the topic' },
  { key: 'planning', label: 'Planning the lecture' },
  { key: 'research', label: 'Researching: sources for every part, then the gaps' },
  { key: 'writing', label: 'Writing slides' },
  { key: 'checking', label: 'Checking every statement' },
] as const;

type StepKey = (typeof BUILD_STEPS)[number]['key'];

/** Plain words for a failed build (LLD §12.6, §12.8): what happened and what to do. */
export const FAILURE_TEXT: Record<string, string> = {
  BUDGET_EXHAUSTED: BUDGET_EXHAUSTED_TEXT,
  SERVICE_UNAVAILABLE:
    'The checking service is busy or down right now. Try again in a few minutes; finished parts are kept.',
  BUILD_TIMEOUT: 'This lecture took too long to prepare. Try again; finished parts are kept.',
};

export interface BuildState {
  current: StepKey | null;
  done: Set<StepKey>;
  outline: boolean;
  parts: { ready: number; total: number | null };
  finished: boolean;
  failed: string | null;
}

export function reduceBuild(state: BuildState, e: LiveEvent, lectureId: string): BuildState {
  if (!('lectureId' in e) || e.lectureId !== lectureId) return state;
  switch (e.type) {
    case 'build.step': {
      if (e.step === 'saving') return state;
      const order = BUILD_STEPS.map((s) => s.key);
      const done = new Set(order.slice(0, order.indexOf(e.step)));
      return {
        ...state,
        current: e.step,
        done,
        failed: null,
        parts: { ...state.parts, total: e.partsTotal ?? state.parts.total },
      };
    }
    case 'build.outline':
      return { ...state, outline: true };
    case 'build.part_ready':
      return { ...state, parts: { ...state.parts, ready: state.parts.ready + 1 } };
    case 'build.done':
      return { ...state, current: null, done: new Set(BUILD_STEPS.map((s) => s.key)), finished: true };
    case 'build.failed':
      return { ...state, current: null, failed: e.errorCode };
    default:
      return state;
  }
}

export const initialBuild: BuildState = {
  current: null,
  done: new Set(),
  outline: false,
  parts: { ready: 0, total: null },
  finished: false,
  failed: null,
};
