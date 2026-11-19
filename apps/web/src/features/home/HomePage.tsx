import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LENGTH_CHOICES, LEVEL_CHOICES, STYLE_CHOICES } from '@nyaai/shared';
import { api, queryKeys } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { ChipGroup } from '@/shared/ui/chip-group';

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
        <label htmlFor="topic" className="mb-2 block text-sm font-medium">
          What do you want to teach?
        </label>
        <input
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={200}
          placeholder="A topic, a section, a case or a question, e.g. frustration of contract, s. 56"
          className="h-12 w-full rounded-control border border-border bg-surface px-4 text-base placeholder:text-muted focus:border-accent"
        />
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
          disabled={!ready}
          aria-describedby="prepare-hint"
          title={ready ? undefined : `Still needed: ${missing.join(', ')}`}
          onClick={() => setNotice('Building lectures is being switched on in the next update.')}
        >
          Prepare
        </Button>
        <p id="prepare-hint" className="text-sm text-muted" aria-live="polite">
          {ready ? (notice ?? 'Ready when you are.') : `Still needed: ${missing.join(', ')}.`}
        </p>
      </div>
    </div>
  );
}
