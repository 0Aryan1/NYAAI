/**
 * Setup (F1, ACC-2 to ACC-6). Each step saves straight away and moves `setup_step` forward, so she can stop
 * and resume. Steps: 1 consent, 2 profile, 3 old slides, 4 style, 5 template, 6 courses.
 * Old slides, template and courses are skipped forward with /setup/progress until their screens land (Day 4).
 */
import express from 'express';
import { CONSENT_VERSION, ConsentRequest, PROCESSORS, ProfileRequest, ProgressRequest, StyleRequest } from '@nyaai/shared';
import { AppError } from '../errors.ts';

export function setupRouter() {
  const r = express.Router();

  r.get('/consents/current', async (req, res) => {
    const accepted = await req.db!(async (c) =>
      (
        await c.query('select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null limit 1', [
          CONSENT_VERSION,
        ])
      ).rowCount,
    );
    res.json({ version: CONSENT_VERSION, processors: PROCESSORS, accepted: accepted === 1 });
  });

  r.post('/consents', async (req, res) => {
    const body = ConsentRequest.parse(req.body);
    await req.db!(async (c) => {
      await c.query(
        `insert into consents (college_id, owner_id, version, processors)
         select app_college(), app_user(), $1, $2::jsonb
          where not exists (select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null)`,
        [body.version, JSON.stringify(PROCESSORS)],
      );
      await c.query('update teacher_profiles set setup_step = greatest(setup_step, 2), updated_at = now() where owner_id = app_user()');
    });
    res.status(204).end();
  });

  /** She withdraws her consent: nothing more is sent to outside services until she agrees again. Her data stays. */
  r.post('/consents/withdraw', async (req, res) => {
    await req.db!((c) => c.query('update consents set withdrawn_at = now() where owner_id = app_user() and withdrawn_at is null'));
    res.status(204).end();
  });

  r.patch('/setup/profile', async (req, res) => {
    const body = ProfileRequest.parse(req.body);
    await req.db!(async (c) => {
      await c.query('update users set name = $1 where id = app_user()', [body.name]);
      await c.query(
        `update teacher_profiles
            set department = $1, subjects = $2, teaching_language = $3,
                setup_step = greatest(setup_step, 3), updated_at = now()
          where owner_id = app_user()`,
        [body.department ?? null, body.subjects, body.teachingLanguage],
      );
    });
    res.status(204).end();
  });

  r.patch('/setup/style', async (req, res) => {
    const style = StyleRequest.parse(req.body);
    await req.db!((c) =>
      c.query(
        `update teacher_profiles set style = style || $1::jsonb, setup_step = greatest(setup_step, 5), updated_at = now()
          where owner_id = app_user()`,
        [JSON.stringify(style)],
      ),
    );
    res.status(204).end();
  });

  r.patch('/setup/progress', async (req, res) => {
    const { step } = ProgressRequest.parse(req.body);
    // Move forward one step at a time only; a step can't be skipped before the one before it is done.
    const updated = await req.db!((c) =>
      c.query(
        `update teacher_profiles set setup_step = greatest(setup_step, $1), updated_at = now()
          where owner_id = app_user() and setup_step >= $1 - 1`,
        [step],
      ),
    );
    if (updated.rowCount === 0) throw new AppError('VALIDATION_FAILED', 'Please finish the earlier setup steps first.');
    res.status(204).end();
  });

  r.post('/setup/finish', async (req, res) => {
    await req.db!(async (c) => {
      const row = (
        await c.query<{ subjects: string[]; style: Record<string, string>; consented: boolean }>(
          `select p.subjects, p.style,
                  exists (select 1 from consents where owner_id = app_user() and version = $1 and withdrawn_at is null) as consented
             from teacher_profiles p where p.owner_id = app_user()`,
          [CONSENT_VERSION],
        )
      ).rows[0];
      const missing: string[] = [];
      if (!row?.consented) missing.push('consent');
      if (!row?.subjects.length) missing.push('profile');
      if (!StyleRequest.safeParse(row?.style ?? {}).success) missing.push('style');
      if (missing.length) throw new AppError('VALIDATION_FAILED', 'A few setup steps still need an answer.', { missing });
      await c.query('update teacher_profiles set setup_step = 6, setup_done_at = coalesce(setup_done_at, now()), updated_at = now() where owner_id = app_user()');
    });
    res.status(204).end();
  });

  return r;
}
