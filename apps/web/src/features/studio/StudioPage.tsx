import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, CircleHelp, CloudOff, Download, ListChecks, Loader2, Undo2 } from 'lucide-react';
import type { StudioSlide } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { useEventStream } from '@/shared/hooks/useEventStream';
import { lectureNo } from '@/shared/lib/labels';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Tabs } from '@/shared/ui/tabs';
import { SlideCanvas } from './SlideCanvas';
import { CoveragePanel } from './CoveragePanel';
import { SourceDrawer } from './SourceDrawer';
import { MarkTaught } from './MarkTaught';
import { CHECKING } from './ClaimLine';
import { useSlideEditor } from './useSlideEditor';
import { DownloadDialog } from './DownloadDialog';

/** Every open (yellow) line in slide order, for N / Shift+N. */
export function openPoints(slides: StudioSlide[]): { slide: number; lineKey: string }[] {
  return slides.flatMap((s, i) => [...s.lines, ...s.notes].filter((l) => l.flag === 'yellow').map((l) => ({ slide: i, lineKey: l.lineKey })));
}

type Panel = 'source' | 'coverage';

/**
 * Lecture Studio (LLD §12.3): outline left, the slide and its speaker notes in the centre, source and coverage right.
 * The header carries the lecture and its two actions; a quiet bar under it carries the counts that need her.
 * Keys: [ and ] previous / next slide; N and Shift+N next / previous point to verify.
 */
export function StudioPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const lecture = useQuery({ queryKey: queryKeys.lecture(id), queryFn: () => api.lecture(id) });
  // While an edited line is being checked in the background, look again every few seconds.
  const slidesQ = useQuery({
    queryKey: queryKeys.slides(id),
    queryFn: () => api.slides(id),
    refetchInterval: (q) => (q.state.data?.slides.some((s) => [...s.lines, ...s.notes].some((l) => l.flagReason === CHECKING)) ? 4000 : false),
  });
  const editor = useSlideEditor(id);
  const slides = useMemo(() => slidesQ.data?.slides ?? [], [slidesQ.data]);
  const [current, setCurrent] = useState(0);
  const [citation, setCitation] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('coverage');
  const [activeLine, setActiveLine] = useState<string | null>(null);
  // Slide view by default; check view shows every source as a chip and every grey case as a pill.
  const [showChecks, setShowChecks] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const points = useMemo(() => openPoints(slides), [slides]);

  useEventStream((e) => {
    if ('lectureId' in e && e.lectureId === id && (e.type === 'build.part_ready' || e.type === 'build.done')) void qc.invalidateQueries({ queryKey: ['lecture', id] });
  });

  const go = useCallback((i: number) => {
    setCurrent(i);
    setActiveLine(null);
  }, []);

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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ']') setCurrent((c) => Math.min(c + 1, slides.length - 1));
      else if (e.key === '[') setCurrent((c) => Math.max(c - 1, 0));
      else if (e.key === 'n' || e.key === 'N') jump(e.shiftKey ? -1 : 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides.length, jump]);

  const openSource = (cid: string, lineKey?: string) => {
    setCitation(cid);
    setPanel('source');
    if (lineKey) setActiveLine(lineKey);
  };

  const lec = lecture.data;
  const slide = slides[current];
  const parts = lec?.plan?.parts ?? [];

  if (lecture.isError || slidesQ.isError) return <p role="alert" className="p-8 text-danger">This lecture could not be opened. Try again.</p>;
  if (!lec || !slidesQ.data) return <p className="p-8 text-muted">Opening the lecture…</p>;

  return (
    <div className="flex h-full flex-col">
      {downloading && <DownloadDialog lecture={lec} onClose={() => setDownloading(false)} />}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-surface px-6 py-4">
        <div className="min-w-0">
          <p className="mb-0.5 truncate text-xs text-muted">
            {lec.course ? (
              <Link to={`/courses/${lec.course.id}`} className="hover:text-text hover:underline">
                {lec.course.name}
                {lec.course.position ? ` · ${lectureNo(lec.course.position)}` : ''}
              </Link>
            ) : (
              'One-off lecture'
            )}
            {` · ${lec.lengthMin} min · ${lec.level}`}
          </p>
          <h1 className="truncate text-xl font-semibold tracking-tight">{lec.topic}</h1>
        </div>
        <div className="flex items-center gap-2">
          <MarkTaught lecture={lec} />
          <Button variant="primary" disabled={lec.status === 'building'} onClick={() => setDownloading(true)}>
            <Download className="size-4" aria-hidden />
            Download
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-bg px-6 py-2 text-sm" aria-label="Points to check">
        <button
          type="button"
          onClick={() => jump(1)}
          disabled={!lec.counts.yellow}
          className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1', lec.counts.yellow ? 'bg-flag-yellow-bg text-flag-yellow hover:brightness-95' : 'text-muted')}
          title="Go to the next point to verify (N)"
        >
          <AlertTriangle className="size-4" aria-hidden />
          {lec.counts.yellow ? `${lec.counts.yellow} to verify` : 'Nothing to verify'}
        </button>
        {lec.counts.grey > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-flag-grey" title="Lines resting on a case whose current status no law expert has confirmed yet">
            <CircleHelp className="size-4" aria-hidden />
            {lec.counts.grey} on cases not yet confirmed
          </span>
        )}
        <button type="button" onClick={() => setPanel('coverage')} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-flag-coverage hover:bg-flag-coverage-bg">
          <ListChecks className="size-4" aria-hidden />
          Coverage {lec.coverageScore !== null ? `${Math.round(lec.coverageScore * 100)}%` : ''}
          {lec.counts.coverage > 0 && ` · ${lec.counts.coverage} ${lec.counts.coverage === 1 ? 'note' : 'notes'}`}
        </button>
        {lec.status === 'building' && <span className="text-muted">Still preparing: slides appear as each part is finished.</span>}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-muted">
          <span>Show sources and checks</span>
          <input type="checkbox" role="switch" checked={showChecks} onChange={(e) => setShowChecks(e.target.checked)} className="peer sr-only" />
          <span
            aria-hidden
            className="relative h-5 w-9 rounded-full bg-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
          />
        </label>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Outline" className="hidden w-72 shrink-0 relative overflow-y-auto border-r border-border bg-surface px-3 py-4 lg:block">
          {parts.map((p, pi) => (
            <section key={pi} className="mb-5">
              <h2 className="mb-1 flex items-baseline justify-between gap-2 px-2 text-xs font-semibold text-text">
                <span>
                  <span className="text-muted">{pi + 1}.</span> {p.title}
                </span>
                <span className="shrink-0 font-normal text-muted">{p.minutes} min</span>
              </h2>
              <ol>
                {slides.map((s, si) =>
                  s.partIndex !== pi ? null : (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => go(si)}
                        aria-current={si === current ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left text-sm leading-snug',
                          si === current ? 'bg-accent/10 text-text' : 'text-muted hover:bg-bg hover:text-text',
                        )}
                      >
                        <span className="w-5 shrink-0 text-right text-xs tabular-nums leading-5 opacity-70">{si + 1}</span>
                        <span className="line-clamp-2">{s.title}</span>
                        {[...s.lines, ...s.notes].some((l) => l.flag === 'yellow') && <span className="ml-auto mt-1.5 size-2 shrink-0 rounded-full bg-flag-yellow" aria-label="has points to verify" />}
                      </button>
                    </li>
                  ),
                )}
              </ol>
            </section>
          ))}
        </nav>

        <main className="min-w-0 flex-1 relative overflow-y-auto bg-bg px-6 py-6 lg:px-10">
          {slide ? (
            <article aria-label={`Slide ${current + 1} of ${slides.length}`} className="mx-auto max-w-4xl">
              <div className="mb-3 flex items-center justify-between text-sm text-muted">
                <span className="truncate">
                  {parts[slide.partIndex]?.title && <span className="text-text">{parts[slide.partIndex]!.title}</span>}
                  <span className="ml-2">
                    Slide {current + 1} of {slides.length}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 inline-flex items-center gap-1 text-xs" aria-live="polite">
                    {editor.state === 'saving' && (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
                      </>
                    )}
                    {editor.state === 'saved' && 'All changes saved'}
                    {editor.state === 'error' && (
                      <span className="inline-flex items-center gap-1 text-danger" title={editor.error ?? undefined}>
                        <CloudOff className="size-3.5" aria-hidden /> {editor.error}
                      </span>
                    )}
                  </span>
                  {slide.version > 1 && lec.status !== 'building' && (
                    <Button size="sm" variant="ghost" onClick={() => void editor.undo(slide)} title="Undo the last change to this slide">
                      <Undo2 className="size-4" aria-hidden />
                      Undo
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => go(current - 1)} aria-label="Previous slide ([)">
                    <ChevronLeft className="size-4" aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={current >= slides.length - 1} onClick={() => go(current + 1)} aria-label="Next slide (])">
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </span>
              </div>
              <SlideCanvas
                key={slide.id}
                slide={slide}
                activeLine={activeLine}
                showChecks={showChecks}
                onOpenSource={openSource}
                editor={lec.status === 'building' ? undefined : editor}
              />
            </article>
          ) : (
            <p className="text-muted">{lec.status === 'building' ? 'Slides appear here as each part is finished.' : 'This lecture has no slides.'}</p>
          )}
        </main>

        <aside className="hidden w-80 shrink-0 flex-col xl:w-96 border-l border-border bg-surface md:flex">
          <Tabs<Panel>
            label="Side panel"
            value={panel}
            onChange={setPanel}
            className="px-3 pt-2"
            options={[
              { value: 'source', label: 'Source' },
              { value: 'coverage', label: 'Coverage', count: lec.counts.coverage || undefined },
            ]}
          />
          <div className="min-h-0 flex-1 relative overflow-y-auto p-5">
            {panel === 'source' ? (
              citation ? (
                <SourceDrawer citationId={citation} onClose={() => setCitation(null)} />
              ) : (
                <p className="text-sm text-muted">Click a small number on the slide to see the exact words it rests on, and the checks they passed.</p>
              )
            ) : (
              <CoveragePanel lectureId={id} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
