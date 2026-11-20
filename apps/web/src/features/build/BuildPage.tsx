import { useState } from 'react';
import { useParams } from 'react-router';
import { Check, Circle, Loader2 } from 'lucide-react';
import type { LiveEvent } from '@nyaai/shared';
import { useEventStream } from '@/shared/hooks/useEventStream';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

/** The four real steps (BUILD-1, LLD §12.3): no fake progress bar, only what the build reports. */
export const BUILD_STEPS = [
  { key: 'sources', label: 'Finding sources' },
  { key: 'planning', label: 'Planning the lecture' },
  { key: 'writing', label: 'Writing slides' },
  { key: 'checking', label: 'Checking every statement' },
] as const;
type StepKey = (typeof BUILD_STEPS)[number]['key'];

interface BuildState {
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
      return { ...state, current: e.step, done, parts: { ...state.parts, total: e.partsTotal ?? state.parts.total } };
    }
    case 'build.outline':
      return { ...state, outline: true };
    case 'build.part_ready':
      return { ...state, parts: { ...state.parts, ready: state.parts.ready + 1 } };
    case 'build.done':
      return { ...state, current: null, done: new Set(BUILD_STEPS.map((s) => s.key)), finished: true };
    case 'build.failed':
      return { ...state, failed: e.errorCode };
    default:
      return state;
  }
}

export const initialBuild: BuildState = { current: null, done: new Set(), outline: false, parts: { ready: 0, total: null }, finished: false, failed: null };

export function BuildPage() {
  const { lectureId = '' } = useParams();
  const [state, setState] = useState<BuildState>(initialBuild);
  useEventStream((e) => setState((s) => reduceBuild(s, e, lectureId)));

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-semibold">Preparing your lecture</h1>
      <p className="mb-8 text-sm text-muted">You can leave this page; the lecture keeps building.</p>
      <ol className="space-y-4" aria-live="polite">
        {BUILD_STEPS.map((s) => {
          const isDone = state.done.has(s.key);
          const isNow = state.current === s.key;
          return (
            <li key={s.key} className="flex items-center gap-3">
              {isDone ? (
                <Check className="size-5 text-success" aria-hidden />
              ) : isNow ? (
                <Loader2 className="size-5 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
              ) : (
                <Circle className="size-5 text-border" aria-hidden />
              )}
              <span className={cn('text-base', !isDone && !isNow && 'text-muted')}>
                {s.label}
                {s.key === 'writing' && state.parts.total ? ` (${state.parts.ready} of ${state.parts.total} parts)` : ''}
              </span>
              <span className="sr-only">{isDone ? 'done' : isNow ? 'in progress' : 'waiting'}</span>
            </li>
          );
        })}
      </ol>
      {state.outline && <p className="mt-6 text-sm">The outline is ready.</p>}
      {state.failed && (
        <p role="alert" className="mt-6 text-sm text-danger">
          The lecture could not be finished. You can try again; finished parts are kept.
        </p>
      )}
      <div className="mt-8">
        <Button variant="primary" size="lg" disabled={!state.finished}>
          Open in Studio
        </Button>
      </div>
    </div>
  );
}
