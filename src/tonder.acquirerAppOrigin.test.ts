import { describe, it, expect, vi, beforeEach } from 'vitest';

const constructed = vi.hoisted(
  () => [] as Array<{ baseUrl: string; options: unknown }>,
);

vi.mock('./adapters/http/fetch-http.client', () => ({
  FetchHttpClient: class {
    constructor(baseUrl: string, _apiKey: string, options?: unknown) {
      constructed.push({ baseUrl, options });
    }
    request = vi.fn();
  },
}));

import { createTonder } from './tonder';
import { resolveEnv } from './shared/config/env';

describe('createTonder HTTP client wiring', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it.each(['production', 'stage', 'sandbox'] as const)(
    'disables X-App-Origin only for the acquirer host (%s)',
    (environment) => {
      const urls = resolveEnv(environment);

      createTonder({ api_key: 'pk_test_123', environment });

      const acquirer = constructed.filter((c) => c.baseUrl === urls.acquirer);
      const api = constructed.filter((c) => c.baseUrl === urls.api);
      expect(acquirer).toHaveLength(1);
      expect(acquirer[0].options).toEqual({ appOrigin: false });
      expect(api).toHaveLength(1);
      expect(api[0].options).toBeUndefined();
    },
  );
});
