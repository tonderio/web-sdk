import { describe, it, expect, vi, beforeEach } from 'vitest';

const created: Record<string, unknown>[] = [];
const client = {
  methodCalled: vi.fn(),
  flowStep: vi.fn(),
  flowFailed: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
};
let factory: (options: Record<string, unknown>) => unknown = () => client;

vi.mock('@tonder.io/client-telemetry', () => ({
  createTelemetry: (options: Record<string, unknown>) => {
    created.push(options);
    return factory(options);
  },
}));

import { ClientTelemetryAdapter } from './client-telemetry.adapter';
import { SDK_VERSION } from '../../shared/version';

function build() {
  return new ClientTelemetryAdapter({
    env: 'stage',
    endpoint: 'https://api-stage.tonder.io/telemetry',
    apiKey: 'api_key_under_test',
  });
}

beforeEach(() => {
  created.length = 0;
  factory = () => client;
  client.methodCalled.mockReset();
  client.flowStep.mockReset();
  client.flowFailed.mockReset();
});

describe('ClientTelemetryAdapter', () => {
  it('identifies the SDK as web-sdk with the build-time version', async () => {
    build();

    expect(created[0].sdk).toEqual({ name: 'web-sdk', version: SDK_VERSION });
    expect(SDK_VERSION).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/);
    expect(created[0].env).toBe('stage');
    expect(created[0].endpoint).toBe('https://api-stage.tonder.io/telemetry');
  });

  it('authorizes with the same header the SDK sends to Tonder', async () => {
    build();

    const getAuthorization = created[0].getAuthorization as () => unknown;
    expect(await getAuthorization()).toBe('Token api_key_under_test');
  });

  it('forwards the three events and the deprecated flag', () => {
    const t = build();

    t.methodCalled('pay');
    t.methodCalled('oldMethod', { deprecated: true });
    t.flowStep('charge', { outcome: 'ok', duration_ms: 12 });
    t.flowFailed('charge', { error_code: 'X', http_status: 503 });

    expect(client.methodCalled).toHaveBeenNthCalledWith(1, 'pay', {}, {});
    expect(client.methodCalled).toHaveBeenNthCalledWith(
      2,
      'oldMethod',
      {},
      { deprecated: true },
    );
    expect(client.flowStep).toHaveBeenCalledWith('charge', {
      outcome: 'ok',
      duration_ms: 12,
    });
    expect(client.flowFailed).toHaveBeenCalledWith('charge', {
      error_code: 'X',
      http_status: 503,
    });
  });

  it('flushes the client without waiting for it and without throwing', () => {
    const t = build();

    t.flush();
    expect(client.flush).toHaveBeenCalledTimes(1);

    client.flush.mockImplementationOnce(() => Promise.reject(new Error('x')));
    expect(() => t.flush()).not.toThrow();
    client.flush.mockImplementationOnce(() => {
      throw new Error('x');
    });
    expect(() => t.flush()).not.toThrow();
  });

  it('never throws into the page, even if the client does', () => {
    client.methodCalled.mockImplementation(() => {
      throw new Error('boom');
    });
    client.flowStep.mockImplementation(() => {
      throw new Error('boom');
    });
    client.flowFailed.mockImplementation(() => {
      throw new Error('boom');
    });
    const t = build();

    expect(() => t.methodCalled('pay')).not.toThrow();
    expect(() => t.flowStep('charge')).not.toThrow();
    expect(() => t.flowFailed('charge')).not.toThrow();
  });

  it('does nothing, and does not throw, when the client cannot be created', () => {
    factory = () => {
      throw new Error('no client');
    };

    const t = build();

    expect(() => t.methodCalled('pay')).not.toThrow();
    expect(() => t.flowStep('charge')).not.toThrow();
    expect(() => t.flowFailed('charge')).not.toThrow();
    expect(client.methodCalled).not.toHaveBeenCalled();
  });
});
