import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LENGTH_CHOICES, LEVEL_CHOICES, ResolveChoice, STYLE_CHOICES } from '@nyaai/shared';
import { z } from 'zod';
import { api, ApiRequestError, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';
import { AmbiguityDialog } from './AmbiguityDialog';
import { TopicBox } from './TopicBox';

export const ONE_OFF = 'one_off';

/**
 * Home (LLD §12.3, HOME-1 to HOME-6). Topic box on top; four chip rows that start empty and are never
 * remembered between visits (HOME-4, HOME-5); Prepare stays disabled until all four and a topic are chosen,
 * and says what is missing (HOME-6). Suggestions, hints and the build itself arrive on Days 2–3.
 */
export function HomePage() {
  const home = useQuery({ queryKey: queryKeys.home, queryFn: api.home });
  const [topic, setTopic] = useState('');
  const [course, setCourse] = useState<string | null>(null);
  const [length, setLength] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [mustInclude, setMustInclude] = useState('');
  const [special, setSpecial] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [choices, setChoices] = useState<ResolveChoice[] | null>(null);
  const [concept, setConcept] = useState<ResolveChoice | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare(choice?: ResolveChoice) {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.resolveTopic(topic.trim(), choice?.conceptId);
      if (choice) setConcept(choice);
      // The lecture build itself arrives with the next update (Day 3); the topic is resolved and kept.
      setNotice(`Ready to build${r.conceptId || choice ? ` (${(choice ?? concept)?.name ?? 'topic found in the library'})` : ''}. Building lectures is being switched on in the next update.`);
    } catch (err) {
      const parsed = err instanceof ApiRequestError && err.body?.error.code === 'TOPIC_AMBIGUOUS' ? z.array(ResolveChoice).safeParse(err.body.error.details?.choices) : null;
      if (parsed?.success) setChoices(parsed.data);
      else setNotice(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const courseOptions = [
    ...(home.data?.courses ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      hint: c.nextUnit ? `next: L${String(c.nextUnit.position).padStart(2, '0')} ${c.nextUnit.title}` : undefined,
    })),
    { value: ONE_OFF, label: 'No course, one-off' },
  ];

  const missing = [
    topic.trim().length < 3 && 'a topic',
    !course && 'a course (or one-off)',
    !length && 'a class length',
    !level && 'a level',
    !style && 'a style',
  ].filter((m): m is string => Boolean(m));
  const ready = missing.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Prepare a lecture</h1>

      <div className="mb-8">
        <TopicBox value={topic} onChange={(v) => { setTopic(v); setConcept(null); }} />
      </div>

      <div className="space-y-6">
        <ChipGroup label="Course" options={courseOptions} value={course} onChange={setCourse} />
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
        <summary className="cursor-pointer text-sm font-medium">Add your own example or a special request (optional)</summary>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="must" className="mb-1 block text-sm">Must include</label>
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
            <label htmlFor="special" className="mb-1 block text-sm">Anything special?</label>
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
