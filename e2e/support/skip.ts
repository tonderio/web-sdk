import { test } from '@playwright/test';
import { ENV_KEYS, readEnv } from './env';

/**
 * Skip guard: every E2E test calls this so the suite is CI-safe and secret-free.
 * With no `TONDER_STAGE_API_KEY` set, `npx playwright test` runs ALL-SKIPPED
 * (green, zero errors). With creds present, tests run against STAGE for real.
 *
 * Call inside a `test(...)` body or a `beforeEach` — `test.skip(condition, ...)`
 * marks the current test skipped when the condition is true.
 */
export function skipIfNoStageCreds(): void {
  test.skip(
    readEnv(ENV_KEYS.api_key) === undefined,
    `${ENV_KEYS.api_key} not set — skipping STAGE E2E`,
  );
}

/** Skip when a specific additional env var is missing (e.g. a test PAN). */
export function skipIfMissing(key: string, reason?: string): void {
  test.skip(readEnv(key) === undefined, reason ?? `${key} not set — skipping`);
}
