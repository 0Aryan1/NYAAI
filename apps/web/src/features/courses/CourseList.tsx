import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import type { SyllabusPreview } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { DOCUMENT_ACCEPT } from '@/shared/lib/files';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { PageHeader } from '@/shared/ui/page';
import { topicsFrom } from './plan';
import { errorText } from '@/shared/lib/errors';

/** Courses (COURSE-1, COURSE-2): her courses, and a new one from her syllabus file, a pasted list of topics, or empty. */
export function CourseListPage() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: queryKeys.courses, queryFn: api.courses });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader className="mb-6" title="Courses" />
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
      ) : list.isLoading ? (
        <ListSkeleton rows={2} label="Loading your courses" className="mb-10" />
      ) : list.isError ? (
        <LoadError what="Your courses" onRetry={() => void list.refetch()} className="mb-10" />
      ) : (
        <div className="mb-10">
          <EmptyState title="No courses yet">
            Lectures in a course open with a recap of the last class and end with a link to the next. Make your first
            course below.
          </EmptyState>
        </div>
      )}

      <NewCourseForm onCreated={(id) => void navigate(`/courses/${id}`)} />
    </div>
  );
}

/** A new course: from her syllabus file, a pasted list of topics, or empty. Also the last step of Setup. */
export function NewCourseForm({
  onCreated,
  title = 'New course',
}: {
  onCreated: (courseId: string) => void;
  title?: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [classCount, setClassCount] = useState('');
  const [topics, setTopics] = useState('');
  // Her syllabus, read by the server (not kept): she picks one lecture per unit or per topic, then edits the list.
  const [syllabus, setSyllabus] = useState<SyllabusPreview | null>(null);
  const [per, setPer] = useState<'unit' | 'topic'>('topic');
  const [findSources, setFindSources] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const applyPlan = (s: SyllabusPreview, p: 'unit' | 'topic') => {
    setPer(p);
    setTopics((p === 'unit' ? s.perUnit : s.perTopic).join('\n'));
  };
  const create = useMutation({
    mutationFn: () =>
      api.createCourse({
        name,
        semester: semester || undefined,
        classCount: classCount ? Number(classCount) : undefined,
        topics: topicsFrom(topics),
        findSources: findSources && topicsFrom(topics).length > 0,
      }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: queryKeys.courses });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
      // Ready for the next course (Setup stays on this step).
      setName('');
      setSemester('');
      setClassCount('');
      setTopics('');
      setSyllabus(null);
      setFindSources(false);
      onCreated(c.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const planned = topicsFrom(topics).length;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-card border border-border bg-surface p-4 text-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <label className="block">
        <span className="mb-1 block font-medium">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          placeholder="Alternative Dispute Resolution"
          className="w-full rounded-control border border-border bg-bg px-2 py-2"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-medium">Semester (optional)</span>
          <input
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            placeholder="Semester VII"
            className="w-full rounded-control border border-border bg-bg px-2 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium">Number of classes (optional)</span>
          <input
            type="number"
            min={1}
            max={80}
            value={classCount}
            onChange={(e) => setClassCount(e.target.value)}
            className="w-full rounded-control border border-border bg-bg px-2 py-2"
          />
        </label>
      </div>
      <div className="rounded-control border border-dashed border-border bg-bg p-3">
        <input
          ref={file}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="sr-only"
          aria-label="Upload your syllabus"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setReadError(null);
            setReading(true);
            try {
              const s = await api.readSyllabus(f, classCount ? Number(classCount) : undefined);
              setSyllabus(s);
              if (!name.trim() && s.courseName) setName(s.courseName.slice(0, 120));
              applyPlan(s, s.suggested);
              setFindSources(true);
            } catch (err) {
              setReadError(errorText(err, 'We could not read that file. Paste the topics instead.'));
            } finally {
              setReading(false);
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={reading} onClick={() => file.current?.click()}>
            <FileUp className="size-4" aria-hidden />
            {reading ? 'Reading…' : 'Upload your syllabus'}
          </Button>
          <span className="text-xs text-muted">
            Word, PDF or text. We list its lectures below for you to check; the file is not kept.
          </span>
        </div>
        {readError && <p className="mt-2 text-xs text-danger">{readError}</p>}
        {syllabus && syllabus.perUnit.length !== syllabus.perTopic.length && (
          <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-xs text-muted">We found {syllabus.units.length} units. Plan it as:</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="per" checked={per === 'unit'} onChange={() => applyPlan(syllabus, 'unit')} />
              one lecture per unit ({syllabus.perUnit.length})
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="per" checked={per === 'topic'} onChange={() => applyPlan(syllabus, 'topic')} />
              one lecture per topic ({syllabus.perTopic.length})
            </label>
          </fieldset>
        )}
      </div>
      <label className="block">
        <span className="mb-1 block font-medium">Lectures, one per line (optional)</span>
        <textarea
          value={topics}
          onChange={(e) => setTopics(e.target.value)}
          rows={8}
          placeholder={'Arbitration agreement\nComposition of the tribunal\nInterim measures'}
          className="w-full rounded-control border border-border bg-bg px-2 py-2"
        />
        <span className="mt-1 block text-xs text-muted">
          {syllabus
            ? 'Check the list: fix any line we read wrongly, delete what is not a lecture.'
            : 'Or paste the topics from your syllabus.'}{' '}
          You can reorder, rename and add lectures later.
          {planned ? ` ${planned} lectures.` : ''}
        </span>
      </label>
      {planned > 0 && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={findSources}
            onChange={(e) => setFindSources(e.target.checked)}
          />
          <span>
            Find the sources for every lecture now
            <span className="block text-xs text-muted">
              The library looks up the Acts and judgments for each lecture in the background, so they are ready when you
              prepare it.
            </span>
          </span>
        </label>
      )}
      {create.error && (
        <p className="text-flag-yellow">{errorText(create.error, 'The course was not saved. Try again.')}</p>
      )}
      <Button type="submit" variant="primary" disabled={create.isPending || name.trim().length < 2}>
        {create.isPending ? 'Saving…' : 'Create course'}
      </Button>
    </form>
  );
}
