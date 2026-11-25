import type { StudioSlide, LineReport } from '@nyaai/shared';
import { useState } from 'react';
import { Plus, User } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { ClaimLine } from './ClaimLine';
import type { SlideEditor } from './useSlideEditor';

interface SlideCanvasProps {
  slide: StudioSlide;
  activeLine: string | null;
  showChecks: boolean;
  onOpenSource: (citationId: string, lineKey: string) => void;
  /** Present when she may edit (STUDIO-2, -4, -6). */
  editor?: SlideEditor;
  /** Her wrong-fact reports on this lecture, by `slideId|lineKey` (ADM-2). */
  reports?: Map<string, LineReport>;
  onReport?: (lineKey: string, text: string) => void;
}

/** Footnote numbers for one slide: each distinct source label gets one number, in reading order. */
export function footnoteNumbers(slide: StudioSlide): {
  byCitation: Map<string, number>;
  notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[];
} {
  const byLabel = new Map<string, number>();
  const byCitation = new Map<string, number>();
  const notes: { n: number; label: string; provisional: boolean; grey: boolean; citationId: string }[] = [];
  for (const line of [...slide.lines, ...slide.notes]) {
    for (const s of line.sources) {
      let n = byLabel.get(s.label);
      if (n === undefined) {
        n = byLabel.size + 1;
        byLabel.set(s.label, n);
        notes.push({
          n,
          label: s.label,
          provisional: s.provisional,
          grey: s.caseStatus === 'not_verified',
          citationId: s.citationId,
        });
      }
      byCitation.set(s.citationId, n);
    }
  }
  return { byCitation, notes };
}

/** Each layout reads like the slide it is: a case in a box, a question large, an example tinted, two columns split. */
const BODY: Record<string, string> = {
  case_box: 'rounded-card border-l-4 border-accent bg-accent/5 px-6 py-5',
  question: 'text-[clamp(1.1rem,3cqw,1.75rem)] leading-snug',
  example: 'rounded-card bg-example-bg/50 px-6 py-5',
  quote: 'border-l-4 border-border pl-6 font-serif italic',
  recap: 'rounded-card bg-bg px-6 py-5',
  bridge: 'rounded-card bg-bg px-6 py-5',
};
const KIND_LABEL: Record<string, string> = {
  case_box: 'Case',
  example: 'Example',
  recap: 'Recap',
  bridge: 'Next class',
  question: 'Question',
};

/** A one-line input that saves on Enter or leaving it (adding a line, a note, or editing the title). */
function InlineInput({ initial = '', placeholder, onDone, className }: { initial?: string; placeholder: string; onDone: (text: string | null) => void; className?: string }) {
  const [text, setText] = useState(initial);
  const finish = () => onDone(text.trim() && text.trim() !== initial.trim() ? text.trim() : null);
  return (
    <input
      autoFocus
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish();
        } else if (e.key === 'Escape') onDone(null);
      }}
      className={cn('w-full rounded-control border border-accent bg-bg px-2 py-1 outline-none', className)}
    />
  );
}

/** Her own example (STUDIO-6): no source needed; any case or section it names is still checked. */
function ExampleForm({ onSave, onCancel }: { onSave: (text: string, keep: boolean) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [keep, setKeep] = useState(true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim().length >= 3) onSave(text.trim(), keep);
      }}
      className="mt-3 rounded-card border border-border bg-surface p-4"
    >
      <label className="block text-sm">
        <span className="mb-1 flex items-center gap-1.5 font-medium text-example">
          <User className="size-4" aria-hidden />
          Your example
        </span>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="e.g. Ravi books a hall in Patna for his sister's wedding; the hall burns down a week before."
          className="w-full rounded-control border border-border bg-bg px-3 py-2"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Keep it in my examples for other lectures
        </label>
        <span className="flex gap-2">
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" type="submit" variant="primary" disabled={text.trim().length < 3}>
            Add to slide
          </Button>
        </span>
      </div>
    </form>
  );
}

export function SlideCanvas({ slide, activeLine, showChecks, onOpenSource, editor, reports, onReport }: SlideCanvasProps) {
  const { byCitation, notes } = footnoteNumbers(slide);
  const [adding, setAdding] = useState<null | 'line' | 'note' | 'example'>(null);
  const [titleEditing, setTitleEditing] = useState(false);
  const lines = slide.lines;
  const twoCol = slide.layout === 'two_column' && lines.length > 2;
  const half = Math.ceil(lines.length / 2);
  const bullet = slide.layout !== 'question' && slide.layout !== 'title';
  const line = (l: (typeof lines)[number]) => (
    <ClaimLine
      key={l.lineKey}
      line={l}
      active={l.lineKey === activeLine}
      numbers={byCitation}
      showChecks={showChecks}
      onOpenSource={(cid) => onOpenSource(cid, l.lineKey)}
      onEdit={editor ? (t) => void editor.editLine(slide, l.lineKey, t) : undefined}
      onRemove={editor ? () => void editor.removeLine(slide, l.lineKey) : undefined}
      onVerify={editor && l.flag === 'yellow' ? () => void editor.verify(slide, l.lineKey) : undefined}
      onReport={onReport && !l.lineKey.startsWith('unsaved-') ? () => onReport(l.lineKey, l.text) : undefined}
      report={reports?.get(`${slide.id}|${l.lineKey}`)}
    />
  );
  const list = (items: typeof lines) => <ul className={cn('space-y-[1cqw]', bullet ? 'list-disc pl-6 marker:text-accent/60' : 'list-none')}>{items.map(line)}</ul>;

  return (
    <>
      {/* A 16:9 frame like the slide in class. Type scales with the frame's width (container units), as on a real
          slide; the frame grows rather than cut a long slide. */}
      <div className="@container">
        <div className="flex aspect-video flex-col rounded-card border border-border bg-surface px-[5cqw] py-[4cqw] shadow-sm">
          {KIND_LABEL[slide.layout] && <p className="mb-[0.8cqw] text-[clamp(0.65rem,1.1cqw,0.8rem)] font-semibold uppercase tracking-wider text-accent">{KIND_LABEL[slide.layout]}</p>}
          {titleEditing && editor ? (
            <InlineInput
              initial={slide.title}
              placeholder="Slide title"
              className="mb-[2.2cqw] text-[clamp(1.25rem,3.6cqw,2.2rem)] font-semibold"
              onDone={(t) => {
                setTitleEditing(false);
                if (t) void editor.editTitle(slide, t);
              }}
            />
          ) : (
            <h2
              onClick={editor ? () => setTitleEditing(true) : undefined}
              className={cn(
                'mb-[2.2cqw] font-semibold leading-tight tracking-tight',
                slide.layout === 'title' ? 'mt-auto text-[clamp(1.6rem,4.6cqw,2.9rem)]' : 'text-[clamp(1.25rem,3.6cqw,2.2rem)]',
                editor && '-mx-2 cursor-text rounded-control px-2 hover:bg-bg/70',
              )}
            >
              {slide.title}
            </h2>
          )}
          <div className={cn('text-[clamp(1rem,2.5cqw,1.4rem)] leading-relaxed', BODY[slide.layout])}>
            {twoCol ? (
              <div className="grid grid-cols-2 gap-8">
                {list(lines.slice(0, half))}
                {list(lines.slice(half))}
              </div>
            ) : (
              list(lines)
            )}
            {adding === 'line' && editor && (
              <div className="mt-[1cqw]">
                <InlineInput
                  placeholder="Type a new line, then press Enter"
                  onDone={(t) => {
                    setAdding(null);
                    if (t) void editor.addLine(slide, t);
                  }}
                />
              </div>
            )}
          </div>
          {notes.length > 0 && (
            <footer className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted">
              {notes.map((f) => (
                <button key={f.n} type="button" onClick={() => onOpenSource(f.citationId, '')} className="text-left hover:text-text hover:underline">
                  <sup>{f.n}</sup> {f.label}
                  {f.grey ? ' · status not verified' : ''}
                  {f.provisional ? ' · not yet reviewed' : ''}
                </button>
              ))}
            </footer>
          )}
        </div>
      </div>

      {editor && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAdding('line')}>
            <Plus className="size-4" aria-hidden />
            Add a line
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding('example')}>
            <User className="size-4" aria-hidden />
            Add your example
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding('note')}>
            <Plus className="size-4" aria-hidden />
            Add a speaker note
          </Button>
        </div>
      )}
      {adding === 'example' && editor && (
        <ExampleForm
          onCancel={() => setAdding(null)}
          onSave={(t, keep) => {
            setAdding(null);
            void editor.addExample(slide, t, keep);
          }}
        />
      )}

      {(slide.notes.length > 0 || adding === 'note') && (
        <section aria-label="Speaker notes" className="mt-5 rounded-card border border-border bg-surface px-6 py-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Speaker notes</h3>
          <ul className="space-y-2 text-[0.95rem] leading-relaxed">{slide.notes.map(line)}</ul>
          {adding === 'note' && editor && (
            <div className="mt-2">
              <InlineInput
                placeholder="Type a note for yourself, then press Enter"
                onDone={(t) => {
                  setAdding(null);
                  if (t) void editor.addLine(slide, t, 'notes');
                }}
              />
            </div>
          )}
        </section>
      )}
    </>
  );
}
