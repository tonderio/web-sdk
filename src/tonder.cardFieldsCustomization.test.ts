/**
 * Pins the one constructor line that read `customization.card_fields` straight
 * off the merchant's config object instead of off the snapshot.
 *
 * Without this test, nothing else in the suite notices if a future refactor
 * reintroduces the alias: the values handed to the card-field tokenizer are
 * identical either way at construction, and the difference only shows up when
 * the merchant mutates their own object afterwards and the tokenizer sees it.
 *
 * The tokenizer adapter is module-mocked so the object it was constructed with
 * can be held and inspected. Nothing else in this file mocks anything.
 */
import { describe, it, expect, vi } from 'vitest';
import type { HttpPort } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TonderConfig } from './shared/types';
import type { CardFieldsCustomization } from './types/customization';

const captured = vi.hoisted(() => ({
  deps: [] as { customization?: unknown; error_messages?: unknown }[],
}));

vi.mock('./adapters/skyflow/skyflow.adapter', () => ({
  SkyflowAdapter: class {
    constructor(deps: { customization?: unknown; error_messages?: unknown }) {
      captured.deps.push(deps);
    }
    mount = vi.fn(() => Promise.resolve());
    unmount = vi.fn();
    collect = vi.fn(() => Promise.resolve({}));
    reveal = vi.fn(() => Promise.resolve());
  },
}));

const { _createTonderWithDeps } = await import('./tonder');

function silentHttp(): HttpPort {
  return asHttpPort(() => Promise.resolve({}));
}

function configWithCardFields(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    customization: {
      card_fields: {
        labels: { cardholder_name: 'Name on card' },
        error_messages: { card_number: 'Original message' },
      },
    },
  };
}

describe('customization.card_fields handed to the tokenizer', () => {
  it('is a snapshot, so a later mutation of the merchant object does not reach it', () => {
    captured.deps.length = 0;
    const config = configWithCardFields();

    // No tokenizer injected on purpose: this is the one path that constructs
    // the real card-field adapter and therefore exercises the constructor line
    // under test.
    _createTonderWithDeps({ config, http: silentHttp() });

    expect(captured.deps).toHaveLength(1);
    const handed = captured.deps[0].customization as CardFieldsCustomization;
    const handedErrors = captured.deps[0].error_messages as Record<
      string,
      string
    >;

    const merchantCardFields = config.customization!.card_fields!;
    merchantCardFields.labels!.cardholder_name = 'Mutated label';
    merchantCardFields.error_messages!.card_number = 'Mutated message';

    expect(handed).not.toBe(merchantCardFields);
    expect(handed.labels?.cardholder_name).toBe('Name on card');
    expect(handed.error_messages?.card_number).toBe('Original message');
    expect(handedErrors.card_number).toBe('Original message');
  });
});
