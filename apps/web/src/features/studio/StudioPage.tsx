import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleHelp, Download, ListChecks } from 'lucide-react';
import type { StudioSlide } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { useEventStream } from '@/shared/hooks/useEventStream';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';
import { SlideCanvas } from './SlideCanvas';
import { CoveragePanel } from './CoveragePanel';
import { SourceDrawer } from './SourceDrawer';

/** Every open (yellow) line in slide order, for N / Shift+N. */
export function openPoints(slides: StudioSlide[]): { slide: number; lineKey: string }[] {
  return slides.flatMap((s, i) => [...s.lines, ...s.notes].filter((l) => l.flag === 'yellow').map((l) => ({ slide: i, lineKey: l.lineKey })));
}

/**
 * Lecture Studio, reading view (LLD §12.3): outline left, the slide in the centre, source and coverage right.
 * Header counts: yellow points, grey cases, coverage notes, coverage score. Editing and Download arrive on Day 4.
 * Keys: [ and ] previous / next slide; N and Shift+N next / previous point to verify.
 */
export function StudioPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const lecture = useQuery({ queryKey: queryKeys.lecture(id), queryFn: () => api.lecture(id) });
  const slidesQ = useQuery({ queryKey: queryKeys.slides(id), queryFn: () => api.slides(id) });
  const slides = useMemo(() => slidesQ.data?.slides ?? [], [slidesQ.data]);
  const [current, setCurrent] = useState(0);
  const [citation, setCitation] = useState<string | null>(null);
  const [activeLine, setActiveLine] = useState<string | null>(null);
  // Slide view by default; check view shows every source as a chip and every grey case as a pill.
  const [showChecks, setShowChecks] = useState(false);
  const points = useMemo(() => openPoints(slides), [slides]);

  useEventStream((e) => {
    if ('lectureId' in e && e.lectureId === id && (e.type === 'build.part_ready' || e.type === 'build.done')) void qc.invalidateQueries({ queryKey: ['lecture', id] });
  });

  const jump = useCallback(
    (dir: 1 | -1) => {
      if (!points.length) return;
      const here = points.findIndex((p) => p.slide === current && p.lineKey === activeLine);
      const next = points[(here + dir + points.length) % points.length] ?? points[0]!;
      setCurrent(next.slide);
      setActiveLine(next.lineKey);
      requestAnimationFrame(() => document.getElementById(`line-${next.lineKey}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    },
    [points, current, activeLine],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) return;
      if (e.key === ']') setCurrent((c) => Math.min(c + 1, slides.length - 1));
      else if (e.key === '[') setCurrent((c) => Math.max(c - 1, 0));
      else if (e.key === 'n' || e.key === 'N') jump(e.shiftKey ? -1 : 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides.length, jump]);

  const lec = lecture.data;
  const slide = slides[current];
  const parts = lec?.plan?.parts ?? [];

  if (lecture.isError || slidesQ.isError) return <p role="alert" className="text-danger">This lecture could not be opened. Try again.</p>;
  if (!lec || !slidesQ.data) return <p className="text-muted">Opening the lecture…</p>;

  return (
    <div className="-mx-4 -my-8 flex h-[calc(100dvh-3.5rem)] flex-col sm:-mx-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{lec.topic}</h1>
          <p className="text-xs text-muted">
            {lec.lengthMin} min · {lec.level} · {slides.length} slides{lec.status === 'building' ? ' · still preparing' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Points to check">
          <button type="button" onClick={() => jump(1)} className="inline-flex items-center gap-1 rounded-full bg-flag-yellow-bg px-3 py-1 text-flag-yellow" title="Go to the next point to verify (N)">
            <AlertTriangle className="size-4" aria-hidden />
            {lec.counts.yellow} to verify
          </button>
          <span className="inline-flex items-center gap-1 rounded-full bg-flag-grey-bg px-3 py-1 text-flag-grey" title="Cases whose current status no law expert has confirmed yet">
            <CircleHelp className="size-4" aria-hidden />
            {lec.counts.grey} status not verified
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-flag-coverage-bg px-3 py-1 text-flag-coverage">
            <ListChecks className="size-4" aria-hidden />
            {lec.counts.coverage} coverage {lec.counts.coverage === 1 ? 'note' : 'notes'}
            {lec.coverageScore !== null && ` · ${Math.round(lec.coverageScore * 100)}%`}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-3 py-1">
            <input type="checkbox" checked={showChecks} onChange={(e) => setShowChecks(e.target.checked)} className="accent-accent" />
            Show checks
          </label>
          <Button variant="primary" disabled title="Download arrives with the next update">
            <Download className="size-4" aria-hidden />
            Download
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Outline" className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 lg:block">
          {parts.map((p, pi) => (
            <div key={pi} className="mb-4">
              <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted">
                {p.title} · {p.minutes} min
              </p>
              <ul>
                {slides.map((s, si) =>
                  s.partIndex !== pi ? null : (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(si);
                          setActiveLine(null);
                        }}
                        aria-current={si === current ? 'true' : undefined}
                        className={cn('flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm', si === current ? 'bg-bg font-medium' : 'text-muted hover:bg-bg')}
                      >
                        <span className="truncate">{s.title}</span>
                        {[...s.lines, ...s.notes].some((l) => l.flag === 'yellow') && <span className="ml-auto size-2 shrink-0 rounded-full bg-flag-yellow" aria-label="has points to verify" />}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto bg-bg p-4 sm:p-8">
          {slide ? (
            <article aria-label={`Slide ${current + 1} of ${slides.length}`} className="mx-auto max-w-3xl">
              <div className="mb-3 flex items-center justify-between text-xs text-muted">
                <span>
                  Slide {current + 1} of {slides.length}
                </span>
                <span className="space-x-2">
                  <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => setCurrent((c) => c - 1)} aria-label="Previous slide ([)">
                    ‹ Previous
                  </Button>
                  <Button size="sm" variant="ghost" disabled={current >= slides.length - 1} onClick={() => setCurrent((c) => c + 1)} aria-label="Next slide (])">
                    Next ›
                  </Button>
                </span>
              </div>
              <SlideCanvas
                slide={slide}
                activeLine={activeLine}
                showChecks={showChecks}
                onOpenSource={(cid, lineKey) => {
                  setCitation(cid);
                  if (lineKey) setActiveLine(lineKey);
                }}
              />
            </article>
          ) : (
            <p className="text-muted">{lec.status === 'building' ? 'Slides appear here as each part is finished.' : 'This lecture has no slides.'}</p>
          )}
        </main>

        <aside className="hidden w-[22.5rem] shrink-0 overflow-y-auto border-l border-border bg-surface p-4 md:block">
          {citation ? <SourceDrawer citationId={citation} onClose={() => setCitation(null)} /> : <CoveragePanel lectureId={id} />}
        </aside>
      </div>
    </div>
  );
}
