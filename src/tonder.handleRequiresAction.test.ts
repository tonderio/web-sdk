import { afterEach, describe, it, expect, vi, expectTypeOf } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { ThreeDsHostPort } from './ports/threeds-host.port';
import type { CheckoutMessengerPort } from './ports/checkout-messenger.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
};

const EMBEDDED_CONFIG: TonderConfig = {
  ...CONFIG,
  presentation_mode: 'embedded',
};

const SNAKE_TOKENS = {
  card_number: 'tok_cn',
  cvv: 'tok_cvv',
  expiration_month: 'tok_m',
  expiration_year: 'tok_y',
  cardholder_name: 'tok_name',
  skyflow_id: 'sky_1',
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

function mockTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve(SNAKE_TOKENS)),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function mockHost(): ThreeDsHostPort & {
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
} {
  return { redirect: vi.fn(), open: vi.fn(), close: vi.fn() };
}

function backendResponse(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'Authorized',
    amount: '150.00',
    currency: 'MXN',
    ...overrides,
  };
}

function requiresActionResponse(): BackendTransactionResponse {
  return backendResponse({
    status: 'Pending',
    next_action: {
      redirect_to_url: {
        url: 'https://3ds.example/go',
        verify_transaction_status_url: 'https://api.example/verify',
      },
    },
  });
}

/**
 * Controllable HTTP: counts GET /transactions/ calls and lets each test decide
 * what each one returns (or rejects). The transaction GET is shared by both the
 * messenger-win `getTransaction` and the poll path.
 */
function controllableHttp(opts: {
  process?: BackendTransactionResponse;
  onTransaction: (callIndex: number) => Promise<unknown>;
}): { http: HttpPort; transactionCalls: () => number } {
  let calls = 0;
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/process/') {
        return Promise.resolve(
          (opts.process ?? requiresActionResponse()) as unknown as T,
        );
      }
      if (options.path.startsWith('/api/v1/transactions/')) {
        const idx = calls;
        calls += 1;
        return opts.onTransaction(idx) as Promise<T>;
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
  return { http, transactionCalls: () => calls };
}

/** Fake messenger whose completion is driven manually by the test. */
function controllableMessenger(): CheckoutMessengerPort & {
  fire: () => void;
  waitForCompletion: ReturnType<typeof vi.fn>;
  signal: () => AbortSignal | undefined;
} {
  let resolveFn: (() => void) | undefined;
  let capturedSignal: AbortSignal | undefined;
  const waitForCompletion = vi.fn((signal: AbortSignal) => {
    capturedSignal = signal;
    return new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      if (signal.aborted) {
        reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
        return;
      }
      signal.addEventListener(
        'abort',
        () => reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED })),
        { once: true },
      );
    });
  });
  return {
    waitForCompletion,
    fire: () => resolveFn?.(),
    signal: () => capturedSignal,
  };
}

/**
 * Messenger whose completion is driven by an EXTERNAL AbortController the test
 * owns (not the race's internal controller). It models a real external abort:
 * `waitForCompletion` rejects with REQUEST_ABORTED the moment the external
 * signal fires, regardless of the internal race signal it was handed.
 */
function externallyAbortedMessenger(
  external: AbortController,
): CheckoutMessengerPort & {
  waitForCompletion: ReturnType<typeof vi.fn>;
} {
  return {
    waitForCompletion: vi.fn(
      (_signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          if (external.signal.aborted) {
            reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
            return;
          }
          external.signal.addEventListener(
            'abort',
            () =>
              reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED })),
            { once: true },
          );
        }),
    ),
  };
}

/** Messenger that never settles on its own (pure regression fallback). */
function neverFiringMessenger(): CheckoutMessengerPort & {
  waitForCompletion: ReturnType<typeof vi.fn>;
} {
  return {
    waitForCompletion: vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          if (signal.aborted) {
            reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
            return;
          }
          signal.addEventListener(
            'abort',
            () =>
              reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED })),
            { once: true },
          );
        }),
    ),
  };
}

async function readyTonder(deps: {
  http: HttpPort;
  host: ThreeDsHostPort;
  messenger?: CheckoutMessengerPort;
  config?: TonderConfig;
}) {
  const tonder = _createTonderWithDeps({
    config: deps.config ?? EMBEDDED_CONFIG,
    http: deps.http,
    tokenizer: mockTokenizer(),
    host: deps.host,
    messenger: deps.messenger,
  });
  await tonder.init();
  return tonder;
}

describe('TonderConfig presentation-events surface', () => {
  it('flat onOpen/onClose no longer exist on TonderConfig', () => {
    // @ts-expect-error — flat presentation callbacks were removed; they now live
    // under config.events.presentation.
    const bad: TonderConfig = { ...CONFIG, on_open: () => undefined };
    void bad;

    // The namespaced location is the ONLY accepted place.
    const good: TonderConfig = {
      ...CONFIG,
      events: { presentation: { on_open: () => undefined } },
    };
    expect(good.events?.presentation?.on_open).toBeTypeOf('function');

    // @ts-expect-error — onComplete is not part of the public presentation events API.
    const badPresentation: TonderConfig = {
      ...CONFIG,
      events: { presentation: { onComplete: () => undefined } },
    };
    void badPresentation;

    expectTypeOf<
      NonNullable<
        NonNullable<TonderConfig['events']>['presentation']
      >['on_open']
    >().toEqualTypeOf<(() => void) | undefined>();
  });
});

describe('Tonder.handleRequiresAction — messenger-driven reconcile (embedded)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('waits for messenger completion before starting the reconcile transaction read', async () => {
    // No fallback polling should run while the iframe is still open.
    const messenger = controllableMessenger();
    const { http, transactionCalls } = controllableHttp({
      onTransaction: () =>
        Promise.resolve(backendResponse({ status: 'Authorized' })),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const payPromise = tonder.pay(payInput());
    // Wait for waitForCompletion to attach. It must NOT start a poll.
    await vi.waitFor(() => {
      expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    });
    expect(transactionCalls()).toBe(0);

    messenger.fire();
    const result = await payPromise;

    expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    // Exactly one transaction read, and only after the messenger signal.
    expect(transactionCalls()).toBe(1);
    expect(messenger.signal()?.aborted).toBe(true);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('tx_1');
    expect(result.status).toBe('Authorized');
    expect('outcome' in result).toBe(false);
    expect('transaction' in result).toBe(false);
  });

  it('after messenger completion, reconcile polls past Pending until a final transaction', async () => {
    // The messenger signals completion, but the first authoritative read is
    // still "Pending" (settlement not yet visible). The short reconcile loop
    // must keep going until a FINAL_STATUSES status is reached.
    vi.useFakeTimers();
    const messenger = controllableMessenger();
    const { http } = controllableHttp({
      onTransaction: (idx) =>
        Promise.resolve(
          idx === 0
            ? backendResponse({ status: 'Pending' })
            : backendResponse({ status: 'Authorized' }),
        ),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const payPromise = tonder.pay(payInput());
    await vi.waitFor(() => {
      expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    });
    messenger.fire();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await payPromise;

    // NEVER a still-Pending result: the final settled transaction wins.
    expect(result.status).toBe('Authorized');
    expect(result.status).not.toBe('Pending');
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it('does not run abandonment polling when the messenger never fires', async () => {
    vi.useFakeTimers();
    const messenger = neverFiringMessenger();
    const { http, transactionCalls } = controllableHttp({
      onTransaction: () =>
        Promise.resolve(backendResponse({ status: 'Authorized' })),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    void tonder.pay(payInput());
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    expect(transactionCalls()).toBe(0);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('reconcile timeout after messenger completion surfaces POLL_TIMEOUT_ERROR and unmounts iframe', async () => {
    vi.useFakeTimers();
    const messenger = controllableMessenger();
    const { http } = controllableHttp({
      onTransaction: () =>
        Promise.resolve(backendResponse({ status: 'Pending' })),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const payPromise = tonder.pay(payInput());
    await vi.waitFor(() => {
      expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    });
    messenger.fire();
    const errPromise = payPromise.catch((e) => e);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await errPromise;

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.POLL_TIMEOUT_ERROR);
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it('redirect mode → messenger never called, returns bare Pending transaction before host.redirect settles it', async () => {
    const messenger = controllableMessenger();
    const { http } = controllableHttp({
      onTransaction: () => Promise.resolve(backendResponse()),
    });
    const host = mockHost();
    const tonder = await readyTonder({
      http,
      host,
      messenger,
      config: CONFIG, // redirect (default)
    });

    const result = await tonder.pay(payInput());

    expect(messenger.waitForCompletion).not.toHaveBeenCalled();
    expect(host.redirect).toHaveBeenCalledWith('https://3ds.example/go');
    expect(result.id).toBe('tx_1');
    expect(result.status).toBe('Pending');
    expect(result.next_action).toBeDefined();
  });

  it('APM embedded → messenger never called, modal LEFT open (no close), returns bare Pending transaction', async () => {
    const messenger = controllableMessenger();
    const http: HttpPort = {
      request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/api/v1/process/') {
          return Promise.resolve(
            backendResponse({
              status: 'pending',
              next_action: {
                redirect_to_url: { url: 'https://voucher.example/oxxo' },
              },
            }) as unknown as T,
          );
        }
        return Promise.resolve(makeBusinessConfig() as unknown as T);
      }),
    };
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'oxxo' } }),
    );

    expect(messenger.waitForCompletion).not.toHaveBeenCalled();
    // The hosted page must stay visible so the shopper sees the CLABE/voucher.
    expect(host.open).toHaveBeenCalledWith(
      'https://voucher.example/oxxo',
      expect.objectContaining({ closable: true }),
    );
    expect(host.close).not.toHaveBeenCalled();
    expect(result.status).toBe('pending');
  });

  it('embedded 3DS opens a NON-closable modal (closable:false)', async () => {
    const messenger = controllableMessenger();
    const { http } = controllableHttp({
      onTransaction: () =>
        Promise.resolve(backendResponse({ status: 'Authorized' })),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const payPromise = tonder.pay(payInput());
    await vi.waitFor(() => {
      expect(host.open).toHaveBeenCalled();
    });

    expect(host.open).toHaveBeenCalledWith(
      'https://3ds.example/go',
      expect.objectContaining({ closable: false }),
    );
    messenger.fire();
    await payPromise;
  });

  it('embedded 3DS pay resolves to the final transaction without a completion callback', async () => {
    const messenger = controllableMessenger();
    const { http } = controllableHttp({
      onTransaction: () =>
        Promise.resolve(backendResponse({ status: 'Authorized' })),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host, messenger });

    const payPromise = tonder.pay(payInput());
    await vi.waitFor(() => {
      expect(messenger.waitForCompletion).toHaveBeenCalledTimes(1);
    });
    messenger.fire();
    const result = await payPromise;

    expect(result.status).toBe('Authorized');
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it('embedded APM shopper-close fires events.presentation.on_close via onUserClose; onOpen wired', async () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    const http: HttpPort = {
      request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/api/v1/process/') {
          return Promise.resolve(
            backendResponse({
              status: 'pending',
              next_action: {
                redirect_to_url: { url: 'https://voucher.example/oxxo' },
              },
            }) as unknown as T,
          );
        }
        return Promise.resolve(makeBusinessConfig() as unknown as T);
      }),
    };
    const host = mockHost();
    const tonder = await readyTonder({
      http,
      host,
      config: {
        ...EMBEDDED_CONFIG,
        events: { presentation: { on_open: onOpen, on_close: onClose } },
      },
    });

    await tonder.pay(payInput({ payment_method: { type: 'oxxo' } }));

    // onOpen is wired from events.presentation.on_open.
    const opts = host.open.mock.calls[0][1] as {
      onOpen?: () => void;
      onUserClose?: () => void;
    };
    expect(opts.onOpen).toBe(onOpen);
    // The facade wires events.presentation.on_close as the modal's onUserClose.
    // Simulate the shopper closing the modal by invoking the captured callback.
    opts.onUserClose?.();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unmountPresentation no longer exists on the public facade', async () => {
    const { http } = controllableHttp({
      onTransaction: () => Promise.resolve(backendResponse()),
    });
    const host = mockHost();
    const tonder = await readyTonder({ http, host });

    expect(
      (tonder as unknown as Record<string, unknown>).unmountPresentation,
    ).toBeUndefined();
  });
});
