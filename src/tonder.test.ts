import { describe, it, expect, vi } from 'vitest';
import { createTonder, _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

function makeBusinessConfig(): BusinessConfig {
  return {
    business: {
      pk: 1,
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

function mockHttp(impl: HttpPort['request']): {
  http: HttpPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(impl);
  return { http: { request: spy }, spy };
}

describe('createTonder', () => {
  it('returns an instance exposing an async init()', () => {
    const tonder = createTonder(CONFIG);
    expect(typeof tonder.init).toBe('function');
  });

  it('throws an AppError with code INIT_ERROR when apiKey is missing', () => {
    let caught: unknown;
    try {
      createTonder({} as TonderConfig);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(ErrorKeyEnum.INIT_ERROR);
    expect((caught as AppError).status).toBe('error');
  });
});

describe('Tonder.init', () => {
  it('fetches the business config and makes ready-guarded operations available', async () => {
    const config = makeBusinessConfig();
    const { http, spy } = mockHttp(() => Promise.resolve(config));
    const tokenizer = mockTokenizer();
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });

    await tonder.init();
    await tonder.create('card_fields', { fields: ['card_number'] }).mount();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(tokenizer.mount).toHaveBeenCalledWith({ fields: ['card_number'] });
  });

  it('throws AppError(INIT_ERROR) and goes to error state when the fetch fails', async () => {
    const { http } = mockHttp(() =>
      Promise.reject(
        new AppError({ errorCode: ErrorKeyEnum.FETCH_BUSINESS_ERROR }),
      ),
    );
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    const err = await tonder.init().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INIT_ERROR);
  });

  it('is idempotent: a second init() does not re-fetch', async () => {
    const config = makeBusinessConfig();
    const { http, spy } = mockHttp(() => Promise.resolve(config));
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    await tonder.init();
    await tonder.init();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('createTonder WITHOUT a customer stays legal: init reaches ready for read-only usage', async () => {
    // CONFIG has no `customer`. Read-only flows (getTransaction,
    // getPaymentMethods, getPaymentMethodBanks) need no customer, so init must still
    // reach `ready`. Only pay()/COF ops require a customer.
    const config = makeBusinessConfig();
    const { http } = mockHttp(() => Promise.resolve(config));
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    await tonder.init();

    await expect(tonder.init()).resolves.toBeUndefined();
    expect(CONFIG.session?.customer).toBeUndefined();
  });
});

function mockTokenizer(): TokenizerPort & {
  mount: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
  collect: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
} {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({})),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

describe('Tonder card fields (via create handle)', () => {
  it('component.mount before init (not ready) throws AppError(NOT_INITIALIZED)', async () => {
    const tokenizer = mockTokenizer();
    const { http } = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });

    const component = tonder.create('card_fields', { fields: ['card_number'] });
    const err = await component.mount().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
    expect(tokenizer.mount).not.toHaveBeenCalled();
  });

  it('component.mount after ready delegates to tokenizer.mount', async () => {
    const tokenizer = mockTokenizer();
    const { http } = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });
    await tonder.init();

    const options = { fields: ['card_number' as const] };
    await tonder.create('card_fields', options).mount();

    expect(tokenizer.mount).toHaveBeenCalledTimes(1);
    expect(tokenizer.mount).toHaveBeenCalledWith(options);
  });

  it('component.reveal after ready delegates to tokenizer.reveal', async () => {
    const tokenizer = mockTokenizer();
    const { http } = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });
    await tonder.init();

    const request = { fields: ['card_number' as const] };
    await tonder
      .create('card_fields', { fields: ['card_number'] })
      .reveal(request);

    expect(tokenizer.reveal).toHaveBeenCalledWith(request);
  });

  it('component.unmount delegates to tokenizer.unmount with its context key', async () => {
    const tokenizer = mockTokenizer();
    const { http } = mockHttp(() => Promise.resolve(makeBusinessConfig()));
    const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });
    await tonder.init();

    tonder.create('card_fields', { fields: ['card_number'] }).unmount();

    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
  });
});
