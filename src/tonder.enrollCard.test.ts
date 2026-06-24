import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { AcquirerPort } from './ports/acquirer.port';
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

function makeBusinessConfig(
  cof: { public_key: string | null } | null = null,
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
    cardonfile_keys: cof,
  };
}

function fakeTokenizer(): TokenizerPort {
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

function fakeAcquirer(): {
  acquirer: AcquirerPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(() => Promise.resolve({ subscriptionId: 'sub_1' }));
  return { acquirer: { createCofSubscription: spy }, spy };
}

/** Routes init (business GET), customer POST, and card-save POST. */
function mockHttp(cof: { public_key: string | null } | null): {
  http: HttpPort;
  saveSpy: ReturnType<typeof vi.fn>;
} {
  const saveSpy = vi.fn(() =>
    Promise.resolve({
      skyflow_id: 'sky_new',
      user_id: 'u_1',
      card_bin: '411111',
    }),
  );
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/customer/') {
        return Promise.resolve({
          id: 42,
          auth_token: 'cust_tok_1',
        } as unknown as T);
      }
      if (options.method === 'POST' && options.path.endsWith('/cards/')) {
        return saveSpy() as Promise<T>;
      }
      return Promise.resolve(makeBusinessConfig(cof) as unknown as T);
    }),
  };
  return { http, saveSpy };
}

async function ready(
  cof: { public_key: string | null } | null,
  cfg: TonderConfig = config(),
) {
  const { http, saveSpy } = mockHttp(cof);
  const { acquirer, spy: acqSpy } = fakeAcquirer();
  const tokenizer = fakeTokenizer();
  const tonder = _createTonderWithDeps({
    config: cfg,
    http,
    tokenizer,
    acquirer,
  });
  await tonder.init();
  return { tonder, saveSpy, acqSpy, tokenizer };
}

describe('Tonder.enrollCard guards', () => {
  it('throws NOT_INITIALIZED before init()', async () => {
    const { http } = mockHttp(null);
    const { acquirer } = fakeAcquirer();
    const tonder = _createTonderWithDeps({
      config: config(),
      http,
      tokenizer: fakeTokenizer(),
      acquirer,
    });

    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
  });

  it('throws MISSING_CUSTOMER when no customer is set in config', async () => {
    const { tonder, saveSpy, acqSpy } = await ready(null);

    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(acqSpy).not.toHaveBeenCalled();
  });

  it('throws SECURE_TOKEN_REQUIRED when secureToken is not configured', async () => {
    const { tonder } = await ready(
      null,
      config({ session: { customer: { email: 'ada@example.com' } } }),
    );

    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.SECURE_TOKEN_REQUIRED,
    });
  });
});

describe('Tonder.enrollCard routing', () => {
  it('routes to the COF path when cardonfile_keys.public_key is present → { cardId, subscriptionId }', async () => {
    const { tonder, acqSpy } = await ready(
      { public_key: 'cof_pub' },
      config({
        session: {
          secure_token: SECURE_TOKEN,
          customer: {
            email: 'ada@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
          },
        },
      }),
    );

    const result = await tonder.enrollCard();

    expect(result).toEqual({ card_id: 'sky_new', subscription_id: 'sub_1' });
    expect(acqSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'cof_pub',
        cardBin: '411111',
        contact: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
      }),
    );
  });

  it('routes to the plain path when COF is inactive → { cardId } (no acquirer call)', async () => {
    const { tonder, acqSpy } = await ready(
      null,
      config({
        session: {
          secure_token: SECURE_TOKEN,
          customer: { email: 'ada@example.com' },
        },
      }),
    );

    const result = await tonder.enrollCard();

    expect(result).toEqual({ card_id: 'sky_new' });
    expect(acqSpy).not.toHaveBeenCalled();
  });

  it('resets mounted new-card fields after a successful plain enrollment', async () => {
    const { tonder, tokenizer } = await ready(
      null,
      config({
        session: {
          secure_token: SECURE_TOKEN,
          customer: { email: 'ada@example.com' },
        },
      }),
    );

    await tonder.create('card_fields').mount();
    await tonder.enrollCard();

    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
    expect(tokenizer.mount).toHaveBeenCalledTimes(2);
  });

  it('resets mounted new-card fields after a successful COF enrollment', async () => {
    const { tonder, tokenizer } = await ready(
      { public_key: 'cof_pub' },
      config({
        session: {
          secure_token: SECURE_TOKEN,
          customer: { email: 'ada@example.com' },
        },
      }),
    );

    await tonder.create('card_fields').mount();
    await tonder.enrollCard();

    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
    expect(tokenizer.mount).toHaveBeenCalledTimes(2);
  });

  it('defaults missing contact name fields to empty strings in the COF path', async () => {
    const { tonder, acqSpy } = await ready(
      { public_key: 'cof_pub' },
      config({
        session: {
          secure_token: SECURE_TOKEN,
          customer: { email: 'ada@example.com' },
        },
      }),
    );

    await tonder.enrollCard();

    expect(acqSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: { firstName: '', lastName: '', email: 'ada@example.com' },
      }),
    );
  });
});
