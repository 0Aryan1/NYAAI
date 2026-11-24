import { z } from 'zod';

export const Role = z.enum(['teacher', 'admin', 'library_editor']);
export type Role = z.infer<typeof Role>;

/** GET /auth/options: which sign-in paths the login page may show. */
export const AuthOptions = z.object({
  google: z.boolean(),
  devLogin: z.boolean(),
});
export type AuthOptions = z.infer<typeof AuthOptions>;

/** POST /auth/dev-login (development only). */
export const DevLoginRequest = z.object({ email: z.email().max(200) });
export type DevLoginRequest = z.infer<typeof DevLoginRequest>;

/**
 * Setup order. Consent comes first: nothing she uploads (old slides) may reach a processor before she has
 * agreed (DPDP). Then the five BRD ACC-2 steps.
 */
export const SETUP_STEPS = ['consent', 'profile', 'old_slides', 'style', 'template', 'courses'] as const;
export type SetupStepName = (typeof SETUP_STEPS)[number];

/** GET /me */
export const Me = z.object({
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string(), role: Role }),
  college: z.object({ id: z.uuid(), name: z.string() }),
  profile: z.object({
    department: z.string().nullable(),
    subjects: z.array(z.string()),
    teachingLanguage: z.string(),
    style: z.record(z.string(), z.string()),
  }),
  /** 1-based index into SETUP_STEPS; the wizard resumes here. */
  setupStep: z.number().int().min(1).max(SETUP_STEPS.length),
  setupDone: z.boolean(),
  /** She has agreed to the current consent and not withdrawn it (teachers only; always true for others). */
  consented: z.boolean(),
  budget: z.object({ monthlyMicroUsd: z.number().int(), usedMicroUsd: z.number().int(), leftMicroUsd: z.number().int() }),
  features: z.array(z.string()),
});
export type Me = z.infer<typeof Me>;
