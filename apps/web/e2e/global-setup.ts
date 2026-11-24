/**
 * Before the journeys: a fresh throwaway teacher is invited, and a worker is started on the E2E queue prefix with
 * the fake AI (the API and the web app are Playwright's webServer). Her email reaches the tests through the env.
 */
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, serverEnv } from '../playwright.config';

export const STATE = path.join(root, 'apps/web/e2e/.run.json');

export default async function globalSetup() {
  const email = `e2e-${Date.now().toString(36)}@cnlu.ac.in`;
  execFileSync('pnpm', ['--filter', '@nyaai/server', 'exec', 'tsx', 'scripts/e2e-account.ts', 'create', email], { cwd: root, stdio: 'inherit' });
  const worker = spawn('pnpm', ['--filter', '@nyaai/server', 'exec', 'tsx', 'src/main.worker.ts'], {
    cwd: root,
    env: { ...process.env, ...serverEnv },
    stdio: 'inherit',
    detached: true,
  });
  writeFileSync(STATE, JSON.stringify({ email, workerPid: worker.pid }));
  process.env.E2E_EMAIL = email;
  // Give the worker a moment to connect to Redis before the first job is queued.
  await new Promise((r) => setTimeout(r, 4000));
}
