import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';

/** One topic per line; numbering and bullets from a pasted syllabus are dropped. */
export function topicsFrom(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\(?\d{1,3}[.)]|L\d{1,3}[:.)-]?|Unit\s+\d+[:.)-]?)\s*/i, '').trim())
    .filter((l) => l.length >= 2)
    .slice(0, 80);
}

/** Courses (COURSE-1, COURSE-2): her courses, and a new one from a pasted list of topics. */
export function CourseListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: queryKeys.courses, queryFn: api.courses });
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [classCount, setClassCount] = useState('');
  const [topics, setTopics] = useState('');
  const create = useMutation({
    mutationFn: () => api.createCourse({ name, semester: semester || undefined, classCount: classCount ? Number(classCount) : undefined, topics: topicsFrom(topics) }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: queryKeys.courses });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      void navigate(`/courses/${c.id}`);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const planned = topicsFrom(topics).length;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Courses</h1>
      {list.data?.courses.length ? (
        <ul className="mb-10 divide-y divide-border rounded-card border border-border bg-surface">
          {list.data.courses.map((c) => (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-bg">
                <span className="font-medium">{c.name}</span>
                <span className="text-sm text-muted">
                  {c.semester ? `${c.semester} · ` : ''}
                  {c.taught} of {c.lectures} taught
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-10 text-sm text-muted">{list.isLoading ? 'Loading…' : 'No courses yet. Lectures in a course open with a recap of the last class and end with a link to the next.'}</p>
      )}

      <form onSubmit={submit} className="space-y-4 rounded-card border border-border bg-surface p-4 text-sm">
        <h2 className="text-base font-semibold">New course</h2>
        <label className="block">
          <span className="mb-1 block font-medium">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Alternative Dispute Resolution" className="w-full rounded-control border border-border bg-bg px-2 py-2" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-medium">Semester (optional)</span>
            <input value={semester} onChange={(e) => setSemester(e.target.value)} placeholder="Semester VII" className="w-full rounded-control border border-border bg-bg px-2 py-2" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium">Number of classes (optional)</span>
            <input type="number" min={1} max={80} value={classCount} onChange={(e) => setClassCount(e.target.value)} className="w-full rounded-control border border-border bg-bg px-2 py-2" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block font-medium">Lectures, one per line (optional)</span>
          <textarea value={topics} onChange={(e) => setTopics(e.target.value)} rows={8} placeholder={'Arbitration agreement\nComposition of the tribunal\nInterim measures'} className="w-full rounded-control border border-border bg-bg px-2 py-2" />
          <span className="mt-1 block text-xs text-muted">Paste the topics from your syllabus. You can reorder, rename and add lectures later.{planned ? ` ${planned} lectures.` : ''}</span>
        </label>
        {create.error && <p className="text-flag-yellow">{create.error instanceof ApiRequestError ? create.error.message : 'The course was not saved. Try again.'}</p>}
        <Button type="submit" variant="primary" disabled={create.isPending || name.trim().length < 2}>
          {create.isPending ? 'Saving…' : 'Create course'}
        </Button>
      </form>
    </div>
  );
}
