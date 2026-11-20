import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

const SECURE_TOKEN = 'secure_abc';
const CONFIG: TonderConfig = {
  api_key: 'api_key_under_test',
  environment: 'sandbox',
  session: {
    secure_token: SECURE_TOKEN,
    customer: { email: 'ada@example.com', first_name: 'Ada' },
  },
};

const CARDS = {
  user_id: 'u_1',
  cards: [
    {
      fields: {
        skyflow_id: 'card_abc',
        card_number: 'XXXX-XXXX-XXXX-1234',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: null,
      },
    },
  ],
};

const CORE_CARDS = {
  customer_id: 123,
  data: [
    {
      id: 'card_abc',
      card_number: 'XXXX-XXXX-XXXX-1234',
      expiration_month: '12',
      expiration_year: '2030',
      card_scheme: 'visa',
      subscription_id: null,
    },
  ],
};

function businessConfig(coreEnabled?: boolean): BusinessConfig {
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
    ...(coreEnabled === undefined
      ? {}
      : { core_payments_enabled: coreEnabled }),
  };
}

function tokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({ skyflow_id: 'sky_new' })),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

/** Answers every route either engine serves and records each call. */
function mockHttp(coreEnabled?: boolean) {
  const calls: HttpRequestOptions[] = [];
  const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
    calls.push(o);
    const key = `${o.method} ${o.path}`;
    switch (key) {
      case 'GET /transactions/v1/business/config':
        return Promise.resolve(businessConfig(coreEnabled));
      case 'POST /transactions/v1/customer':
        return Promise.resolve({
          customer_id: 123,
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: '',
          auth_token: 'core_user_tok',
          auth_token_expires_at: '2026-11-20T18:00:00Z',
        });
      case 'POST /api/v1/customer/':
        return Promise.resolve({ id: 42, auth_token: 'legacy_user_tok' });
      case 'GET /api/v1/business/7/cards/':
        return Promise.resolve(CARDS);
      case 'GET /transactions/v1/cards':
        return Promise.resolve(CORE_CARDS);
      case 'POST /api/v1/business/7/cards/':
        return Promise.resolve({ skyflow_id: 'sky_new', user_id: 'u_1' });
      case 'POST /transactions/v1/cards':
        return Promise.resolve({
          id: 'sky_new',
          customer_id: 123,
          subscription_id: null,
        });
      case 'DELETE /api/v1/business/7/cards/card_abc/':
        return Promise.resolve({ message: 'ok' });
      case 'DELETE /transactions/v1/cards/card_abc':
        return Promise.resolve(null);
      case 'GET /transactions/v1/payment_methods?status=active':
        return Promise.resolve({ data: [] });
      case 'GET /transactions/v1/safetypay/banks':
        return Promise.resolve({ data: [] });
      default:
        return Promise.reject(new Error(`unexpected ${key}`));
    }
  });
  const paths = () => calls.map((c) => `${c.method} ${c.path}`);
  return { http, calls, paths };
}

async function ready(http: HttpPort) {
  const tonder = _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer: tokenizer(),
  });
  await tonder.init();
  return tonder;
}

describe('customer and saved cards follow core_payments_enabled', () => {
  it('flag ON: the customer and the card list, add and remove go to the transactions API', async () => {
    const { http, calls, paths } = mockHttp(true);
    const tonder = await ready(http);

    const cards = await tonder.getCustomerCards();
    await tonder.removeCustomerCard('card_abc');
    await tonder.enrollCard();

    // The merchant-facing result is the same list the monolith path gives.
    expect(cards).toEqual([
      {
        card_id: 'card_abc',
        card_number: 'XXXX-XXXX-XXXX-1234',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: null,
      },
    ]);
    expect(paths()).toEqual([
      'GET /transactions/v1/business/config',
      'POST /transactions/v1/customer',
      'GET /transactions/v1/cards',
      'DELETE /transactions/v1/cards/card_abc',
      'POST /transactions/v1/cards',
    ]);
    // Same credential as /process for the customer; the card routes carry only
    // the secure token and the customer token the core issued.
    expect(calls[1]?.headers).toEqual({
      Authorization: 'Token api_key_under_test',
    });
    expect(calls[2]?.headers).toEqual({
      Authorization: `Bearer ${SECURE_TOKEN}`,
      'User-Token': 'core_user_tok',
    });
  });

  it('flag OFF: customer and cards stay on the monolith exactly as before', async () => {
    const { http, calls, paths } = mockHttp(false);
    const tonder = await ready(http);

    await tonder.getCustomerCards();
    await tonder.removeCustomerCard('card_abc');
    await tonder.enrollCard();

    expect(paths()).toEqual([
      'GET /transactions/v1/business/config',
      'POST /api/v1/customer/',
      'GET /api/v1/business/7/cards/',
      'DELETE /api/v1/business/7/cards/card_abc/',
      'POST /api/v1/business/7/cards/',
    ]);
    expect(calls[2]?.headers).toEqual({
      Authorization: `Bearer ${SECURE_TOKEN}`,
      'User-Token': 'legacy_user_tok',
    });
  });

  it('flag absent (older backend): behaves as OFF', async () => {
    const { http, paths } = mockHttp(undefined);
    const tonder = await ready(http);

    await tonder.getCustomerCards();

    expect(paths()).toContain('POST /api/v1/customer/');
    expect(paths()).toContain('GET /api/v1/business/7/cards/');
  });
});

describe('payment methods and SafetyPay banks always go to the transactions API', () => {
  it.each([true, false, undefined])(
    'flag %s: no monolith route is called',
    async (flag) => {
      const { http, paths } = mockHttp(flag);
      const tonder = await ready(http);

      await tonder.getPaymentMethods();
      await tonder.getPaymentMethodBanks();

      expect(paths().slice(1)).toEqual([
        'GET /transactions/v1/payment_methods?status=active',
        'GET /transactions/v1/safetypay/banks',
      ]);
    },
  );

  it('works before init() with no key in the path', async () => {
    const { http, paths } = mockHttp(false);
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    await tonder.getPaymentMethodBanks();

    expect(paths()).toEqual(['GET /transactions/v1/safetypay/banks']);
  });
});
