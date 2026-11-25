/**
 * Browser journeys (HLD §12, LLD §16): J3 (first sign-in and setup) and J1 (a lecture end to end), in a real
 * browser, with axe-core on every screen they visit. They run on their own ports and queue prefix beside a
 * developer's `pnpm dev`, with a scripted fake AI (E2E_FAKE_AI: no cost, no network) on the real library.
 *   pnpm --filter @nyaai/web e2e
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const API_PORT = 4100;
export const WEB_PORT = 5174;
// A robot clicks much faster than a teacher: the per-teacher limit (60 a minute) is raised for this run only.
const serverEnv = { API_PORT: String(API_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}`, E2E_FAKE_AI: 'true', QUEUE_PREFIX: 'e2e', LOG_LEVEL: 'warn', RATE_LIMIT_PER_MIN: '1000', SIGNIN_LIMIT_PER_MIN: '1000' };

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome', // the Chrome already installed: no browser download
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @nyaai/server exec tsx src/main.api.ts',
      cwd: root,
      env: serverEnv,
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @nyaai/web exec vite',
      cwd: root,
      env: { WEB_PORT: String(WEB_PORT), API_ORIGIN: `http://localhost:${API_PORT}` },
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

export { serverEnv, root };
