import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Lightbulb, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CourseDetail, CourseUnitView, UpdateUnits } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

const no = (p: number) => `L${String(p).padStart(2, '0')}`;
const STATUS: Record<CourseUnitView['status'], string> = { planned: 'Planned', taught: 'Taught', skipped: 'Skipped' };

/**
 * Course plan (LLD §12: ordered units with status, taught date and series-check warnings; COURSE-3 to COURSE-7).
 * Series checks are suggestions: nothing changes unless she does it here.
 */
export function CoursePlanPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const course = useQuery({ queryKey: queryKeys.course(id), queryFn: () => api.course(id) });
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState('');
  const change = useMutation({
    mutationFn: (body: UpdateUnits) => api.updateUnits(id, body),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.course(id), data);
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      setEditing(null);
    },
  });

  if (course.isError) return <p role="alert" className="text-danger">This course could not be opened.</p>;
  const c: CourseDetail | undefined = course.data;
  if (!c) return <p className="text-muted">Opening the course…</p>;
  const units = c.units;
  const move = (i: number, dir: -1 | 1) => {
    const order = units.map((u) => u.id);
    [order[i], order[i + dir]] = [order[i + dir]!, order[i]!];
    change.mutate({ order });
  };
  const checksFor = (unitId: string | null) => c.checks.filter((x) => x.unitId === unitId);
  const prepare = (u: CourseUnitView) => void navigate(`/?course=${c.id}&unit=${u.id}&topic=${encodeURIComponent(u.title)}`);
  const togglePrereq = (u: CourseUnitView, pre: string) =>
    change.mutate({ prerequisites: [{ id: u.id, prerequisites: u.prerequisites.includes(pre) ? u.prerequisites.filter((x) => x !== pre) : [...u.prerequisites, pre] }] });

  return (
    <div className="mx-auto max-w-3xl">
      <p className="mb-1 text-sm">
        <Link to="/courses" className="text-muted hover:underline">
          Courses
        </Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold">{c.name}</h1>
      <p className="mb-6 text-sm text-muted">
        {[c.semester, c.classCount ? `${c.classCount} classes` : null, `${units.filter((u) => u.status === 'taught').length} of ${units.filter((u) => u.status !== 'skipped').length} taught`].filter(Boolean).join(' · ')}
      </p>

      {checksFor(null).map((x, i) => (
        <p key={i} className="mb-4 flex gap-2 rounded-card border border-border bg-surface p-3 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-flag-yellow" aria-hidden />
          {x.message}
        </p>
      ))}
      {change.error && <p className="mb-4 text-sm text-flag-yellow">{change.error instanceof ApiRequestError ? change.error.message : 'That change was not saved.'}</p>}

      <ol className="space-y-3">
        {units.map((u, i) => (
          <li key={u.id} className={cn('rounded-card border border-border bg-surface p-4', u.status === 'skipped' && 'opacity-60')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {editing === u.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      change.mutate({ rename: [{ id: u.id, title }] });
                    }}
                    className="flex gap-2"
                  >
                    <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus minLength={2} className="flex-1 rounded-control border border-border bg-bg px-2 py-1 text-sm" aria-label="Lecture title" />
                    <Button size="sm" type="submit" variant="primary">
                      Save
                    </Button>
                    <Button size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <p className="font-medium">
                    <span className="mr-2 text-muted">{no(u.position)}</span>
                    {u.title}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  <span className={cn(u.status === 'taught' && 'text-success')}>{STATUS[u.status]}</span>
                  {u.taughtOn ? ` on ${u.taughtOn}` : ''}
                  {u.lecture && (
                    <>
                      {' · '}
                      <Link to={`/lectures/${u.lecture.id}`} className="underline">
                        {u.lecture.status === 'building' ? 'being prepared' : 'open lecture'}
                      </Link>
                    </>
                  )}
                  {u.prerequisites.length > 0 && ` · builds on ${u.prerequisites.map((p) => units.find((x) => x.id === p)).filter(Boolean).map((x) => no(x!.position)).join(', ')}`}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {u.status !== 'taught' && (
                  <Button size="sm" variant={u.status === 'planned' && !u.lecture ? 'primary' : 'secondary'} onClick={() => prepare(u)}>
                    {u.lecture ? 'Prepare again' : 'Prepare'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={i === 0 || change.isPending} onClick={() => move(i, -1)} aria-label={`Move ${no(u.position)} up`}>
                  <ArrowUp className="size-4" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" disabled={i === units.length - 1 || change.isPending} onClick={() => move(i, 1)} aria-label={`Move ${no(u.position)} down`}>
                  <ArrowDown className="size-4" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(u.id);
                    setTitle(u.title);
                  }}
                  aria-label={`Rename ${no(u.position)}`}
                >
                  <Pencil className="size-4" aria-hidden />
                </Button>
                {u.status !== 'taught' && (
                  <Button size="sm" variant="ghost" onClick={() => window.confirm(`Delete ${no(u.position)} ${u.title} from the plan? Its lecture is kept.`) && change.mutate({ remove: [u.id] })} aria-label={`Delete ${no(u.position)}`}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>

            {checksFor(u.id).map((x, k) => (
              <p key={k} className="mt-3 flex gap-2 text-sm">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-flag-yellow" aria-hidden />
                {x.message}
              </p>
            ))}

            {u.memory && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">What the class learnt (used for the next recap)</summary>
                <div className="mt-2 space-y-1">
                  {u.memory.summary && <p>{u.memory.summary}</p>}
                  {u.memory.terms.length > 0 && <p className="text-muted">Terms: {u.memory.terms.join(', ')}</p>}
                  {u.memory.cases.length > 0 && <p className="text-muted">Cases: {u.memory.cases.join('; ')}</p>}
                  {u.memory.runningExample && <p className="text-muted">Running example: {u.memory.runningExample}</p>}
                  {u.memory.openThreads.length > 0 && <p className="text-muted">For a later class: {u.memory.openThreads.join('; ')}</p>}
                </div>
              </details>
            )}

            {i > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-muted">Builds on…</summary>
                <div className="mt-2 flex flex-wrap gap-3">
                  {units.slice(0, i).map((p) => (
                    <label key={p.id} className="inline-flex items-center gap-1">
                      <input type="checkbox" checked={u.prerequisites.includes(p.id)} onChange={() => togglePrereq(u, p.id)} />
                      {no(p.position)} {p.title}
                    </label>
                  ))}
                </div>
              </details>
            )}

            {u.status !== 'taught' && (
              <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={u.status === 'skipped'} onChange={(e) => change.mutate({ status: [{ id: u.id, status: e.target.checked ? 'skipped' : 'planned' }] })} />
                Skip this lecture
              </label>
            )}
          </li>
        ))}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim().length >= 2) change.mutate({ add: [{ title: adding.trim() }] }, { onSuccess: () => setAdding('') });
        }}
        className="mt-4 flex gap-2"
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a lecture at the end" className="flex-1 rounded-control border border-border bg-bg px-2 py-2 text-sm" aria-label="New lecture title" />
        <Button type="submit" disabled={adding.trim().length < 2}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
    </div>
  );
}
