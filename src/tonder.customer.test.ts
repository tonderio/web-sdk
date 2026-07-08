import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

const SECURE_TOKEN = 'secure_abc';

function config(overrides: Partial<TonderConfig> = {}): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    return_url: 'https://merchant.example/return',
    session: { secure_token: SECURE_TOKEN, ...overrides.session },
    ...overrides,
  };
}

function makeBusinessConfig(): BusinessConfig {
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
      checkout_environment: true,
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
  };
}

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() =>
      Promise.resolve({
        skyflow_id: 'sky_new',
        card_number: 'tok_number',
        cardholder_name: 'tok_name',
        expiration_month: 'tok_mm',
        expiration_year: 'tok_yy',
        cvv: 'tok_cvv',
      }),
    ),
  };
}

/**
 * Routes init (business GET), customer POST, card save POST, cards GET, and
 * card DELETE. `customerSpy` counts each `CustomerService.registerOrFetch`
 * (one customer POST per call) and records the email of the customer body.
 */
function mockHttp(): {
  http: HttpPort;
  customerSpy: ReturnType<typeof vi.fn>;
} {
  const customerSpy = vi.fn((email: string) => ({
    id: 1,
    auth_token: `cust_tok_${email}`,
  }));
  let saveCount = 0;
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/customer/') {
        const email = (options.body as { email: string }).email;
        return Promise.resolve(customerSpy(email) as unknown as T);
      }
      if (options.method === 'POST' && options.path.endsWith('/cards/')) {
        saveCount += 1;
        return Promise.resolve({
          skyflow_id: `sky_${saveCount}`,
          user_id: 'u_1',
          card_bin: '411111',
        } as unknown as T);
      }
      if (options.method === 'GET' && options.path.endsWith('/cards/')) {
        return Promise.resolve({ user_id: 'u_1', cards: [] } as unknown as T);
      }
      if (options.method === 'DELETE') {
        return Promise.resolve({} as unknown as T);
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
  return { http, customerSpy };
}

async function ready(cfg: TonderConfig = config()) {
  const { http, customerSpy } = mockHttp();
  const tonder = _createTonderWithDeps({
    config: cfg,
    http,
    tokenizer: noopTokenizer(),
  });
  await tonder.init();
  return { tonder, customerSpy };
}

const CUSTOMER = { email: 'ada@example.com' };

describe('Tonder transparent customer (config.session.customer)', () => {
  it('2.1 enrollCard auto-registers once via config.session.customer', async () => {
    const { tonder, customerSpy } = await ready(
      config({ session: { secure_token: SECURE_TOKEN, customer: CUSTOMER } }),
    );

    const result = await tonder.enrollCard();

    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ card_id: 'sky_new' });
  });

  it('2.2 memoizes: two COF ops register exactly once', async () => {
    const { tonder, customerSpy } = await ready(
      config({ session: { secure_token: SECURE_TOKEN, customer: CUSTOMER } }),
    );

    await tonder.enrollCard();
    await tonder.getCustomerCards();

    expect(customerSpy).toHaveBeenCalledTimes(1);
  });

  it('2.3 the public registerCustomer() method is gone from the instance', async () => {
    const { tonder } = await ready(
      config({ session: { secure_token: SECURE_TOKEN, customer: CUSTOMER } }),
    );

    expect(
      (tonder as unknown as Record<string, unknown>).registerCustomer,
    ).toBeUndefined();
  });

  it('2.5 no customer anywhere → MISSING_CUSTOMER', async () => {
    const { tonder, customerSpy } = await ready();

    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    expect(customerSpy).not.toHaveBeenCalled();
  });

  it('2.6 getCustomerCards is transparent via config.session.customer', async () => {
    const { tonder, customerSpy } = await ready(
      config({ session: { secure_token: SECURE_TOKEN, customer: CUSTOMER } }),
    );

    await expect(tonder.getCustomerCards()).resolves.toEqual([]);
    expect(customerSpy).toHaveBeenCalledTimes(1);
  });

  it('2.7 removeCustomerCard is transparent via config.session.customer', async () => {
    const { tonder, customerSpy } = await ready(
      config({ session: { secure_token: SECURE_TOKEN, customer: CUSTOMER } }),
    );

    await expect(
      tonder.removeCustomerCard('card_123'),
    ).resolves.toBeUndefined();
    expect(customerSpy).toHaveBeenCalledTimes(1);
  });
});
