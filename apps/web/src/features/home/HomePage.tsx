import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LENGTH_CHOICES, LEVEL_CHOICES, ResolveChoice, STYLE_CHOICES, type PrepareLecture } from '@nyaai/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';
import { AmbiguityDialog } from './AmbiguityDialog';
import { TopicBox } from './TopicBox';
import { NotesPicker, useNotes, waitingNotes } from '@/features/notes/notes-ui';
import { LoadError, Skeleton } from '@/shared/ui/states';
import { lectureNo } from '@/shared/lib/labels';

export const ONE_OFF = 'one_off';

/**
 * Home (LLD §12.3, HOME-1 to HOME-6). Topic box on top; four chip rows that start empty and are never
 * remembered between visits (HOME-4, HOME-5); Prepare stays disabled until all four and a topic are chosen,
 * and says what is missing (HOME-6). Prepare queues the build and opens the Build screen.
 */
export function HomePage() {
  const navigate = useNavigate();
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
  const [busy, setBusy] = useState(false);
  // Her notes for this lecture: none until she ticks or uploads one (Option A, decision 2026-11-25).
  const [notes, setNotes] = useState<string[]>([]);
  const allNotes = useNotes();

  async function prepare(choice?: ResolveChoice, prereqAck = false) {
    if (!course || !length || !level || !style) return;
    setBusy(true);
    setNotice(null);
    setPrereq(null);
    try {
      const picked = choice ?? concept;
      const r = await api.prepare({
        topic: topic.trim(),
        course:
          course === ONE_OFF
            ? { kind: 'one_off' }
            : {
                kind: 'course',
                courseId: course,
                unitId:
                  (course === fromPlan.course ? fromPlan.unit : null) ??
                  home.data?.courses.find((c) => c.id === course)?.nextUnit?.id,
              },
        lengthMin: Number(length) as PrepareLecture['lengthMin'],
        level: level as PrepareLecture['level'],
        styleKey: style as PrepareLecture['styleKey'],
        mustInclude: mustInclude.trim() ? { text: mustInclude.trim() } : undefined,
        anythingSpecial: special.trim() || undefined,
        filters: { jurisdiction: 'IN', comparative: false },
        // From Explore's "Turn into a lecture": the topic she explored, already chosen.
        ambiguityChoice: picked?.conceptId ?? params.get('concept') ?? undefined,
        prereqAck: prereqAck || undefined,
        notes,
      });
      if (choice) setConcept(choice);
      void navigate(`/build/${r.lectureId}`);
    } catch (err) {
      const parsed =
        err instanceof ApiRequestError && err.body?.error.code === 'TOPIC_AMBIGUOUS'
          ? z.array(ResolveChoice).safeParse(err.body.error.details?.choices)
          : null;
      if (parsed?.success) setChoices(parsed.data);
      else if (err instanceof ApiRequestError && err.body?.error.code === 'PREREQ_WARNING_UNACKED')
        setPrereq(err.body.error.message);
      else setNotice(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
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

  const missing = [
    topic.trim().length < 3 && 'a topic',
    !course && 'a course (or one-off)',
    !length && 'a class length',
    !level && 'a level',
    !style && 'a style',
    waitingNotes(allNotes.data?.notes, notes).length > 0 && 'your notes to finish reading (or untick them)',
  ].filter((m): m is string => Boolean(m));
  const ready = missing.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Prepare a lecture</h1>

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
          onClick={() => void prepare()}
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
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void prepare(concept ?? undefined, true)}>
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
            void prepare(c);
          }}
        />
      )}
    </div>
  );
}
