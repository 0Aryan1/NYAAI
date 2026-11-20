import type { StudioSlide } from '@nyaai/shared';
import { cn } from '@/shared/lib/utils';
import { ClaimLine } from './ClaimLine';

interface SlideCanvasProps {
  slide: StudioSlide;
  activeLine: string | null;
  showChecks: boolean;
  onOpenSource: (citationId: string, lineKey: string) => void;
}

/** Footnote numbers for one slide: each distinct source label gets one number, in reading order. */
export function footnoteNumbers(slide: StudioSlide): { byCitation: Map<string, number>; notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[] } {
  const byLabel = new Map<string, number>();
  const byCitation = new Map<string, number>();
  const notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[] = [];
  for (const line of [...slide.lines, ...slide.notes]) {
    for (const s of line.sources) {
      let n = byLabel.get(s.label);
      if (n === undefined) {
        n = byLabel.size + 1;
        byLabel.set(s.label, n);
        notes.push({ n, label: s.label, provisional: s.provisional, grey: s.caseStatus === 'not_verified', citationId: s.citationId });
      }
      byCitation.set(s.citationId, n);
    }
  }
  return { byCitation, notes };
}

/** Each layout reads like the slide it is: a case in a box, a question large, an example tinted, two columns split. */
const BODY: Record<string, string> = {
  case_box: 'rounded-card border-l-4 border-accent bg-bg/60 p-4',
  question: 'text-xl',
  example: 'rounded-card bg-example-bg/40 p-4',
  quote: 'border-l-4 border-border pl-4 italic',
};

export function SlideCanvas({ slide, activeLine, showChecks, onOpenSource }: SlideCanvasProps) {
  const { byCitation, notes } = footnoteNumbers(slide);
  const lines = slide.lines;
  const twoCol = slide.layout === 'two_column' && lines.length > 2;
  const half = Math.ceil(lines.length / 2);
  const render = (list: typeof lines) =>
    list.map((l) => (
      <ClaimLine key={l.lineKey} line={l} active={l.lineKey === activeLine} numbers={byCitation} showChecks={showChecks} onOpenSource={(cid) => onOpenSource(cid, l.lineKey)} />
    ));

  return (
    <>
      <div className="flex aspect-[16/10] min-h-[22rem] flex-col overflow-y-auto rounded-card border border-border bg-surface p-8 shadow-sm">
        <h2 className={cn('mb-6 font-semibold', slide.layout === 'title' ? 'mt-auto text-3xl' : 'text-2xl')}>{slide.title}</h2>
        <div className={cn('text-lg', BODY[slide.layout])}>
          {twoCol ? (
            <div className="grid grid-cols-2 gap-6">
              <ul className="list-disc space-y-2 pl-5 marker:text-muted">{render(lines.slice(0, half))}</ul>
              <ul className="list-disc space-y-2 pl-5 marker:text-muted">{render(lines.slice(half))}</ul>
            </div>
          ) : (
            <ul className={cn('space-y-2', slide.layout === 'question' || slide.layout === 'title' ? 'list-none' : 'list-disc pl-5 marker:text-muted')}>{render(lines)}</ul>
          )}
        </div>
        {notes.length > 0 && (
          <footer className="mt-auto border-t border-border pt-3 text-xs text-muted">
            {notes.map((f) => (
              <button key={f.n} type="button" onClick={() => onOpenSource(f.citationId, '')} className="mr-3 hover:text-text hover:underline">
                <sup>{f.n}</sup> {f.label}
                {f.grey ? ' (status not verified)' : ''}
                {f.provisional ? ' (not yet reviewed)' : ''}
              </button>
            ))}
          </footer>
        )}
      </div>
      {slide.notes.length > 0 && (
        <details className="mt-4 rounded-card border border-border bg-surface p-4" open={showChecks || slide.notes.some((n) => n.flag === 'yellow')}>
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted">Speaker notes</summary>
          <ul className="mt-2 space-y-1 text-sm">{slide.notes.map((l) => (
            <ClaimLine key={l.lineKey} line={l} active={l.lineKey === activeLine} numbers={byCitation} showChecks={showChecks} onOpenSource={(cid) => onOpenSource(cid, l.lineKey)} />
          ))}</ul>
        </details>
      )}
    </>
  );
}
