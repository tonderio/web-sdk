import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import { MESSAGES_EN } from './shared/errors/messages';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

function makeBusinessConfig(
  overrides: Partial<BusinessConfig> = {},
): BusinessConfig {
  return {
    business: {
      pk: 7,
      name: 'Acme',
      categories: [],
      web: 'https://acme.test',
      logo: 'logo.png',
      full_logo_url: 'https://acme.test/logo.png',
      background_color: '#fff',
      primary_color: '#000',
      checkout_mode: true,
      textCheckoutColor: '#111',
      textDetailsColor: '#222',
      checkout_logo: 'checkout.png',
    },
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
    ...overrides,
  };
}

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve({})),
  };
}

function build(
  business: Partial<BusinessConfig>,
  customer?: NonNullable<TonderConfig['session']>['customer'],
) {
  const http: HttpPort = asHttpPort((_options: HttpRequestOptions) =>
    Promise.resolve(makeBusinessConfig(business)),
  );
  return _createTonderWithDeps({
    config: {
      api_key: 'pk_test_123',
      environment: 'sandbox',
      session: { secure_token: 'secure_abc', customer },
    },
    http,
    tokenizer: noopTokenizer(),
  });
}

const WITH_PHONE = { email: 'ada@example.com', phone: '5512345678' };
const NO_PHONE = { email: 'ada@example.com' };

describe('Tonder.canSaveCards', () => {
  it('returns false before init() without throwing', () => {
    const tonder = build({ save_cards_identifier_type: 'email' }, WITH_PHONE);

    expect(tonder.canSaveCards()).toBe(false);
  });

  it.each([
    ['email mode, no phone', 'email', NO_PHONE],
    ['email mode, phone', 'email', WITH_PHONE],
    ['field absent, no phone', undefined, NO_PHONE],
    ['unknown type, no phone', 'document', NO_PHONE],
    ['phone mode, phone present', 'phone', WITH_PHONE],
  ] as const)('is true: %s', async (_name, type, customer) => {
    const tonder = build(
      {
        save_cards_identifier_type: type as 'email' | 'phone' | undefined,
      },
      customer,
    );
    await tonder.init();

    expect(tonder.canSaveCards()).toBe(true);
  });

  it.each([
    ['phone missing', NO_PHONE],
    ['phone empty', { ...NO_PHONE, phone: '' }],
    ['phone whitespace-only', { ...NO_PHONE, phone: '   ' }],
    ['no customer', undefined],
  ] as const)('is false in phone mode: %s', async (_name, customer) => {
    const tonder = build({ save_cards_identifier_type: 'phone' }, customer);
    await tonder.init();

    expect(tonder.canSaveCards()).toBe(false);
  });

  it('has a message naming the phone requirement', () => {
    expect(MESSAGES_EN[ErrorKeyEnum.SAVE_CARDS_UNAVAILABLE]).toMatch(/phone/i);
  });
});
