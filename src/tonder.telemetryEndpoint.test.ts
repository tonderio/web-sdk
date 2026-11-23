import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: Record<string, unknown>[] = [];

vi.mock('@tonder.io/client-telemetry', () => ({
  createTelemetry: (options: Record<string, unknown>) => {
    created.push(options);
    return { methodCalled: vi.fn(), flowStep: vi.fn(), flowFailed: vi.fn() };
  },
}));

import { createTonder } from './tonder';
import { resolveEnv } from './shared/config/env';
import type { TonderMode } from './shared/config/env';

beforeEach(() => {
  created.length = 0;
});

describe('telemetry endpoint', () => {
  it.each(['production', 'stage', 'sandbox'] as TonderMode[])(
    'is on the microservices host, not the monolith, in %s',
    (environment) => {
      createTonder({ api_key: 'api_key_under_test', environment });

      const env = resolveEnv(environment);
      expect(created[0].endpoint).toBe(`${env.core}/telemetry`);
      expect(String(created[0].endpoint)).not.toContain(env.api);
    },
  );
});
