import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { CheckoutMessengerPort } from './ports/checkout-messenger.port';
import type { ThreeDsHostPort } from './ports/threeds-host.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'api_key_under_test',
  environment: 'sandbox',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
};

const LEGACY_PROCESS = '/api/v1/process/';
const CORE_PROCESS = '/transactions/v1/process';
const CORE_CONFIG = '/transactions/v1/business/config';

const TOKENS = {
  card_number: 'tok_cn',
  cvv: 'tok_cvv',
  expiration_month: 'tok_m',
  expiration_year: 'tok_y',
  cardholder_name: 'tok_name',
  skyflow_id: 'sky_1',
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

function tx(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_core_1',
    operation_type: 'payment',
    status: 'Success',
    amount: '150.00',
    currency: 'MXN',
    ...overrides,
  };
}

function threeDsPending(): BackendTransactionResponse {
  return tx({
    status: 'Pending',
    next_action: { redirect_to_url: { url: 'https://auth.example/challenge' } },
  });
}

function payInput(overrides: Partial<PayInput> = {}): PayInput {
  return {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    payment_method: { type: 'card' },
    client_reference: 'order_123',
    ...overrides,
  };
}

function tokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve(TOKENS)),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function host(): ThreeDsHostPort & { redirect: ReturnType<typeof vi.fn> } {
  return {
    redirect: vi.fn<ThreeDsHostPort['redirect']>(),
    open: vi.fn<ThreeDsHostPort['open']>(),
    close: vi.fn<ThreeDsHostPort['close']>(),
  };
}

interface Routes {
  config?: BusinessConfig;
  coreProcess?: (o: HttpRequestOptions) => Promise<unknown>;
  legacyProcess?: (o: HttpRequestOptions) => Promise<unknown>;
  coreGet?: (id: string) => Promise<unknown>;
  legacyGet?: (id: string) => Promise<unknown>;
}

function mockHttp(routes: Routes = {}) {
  const calls: HttpRequestOptions[] = [];
  const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
    calls.push(o);
    if (o.path === CORE_CONFIG) {
      return Promise.resolve(routes.config ?? businessConfig());
    }
    if (o.path === CORE_PROCESS) {
      return (routes.coreProcess ?? (() => Promise.resolve(tx())))(o);
    }
    if (o.path === LEGACY_PROCESS) {
      return (
        routes.legacyProcess ??
        (() => Promise.resolve(tx({ id: 'tx_legacy_1' })))
      )(o);
    }
    if (o.path === '/transactions/v1/customer') {
      return Promise.resolve({
        customer_id: 123,
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        auth_token: 'core_user_tok',
        auth_token_expires_at: '2026-11-20T18:00:00Z',
      });
    }
    if (o.method === 'GET' && o.path === '/transactions/v1/cards') {
      return Promise.resolve({
        customer_id: 123,
        data: [
          {
            id: 'card_abc',
            card_number: 'XXXX-XXXX-XXXX-1234',
            expiration_month: '12',
            expiration_year: '2030',
            card_scheme: 'visa',
            subscription_id: 'sub_abc',
          },
        ],
      });
    }
    if (o.path.startsWith('/transactions/v1/')) {
      const id = o.path.slice('/transactions/v1/'.length);
      return (routes.coreGet ?? (() => Promise.resolve(tx({ id }))))(id);
    }
    if (o.path.startsWith('/api/v1/transactions/')) {
      const id = o.path.slice('/api/v1/transactions/'.length).replace('/', '');
      return (routes.legacyGet ?? (() => Promise.resolve(tx({ id }))))(id);
    }
    if (o.path === '/api/v1/customer/') {
      return Promise.resolve({ id: 42, auth_token: 'cust_tok_1' });
    }
    if (o.method === 'GET' && o.path === '/api/v1/business/7/cards/') {
      return Promise.resolve({
        user_id: 'u_1',
        cards: [
          {
            fields: {
              skyflow_id: 'card_abc',
              card_number: 'XXXX-XXXX-XXXX-1234',
              expiration_month: '12',
              expiration_year: '2030',
              card_scheme: 'visa',
              subscription_id: 'sub_abc',
            },
          },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected ${o.method} ${o.path}`));
  });
  const paths = () => calls.map((c) => `${c.method} ${c.path}`);
  return { http, calls, paths };
}

function disabled(): AppError {
  return new AppError({
    errorCode: ErrorKeyEnum.REQUEST_FAILED,
    status_code: 503,
    originalError: { error_code: 'operations_disabled' },
  });
}

async function ready(
  http: HttpPort,
  extra: Partial<Parameters<typeof _createTonderWithDeps>[0]> = {},
) {
  const tonder = _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer: tokenizer(),
    ...extra,
  });
  await tonder.init();
  return tonder;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('Tonder engine — flag OFF keeps today', () => {
  it.each([
    ['absent', undefined],
    ['false', false],
  ])(
    'core_payments_enabled %s: pay() uses the legacy process route only',
    async (_l, flag) => {
      const { http, paths } = mockHttp({ config: businessConfig(flag) });
      const tonder = await ready(http);

      const result = await tonder.pay(payInput());

      expect(result.id).toBe('tx_legacy_1');
      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
    },
  );

  it('legacy process keeps sending no X-Request-Id without an idempotency key', async () => {
    const { http, calls } = mockHttp({ config: businessConfig(false) });
    const tonder = await ready(http);

    await tonder.pay(payInput());

    expect(calls[1].headers).toEqual({});
  });
});

describe('Tonder engine — flag ON routes card payments to the core', () => {
  it('init reads the configuration from the core route', async () => {
    const { http, paths } = mockHttp({ config: businessConfig(true) });

    await ready(http);

    expect(paths()).toEqual([`GET ${CORE_CONFIG}`]);
  });

  it('pay() POSTs the same body to the core with a client-made X-Request-Id', async () => {
    const { http, calls, paths } = mockHttp({ config: businessConfig(true) });
    const tonder = await ready(http);

    const result = await tonder.pay(payInput());

    expect(result).toMatchObject({ id: 'tx_core_1', status: 'Success' });
    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    const sent = calls[1];
    expect(sent.headers?.['X-Request-Id']).toMatch(/^[0-9a-f-]{16,}$/i);
    expect(sent.body).toMatchObject({
      operation_type: 'payment',
      amount: 150,
      currency: 'MXN',
      client_reference: 'order_123',
      customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
      payment_method: { type: 'CARD', card_number: 'tok_cn' },
    });
  });

  it('uses a new request id per payment attempt', async () => {
    const { http, calls } = mockHttp({ config: businessConfig(true) });
    const tonder = await ready(http);

    await tonder.pay(payInput());
    await tonder.pay(payInput());

    expect(calls[1].headers?.['X-Request-Id']).not.toBe(
      calls[2].headers?.['X-Request-Id'],
    );
  });

  it('keeps the merchant idempotency key, scoped by business, as the request id', async () => {
    const { http, calls } = mockHttp({ config: businessConfig(true) });
    const tonder = await ready(http);

    await tonder.pay(payInput({ idempotency_key: 'idem-1' }));

    expect(calls[1].headers).toEqual({ 'X-Request-Id': '7_idem-1' });
  });

  it.each(['saved_card', 'SAVED_CARD', 'Saved_Card'])(
    'a %s payment method goes to the core, and so do its customer and card lookups',
    async (type) => {
      const { http, calls, paths } = mockHttp({
        config: {
          ...businessConfig(true),
          cardonfile_keys: { public_key: 'cof_pub' },
        },
      });
      const tonder = await ready(http, {
        config: {
          ...CONFIG,
          session: { ...CONFIG.session, secure_token: 'secure_abc' },
        },
      });

      await tonder.pay(
        payInput({ payment_method: { type, card_id: 'card_abc' } as never }),
      );

      expect(paths()).toContain(`POST ${CORE_PROCESS}`);
      expect(paths()).not.toContain(`POST ${LEGACY_PROCESS}`);
      expect(paths()).toContain('POST /transactions/v1/customer');
      expect(paths()).toContain('GET /transactions/v1/cards');
      expect(paths()).not.toContain('GET /api/v1/business/7/cards/');
      expect(paths()).not.toContain('POST /api/v1/customer/');
      const sent = calls.find((c) => c.path === CORE_PROCESS);
      expect(sent?.body).toMatchObject({
        payment_method: { type: 'CARD', token: 'card_abc' },
      });
    },
  );

  it.each(['CARD', 'Card', 'card'])(
    'a %s payment method goes to the core, whatever its casing',
    async (type) => {
      const { http, paths } = mockHttp({ config: businessConfig(true) });
      const tonder = await ready(http);

      await tonder.pay(payInput({ payment_method: { type } as never }));

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    },
  );

  it.each([
    ['the string "false"', 'false'],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
  ])(
    'a core_payments_enabled that is %s is not the boolean true: legacy route',
    async (_label, flag) => {
      const { http, paths } = mockHttp({
        config: { ...businessConfig(), core_payments_enabled: flag } as never,
      });
      const tonder = await ready(http);

      await tonder.pay(payInput());

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
    },
  );

  it('an APM payment stays on the legacy flow whatever the flag says', async () => {
    const { http, paths } = mockHttp({ config: businessConfig(true) });
    const tonder = await ready(http);

    await tonder.pay(payInput({ payment_method: { type: 'wallet' } }));

    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
  });

  it('a decline is returned as today (200 with a declined status)', async () => {
    const { http } = mockHttp({
      config: businessConfig(true),
      coreProcess: () =>
        Promise.resolve(tx({ status: 'Declined', decline_code: '51' })),
    });
    const tonder = await ready(http);

    const result = await tonder.pay(payInput());

    expect(result).toMatchObject({ status: 'Declined', decline_code: '51' });
  });

  it('wraps a core transport failure as PAYMENT_PROCESS_ERROR, as the legacy route does', async () => {
    const { http, paths } = mockHttp({
      config: businessConfig(true),
      coreProcess: () =>
        Promise.reject(
          new AppError({
            errorCode: ErrorKeyEnum.REQUEST_FAILED,
            status_code: 402,
          }),
        ),
    });
    const tonder = await ready(http);

    const err = await tonder.pay(payInput()).catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
    expect(err.status_code).toBe(402);
    expect(paths()).not.toContain(`POST ${LEGACY_PROCESS}`);
  });
});

describe('Tonder engine — a core failure is never retried on the monolith', () => {
  it('a 503 operations_disabled reaches the merchant as the core error, with no monolith request', async () => {
    const { http, paths } = mockHttp({
      config: businessConfig(true),
      coreProcess: () => Promise.reject(disabled()),
    });
    const events = { on_error: vi.fn(), on_completed: vi.fn() };
    const tonder = await ready(http, {
      config: { ...CONFIG, events: { payment: events } },
    });

    const err = await tonder
      .pay(payInput({ idempotency_key: 'idem-2' }))
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    expect(events.on_error).toHaveBeenCalledTimes(1);
    expect(events.on_completed).not.toHaveBeenCalled();
  });

  it.each([
    ['a bare 503', 503, undefined],
    [
      'a 500 carrying operations_disabled',
      500,
      { error_code: 'operations_disabled' },
    ],
    [
      'a 502 carrying operations_disabled',
      502,
      { error_code: 'operations_disabled' },
    ],
    [
      'a 504 carrying operations_disabled',
      504,
      { error_code: 'operations_disabled' },
    ],
  ])('%s never creates a second payment', async (_l, status, cause) => {
    const { http, paths } = mockHttp({
      config: businessConfig(true),
      coreProcess: () =>
        Promise.reject(
          new AppError({
            errorCode: ErrorKeyEnum.REQUEST_FAILED,
            status_code: status,
            ...(cause ? { originalError: cause } : {}),
          }),
        ),
    });
    const tonder = await ready(http);

    await expect(tonder.pay(payInput())).rejects.toMatchObject({
      code: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
    });
    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
  });

  it('a network error after the send never creates a second payment', async () => {
    const { http, paths } = mockHttp({
      config: businessConfig(true),
      coreProcess: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const tonder = await ready(http);

    await expect(tonder.pay(payInput())).rejects.toBeInstanceOf(AppError);
    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
  });
});

describe('Tonder engine — pinned per payment', () => {
  it('embedded 3DS polls the core read route for a core payment', async () => {
    const messenger: CheckoutMessengerPort = {
      waitForCompletion: vi.fn(() => Promise.resolve()),
    };
    const { http, paths } = mockHttp({
      config: businessConfig(true),
      coreProcess: () => Promise.resolve(threeDsPending()),
      coreGet: (id) => Promise.resolve(tx({ id })),
    });
    const tonder = await ready(http, {
      config: { ...CONFIG, presentation_mode: 'embedded' },
      host: host(),
      messenger,
    });

    const result = await tonder.pay(payInput());

    expect(result.status).toBe('Success');
    expect(paths()).toEqual([
      `GET ${CORE_CONFIG}`,
      `POST ${CORE_PROCESS}`,
      'GET /transactions/v1/tx_core_1',
    ]);
  });

  it.each(['CARD', 'Card'])(
    'embedded 3DS of a %s card payment method polls the core to the final transaction',
    async (type) => {
      const messenger: CheckoutMessengerPort = {
        waitForCompletion: vi.fn(() => Promise.resolve()),
      };
      const { http, paths } = mockHttp({
        config: businessConfig(true),
        coreProcess: () => Promise.resolve(threeDsPending()),
      });
      const tonder = await ready(http, {
        config: { ...CONFIG, presentation_mode: 'embedded' },
        host: host(),
        messenger,
      });

      const result = await tonder.pay(
        payInput({ payment_method: { type } as never }),
      );

      expect(result.status).toBe('Success');
      expect(paths().at(-1)).toBe('GET /transactions/v1/tx_core_1');
    },
  );

  it.each(['saved_card', 'SAVED_CARD'])(
    'embedded 3DS of a %s saved card payment method polls the core to the final transaction',
    async (type) => {
      const messenger: CheckoutMessengerPort = {
        waitForCompletion: vi.fn(() => Promise.resolve()),
      };
      const { http, paths } = mockHttp({
        config: {
          ...businessConfig(true),
          cardonfile_keys: { public_key: 'cof_pub' },
        },
        coreProcess: () => Promise.resolve(threeDsPending()),
      });
      const tonder = await ready(http, {
        config: {
          ...CONFIG,
          presentation_mode: 'embedded',
          session: { ...CONFIG.session, secure_token: 'secure_abc' },
        },
        host: host(),
        messenger,
      });

      const result = await tonder.pay(
        payInput({ payment_method: { type, card_id: 'card_abc' } as never }),
      );

      expect(result.status).toBe('Success');
      expect(paths().at(-1)).toBe('GET /transactions/v1/tx_core_1');
    },
  );

  it('redirect 3DS hands the buyer to the same hosted page URL as today', async () => {
    const h = host();
    const { http } = mockHttp({
      config: businessConfig(true),
      coreProcess: () => Promise.resolve(threeDsPending()),
    });
    const tonder = await ready(http, { host: h });

    const result = await tonder.pay(payInput());

    expect(h.redirect).toHaveBeenCalledWith('https://auth.example/challenge');
    expect(result.status).toBe('Pending');
  });

  it('getTransaction() of a core payment reads the core, also from a new instance before init()', async () => {
    const first = mockHttp({
      config: businessConfig(true),
      coreProcess: () => Promise.resolve(threeDsPending()),
    });
    const tonder = await ready(first.http, { host: host() });
    await tonder.pay(payInput());

    const afterReturn = mockHttp();
    const fresh = _createTonderWithDeps({
      config: CONFIG,
      http: afterReturn.http,
    });
    await fresh.getTransaction('tx_core_1');

    expect(afterReturn.paths()).toEqual(['GET /transactions/v1/tx_core_1']);
  });

  it('a payment started OFF keeps reading the monolith even if the next init says ON', async () => {
    const off = mockHttp({ config: businessConfig(false) });
    const first = await ready(off.http);
    await first.pay(payInput());

    const on = mockHttp({ config: businessConfig(true) });
    const second = await ready(on.http);
    await second.getTransaction('tx_legacy_1');

    expect(on.paths().at(-1)).toBe('GET /api/v1/transactions/tx_legacy_1/');
  });

  it('a payment started ON keeps reading the core after the flag turns OFF', async () => {
    const on = mockHttp({ config: businessConfig(true) });
    const first = await ready(on.http);
    await first.pay(payInput());

    const off = mockHttp({ config: businessConfig(false) });
    const second = await ready(off.http);
    await second.getTransaction('tx_core_1');

    expect(off.paths().at(-1)).toBe('GET /transactions/v1/tx_core_1');
  });

  describe('an id with no remembered engine', () => {
    const notFound = () =>
      Promise.reject(
        new AppError({
          errorCode: ErrorKeyEnum.REQUEST_FAILED,
          status_code: 404,
        }),
      );

    it('is read from the payments API first, with no legacy call', async () => {
      const { http, paths } = mockHttp({ config: businessConfig(true) });
      const tonder = await ready(http);

      const result = await tonder.getTransaction('unknown-id');

      expect(result.id).toBe('unknown-id');
      expect(paths().slice(1)).toEqual(['GET /transactions/v1/unknown-id']);
    });

    it('falls back to the legacy route only when the API answers 404', async () => {
      const { http, paths } = mockHttp({
        config: businessConfig(true),
        coreGet: notFound,
      });
      const tonder = await ready(http);

      const result = await tonder.getTransaction('legacy-id');

      expect(result.id).toBe('legacy-id');
      expect(paths().slice(1)).toEqual([
        'GET /transactions/v1/legacy-id',
        'GET /api/v1/transactions/legacy-id/',
      ]);
    });

    it('works before init(), as the redirect return page does', async () => {
      const { http, paths } = mockHttp({ coreGet: notFound });
      const tonder = _createTonderWithDeps({ config: CONFIG, http });

      await tonder.getTransaction('legacy-id');

      expect(paths()).toEqual([
        'GET /transactions/v1/legacy-id',
        'GET /api/v1/transactions/legacy-id/',
      ]);
    });

    it.each([
      [
        'a 500',
        () =>
          Promise.reject(
            new AppError({
              errorCode: ErrorKeyEnum.REQUEST_FAILED,
              status_code: 500,
            }),
          ),
      ],
      [
        'a 503',
        () =>
          Promise.reject(
            new AppError({
              errorCode: ErrorKeyEnum.REQUEST_FAILED,
              status_code: 503,
            }),
          ),
      ],
      [
        'a 401',
        () =>
          Promise.reject(
            new AppError({
              errorCode: ErrorKeyEnum.REQUEST_FAILED,
              status_code: 401,
            }),
          ),
      ],
      [
        'a network error',
        () => Promise.reject(new TypeError('Failed to fetch')),
      ],
    ])('surfaces %s without a second call', async (_label, coreGet) => {
      const { http, paths } = mockHttp({
        config: businessConfig(true),
        coreGet,
      });
      const tonder = await ready(http);

      const err = await tonder.getTransaction('x').catch((e) => e);

      expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
      expect(paths().slice(1)).toEqual(['GET /transactions/v1/x']);
    });

    it('surfaces the legacy error when both routes fail', async () => {
      const { http } = mockHttp({
        config: businessConfig(true),
        coreGet: notFound,
        legacyGet: notFound,
      });
      const tonder = await ready(http);

      const err = await tonder.getTransaction('x').catch((e) => e);

      expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
      expect(err.status_code).toBe(404);
    });
  });

  it('a legacy payment polls the legacy route straight, with no payments API call', async () => {
    const messenger: CheckoutMessengerPort = {
      waitForCompletion: vi.fn(() => Promise.resolve()),
    };
    const { http, paths } = mockHttp({
      config: businessConfig(false),
      legacyProcess: () =>
        Promise.resolve(
          tx({
            id: 'tx_legacy_3',
            status: 'Pending',
            next_action: {
              redirect_to_url: { url: 'https://auth.example/challenge' },
            },
          }),
        ),
    });
    const tonder = await ready(http, {
      config: { ...CONFIG, presentation_mode: 'embedded' },
      host: host(),
      messenger,
    });

    await tonder.pay(payInput());

    expect(paths()).toEqual([
      `GET ${CORE_CONFIG}`,
      `POST ${LEGACY_PROCESS}`,
      'GET /api/v1/transactions/tx_legacy_3/',
    ]);
  });

  it('still pins within the instance when session storage is unavailable', async () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    const get = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    try {
      const { http, paths } = mockHttp({ config: businessConfig(true) });
      const tonder = await ready(http);
      await tonder.pay(payInput());

      await tonder.getTransaction('tx_core_1');

      expect(paths().at(-1)).toBe('GET /transactions/v1/tx_core_1');
    } finally {
      spy.mockRestore();
      get.mockRestore();
    }
  });
});
