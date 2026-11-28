/**
 * Setup and consent (F1, ACC-2 to ACC-6; BRD NFR-8). Each step saves straight away and moves `setup_step` forward,
 * so she can stop and resume. Steps: 1 consent, 2 profile, 3 old slides, 4 style, 5 template, 6 courses.
 * Runs in her own transaction (RLS: `app_user()` is her).
 */
import type pg from 'pg';
import { CONSENT_VERSION, PROCESSORS, StyleRequest, type ProfileRequest } from '@nyaai/shared';
import { AppError } from '../../errors.ts';

/** Has she agreed to the current consent version, and not withdrawn it? */
export async function hasConsent(c: pg.PoolClient): Promise<boolean> {
  const r = await c.query(
    'select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null limit 1',
    [CONSENT_VERSION],
  );
  return r.rowCount === 1;
}

/** Step 1: she agrees to the services listed (a second agreement to the same version changes nothing). */
export async function giveConsent(c: pg.PoolClient, version: typeof CONSENT_VERSION): Promise<void> {
  await c.query(
    `insert into consents (college_id, owner_id, version, processors)
     select app_college(), app_user(), $1, $2::jsonb
      where not exists (select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null)`,
    [version, JSON.stringify(PROCESSORS)],
  );
  await advanceTo(c, 2);
}

/** She withdraws: nothing more is sent to outside services until she agrees again. Her data stays. */
export async function withdrawConsent(c: pg.PoolClient): Promise<void> {
  await c.query('update consents set withdrawn_at = now() where owner_id = app_user() and withdrawn_at is null');
}

export async function saveProfile(c: pg.PoolClient, body: ProfileRequest): Promise<void> {
  await c.query('update users set name = $1 where id = app_user()', [body.name]);
  await c.query(
    `update teacher_profiles set department = $1, subjects = $2, teaching_language = $3, updated_at = now()
      where owner_id = app_user()`,
    [body.department ?? null, body.subjects, body.teachingLanguage],
  );
  await advanceTo(c, 3);
}

export async function saveStyle(c: pg.PoolClient, style: StyleRequest): Promise<void> {
  await c.query(
    'update teacher_profiles set style = style || $1::jsonb, updated_at = now() where owner_id = app_user()',
    [JSON.stringify(style)],
  );
  await advanceTo(c, 5);
}

/** Moves her forward to `step` (never back). With `strict`, refuses to skip a step she has not reached. */
export async function advanceTo(c: pg.PoolClient, step: number, strict = false): Promise<void> {
  const r = await c.query(
    `update teacher_profiles set setup_step = greatest(setup_step, $1), updated_at = now()
      where owner_id = app_user() and ($2::boolean is false or setup_step >= $1 - 1)`,
    [step, strict],
  );
  if (strict && r.rowCount === 0)
    throw new AppError('VALIDATION_FAILED', 'Please finish the earlier setup steps first.');
}

/** The last step: every required answer must be there (consent, profile, style). */
export async function finishSetup(c: pg.PoolClient): Promise<void> {
  const row = (
    await c.query<{ subjects: string[]; style: Record<string, string> }>(
      'select subjects, style from teacher_profiles where owner_id = app_user()',
    )
  ).rows[0];
  const missing: string[] = [];
  if (!(await hasConsent(c))) missing.push('consent');
  if (!row?.subjects.length) missing.push('profile');
  if (!StyleRequest.safeParse(row?.style ?? {}).success) missing.push('style');
  if (missing.length) throw new AppError('VALIDATION_FAILED', 'A few setup steps still need an answer.', { missing });
  await c.query(
    'update teacher_profiles set setup_step = 6, setup_done_at = coalesce(setup_done_at, now()), updated_at = now() where owner_id = app_user()',
  );
}
