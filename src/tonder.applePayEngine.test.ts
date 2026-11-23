/**
 * Which system charges an Apple Pay payment: a business on the core goes to the
 * core's `/process`, any other business keeps the monolith. The core answer is
 * mapped as a card payment's. The token is sent whole and never logged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type {
  ApplePayAdapter,
  ApplePayPaymentToken,
  ApplePaySessionHandlers,
} from './ports/apple-pay.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';
import { AppError } from './shared/errors/AppError';

const LEGACY_PROCESS = '/api/v1/process/';
const CORE_PROCESS = '/transactions/v1/process';
const CORE_CONFIG = '/transactions/v1/business/config';

const TOKEN = {
  paymentData: { version: 'EC_v1', data: 'opaque' },
} as unknown as ApplePayPaymentToken;

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  session: { customer: { email: 'ada@example.com', first_name: 'Ada' } },
};

function businessConfig(core?: unknown): BusinessConfig {
  return {
    business: {
      pk: 7,
      name: 'Ada Store',
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
    ...(core === undefined ? {} : { core_payments_enabled: core }),
  } as unknown as BusinessConfig;
}

function setup(
  core: unknown,
  process: (o: HttpRequestOptions) => Promise<unknown> = (o) =>
    Promise.resolve({
      id: o.path === CORE_PROCESS ? 'tx_core_1' : 'tx_legacy_1',
      operation_type: 'payment',
      status: 'Success',
      amount: '150.00',
      currency: 'MXN',
    }),
) {
  const calls: HttpRequestOptions[] = [];
  const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
    calls.push(o);
    if (o.path === CORE_CONFIG) return Promise.resolve(businessConfig(core));
    if (o.path === CORE_PROCESS || o.path === LEGACY_PROCESS) {
      return process(o);
    }
    return Promise.reject(new Error(`unexpected ${o.method} ${o.path}`));
  });
  const handlers: ApplePaySessionHandlers[] = [];
  const completePayment = vi.fn();
  const adapter: ApplePayAdapter = {
    canUseApplePay: () => true,
    render: (o) => {
      handlers.push({ click: o.onClick } as unknown as ApplePaySessionHandlers);
      return () => undefined;
    },
    createSession: (_r, h) => {
      handlers.push(h);
      return {
        begin: vi.fn(),
        completeMerchantValidation: vi.fn(),
        completePayment,
        abort: vi.fn(),
      };
    },
  };
  const onCompleted = vi.fn();
  const onError = vi.fn();
  const tonder = _createTonderWithDeps({
    config: {
      ...CONFIG,
      events: { payment: { on_completed: onCompleted, on_error: onError } },
    } as TonderConfig,
    http,
    tokenizer: {
      mount: vi.fn(() => Promise.resolve()),
      unmount: vi.fn(),
      collect: vi.fn(() => Promise.resolve({})),
      reveal: vi.fn(() => Promise.resolve()),
    },
    applePay: adapter,
  });
  return { tonder, calls, handlers, completePayment, onCompleted, onError };
}

async function charge(
  s: ReturnType<typeof setup>,
  payment: Record<string, unknown> = {},
) {
  await s.tonder.init();
  const button = s.tonder.create('apple_pay_button', {
    payment: {
      amount: 150,
      currency: 'MXN',
      return_url: 'https://merchant.example/return',
      client_reference: 'order_123',
      ...payment,
    },
  });
  await button.mount();
  // The button's click handler starts the session; the sheet then authorizes.
  const click = s.handlers[0] as unknown as { click: () => void };
  click.click();
  await s.handlers[1].onPaymentAuthorized(TOKEN);
  return s.calls.filter((c) => c.path !== CORE_CONFIG);
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('Apple Pay charge — which system processes it', () => {
  it('a business on the core charges through the core /process', async () => {
    const s = setup(true);

    const sent = await charge(s);

    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${CORE_PROCESS}`,
    ]);
    expect(sent[0].body).toMatchObject({
      operation_type: 'payment',
      amount: 150,
      payment_method: { type: 'APPLE_PAY', token: TOKEN },
    });
    expect(
      (sent[0].body as { payment_method: object }).payment_method,
    ).not.toHaveProperty('apm_config');
  });

  it.each([
    ['absent', undefined],
    ['false', false],
    ['a string', 'true'],
    ['a number', 1],
  ])('a business with the flag %s keeps the monolith', async (_l, flag) => {
    const s = setup(flag);

    const sent = await charge(s);

    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${LEGACY_PROCESS}`,
    ]);
  });

  it('maps the core answer as a card payment on the core', async () => {
    const s = setup(true);

    await charge(s);

    expect(s.completePayment).toHaveBeenCalledWith({ status: 'success' });
    expect(s.onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx_core_1', status: 'Success' }),
    );
  });

  it('a core decline reaches on_completed and tells Apple failure', async () => {
    const s = setup(true, () =>
      Promise.resolve({
        id: 'tx_core_2',
        operation_type: 'payment',
        status: 'Declined',
        amount: '150.00',
        currency: 'MXN',
      }),
    );

    await charge(s);

    expect(s.completePayment).toHaveBeenCalledWith({ status: 'failure' });
    expect(s.onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx_core_2', status: 'Declined' }),
    );
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('a core transport failure goes to on_error without the token', async () => {
    const s = setup(true, () => Promise.reject(new Error('boom')));

    await charge(s);

    expect(s.completePayment).toHaveBeenCalledWith({ status: 'failure' });
    const error = s.onError.mock.calls[0][0] as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(JSON.stringify(error.details ?? {})).not.toContain('opaque');
  });

  it('a core 503 reaches the merchant as an error and never touches the monolith', async () => {
    const s = setup(true, () =>
      Promise.reject(
        new AppError({
          errorCode: 'REQUEST_FAILED' as never,
          status_code: 503,
          originalError: { error_code: 'operations_disabled' },
        }),
      ),
    );

    const sent = await charge(s);

    expect(sent.map((c) => c.path)).toEqual([CORE_PROCESS]);
    expect(s.completePayment).toHaveBeenCalledWith({ status: 'failure' });
    expect(s.onError).toHaveBeenCalledTimes(1);
    expect(s.onCompleted).not.toHaveBeenCalled();
  });
});

describe('X-Request-Id on the Apple Pay payment', () => {
  it.each([
    ['core', true, CORE_PROCESS],
    ['monolith', false, LEGACY_PROCESS],
  ])(
    'sends a generated id on the %s when no idempotency_key is given',
    async (_l, flag, path) => {
      const s = setup(flag);

      const sent = await charge(s);

      expect(sent[0].path).toBe(path);
      expect(sent[0].headers?.['X-Request-Id']).toMatch(/^[0-9a-f-]{16,}$/i);
    },
  );

  it('sends the merchant key scoped by business when given', async () => {
    const s = setup(true);

    const sent = await charge(s, { idempotency_key: ' key-1 ' });

    expect(sent[0].headers).toEqual({ 'X-Request-Id': '7_key-1' });
  });
});
