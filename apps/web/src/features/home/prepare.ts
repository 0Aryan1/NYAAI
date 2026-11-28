/**
 * Home's "Prepare" (HOME-1 to HOME-9), without the screen: what is still missing, the request her choices make, and
 * what a refusal means (an unclear topic asks which one she means; a missing earlier lecture asks her to confirm).
 * `usePrepareLecture` sends it and opens the Build screen.
 */
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { ResolveChoice, type PrepareLecture } from '@nyaai/shared';
import { api, ApiRequestError } from '@/shared/api/client';
import { errorText } from '@/shared/lib/errors';

/** The "No course, one-off" chip. */
export const ONE_OFF = 'one_off';

/** Her choices on Home. Chips start empty (null) and are never remembered between visits (HOME-4, HOME-5). */
export interface PrepareForm {
  topic: string;
  course: string | null;
  length: string | null;
  level: string | null;
  style: string | null;
  mustInclude: string;
  special: string;
  notes: string[];
}

/** What Prepare still needs, in her words (HOME-6). Empty means ready. */
export function missingChoices(f: PrepareForm, notesStillReading: boolean): string[] {
  return [
    f.topic.trim().length < 3 && 'a topic',
    !f.course && 'a course (or one-off)',
    !f.length && 'a class length',
    !f.level && 'a level',
    !f.style && 'a style',
    notesStillReading && 'your notes to finish reading (or untick them)',
  ].filter((m): m is string => Boolean(m));
}

/**
 * The request. `unitId` is the lecture of her plan she clicked Prepare on (when she kept that course), else the
 * course's next lecture. `ambiguityChoice` is the meaning she picked, or the topic she explored.
 */
export function prepareRequest(
  f: PrepareForm & { course: string; length: string; level: string; style: string },
  ctx: { planUnit: string | null; nextUnit: string | undefined; conceptId: string | undefined; prereqAck: boolean },
): PrepareLecture {
  return {
    topic: f.topic.trim(),
    course:
      f.course === ONE_OFF
        ? { kind: 'one_off' }
        : { kind: 'course', courseId: f.course, unitId: ctx.planUnit ?? ctx.nextUnit },
    lengthMin: Number(f.length) as PrepareLecture['lengthMin'],
    level: f.level as PrepareLecture['level'],
    styleKey: f.style as PrepareLecture['styleKey'],
    mustInclude: f.mustInclude.trim() ? { text: f.mustInclude.trim() } : undefined,
    anythingSpecial: f.special.trim() || undefined,
    filters: { jurisdiction: 'IN', comparative: false },
    ambiguityChoice: ctx.conceptId,
    prereqAck: ctx.prereqAck || undefined,
    notes: f.notes,
  };
}

type PrepareRefusal =
  | { kind: 'ambiguous'; choices: ResolveChoice[] }
  | { kind: 'prereq'; message: string }
  | { kind: 'error'; message: string };

/** What a refused Prepare asks of her. */
export function prepareRefusal(err: unknown): PrepareRefusal {
  if (err instanceof ApiRequestError && err.code === 'TOPIC_AMBIGUOUS') {
    const choices = z.array(ResolveChoice).safeParse(err.body?.error.details?.choices);
    if (choices.success) return { kind: 'ambiguous', choices: choices.data };
  }
  if (err instanceof ApiRequestError && err.code === 'PREREQ_WARNING_UNACKED')
    return { kind: 'prereq', message: err.message };
  return { kind: 'error', message: errorText(err, 'Something went wrong. Please try again.') };
}

/** Sends Prepare; on success opens the Build screen. The caller handles a refusal (`prepareRefusal`). */
export function usePrepareLecture() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (req: PrepareLecture) => api.prepare(req),
    onSuccess: (r) => void navigate(`/build/${r.lectureId}`),
  });
}
