import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/shared/api/client';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';
import { NewCourseForm } from './NewCourseForm';
import { PageHeader } from '@/shared/ui/page';

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
