import { z } from 'zod';

/** Chip choices on Home (HOME-3, HOME-5, HOME-6). Every chip starts empty; the app never picks one. */
export const LENGTH_CHOICES = [40, 50, 60, 90] as const;
export const LEVEL_CHOICES = [
  { value: 'intro', label: 'Introductory' },
  { value: 'standard', label: 'Standard' },
  { value: 'advanced', label: 'Advanced' },
] as const;
export const STYLE_CHOICES = [
  { value: 'usual', label: 'My usual style' },
  { value: 'exam', label: 'Exam revision' },
  { value: 'discussion', label: 'Discussion class' },
] as const;

/** GET /home */
export const HomeResponse = z.object({
  courses: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      nextUnit: z.object({ id: z.uuid(), position: z.number().int(), title: z.string() }).nullable(),
    }),
  ),
});
export type HomeResponse = z.infer<typeof HomeResponse>;
