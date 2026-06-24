import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the @tonder.io/web-sdk E2E suite.
 *
 * The suite drives the IIFE bundle (`dist/index.global.js`) inside a real
 * Chromium against Tonder STAGE. Every test self-skips when stage credentials
 * are absent (see e2e/support/skip.ts), so `npx playwright test` is CI-safe and
 * secret-free out of the box: it runs ALL-SKIPPED with no env vars.
 *
 * Serial workers: stage state (customers, cards, transactions) is shared and
 * order-sensitive, so parallelism would cause cross-test interference.
 */
const PORT = Number(process.env.E2E_PORT ?? 4321);

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Pre-built bundle (pretest:e2e runs `npm run build`) is served by a tiny
  // zero-dependency Node static server. reuseExistingServer locally for fast
  // re-runs; never reuse on CI to guarantee a clean process.
  webServer: {
    command: `node e2e/support/server.mjs`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
