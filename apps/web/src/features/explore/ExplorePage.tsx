import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Compass, Search } from 'lucide-react';
import { api, queryKeys } from '@/shared/api/client';
import { EmptyState, ListSkeleton, LoadError } from '@/shared/ui/states';

/**
 * Explore (EXP-1): the topics the library knows well (the expert's concept list), by subject. A topic opens its map:
 * key sections, leading cases, open questions, and a box for follow-up questions.
 */
export function ExplorePage() {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: queryKeys.concepts(''), queryFn: () => api.exploreConcepts() });
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = list.data?.concepts ?? [];
    return t
      ? all.filter((c) => c.name.toLowerCase().includes(t) || c.aliases.some((a) => a.toLowerCase().includes(t)))
      : all;
  }, [list.data, q]);
  const bySubject = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const c of shown) m.set(c.subject, [...(m.get(c.subject) ?? []), c]);
    return [...m.entries()];
  }, [shown]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Compass className="size-6" aria-hidden />
        Explore
      </h1>
      <p className="mt-2 max-w-prose text-sm text-muted">
        Look into a topic before you teach it: its key sections, leading cases and open questions, with answers from the
        library only.
      </p>
      <label className="relative mt-6 block">
        <span className="sr-only">Find a topic</span>
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a topic, e.g. lis pendens"
          className="h-10 w-full rounded-control border border-border bg-surface pl-9 pr-3 text-sm"
        />
      </label>
      <div className="mt-6">
        {list.isLoading && <ListSkeleton rows={4} label="Loading the topics" />}
        {list.isError && <LoadError what="The topics" onRetry={() => void list.refetch()} />}
        {list.isSuccess && shown.length === 0 && (
          <EmptyState title="No topic by that name">
            The library team adds topics as the library grows. You can still prepare a lecture on any topic from
            Prepare.
          </EmptyState>
        )}
        {bySubject.map(([subject, concepts]) => (
          <section key={subject} aria-labelledby={`subj-${subject}`} className="mb-8">
            <h2 id={`subj-${subject}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              {subject}
            </h2>
            <ul className="divide-y divide-border rounded-card border border-border bg-surface">
              {concepts.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/explore/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-bg"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {c.keySections} {c.keySections === 1 ? 'section' : 'sections'} · {c.leadingCases}{' '}
                      {c.leadingCases === 1 ? 'case' : 'cases'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
