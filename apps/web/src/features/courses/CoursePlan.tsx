import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Lightbulb, Link2, MoreHorizontal, Pencil, Plus, SkipForward, Trash2, Undo2 } from 'lucide-react';
import type { CourseDetail, CourseUnitView, UpdateUnits } from '@nyaai/shared';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { lectureNo } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Menu } from '@/shared/ui/menu';
import { Page, PageHeader } from '@/shared/ui/page';
import { Pill } from '@/shared/ui/pill';

/**
 * Course plan (LLD §12: ordered lectures with status, taught date and series suggestions; COURSE-3 to COURSE-7).
 * Each row shows what it is and its one next step; everything else is in the row's menu. Suggestions never change
 * the plan: she does.
 */
export function CoursePlanPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // While the background check is finding sources (DATA-3), the plan refreshes itself.
  const course = useQuery({
    queryKey: queryKeys.course(id),
    queryFn: () => api.course(id),
    refetchInterval: (q) => (q.state.data?.units.some((u) => u.sources?.state === 'waiting') ? 5000 : false),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [prereqFor, setPrereqFor] = useState<string | null>(null);
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
  const taught = units.filter((u) => u.status === 'taught').length;
  const planned = units.filter((u) => u.status !== 'skipped').length;
  const next = units.find((u) => u.status === 'planned');

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link to="/courses" className="hover:text-text hover:underline">
            Courses
          </Link>
        }
        title={c.name}
        description={[c.semester, c.classCount ? `${c.classCount} classes` : null, `${taught} of ${planned} taught`].filter(Boolean).join(' · ')}
        actions={
          next && (
            <Button variant="primary" onClick={() => prepare(next)}>
              Prepare {lectureNo(next.position)}
            </Button>
          )
        }
      />

      {checksFor(null).map((x, i) => (
        <p key={i} className="mb-4 flex gap-2 rounded-card border border-border bg-surface px-4 py-3 text-sm">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-flag-yellow" aria-hidden />
          {x.message}
        </p>
      ))}
      {change.error && <p className="mb-4 text-sm text-danger">{change.error instanceof ApiRequestError ? change.error.message : 'That change was not saved.'}</p>}

      <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        {units.map((u, i) => (
          <li key={u.id} className={cn('px-5 py-4', u.status === 'skipped' && 'bg-bg/60')}>
            <div className="flex items-start gap-4">
              <span className={cn('mt-0.5 w-9 shrink-0 text-sm font-semibold tabular-nums', u.status === 'skipped' ? 'text-muted line-through' : 'text-muted')}>{lectureNo(u.position)}</span>
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
                  <p className={cn('font-medium', u.status === 'skipped' && 'text-muted')}>{u.title}</p>
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {u.status === 'taught' ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      Taught {u.taughtOn}
                    </span>
                  ) : u.status === 'skipped' ? (
                    <span>Skipped</span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <CircleDashed className="size-3.5" aria-hidden />
                      {u.lecture ? (u.lecture.status === 'building' ? 'Being prepared' : 'Prepared, not taught') : 'Not prepared'}
                    </span>
                  )}
                  {u.lecture && (
                    <Link to={`/lectures/${u.lecture.id}`} className="text-accent hover:underline">
                      Open lecture
                    </Link>
                  )}
                  {!u.lecture && u.status === 'planned' && u.sources && <SourcesNote s={u.sources} />}
                  {u.prerequisites.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="size-3.5" aria-hidden />
                      Builds on{' '}
                      {u.prerequisites
                        .map((p) => units.find((x) => x.id === p))
                        .filter(Boolean)
                        .map((x) => lectureNo(x!.position))
                        .join(', ')}
                    </span>
                  )}
                </p>
                {checksFor(u.id).map((x, k) => (
                  <p key={k} className="mt-2 flex gap-2 text-sm">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-flag-yellow" aria-hidden />
                    {x.message}
                  </p>
                ))}
                {u.memory && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-muted hover:text-text">What the class learnt</summary>
                    <div className="mt-2 space-y-1.5 rounded-control bg-bg px-3 py-2">
                      {u.memory.summary && <p>{u.memory.summary}</p>}
                      {u.memory.terms.length > 0 && (
                        <p className="flex flex-wrap gap-1">
                          {u.memory.terms.map((t) => (
                            <Pill key={t}>{t}</Pill>
                          ))}
                        </p>
                      )}
                      {u.memory.cases.length > 0 && <p className="text-muted">Cases: {u.memory.cases.join('; ')}</p>}
                      {u.memory.runningExample && <p className="text-muted">Running example: {u.memory.runningExample}</p>}
                      {u.memory.openThreads.length > 0 && <p className="text-muted">Left for a later class: {u.memory.openThreads.join('; ')}</p>}
                    </div>
                  </details>
                )}
                {prereqFor === u.id && (
                  <div className="mt-3 rounded-control bg-bg px-3 py-2 text-sm">
                    <p className="mb-2 font-medium">{lectureNo(u.position)} builds on…</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {units.slice(0, i).map((p) => (
                        <label key={p.id} className="inline-flex items-center gap-1.5">
                          <input type="checkbox" checked={u.prerequisites.includes(p.id)} onChange={() => togglePrereq(u, p.id)} />
                          {lectureNo(p.position)} {p.title}
                        </label>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" className="mt-2" onClick={() => setPrereqFor(null)}>
                      Done
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {u.status === 'planned' && (
                  <Button size="sm" onClick={() => prepare(u)}>
                    {u.lecture ? 'Prepare again' : 'Prepare'}
                  </Button>
                )}
                <Menu
                  label={`More for ${lectureNo(u.position)}`}
                  trigger={
                    <span className="grid size-8 place-items-center rounded-control text-muted hover:bg-bg hover:text-text">
                      <MoreHorizontal className="size-4" aria-hidden />
                    </span>
                  }
                  items={[
                    { label: 'Rename', icon: <Pencil className="size-4 text-muted" aria-hidden />, onSelect: () => (setEditing(u.id), setTitle(u.title)) },
                    { label: 'Move up', icon: <ArrowUp className="size-4 text-muted" aria-hidden />, disabled: i === 0, onSelect: () => move(i, -1) },
                    { label: 'Move down', icon: <ArrowDown className="size-4 text-muted" aria-hidden />, disabled: i === units.length - 1, onSelect: () => move(i, 1) },
                    ...(i > 0 ? [{ label: 'Builds on…', icon: <Link2 className="size-4 text-muted" aria-hidden />, onSelect: () => setPrereqFor(u.id) }] : []),
                    ...(u.status !== 'taught'
                      ? [
                          u.status === 'skipped'
                            ? { label: 'Plan it again', icon: <Undo2 className="size-4 text-muted" aria-hidden />, onSelect: () => change.mutate({ status: [{ id: u.id, status: 'planned' }] }) }
                            : { label: 'Skip this lecture', icon: <SkipForward className="size-4 text-muted" aria-hidden />, onSelect: () => change.mutate({ status: [{ id: u.id, status: 'skipped' }] }) },
                          {
                            label: 'Delete from the plan',
                            danger: true,
                            icon: <Trash2 className="size-4" aria-hidden />,
                            onSelect: () => window.confirm(`Delete ${lectureNo(u.position)} ${u.title} from the plan? Its lecture is kept.`) && change.mutate({ remove: [u.id] }),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </div>
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
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a lecture at the end of the plan" className="flex-1 rounded-control border border-border bg-surface px-3 py-2 text-sm" aria-label="New lecture title" />
        <Button type="submit" disabled={adding.trim().length < 2}>
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>
    </Page>
  );
}

/** What the background check found for a planned lecture (DATA-3), in plain words. */
export function SourcesNote({ s }: { s: NonNullable<CourseUnitView['sources']> }) {
  if (s.state === 'waiting') return <span>Finding sources…</span>;
  if (s.state === 'not_checked') return <span>Sources: checked when you prepare it</span>;
  if (s.state === 'ok') return <span className="text-success">Sources ready ({s.found}){s.loaded ? `, ${s.loaded} newly added` : ''}</span>;
  if (s.state === 'thin') return <span className="text-flag-yellow">Few sources ({s.found}); the library team is told</span>;
  return <span className="text-flag-yellow">No sources found yet; the library team is told</span>;
}
