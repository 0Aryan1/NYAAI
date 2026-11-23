import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';

/**
 * Coverage panel (LLD §8.5, §12.4): missing provisos, exceptions, explanations, clauses and leading cases grouped per
 * section; the "Left out of this lecture" list; questions the library could not answer. Only her tick clears a note.
 */
export function CoveragePanel({ lectureId }: { lectureId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.coverage(lectureId), queryFn: () => api.coverage(lectureId) });
  const leave = useMutation({
    mutationFn: api.leaveOut,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.coverage(lectureId) });
      void qc.invalidateQueries({ queryKey: queryKeys.lecture(lectureId) });
    },
  });
  const d = q.data;
  if (!d) return <p className="text-sm text-muted">{q.isError ? 'Coverage could not be loaded.' : 'Loading coverage…'}</p>;
  const missingGroups = d.groups.filter((g) => g.missing > 0);

  return (
    <section aria-label="Coverage" className="space-y-6 text-sm">
      <div>
        <p className="text-muted">
          {d.score === null ? 'Nothing in the cited sections needs a separate mention.' : `${Math.round(d.score * 100)}% of the provisos, exceptions and clauses of the sections you teach are covered.`}
        </p>
      </div>

      {missingGroups.length > 0 && (
        <ul className="space-y-3">
          {missingGroups.map((g) => (
            <li key={g.sectionKey} className="rounded-card bg-flag-coverage-bg p-3">
              <p className="font-medium text-flag-coverage">
                {g.title}: {g.missing} of {g.total} not covered
              </p>
              <ul className="mt-2 space-y-2">
                {g.items
                  .filter((i) => i.state === 'missing')
                  .map((i) => (
                    <li key={i.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">Missing: {i.label}</span>
                        <Button size="sm" variant="ghost" disabled={leave.isPending} onClick={() => leave.mutate(i.id)} title="Confirm you are leaving this out on purpose">
                          Leave out
                        </Button>
                      </div>
                      {i.text && (
                        <blockquote className="mt-2 whitespace-pre-line border-l-2 border-flag-coverage/50 pl-3 text-[13px] leading-relaxed">
                          <span className="mb-1 block text-xs text-muted">What the Act says:</span>
                          {i.text.trim()}
                        </blockquote>
                      )}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {d.leftOut.some((i) => i.state === 'missing') && (
        <div>
          <h3 className="mb-2 font-medium">Left out of this lecture</h3>
          <ul className="space-y-2">
            {d.leftOut
              .filter((i) => i.state === 'missing')
              .map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-2">
                  <span>
                    {i.label}
                    {i.reason && <span className="block text-xs text-muted">{i.reason}</span>}
                  </span>
                  <Button size="sm" variant="ghost" disabled={leave.isPending} onClick={() => leave.mutate(i.id)} title="Confirm this is meant to be left out">
                    Okay
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      )}

      {d.notFound.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium">Not found in the library</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {d.notFound.map((n, i) => (
              <li key={i}>{n.question}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The library team has been told, so these can be added.</p>
        </div>
      )}
    </section>
  );
}
