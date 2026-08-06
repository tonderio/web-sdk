import { afterEach, describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type {
  ThreeDsHostPort,
  ThreeDsHostOptions,
} from './ports/threeds-host.port';
import type { CheckoutMessengerPort } from './ports/checkout-messenger.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

const EMBEDDED_CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  presentation_mode: 'embedded',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
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
  };
}

function mockTokenizer(): TokenizerPort {
  return {
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

/**
 * Host fake that behaves like the real browser host: it actually INVOKES the
 * `onOpen` it is handed, and exposes a `userClose()` that invokes `onUserClose`.
 *
 * A host whose `open` is a bare spy would never call the merchant callback, so
 * every isolation assertion below would pass without any isolation existing.
 */
function invokingHost(): ThreeDsHostPort & {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  userClose: () => void;
} {
  let captured: ThreeDsHostOptions | undefined;
  return {
    redirect: vi.fn<ThreeDsHostPort['redirect']>(),
    close: vi.fn<ThreeDsHostPort['close']>(),
    open: vi.fn((_url: string, options: ThreeDsHostOptions) => {
      captured = options;
      options.onOpen?.();
    }),
    userClose: () => captured?.onUserClose?.(),
  };
}

function threeDsHttp(): HttpPort {
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/process/') {
      return Promise.resolve({
        id: 'tx_1',
        operation_type: 'payment',
        status: 'Pending',
        amount: '150.00',
        currency: 'MXN',
        next_action: {
          redirect_to_url: {
            url: 'https://3ds.example/go',
            verify_transaction_status_url: 'https://api.example/verify',
          },
        },
      } as BackendTransactionResponse);
    }
    if (options.path.startsWith('/api/v1/transactions/')) {
      return Promise.resolve({
        id: 'tx_1',
        operation_type: 'payment',
        status: 'Authorized',
        amount: '150.00',
        currency: 'MXN',
      } as BackendTransactionResponse);
    }
    return Promise.resolve(makeBusinessConfig());
  });
}

function apmHttp(): HttpPort {
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/process/') {
      return Promise.resolve({
        id: 'tx_apm',
        operation_type: 'payment',
        status: 'pending',
        amount: '150.00',
        currency: 'MXN',
        next_action: {
          redirect_to_url: { url: 'https://voucher.example/oxxo' },
        },
      } as BackendTransactionResponse);
    }
    return Promise.resolve(makeBusinessConfig());
  });
}

/** Messenger that completes as soon as the challenge iframe is opened. */
function immediateMessenger(): CheckoutMessengerPort {
  return {
    waitForCompletion: vi.fn((signal: AbortSignal) => {
      if (signal.aborted) {
        return Promise.reject(
          new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }),
        );
      }
      return Promise.resolve();
    }),
  };
}

async function readyTonder(deps: {
  http: HttpPort;
  host: ThreeDsHostPort;
  messenger?: CheckoutMessengerPort;
  config: TonderConfig;
}) {
  const tonder = _createTonderWithDeps({
    config: deps.config,
    http: deps.http,
    tokenizer: mockTokenizer(),
    host: deps.host,
    messenger: deps.messenger,
  });
  await tonder.init();
  return tonder;
}

const boom = (): never => {
  throw new Error('merchant analytics blew up');
};

describe('events.presentation callbacks are isolated from the payment path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a throwing on_open does not reject embedded card 3DS pay() nor change the transaction', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = invokingHost();
    const tonder = await readyTonder({
      http: threeDsHttp(),
      host,
      messenger: immediateMessenger(),
      config: {
        ...EMBEDDED_CONFIG,
        events: { presentation: { on_open: boom } },
      },
    });

    const result = await tonder.pay(payInput());

    expect(result.status).toBe('Authorized');
    expect(result.id).toBe('tx_1');
    expect(host.open).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('a throwing on_open does not reject an embedded APM pay()', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = invokingHost();
    const tonder = await readyTonder({
      http: apmHttp(),
      host,
      config: {
        ...EMBEDDED_CONFIG,
        events: { presentation: { on_open: boom } },
      },
    });

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'oxxo' } }),
    );

    expect(result.status).toBe('pending');
    expect(result.id).toBe('tx_apm');
  });

  it('a throwing on_close does not escape the shopper-driven modal close', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = invokingHost();
    const tonder = await readyTonder({
      http: apmHttp(),
      host,
      config: {
        ...EMBEDDED_CONFIG,
        events: { presentation: { on_close: boom } },
      },
    });

    await tonder.pay(payInput({ payment_method: { type: 'oxxo' } }));

    expect(() => host.userClose()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('survives a console.warn that itself throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console is patched by the merchant');
    });
    const host = invokingHost();
    const tonder = await readyTonder({
      http: apmHttp(),
      host,
      config: {
        ...EMBEDDED_CONFIG,
        events: { presentation: { on_open: boom, on_close: boom } },
      },
    });

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'oxxo' } }),
    );

    expect(result.status).toBe('pending');
    expect(() => host.userClose()).not.toThrow();
  });

  it('still reads events.presentation at FIRE time, not at construction', async () => {
    const host = invokingHost();
    const onOpen = vi.fn();
    const config: TonderConfig = { ...EMBEDDED_CONFIG };
    const tonder = await readyTonder({ http: apmHttp(), host, config });

    // Assigned AFTER createTonder — the documented carve-out from the config
    // snapshot. Isolation must not turn into a construction-time capture.
    config.events = { presentation: { on_open: onOpen } };

    await tonder.pay(payInput({ payment_method: { type: 'oxxo' } }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('invokes no merchant code when events.presentation is absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = invokingHost();
    const tonder = await readyTonder({
      http: apmHttp(),
      host,
      config: EMBEDDED_CONFIG,
    });

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'oxxo' } }),
    );

    expect(result.status).toBe('pending');
    expect(() => host.userClose()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
