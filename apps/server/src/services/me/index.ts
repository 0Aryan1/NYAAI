/**
 * Who is signed in (GET /me): her account, college, profile, setup step, consent and this month's budget, and
 * the feature flags. Also records that she was seen now. Runs in her transaction (RLS).
 */
import type pg from 'pg';
import { CONSENT_VERSION, type Me } from '@nyaai/shared';
import { AppError } from '../../errors.ts';
import { monthlyBudget } from '../budget/index.ts';

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
  consented: boolean;
}

export async function loadMe(c: pg.PoolClient, features: string[]): Promise<Me> {
  await c.query('update users set last_seen_at = now() where id = app_user()');
  const row = (
    await c.query<MeRow>(
      `select u.id, u.name, u.email, u.role, c.id as college_id, c.name as college_name,
              p.department, p.subjects, p.teaching_language, p.style, p.setup_step, p.setup_done_at,
              exists (select 1 from consents k where k.owner_id = u.id and k.version = $1 and k.withdrawn_at is null) as consented
         from users u
         join colleges c on c.id = u.college_id
         join teacher_profiles p on p.owner_id = u.id
        where u.id = app_user()`,
      [CONSENT_VERSION],
    )
  ).rows[0];
  // Every invited user gets a profile row on first sign-in (auth_accept_invite); without one, sign-in went wrong.
  if (!row) throw new AppError('NOT_SIGNED_IN', 'Your account is not set up yet. Sign in again.');
  const budget = await monthlyBudget(c, row.id);
  const b = budget ?? { budget: 0, spent: 0, left: 0 };
  return {
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
    budget: { monthlyMicroUsd: b.budget, usedMicroUsd: b.spent, leftMicroUsd: Math.max(0, b.left) },
    features,
  };
}
