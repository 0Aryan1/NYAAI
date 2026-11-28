/** GET /me: who she is, where setup stands, budget left this month, feature flags (LLD §4.2, §11.5). */
import express from 'express';
import { CONSENT_VERSION, Me } from '@nyaai/shared';
import type { Config } from '../config.ts';
import { CSRF_COOKIE, csrfValid, issueCsrf } from '../auth/csrf.ts';

interface MeRow {
  id: string;
  name: string;
  email: string;
  role: Me['user']['role'];
  college_id: string;
  college_name: string;
  department: string | null;
  subjects: string[];
  teaching_language: string;
  style: Record<string, string>;
  setup_step: number;
  setup_done_at: Date | null;
  budget: string;
  used: string;
  consented: boolean;
}

export function meRouter(config: Config) {
  const r = express.Router();
  r.get('/me', async (req, res) => {
    const row = await req.db!(async (c) => {
      await c.query('update users set last_seen_at = now() where id = app_user()');
      return (
        await c.query<MeRow>(
          `select u.id, u.name, u.email, u.role, c.id as college_id, c.name as college_name,
                  p.department, p.subjects, p.teaching_language, p.style, p.setup_step, p.setup_done_at,
                  p.monthly_budget_micro_usd as budget,
                  exists (select 1 from consents k where k.owner_id = u.id and k.version = $1 and k.withdrawn_at is null) as consented,
                  (select coalesce(sum(cost_micro_usd), 0) from usage
                    where owner_id = app_user()
                      and created_at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')) as used
             from users u
             join colleges c on c.id = u.college_id
             join teacher_profiles p on p.owner_id = u.id
            where u.id = app_user()`,
          [CONSENT_VERSION],
        )
      ).rows[0];
    });
    if (!row) throw new Error('signed-in user has no profile row');

    // Make sure the page holds a CSRF token for this user before it sends any change.
    if (!csrfValid(req.cookies?.[CSRF_COOKIE] as string | undefined, row.id, config.CSRF_SECRET)) {
      issueCsrf(res, row.id, config.CSRF_SECRET, config.NODE_ENV === 'production');
    }

    const budget = Number(row.budget);
    const used = Number(row.used);
    res.json(
      Me.parse({
        user: { id: row.id, name: row.name, email: row.email, role: row.role },
        college: { id: row.college_id, name: row.college_name },
        profile: {
          department: row.department,
          subjects: row.subjects,
          teachingLanguage: row.teaching_language,
          style: row.style,
        },
        setupStep: row.setup_step,
        setupDone: row.setup_done_at !== null,
        consented: row.role !== 'teacher' || row.consented,
        budget: { monthlyMicroUsd: budget, usedMicroUsd: used, leftMicroUsd: Math.max(0, budget - used) },
        features: config.FEATURE_FLAGS,
      }),
    );
  });
  return r;
}
