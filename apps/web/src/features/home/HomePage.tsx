import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LENGTH_CHOICES, LEVEL_CHOICES, STYLE_CHOICES, type ResolveChoice } from '@nyaai/shared';
import { useSearchParams } from 'react-router';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';
import { AmbiguityDialog } from './AmbiguityDialog';
import { TopicBox } from './TopicBox';
import {
  missingChoices,
  ONE_OFF,
  prepareRefusal,
  prepareRequest,
  usePrepareLecture,
  type PrepareForm,
} from './prepare';
import { NotesPicker } from '@/features/notes/NotesPicker';
import { useNotes, waitingNotes } from '@/features/notes/useNotes';
import { LoadError, Skeleton } from '@/shared/ui/states';
import { lectureNo } from '@/shared/lib/labels';
import { PageHeader } from '@/shared/ui/page';

/**
 * Home (LLD §12.3, HOME-1 to HOME-6). Topic box on top; four chip rows that start empty and are never
 * remembered between visits (HOME-4, HOME-5); Prepare stays disabled until all four and a topic are chosen,
 * and says what is missing (HOME-6). Prepare queues the build and opens the Build screen.
 */
export function HomePage() {
  // "Prepare" on a lecture in her course plan opens Home with that course and lecture chosen by her, not by the app.
  const [params] = useSearchParams();
  const fromPlan = { course: params.get('course'), unit: params.get('unit') };
  const home = useQuery({ queryKey: queryKeys.home, queryFn: api.home });
  const [topic, setTopic] = useState(params.get('topic') ?? '');
  const [course, setCourse] = useState<string | null>(fromPlan.course);
  const [prereq, setPrereq] = useState<string | null>(null);
  const [length, setLength] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [mustInclude, setMustInclude] = useState('');
  const [special, setSpecial] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [choices, setChoices] = useState<ResolveChoice[] | null>(null);
  const [concept, setConcept] = useState<ResolveChoice | null>(null);
  // Her notes for this lecture: none until she ticks or uploads one (Option A, decision 2026-11-25).
  const [notes, setNotes] = useState<string[]>([]);
  const allNotes = useNotes();

  const send = usePrepareLecture();
  const busy = send.isPending;
  const form: PrepareForm = { topic, course, length, level, style, mustInclude, special, notes };

  function prepare(choice?: ResolveChoice, prereqAck = false) {
    if (!course || !length || !level || !style) return;
    setNotice(null);
    setPrereq(null);
    const picked = choice ?? concept;
    const req = prepareRequest(
      { ...form, course, length, level, style },
      {
        planUnit: course === fromPlan.course ? fromPlan.unit : null,
        nextUnit: home.data?.courses.find((c) => c.id === course)?.nextUnit?.id,
        // From Explore's "Turn into a lecture": the topic she explored, already chosen.
        conceptId: picked?.conceptId ?? params.get('concept') ?? undefined,
        prereqAck,
      },
    );
    send.mutate(req, {
      onSuccess: () => {
        if (choice) setConcept(choice);
      },
      onError: (err) => {
        const r = prepareRefusal(err);
        if (r.kind === 'ambiguous') setChoices(r.choices);
        else if (r.kind === 'prereq') setPrereq(r.message);
        else setNotice(r.message);
      },
    });
  }

  const courseOptions = [
    ...(home.data?.courses ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      hint:
        c.id === fromPlan.course && fromPlan.unit
          ? `for: ${params.get('topic') ?? 'the lecture you chose'}`
          : c.nextUnit
            ? `next: ${lectureNo(c.nextUnit.position)} ${c.nextUnit.title}`
            : undefined,
    })),
    { value: ONE_OFF, label: 'No course, one-off' },
  ];

  const missing = missingChoices(form, waitingNotes(allNotes.data?.notes, notes).length > 0);
  const ready = missing.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader className="mb-6" title="Prepare a lecture" />

      <div className="mb-8">
        <TopicBox
          value={topic}
          onChange={(v) => {
            setTopic(v);
            setConcept(null);
          }}
        />
      </div>

      <div className="space-y-6">
        {home.isLoading ? (
          <div role="status" aria-label="Loading your courses">
            <Skeleton className="mb-2 h-4 w-16" />
            <div className="flex gap-2">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-9 w-40" />
            </div>
          </div>
        ) : (
          <ChipGroup label="Course" options={courseOptions} value={course} onChange={setCourse} />
        )}
        {home.isError && <LoadError what="Your courses" onRetry={() => void home.refetch()} />}
        <ChipGroup
          label="Class length"
          options={LENGTH_CHOICES.map((m) => ({ value: String(m), label: `${m} min` }))}
          value={length}
          onChange={setLength}
        />
        <ChipGroup label="Level" options={LEVEL_CHOICES} value={level} onChange={setLevel} />
        <ChipGroup label="Style" options={STYLE_CHOICES} value={style} onChange={setStyle} />
      </div>

      <details className="mt-8 rounded-card border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Use your own notes (optional){notes.length > 0 && ` · ${notes.length} chosen`}
        </summary>
        <div className="mt-4">
          <NotesPicker selected={notes} onChange={setNotes} />
        </div>
      </details>

      <details className="mt-4 rounded-card border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Add your own example or a special request (optional)
        </summary>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="must" className="mb-1 block text-sm">
              Must include
            </label>
            <textarea
              id="must"
              value={mustInclude}
              onChange={(e) => setMustInclude(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="An example of yours the lecture must use"
              className="w-full rounded-control border border-border bg-bg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="special" className="mb-1 block text-sm">
              Anything special?
            </label>
            <input
              id="special"
              value={special}
              onChange={(e) => setSpecial(e.target.value)}
              maxLength={500}
              placeholder="e.g. more case stories this time"
              className="h-10 w-full rounded-control border border-border bg-bg px-3 text-sm"
            />
          </div>
        </div>
      </details>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button
          variant="primary"
          size="lg"
          disabled={!ready || busy}
          aria-describedby="prepare-hint"
          title={ready ? undefined : `Still needed: ${missing.join(', ')}`}
          onClick={() => prepare()}
        >
          Prepare
        </Button>
        <p id="prepare-hint" className="text-sm text-muted" aria-live="polite">
          {ready ? (notice ?? 'Ready when you are.') : `Still needed: ${missing.join(', ')}.`}
        </p>
      </div>
      {prereq && (
        <div role="alert" className="mt-4 rounded-card border border-border bg-surface p-4 text-sm">
          <p className="mb-3">{prereq} The recap will not assume the class has had it.</p>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => prepare(concept ?? undefined, true)}>
            Prepare anyway
          </Button>
        </div>
      )}
      {choices && (
        <AmbiguityDialog
          topic={topic.trim()}
          choices={choices}
          onCancel={() => setChoices(null)}
          onChoose={(c) => {
            setChoices(null);
            prepare(c);
          }}
        />
      )}
    </div>
  );
}
