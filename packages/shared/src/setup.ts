import { z } from 'zod';

/** Step "profile" (ACC-3): name and department prefilled from Google; she picks subjects and language. */
export const ProfileRequest = z.object({
  name: z.string().trim().min(2).max(120),
  department: z.string().trim().max(120).optional(),
  subjects: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  teachingLanguage: z.enum(['en', 'en_hi', 'hi']),
});
export type ProfileRequest = z.infer<typeof ProfileRequest>;

/** The five one-tap style questions (ACC-5). Keys match teacher_profiles.style. */
export const STYLE_QUESTIONS = [
  {
    key: 'density',
    question: 'How full should a slide be?',
    options: [
      { value: 'light', label: 'A few key points' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'dense', label: 'Detailed' },
    ],
  },
  {
    key: 'case_first',
    question: 'Do you start with the case or the rule?',
    options: [
      { value: 'rule_first', label: 'Rule first' },
      { value: 'case_first', label: 'Case first' },
    ],
  },
  {
    key: 'structure',
    question: 'How do you build a class?',
    options: [
      { value: 'irac', label: 'Issue, rule, application, conclusion' },
      { value: 'story', label: 'How the law developed' },
      { value: 'questions', label: 'Led by questions' },
    ],
  },
  {
    key: 'language_mix',
    question: 'Which language on the slides?',
    options: [
      { value: 'english', label: 'English' },
      { value: 'english_hindi_terms', label: 'English with Hindi terms' },
      { value: 'bilingual', label: 'English and Hindi' },
    ],
  },
  {
    key: 'example_kind',
    question: 'What kind of examples?',
    options: [
      { value: 'indian_cases', label: 'Real Indian cases' },
      { value: 'everyday', label: 'Everyday situations' },
      { value: 'hypotheticals', label: 'Exam-style problems' },
    ],
  },
] as const;

export const StyleRequest = z.object({
  density: z.enum(['light', 'balanced', 'dense']),
  case_first: z.enum(['rule_first', 'case_first']),
  structure: z.enum(['irac', 'story', 'questions']),
  language_mix: z.enum(['english', 'english_hindi_terms', 'bilingual']),
  example_kind: z.enum(['indian_cases', 'everyday', 'hypotheticals']),
});
export type StyleRequest = z.infer<typeof StyleRequest>;

/** PATCH /setup/progress: move past a step that has nothing to save yet (old slides, template, courses). */
export const ProgressRequest = z.object({ step: z.number().int().min(2).max(6) });

/**
 * Every outside processor her data may reach (consent screen, LLD §12.3). Changing this list means a new
 * CONSENT_VERSION, and teachers are asked again.
 */
export const CONSENT_VERSION = '2026-11-19';
export const PROCESSORS = [
  {
    name: 'Anthropic (Claude)',
    purpose: 'Writes and checks lecture text from the sources it is given',
    dataSent: 'Your topic, library extracts, your style settings, and any notes or examples you choose to use',
    region: 'United States',
  },
  {
    name: 'Voyage AI',
    purpose: 'Makes the law library and your uploads searchable',
    dataSent: 'Text passages from the library and from your uploads',
    region: 'United States',
  },
  {
    name: 'Indian Kanoon',
    purpose: 'Looks up judgments the library does not have yet',
    dataSent: 'Search words taken from your topic (never your files)',
    region: 'India',
  },
  {
    name: 'Hosting and storage (pilot)',
    purpose: 'Runs the app and keeps your lectures and files',
    dataSent: 'Everything you save in NYAAI',
    region: 'Covered by the CNLU pilot data agreement',
  },
] as const;

export const ConsentRequest = z.object({ version: z.literal(CONSENT_VERSION), accept: z.literal(true) });
export type ConsentRequest = z.infer<typeof ConsentRequest>;
