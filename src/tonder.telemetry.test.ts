/**
 * What the SDK reports to the shared telemetry client: public methods and the
 * key payment steps only, never card, buyer or 3DS data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TelemetryPort } from './ports/telemetry.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { CheckoutMessengerPort } from './ports/checkout-messenger.port';
import type { ThreeDsHostPort } from './ports/threeds-host.port';
import type {
  ApplePayAdapter,
  ApplePayPaymentToken,
  ApplePaySessionHandlers,
} from './ports/apple-pay.port';
import type { BusinessConfig } from './models/business.model';
import type { PayInput, TonderConfig } from './shared/types';
import { ClientTelemetryAdapter } from './adapters/telemetry/client-telemetry.adapter';

const LEGACY_PROCESS = '/api/v1/process/';
const CORE_PROCESS = '/transactions/v1/process';
const CORE_CONFIG = '/transactions/v1/business/config';

const TOKEN = {
  paymentData: { version: 'EC_v1', data: 'opaque-token-data' },
} as unknown as ApplePayPaymentToken;

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

function businessConfig(core: boolean): BusinessConfig {
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
      country_code: 'MX',
    },
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    apple_pay: { enabled: true },
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
    core_payments_enabled: core,
  } as unknown as BusinessConfig;
}

type Call = [kind: string, name: string, fields?: Record<string, unknown>];

function fakeTelemetry() {
  const calls: Call[] = [];
  const port: TelemetryPort = {
    methodCalled: (m, o) =>
      calls.push(['method', m, o as Record<string, unknown>]),
    flowStep: (s, f) => calls.push(['step', s, f as Record<string, unknown>]),
    flowFailed: (s, f) =>
      calls.push(['failed', s, f as Record<string, unknown>]),
    flush: () => calls.push(['flush', 'flush']),
  };
  return { port, calls };
}

function summary(calls: Call[]): string[] {
  return calls.map(([k, n]) => `${k}:${n}`);
}

function tx(status = 'Success') {
  return {
    id: '3f0c1d2e-aaaa-bbbb-cccc-1234567890ab',
    operation_type: 'payment',
    status,
    amount: '150.00',
    currency: 'MXN',
  };
}

function setup(options: {
  core?: boolean;
  process?: (o: HttpRequestOptions) => Promise<unknown>;
  applePay?: ApplePayAdapter;
}) {
  const telemetry = fakeTelemetry();
  const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
    if (o.path === CORE_CONFIG) {
      return Promise.resolve(businessConfig(options.core ?? false));
    }
    if (o.path === '/transactions/v1/apple-pay/validate-merchant') {
      return Promise.resolve({ merchantSessionIdentifier: 'm' });
    }
    if (o.path === CORE_PROCESS || o.path === LEGACY_PROCESS) {
      return (options.process ?? (() => Promise.resolve(tx())))(o);
    }
    return Promise.reject(new Error(`unexpected ${o.method} ${o.path}`));
  });
  const tokenizer: TokenizerPort = {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() =>
      Promise.resolve({
        card_number: 'tok_cn',
        cvv: 'tok_cvv',
        expiration_month: 'tok_m',
        expiration_year: 'tok_y',
        cardholder_name: 'tok_name',
        skyflow_id: 'sky_1',
      }),
    ),
    reveal: vi.fn(() => Promise.resolve()),
  };
  const tonder = _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer,
    telemetry: telemetry.port,
    ...(options.applePay ? { applePay: options.applePay } : {}),
  });
  return { tonder, ...telemetry };
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

const UUID_OR_KEY = /^[A-Za-z0-9_-]{8,64}$/;

beforeEach(() => {
  sessionStorage.clear();
});

describe('telemetry — public methods', () => {
  it('reports each public method once, by name, and nothing about its arguments', async () => {
    const { tonder, calls } = setup({});

    await tonder.init();
    tonder.canSaveCards();
    tonder.isApplePayAvailable();
    await tonder
      .getTransaction('3f0c1d2e-aaaa-bbbb-cccc-1234567890ab')
      .catch(() => undefined);

    expect(calls.filter(([k]) => k === 'method').map(([, n]) => n)).toEqual([
      'init',
      'canSaveCards',
      'isApplePayAvailable',
      'getTransaction',
    ]);
    for (const [, , fields] of calls) {
      expect(fields ?? {}).not.toHaveProperty('deprecated', true);
    }
    expect(JSON.stringify(calls)).not.toContain('3f0c1d2e');
  });

  it('reports create() and the component methods', async () => {
    const { tonder, calls } = setup({});
    await tonder.init();

    const card = tonder.create('card_fields');
    await card.mount();
    card.unmount();

    expect(calls.filter(([k]) => k === 'method').map(([, n]) => n)).toEqual([
      'init',
      'create',
      'card_fields.mount',
      'card_fields.unmount',
    ]);
  });
});

describe('telemetry — the pay() flow', () => {
  it.each([
    ['monolith', false, LEGACY_PROCESS],
    ['core', true, CORE_PROCESS],
  ])('a successful card payment on the %s sends 4 events', async (_l, core) => {
    const { tonder, calls } = setup({ core });
    await tonder.init();
    calls.length = 0;

    await tonder.pay(payInput({ idempotency_key: 'idem-key-1' }));

    expect(summary(calls)).toEqual([
      'method:pay',
      'step:start',
      'step:charge',
      'step:result',
    ]);
    const charge = calls[2][2]!;
    expect(charge).toMatchObject({
      outcome: 'ok',
      payment_method_type: 'CARD',
      request_id: '7_idem-key-1',
    });
    expect(typeof charge.duration_ms).toBe('number');
    expect(calls[3][2]).toMatchObject({
      outcome: 'ok',
      payment_method_type: 'CARD',
    });
  });

  it('sends the generated X-Request-Id as request_id when no key is given', async () => {
    const seen: string[] = [];
    const { tonder, calls } = setup({
      core: true,
      process: (o) => {
        seen.push(o.headers?.['X-Request-Id'] ?? '');
        return Promise.resolve(tx());
      },
    });
    await tonder.init();
    calls.length = 0;

    await tonder.pay(payInput());

    const charge = calls.find(([, n]) => n === 'charge')![2]!;
    expect(charge.request_id).toBe(seen[0]);
    expect(String(charge.request_id)).toMatch(UUID_OR_KEY);
  });

  it('a decline is a result with outcome error, not a failure', async () => {
    const { tonder, calls } = setup({
      core: true,
      process: () => Promise.resolve(tx('Declined')),
    });
    await tonder.init();
    calls.length = 0;

    await tonder.pay(payInput());

    expect(summary(calls)).toEqual([
      'method:pay',
      'step:start',
      'step:charge',
      'step:result',
    ]);
    expect(calls[3][2]).toMatchObject({ outcome: 'error' });
  });

  it('a core 503 sends one charge failure with the code, the status and the request id', async () => {
    const { tonder, calls } = setup({
      core: true,
      process: () =>
        Promise.reject(
          new AppError({
            errorCode: ErrorKeyEnum.REQUEST_FAILED,
            status_code: 503,
          }),
        ),
    });
    await tonder.init();
    calls.length = 0;

    await tonder
      .pay(payInput({ idempotency_key: 'idem-key-2' }))
      .catch(() => undefined);

    expect(summary(calls)).toEqual([
      'method:pay',
      'step:start',
      'failed:charge',
    ]);
    expect(calls[2][2]).toMatchObject({
      outcome: 'error',
      error_code: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
      http_status: 503,
      request_id: '7_idem-key-2',
      payment_method_type: 'CARD',
    });
  });

  it('a failure before the charge is reported on the step it happened in', async () => {
    const { tonder, calls } = setup({});
    await tonder.init();
    calls.length = 0;

    await tonder
      .pay(payInput({ amount: -1 } as Partial<PayInput>))
      .catch(() => undefined);

    expect(summary(calls)).toEqual(['method:pay', 'failed:start']);
    expect(calls[1][2]).toMatchObject({
      outcome: 'error',
      error_code: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
    });
  });

  it('never carries card, buyer or authentication data', async () => {
    const { tonder, calls } = setup({
      core: true,
      process: () =>
        Promise.resolve({
          ...tx(),
          next_action: undefined,
          decline_reason: 'Ada Lovelace ada@example.com',
        }),
    });
    await tonder.init();

    await tonder.pay(payInput({ idempotency_key: 'idem-key-3' }));

    const wire = JSON.stringify(calls);
    for (const secret of [
      'tok_cn',
      'tok_cvv',
      'sky_1',
      'ada@example.com',
      'Ada',
      'Lovelace',
      'order_123',
      'api_key_under_test',
      'merchant.example',
    ]) {
      expect(wire).not.toContain(secret);
    }
  });
});

describe('telemetry — Apple Pay', () => {
  function applePayHarness() {
    const handlers: ApplePaySessionHandlers[] = [];
    const clicks: (() => void)[] = [];
    const adapter: ApplePayAdapter = {
      canUseApplePay: () => true,
      render: (o) => {
        clicks.push(o.onClick);
        return () => undefined;
      },
      createSession: (_r, h) => {
        handlers.push(h);
        return {
          begin: vi.fn(),
          completeMerchantValidation: vi.fn(),
          completePayment: vi.fn(),
          abort: vi.fn(),
        };
      },
    };
    return { adapter, handlers, clicks };
  }

  async function press(
    h: ReturnType<typeof applePayHarness>,
    s: ReturnType<typeof setup>,
  ) {
    await s.tonder.init();
    const button = s.tonder.create('apple_pay_button', {
      payment: {
        amount: 150,
        currency: 'MXN',
        return_url: 'https://merchant.example/return',
        client_reference: 'order_123',
        idempotency_key: 'apple-key-1',
      },
    });
    await button.mount();
    s.calls.length = 0;
    h.clicks[0]();
    return h.handlers[0];
  }

  it('a successful Apple Pay payment sends start, charge and result with the request id', async () => {
    const h = applePayHarness();
    const s = setup({ core: true, applePay: h.adapter });
    const session = await press(h, s);
    await session.onValidateMerchant();
    s.calls.length = 0;

    await session.onPaymentAuthorized(TOKEN);

    expect(summary(s.calls)).toEqual(['step:charge', 'step:result']);
    expect(s.calls[0][2]).toMatchObject({
      outcome: 'ok',
      payment_method_type: 'APPLE_PAY',
      request_id: '7_apple-key-1',
    });
    expect(JSON.stringify(s.calls)).not.toContain('opaque-token-data');
  });

  it('a core 503 is one charge failure, with no token', async () => {
    const h = applePayHarness();
    const s = setup({
      core: true,
      applePay: h.adapter,
      process: () =>
        Promise.reject(
          new AppError({
            errorCode: ErrorKeyEnum.REQUEST_FAILED,
            status_code: 503,
          }),
        ),
    });
    const session = await press(h, s);
    await session.onValidateMerchant();
    s.calls.length = 0;

    await session.onPaymentAuthorized(TOKEN);

    expect(summary(s.calls)).toEqual(['failed:charge']);
    expect(s.calls[0][2]).toMatchObject({
      error_code: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
      http_status: 503,
      payment_method_type: 'APPLE_PAY',
      request_id: '7_apple-key-1',
    });
    expect(JSON.stringify(s.calls)).not.toContain('opaque-token-data');
  });

  it('reports the start step once the sheet has opened and merchant validation completed', async () => {
    const h = applePayHarness();
    const s = setup({ core: true, applePay: h.adapter });
    const session = await press(h, s);

    expect(summary(s.calls)).toEqual([]);
    await session.onValidateMerchant();

    expect(summary(s.calls)).toEqual(['step:start']);
    expect(s.calls[0][2]).toMatchObject({
      outcome: 'ok',
      payment_method_type: 'APPLE_PAY',
    });
  });
});

describe('telemetry — the customer step belongs to payments', () => {
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

  function cardHttp(): HttpPort {
    return asHttpPort((o: HttpRequestOptions) => {
      if (o.path === CORE_CONFIG) return Promise.resolve(businessConfig(false));
      if (o.path === '/api/v1/customer/') {
        return Promise.resolve({ id: 42, auth_token: 'cust_tok_1' });
      }
      if (o.method === 'GET' && o.path === '/api/v1/business/7/cards/') {
        return Promise.resolve(CARDS);
      }
      if (o.path === LEGACY_PROCESS) return Promise.resolve(tx());
      return Promise.resolve({});
    });
  }

  const WITH_SECURE_TOKEN: TonderConfig = {
    ...CONFIG,
    session: { ...CONFIG.session, secure_token: 'secure_tok' },
  };

  function tokenizer(): TokenizerPort {
    return {
      mount: vi.fn(() => Promise.resolve()),
      unmount: vi.fn(),
      collect: vi.fn(() => Promise.resolve({ cvv: 'tok_cvv' })),
      reveal: vi.fn(() => Promise.resolve()),
    };
  }

  it('init() and getCustomerCards() send only method.called, as the client would serialize them', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((..._args: unknown[]) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const tonder = _createTonderWithDeps({
        config: WITH_SECURE_TOKEN,
        http: cardHttp(),
        tokenizer: tokenizer(),
        telemetry: new ClientTelemetryAdapter({
          env: 'sandbox',
          endpoint: 'https://api-stage.tonder.io/telemetry',
          apiKey: 'api_key_under_test',
        }),
      });

      await tonder.init();
      await tonder.getCustomerCards();
      await vi.advanceTimersByTimeAsync(6000);

      const sent = fetchMock.mock.calls.filter(
        ([url]) =>
          String(url) === 'https://api-stage.tonder.io/telemetry/v1/events',
      ) as unknown as [string, { body: string }][];
      const events = sent.flatMap(
        ([, init]) =>
          JSON.parse(init.body).events as { name: string; method?: string }[],
      );
      expect(events.map((e) => [e.name, e.method])).toEqual([
        ['method.called', 'init'],
        ['method.called', 'getCustomerCards'],
      ]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('a saved-card payment still reports the customer step it fetches', async () => {
    const telemetry = fakeTelemetry();
    const tonder = _createTonderWithDeps({
      config: WITH_SECURE_TOKEN,
      http: cardHttp(),
      tokenizer: tokenizer(),
      telemetry: telemetry.port,
    });
    await tonder.init();
    telemetry.calls.length = 0;

    await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(summary(telemetry.calls)).toEqual([
      'method:pay',
      'step:customer',
      'step:start',
      'step:charge',
      'step:result',
    ]);
  });

  it.each(['enrollCard', 'removeCustomerCard'] as const)(
    '%s sends no customer step',
    async (method) => {
      const telemetry = fakeTelemetry();
      const tonder = _createTonderWithDeps({
        config: WITH_SECURE_TOKEN,
        http: cardHttp(),
        tokenizer: tokenizer(),
        telemetry: telemetry.port,
      });
      await tonder.init();
      telemetry.calls.length = 0;

      await (
        method === 'enrollCard'
          ? tonder.enrollCard()
          : tonder.removeCustomerCard('card_abc')
      ).catch(() => undefined);

      expect(
        summary(telemetry.calls).filter((s) => s.includes('customer')),
      ).toEqual(
        [
          method === 'enrollCard'
            ? 'method:enrollCard'
            : 'method:removeCustomerCard',
        ].filter((s) => s.includes('customer')),
      );
      expect(
        telemetry.calls.some(([k]) => k === 'step' || k === 'failed'),
      ).toBe(false);
    },
  );
});

describe('telemetry — a payment that goes through a 3DS challenge', () => {
  const CHALLENGE = {
    ...tx('Pending'),
    next_action: { redirect_to_url: { url: 'https://auth.example/challenge' } },
  };

  function threeDsSetup(
    core: boolean,
    mode: 'embedded' | 'redirect',
    final = 'Success',
  ) {
    const telemetry = fakeTelemetry();
    const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
      if (o.path === CORE_CONFIG) {
        return Promise.resolve(businessConfig(core));
      }
      if (o.path === CORE_PROCESS || o.path === LEGACY_PROCESS) {
        return Promise.resolve(CHALLENGE);
      }
      if (o.method === 'GET') return Promise.resolve(tx(final));
      return Promise.reject(new Error(`unexpected ${o.method} ${o.path}`));
    });
    const host: ThreeDsHostPort = {
      redirect: vi.fn(() => telemetry.calls.push(['redirect', 'redirect'])),
      open: vi.fn(),
      close: vi.fn(),
    };
    const messenger: CheckoutMessengerPort = {
      waitForCompletion: vi.fn(() => Promise.resolve()),
    };
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: mode },
      http,
      tokenizer: {
        mount: vi.fn(() => Promise.resolve()),
        unmount: vi.fn(),
        collect: vi.fn(() => Promise.resolve({})),
        reveal: vi.fn(() => Promise.resolve()),
      },
      host,
      messenger,
      telemetry: telemetry.port,
    });
    return { tonder, host, ...telemetry };
  }

  it.each([
    ['monolith', false],
    ['core', true],
  ])(
    'redirect on the %s: one redirect step, flushed before the page leaves, no result',
    async (_l, core) => {
      const s = threeDsSetup(core, 'redirect');
      await s.tonder.init();
      s.calls.length = 0;

      await s.tonder.pay(payInput({ idempotency_key: 'idem-key-9' }));

      expect(summary(s.calls)).toEqual([
        'method:pay',
        'step:start',
        'step:charge',
        'step:redirect',
        'flush:flush',
        'redirect:redirect',
      ]);
      expect(s.calls[3][2]).toMatchObject({
        outcome: 'ok',
        payment_method_type: 'CARD',
        request_id: '7_idem-key-9',
      });
    },
  );

  it.each([
    ['monolith', false],
    ['core', true],
  ])(
    'embedded on the %s: one result with the final status, after the challenge',
    async (_l, core) => {
      const s = threeDsSetup(core, 'embedded');
      await s.tonder.init();
      s.calls.length = 0;

      await s.tonder.pay(payInput());

      expect(summary(s.calls)).toEqual([
        'method:pay',
        'step:start',
        'step:charge',
        'step:result',
      ]);
      expect(s.calls[3][2]).toMatchObject({ outcome: 'ok' });
    },
  );

  it('embedded: a challenge that ends declined is one result with outcome error', async () => {
    const s = threeDsSetup(true, 'embedded', 'Declined');
    await s.tonder.init();
    s.calls.length = 0;

    await s.tonder.pay(payInput());

    expect(summary(s.calls).filter((c) => c.includes('result'))).toEqual([
      'step:result',
    ]);
    expect(s.calls.at(-1)![2]).toMatchObject({ outcome: 'error' });
  });
});
