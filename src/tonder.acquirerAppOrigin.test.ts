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
    'disables X-App-Origin only for the card acquirer client, not the transactions API client (%s)',
    (environment) => {
      const urls = resolveEnv(environment);

      createTonder({ api_key: 'pk_test_123', environment });

      // The transactions API shares the acquirer's host but allows the header.
      const onAcquirerHost = constructed.filter(
        (c) => c.baseUrl === urls.acquirer,
      );
      const api = constructed.filter((c) => c.baseUrl === urls.api);
      expect(onAcquirerHost.map((c) => c.options)).toEqual([
        undefined,
        { appOrigin: false },
      ]);
      expect(urls.core).toBe(urls.acquirer);
      expect(api).toHaveLength(1);
      expect(api[0].options).toBeUndefined();
    },
  );
});
