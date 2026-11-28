/** After the journeys: stop the worker, and delete everything about the throwaway teacher. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { root } from '../playwright.config';
import { STATE } from './global-setup';

export default async function globalTeardown() {
  if (!existsSync(STATE)) return;
  const { email, workerPid } = JSON.parse(readFileSync(STATE, 'utf8')) as { email: string; workerPid?: number };
  if (workerPid) {
    try {
      process.kill(-workerPid, 'SIGTERM'); // the whole process group: pnpm, tsx and node
    } catch {
      /* already gone */
    }
  }
  if (!process.env.E2E_KEEP)
    execFileSync('pnpm', ['--filter', '@nyaai/server', 'exec', 'tsx', 'scripts/e2e-account.ts', 'remove', email], {
      cwd: root,
      stdio: 'inherit',
    });
  rmSync(STATE, { force: true });
}
