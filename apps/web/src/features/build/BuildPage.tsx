import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle, Loader2 } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { useEventStream } from '@/shared/hooks/useEventStream';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';
import { BUILD_STEPS, FAILURE_TEXT, initialBuild, reduceBuild, type BuildState } from './build-progress';
import { LoadError } from '@/shared/ui/states';

export function BuildPage() {
  const { lectureId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, setState] = useState<BuildState>(initialBuild);
  const [retrying, setRetrying] = useState(false);
  const lecture = useQuery({
    queryKey: queryKeys.lecture(lectureId),
    queryFn: () => api.lecture(lectureId),
    enabled: !!lectureId,
  });

  useEventStream((e) => {
    setState((s) => reduceBuild(s, e, lectureId));
    if (
      'lectureId' in e &&
      e.lectureId === lectureId &&
      (e.type === 'build.outline' || e.type === 'build.done' || e.type === 'build.failed')
    ) {
      void qc.invalidateQueries({ queryKey: queryKeys.lecture(lectureId) });
    }
  });

  // Coming back to this page after the build ended: take the saved state.
  const saved = lecture.data;
  const finished = state.finished || saved?.status === 'ready';
  const failed = state.failed ?? (saved?.status === 'failed' ? (saved.errorCode ?? 'BUILD_FAILED') : null);
  const total = state.parts.total ?? saved?.plan?.parts.length ?? null;
  const ready = Math.max(state.parts.ready, saved?.partsDone.length ?? 0);

  useEffect(() => {
    if (state.finished) void navigate(`/lectures/${lectureId}`);
  }, [state.finished, lectureId, navigate]);

  async function retry() {
    setRetrying(true);
    try {
      await api.retryBuild(lectureId);
      setState({ ...initialBuild, outline: !!saved?.plan });
      void qc.invalidateQueries({ queryKey: queryKeys.lecture(lectureId) });
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-1 text-2xl font-semibold">Preparing your lecture</h1>
      <p className="mb-8 text-sm text-muted">
        {saved?.topic ? `${saved.topic}. ` : ''}You can leave this page; the lecture keeps building.
      </p>
      {lecture.isError && !state.done.size && (
        <LoadError what="This lecture's progress" onRetry={() => void lecture.refetch()} className="mb-6" />
      )}
      <ol className="space-y-4" aria-live="polite">
        {BUILD_STEPS.map((s) => {
          const isDone = finished || state.done.has(s.key);
          const isNow = !finished && !failed && state.current === s.key;
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
                {s.key === 'writing' && total ? ` (${Math.min(ready, total)} of ${total} parts)` : ''}
              </span>
              <span className="sr-only">{isDone ? 'done' : isNow ? 'in progress' : 'waiting'}</span>
            </li>
          );
        })}
      </ol>

      {(state.outline || saved?.plan) && saved?.plan && (
        <section className="mt-8 rounded-card border border-border bg-surface p-4" aria-label="Outline">
          <h2 className="mb-2 text-sm font-medium">Outline</h2>
          <ol className="space-y-1 text-sm">
            {saved.plan.parts.map((p, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{p.title}</span>
                <span className="shrink-0 text-muted">{p.minutes} min</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {failed && (
        <div role="alert" className="mt-6 space-y-3">
          <p className="text-sm text-danger">
            {FAILURE_TEXT[failed] ?? 'The lecture could not be finished. You can try again; finished parts are kept.'}
          </p>
          {failed !== 'BUDGET_EXHAUSTED' && (
            <Button variant="secondary" onClick={() => void retry()} disabled={retrying}>
              Try again
            </Button>
          )}
        </div>
      )}
      <div className="mt-8">
        <Button
          variant="primary"
          size="lg"
          disabled={!finished}
          onClick={() => void navigate(`/lectures/${lectureId}`)}
        >
          Open in Studio
        </Button>
      </div>
    </div>
  );
}
