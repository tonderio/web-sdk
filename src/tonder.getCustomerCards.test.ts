import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendCardsResponse } from './models/card.model';
import type { TonderConfig } from './shared/types';

const BASE_CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
};

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

function cardsResponse(
  subscription_id: string | null = null,
): BackendCardsResponse {
  return {
    user_id: 'u_1',
    cards: [
      {
        fields: {
          card_number: 'XXXX-XXXX-XXXX-1234',
          expiration_month: '12',
          expiration_year: '2030',
          skyflow_id: 'sky_1',
          subscription_id,
          card_scheme: 'visa',
        },
      },
    ],
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

/** Routes business GET, customer POST, and the cards GET. */
function mockHttp(
  mockOptions: {
    business?: Partial<BusinessConfig>;
    subscription_id?: string | null;
  } = {},
): { http: HttpPort; cardsSpy: ReturnType<typeof vi.fn> } {
  const cardsSpy = vi.fn((_options: HttpRequestOptions) =>
    Promise.resolve(cardsResponse(mockOptions.subscription_id)),
  );
  const http: HttpPort = asHttpPort((requestOptions: HttpRequestOptions) => {
    if (requestOptions.path === '/api/v1/customer/') {
      return Promise.resolve({
        id: 1,
        auth_token: 'cust_tok_1',
      });
    }
    if (requestOptions.path.endsWith('/cards/')) {
      return cardsSpy(requestOptions);
    }
    return Promise.resolve(makeBusinessConfig(mockOptions.business));
  });
  return { http, cardsSpy };
}

async function readyWithCustomer(
  config: TonderConfig,
  http: HttpPort,
): Promise<ReturnType<typeof _createTonderWithDeps>> {
  const tonder = _createTonderWithDeps({
    config: {
      ...config,
      session: { ...config.session, customer: { email: 'ada@example.com' } },
    },
    http,
    tokenizer: noopTokenizer(),
  });
  await tonder.init();
  return tonder;
}

describe('Tonder.getCustomerCards', () => {
  it('throws NOT_INITIALIZED before init()', async () => {
    const { http } = mockHttp();
    const tonder = _createTonderWithDeps({
      config: { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
      tokenizer: noopTokenizer(),
    });

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
  });

  it('throws MISSING_CUSTOMER when no customer is set in config', async () => {
    const { http, cardsSpy } = mockHttp();
    const tonder = _createTonderWithDeps({
      config: { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    expect(cardsSpy).not.toHaveBeenCalled();
  });

  it('throws SECURE_TOKEN_REQUIRED when secureToken is not configured', async () => {
    const { http } = mockHttp();
    const tonder = await readyWithCustomer(BASE_CONFIG, http);

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.SECURE_TOKEN_REQUIRED,
    });
  });

  it('returns Card[] and sends Bearer + User-Token using the integer business.pk', async () => {
    const { http, cardsSpy } = mockHttp();
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    const cards = await tonder.getCustomerCards();

    expect(cards).toEqual([
      {
        card_id: 'sky_1',
        card_number: 'XXXX-XXXX-XXXX-1234',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: null,
      },
    ]);
    expect(cardsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/business/7/cards/',
        headers: expect.objectContaining({
          Authorization: 'Bearer secure_abc',
          'User-Token': 'cust_tok_1',
        }),
      }),
    );
  });

  it('hides subscription_id when card-on-file is not enabled for the business', async () => {
    const { http } = mockHttp({ subscription_id: 'sub_1' });
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    const cards = await tonder.getCustomerCards();

    expect(cards[0].subscription_id).toBeNull();
  });

  it('returns subscription_id when card-on-file is enabled for the business', async () => {
    const { http } = mockHttp({
      business: { cardonfile_keys: { public_key: 'cof_pub' } },
      subscription_id: 'sub_1',
    });
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    const cards = await tonder.getCustomerCards();

    expect(cards[0].subscription_id).toBe('sub_1');
  });

  it('does not send an HMAC signature header', async () => {
    const { http, cardsSpy } = mockHttp();
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    await tonder.getCustomerCards();

    const sentHeaders = cardsSpy.mock.calls[0][0].headers;
    expect(sentHeaders).not.toHaveProperty('X-Signature-Transaction');
  });

  it('wraps a transport failure as FETCH_CARDS_ERROR', async () => {
    const cardsSpy = vi.fn((_options: HttpRequestOptions) =>
      Promise.reject(new Error('boom')),
    );
    const http: HttpPort = asHttpPort((options: HttpRequestOptions) => {
      if (options.path === '/api/v1/customer/') {
        return Promise.resolve({
          id: 1,
          auth_token: 'cust_tok_1',
        });
      }
      if (options.path.endsWith('/cards/')) {
        return cardsSpy(options);
      }
      return Promise.resolve(makeBusinessConfig());
    });
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_CARDS_ERROR,
    });
  });
});
