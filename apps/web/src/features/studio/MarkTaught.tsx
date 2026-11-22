import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import type { LectureSummary } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';

/** Today in India, as YYYY-MM-DD (dates are shown in IST). */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * COURSE-7: mark the lecture taught. Only then does the course remember it (summary, terms, cases), so the next
 * lecture can open with a recap. Undo clears that memory.
 */
export function MarkTaught({ lecture }: { lecture: LectureSummary }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIst());
  const [open, setOpen] = useState(false);
  const done = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.lecture(lecture.id) });
    if (lecture.course) void qc.invalidateQueries({ queryKey: queryKeys.course(lecture.course.id) });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
    setOpen(false);
  };
  const mark = useMutation({ mutationFn: () => api.markTaught(lecture.id, date), onSuccess: done });
  const undo = useMutation({ mutationFn: () => api.undoTaught(lecture.id), onSuccess: done });
  const err = mark.error ?? undo.error;

  if (lecture.status === 'taught') {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        Taught on {lecture.taughtOn}
        {lecture.course && (
          <Link to={`/courses/${lecture.course.id}`} className="text-muted underline">
            {lecture.course.name}
          </Link>
        )}
        <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate()}>
          Undo
        </Button>
      </span>
    );
  }
  if (lecture.status !== 'ready') return null;
  return open ? (
    <form
      className="inline-flex items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        mark.mutate();
      }}
    >
      <label className="inline-flex items-center gap-1">
        Taught on
        <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} required className="rounded-control border border-border bg-bg px-2 py-1" />
      </label>
      <Button size="sm" type="submit" variant="primary" disabled={mark.isPending}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {err && <span className="text-flag-yellow">{err instanceof ApiRequestError ? err.message : 'Not saved. Try again.'}</span>}
    </form>
  ) : (
    <Button title={lecture.course ? 'The next lecture in the course will open with a recap of this one' : undefined} onClick={() => setOpen(true)}>
      <CheckCircle2 className="size-4" aria-hidden />
      Mark taught
    </Button>
  );
}
