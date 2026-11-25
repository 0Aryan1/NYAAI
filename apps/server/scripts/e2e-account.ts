/**
 * The browser journeys' throwaway teacher (apps/web/e2e). Development only.
 *   tsx scripts/e2e-account.ts create <email>   invite her to the dev college (she signs in and sets up in J3)
 *   tsx scripts/e2e-account.ts remove <email>   delete everything about her, as "Delete my data" does, then her row
 */
import { createPool, withTenant } from '@nyaai/db';
import { loadConfig } from '../src/config.ts';
import { storageFrom } from '../src/services/factory.ts';
import { forgetTeacher } from '../src/services/account/index.ts';

const DEV_COLLEGE = '00000000-0000-4000-8000-000000000002';
const [command, email] = process.argv.slice(2);
if (!email || !/^e2e-[a-z0-9-]+@/.test(email)) throw new Error('usage: create|remove e2e-…@<domain>');
const config = loadConfig();
if (config.NODE_ENV !== 'development') throw new Error('the e2e account script runs only in development');
if (!process.env.DATABASE_URL_MIGRATE || !config.DATABASE_URL_WORKER) throw new Error('DATABASE_URL_MIGRATE and DATABASE_URL_WORKER are needed');
const owner = createPool(process.env.DATABASE_URL_MIGRATE, 1);
const worker = createPool(config.DATABASE_URL_WORKER, 2);

try {
  if (command === 'create') {
    await owner.query("insert into invite_allowlist (college_id, email, role) values ($1, $2, 'teacher') on conflict do nothing", [DEV_COLLEGE, email]);
    console.log(`invited ${email}`);
  } else if (command === 'remove') {
    const user = (await owner.query<{ id: string; college_id: string }>('select id, college_id from users where email = $1', [email])).rows[0];
    if (user) {
      // Test reports must not stay in the gold set (a real teacher's do, unlinked; these are not real).
      await owner.query('delete from eval_items where from_report in (select id from reports where owner_id = $1)', [user.id]);
      const storage = storageFrom(config);
      const r = await forgetTeacher({ userId: user.id, collegeId: user.college_id, role: 'teacher' }, { worker, storage });
      await withTenant(worker, { userId: user.id, collegeId: user.college_id, role: 'teacher' }, (c) => c.query('delete from deletion_log where id = $1', [r.logId]));
      await owner.query('delete from users where id = $1', [user.id]).catch(() => {
        /* kept as an anonymous shell if a library record points at it */
      });
    }
    await owner.query('delete from invite_allowlist where email = $1', [email]);
    console.log(`removed ${email}`);
  } else {
    throw new Error('usage: create|remove <email>');
  }
} finally {
  await Promise.all([owner.end(), worker.end()]);
}
