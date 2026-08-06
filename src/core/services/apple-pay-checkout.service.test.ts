/**
 * The orchestration is drivable end-to-end by local fakes: everything it
 * touches arrives through its deps object, so no DOM, no globals and no network
 * appear here.
 *
 * The fakes are LOCAL to this file, never modules under `src/` — a shipped mock
 * would be compiled, bundled and delivered to every merchant.
 *
 * TWO STANDING RULES IN THIS FILE:
 * - `expect.objectContaining` is BANNED (DD12). It passes when extra keys are
 *   present, which is exactly how `completePayment({ status: 'failure' })`
 *   would ship green with a stray `errors` key. Whole-argument
 *   `toHaveBeenCalledWith` and whole-value `toEqual` only.
 * - The synchrony assertions are PROXIES for Apple's user-activation rule, not
 *   evidence of it. jsdom models no user activation, so nothing here touches
 *   Safari's real gesture enforcement (S3 stays open for Phase 7).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApplePayCheckoutService } from './apple-pay-checkout.service';
import type {
  ApplePayCheckoutContext,
  ApplePayCheckoutDeps,
} from './apple-pay-checkout.service';
import { ApplePayService } from './apple-pay.service';
import { DirectApiService } from './direct-api.service';
import * as processBody from '../strategies/process-body.strategy';
import type {
  ApplePayPaymentToken,
  ApplePayPort,
  ApplePaySessionHandle,
  ApplePaySessionHandlers,
} from '../../ports/apple-pay.port';
import type { HttpRequestOptions } from '../../ports/http.port';
import { asHttpPort } from '../../test-support/http.mock';
import type { ApplePayConfig } from '../../models/business.model';
import type { BackendTransactionResponse } from '../../models/transaction.model';
import type { Customer, PaymentEventSink } from '../../shared/types';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const TOKEN = {
  paymentData: { version: 'EC_v1', data: 'opaque' },
  paymentMethod: { displayName: 'Visa 1234', network: 'Visa', type: 'debit' },
  transactionIdentifier: 'txn_1',
} as unknown as ApplePayPaymentToken;

const CUSTOMER: Customer = {
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

const APPLE_PAY: ApplePayConfig = {
  enabled: true,
  supports_debit: true,
};

function payment(overrides: Record<string, unknown> = {}) {
  return {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    client_reference: 'order_123',
    ...overrides,
  };
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

/** A session handle plus the handlers the port was wired with. */
interface FakeSession {
  handle: ApplePaySessionHandle & {
    begin: ReturnType<typeof vi.fn>;
    completeMerchantValidation: ReturnType<typeof vi.fn>;
    completePayment: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  handlers: ApplePaySessionHandlers;
}

function fakeApplePayPort(order?: string[]): {
  port: ApplePayPort;
  createSession: ReturnType<typeof vi.fn>;
  sessions: FakeSession[];
} {
  const sessions: FakeSession[] = [];
  const createSession = vi.fn(
    (_request: unknown, handlers: ApplePaySessionHandlers) => {
      order?.push('createSession');
      const handle = {
        begin: vi.fn(() => order?.push('begin')),
        completeMerchantValidation: vi.fn(),
        completePayment: vi.fn(),
        abort: vi.fn(),
      };
      sessions.push({ handle, handlers });
      return handle;
    },
  );
  return {
    port: { canUseApplePay: vi.fn(() => true), createSession },
    createSession,
    sessions,
  };
}

function fakeSink(): PaymentEventSink & {
  onCompleted: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} {
  return {
    onCompleted: vi.fn<PaymentEventSink['onCompleted']>(),
    onError: vi.fn<PaymentEventSink['onError']>(),
    onCancel: vi.fn<PaymentEventSink['onCancel']>(),
  };
}

function context(
  overrides: Partial<ApplePayCheckoutContext> = {},
): ApplePayCheckoutContext {
  return {
    applePay: APPLE_PAY,
    customer: CUSTOMER,
    presentationMode: 'redirect',
    businessPk: 7,
    ...overrides,
  };
}

interface Harness {
  checkout: ApplePayCheckoutService;
  sessions: FakeSession[];
  createSession: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof fakeSink>;
  processSpy: ReturnType<typeof vi.fn>;
  validateSpy: ReturnType<typeof vi.fn>;
  order: string[];
}

function harness(
  options: {
    process?: () => Promise<unknown>;
    validate?: () => Promise<unknown>;
    ctx?: Partial<ApplePayCheckoutContext>;
  } = {},
): Harness {
  const order: string[] = [];
  const { port, createSession, sessions } = fakeApplePayPort(order);
  const emit = fakeSink();
  const processSpy = vi.fn(
    options.process ?? (() => Promise.resolve(backendResponse())),
  );
  const validateSpy = vi.fn(
    options.validate ?? (() => Promise.resolve({ merchantSession: 'opaque' })),
  );
  const processHttp = asHttpPort(() => processSpy());
  const validateHttp = asHttpPort(() => validateSpy());

  const deps: ApplePayCheckoutDeps = {
    applePay: port,
    validation: new ApplePayService(validateHttp),
    directApi: new DirectApiService(processHttp),
    getContext: () => context(options.ctx),
    emit,
  };

  return {
    checkout: new ApplePayCheckoutService(deps),
    sessions,
    createSession,
    emit,
    processSpy,
    validateSpy,
    order,
  };
}

function startInput(overrides: Record<string, unknown> = {}) {
  return {
    payment: payment(),
    countryCode: 'MX',
    merchantName: 'Ada Store',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApplePayCheckoutService.start — click-path synchrony (T1, T2)', () => {
  it('creates the session and calls begin() before any microtask queued before the click', async () => {
    // PROXY for Apple's user-gesture rule, and the ONLY form no later deferral
    // can defeat. The naive `expect(createSession).toHaveBeenCalled()` is green
    // today and STAYS green the day someone adds `await flushPromises()` here
    // to "fix a flake" — at which point it proves nothing. A sentinel queued
    // BEFORE the call is reordered by any deferral, however small.
    const h = harness();

    queueMicrotask(() => h.order.push('microtask'));
    h.checkout.start(startInput());

    expect(h.order).toEqual(['createSession', 'begin']);

    await Promise.resolve();

    expect(h.order).toEqual(['createSession', 'begin', 'microtask']);
  });

  it('calls a function-valued payment synchronously inside the click path', () => {
    const h = harness();
    const resolvePayment = vi.fn(() => payment({ amount: 42 }));

    queueMicrotask(() => h.order.push('microtask'));
    h.checkout.start(startInput({ payment: resolvePayment }));

    expect(resolvePayment).toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(['createSession', 'begin']);
  });

  it('builds the sheet request from the gate-proved country and merchant name and the live apple_pay block', () => {
    const h = harness();

    h.checkout.start(startInput());

    expect(h.createSession.mock.calls[0][0]).toEqual({
      countryCode: 'MX',
      currencyCode: 'MXN',
      supportedNetworks: ['visa', 'masterCard'],
      merchantCapabilities: ['supports3DS', 'supportsDebit'],
      total: { label: 'Ada Store', amount: '150.00', type: 'final' },
    });
  });

  it('defaults the currency when the payment omits it', () => {
    const h = harness();

    h.checkout.start(startInput({ payment: payment({ currency: undefined }) }));

    expect(h.createSession.mock.calls[0][0].currencyCode).toBe('MXN');
  });

  it('reports a failure thrown in the click path through on_error, with no promise to reject', () => {
    const h = harness();

    // A zero amount makes buildApplePayPaymentRequest throw.
    const returned = h.checkout.start(
      startInput({ payment: payment({ amount: 0 }) }),
    );

    expect(returned).toBeUndefined();
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.emit.onError).toHaveBeenCalledTimes(1);
    const error = h.emit.onError.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
  });

  it('wraps a non-AppError thrown in the click path as PAYMENT_PROCESS_ERROR', () => {
    const h = harness();

    h.checkout.start(
      startInput({
        payment: () => {
          throw new TypeError('cart blew up');
        },
      }),
    );

    const error = h.emit.onError.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });
});

describe('ApplePayCheckoutService — onValidateMerchant', () => {
  it('hands Apple the merchant session the backend returned', async () => {
    const h = harness({ validate: () => Promise.resolve({ opaque: 'blob' }) });
    h.checkout.start(startInput());

    await h.sessions[0].handlers.onValidateMerchant();

    expect(
      h.sessions[0].handle.completeMerchantValidation,
    ).toHaveBeenCalledWith({ opaque: 'blob' });
    expect(h.sessions[0].handle.abort).not.toHaveBeenCalled();
  });

  it('aborts and re-emits the SAME AppError instance on a validation failure (T12)', async () => {
    const h = harness({ validate: () => Promise.reject(new Error('502')) });
    h.checkout.start(startInput());

    await h.sessions[0].handlers.onValidateMerchant();

    expect(h.sessions[0].handle.abort).toHaveBeenCalledTimes(1);
    expect(
      h.sessions[0].handle.completeMerchantValidation,
    ).not.toHaveBeenCalled();

    const emitted = h.emit.onError.mock.calls[0][0];
    // A re-wrap would show PAYMENT_PROCESS_ERROR and a different instance, and
    // the merchant would lose the actionable code.
    expect(emitted.code).toBe(ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR);
    expect(h.emit.onError).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the session was aborted before the callback arrived', async () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    h.checkout.abort();
    await session.handlers.onValidateMerchant();

    expect(session.handle.completeMerchantValidation).not.toHaveBeenCalled();
    expect(h.validateSpy).not.toHaveBeenCalled();
  });
});

describe('ApplePayCheckoutService — onPaymentAuthorized (D6 mapping)', () => {
  it('row 1 — an authorized charge completes success, THEN calls on_completed (T4, T8)', async () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onPaymentAuthorized(TOKEN);

    expect(session.handle.completePayment).toHaveBeenCalledWith({
      status: 'success',
    });
    expect(h.emit.onCompleted).toHaveBeenCalledTimes(1);
    expect(h.emit.onCompleted.mock.calls[0][0].id).toBe('tx_1');
    expect(h.emit.onError).not.toHaveBeenCalled();

    // The merchant's on_completed commonly navigates. Settling the sheet after it
    // would leave Apple's sheet on screen as the page goes away.
    expect(
      session.handle.completePayment.mock.invocationCallOrder[0],
    ).toBeLessThan(h.emit.onCompleted.mock.invocationCallOrder[0]);
  });

  it('row 2 — a decline completes FAILURE to Apple but calls on_completed for the merchant', async () => {
    const h = harness({
      process: () =>
        Promise.resolve(
          backendResponse({ status: 'Declined', decline_code: 'do_not_honor' }),
        ),
    });
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onPaymentAuthorized(TOKEN);

    // A decline is a RESULT, not a failure: Apple must not tell the shopper the
    // payment went through, and the merchant gets the same transaction pay()
    // would have handed them.
    expect(session.handle.completePayment).toHaveBeenCalledWith({
      status: 'failure',
    });
    expect(h.emit.onCompleted).toHaveBeenCalledTimes(1);
    expect(h.emit.onCompleted.mock.calls[0][0].status).toBe('Declined');
    expect(h.emit.onError).not.toHaveBeenCalled();
    expect(
      session.handle.completePayment.mock.invocationCallOrder[0],
    ).toBeLessThan(h.emit.onCompleted.mock.invocationCallOrder[0]);
  });

  it('row 3 — a /process failure completes failure FIRST, then calls on_error (T5, T6)', async () => {
    const h = harness({ process: () => Promise.reject(new Error('network')) });
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onPaymentAuthorized(TOKEN);

    // EXACTLY `{ status: 'failure' }` — `errors` stays unpopulated (S9), and
    // objectContaining would have passed with a stray one.
    expect(session.handle.completePayment).toHaveBeenCalledWith({
      status: 'failure',
    });
    expect(h.emit.onCompleted).not.toHaveBeenCalled();
    expect(h.emit.onError).toHaveBeenCalledTimes(1);
    expect(h.emit.onError.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(
      session.handle.completePayment.mock.invocationCallOrder[0],
    ).toBeLessThan(h.emit.onError.mock.invocationCallOrder[0]);
  });

  it('row 4 — a next_action response completes failure and still reports the transaction (T7)', async () => {
    // The channel is decided by whether a transaction exists, not by whether
    // its status is one the SDK can present. `on_error` carries an AppError
    // and no transaction, so routing this there would cost the merchant the id
    // they need to reconcile — and the pending action is on the transaction.
    const h = harness({
      process: () =>
        Promise.resolve(
          backendResponse({
            status: 'Pending',
            next_action: {
              redirect_to_url: { url: 'https://3ds.example/go' },
            },
          }),
        ),
    });
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onPaymentAuthorized(TOKEN);

    // Apple is told the payment did not complete — saying otherwise would tell
    // the shopper they paid.
    expect(session.handle.completePayment).toHaveBeenCalledWith({
      status: 'failure',
    });
    expect(h.emit.onError).not.toHaveBeenCalled();

    const tx = h.emit.onCompleted.mock.calls[0][0];
    expect(tx.status).toBe('Pending');
    expect(tx.next_action?.redirect_to_url?.url).toBe('https://3ds.example/go');

    expect(
      session.handle.completePayment.mock.invocationCallOrder[0],
    ).toBeLessThan(h.emit.onCompleted.mock.invocationCallOrder[0]);
  });

  it('is a no-op after abort() — a late authorization drops the charge (T9)', async () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    h.checkout.abort();
    await session.handlers.onPaymentAuthorized(TOKEN);

    expect(h.processSpy).not.toHaveBeenCalled();
    expect(session.handle.completePayment).not.toHaveBeenCalled();
    expect(h.emit.onCompleted).not.toHaveBeenCalled();
    expect(h.emit.onError).not.toHaveBeenCalled();
  });
});

describe('ApplePayCheckoutService — oncancel (T10)', () => {
  it('fires on_cancel with no arguments and never on_error or completePayment', async () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onCancel();

    expect(h.emit.onCancel).toHaveBeenCalledTimes(1);
    expect(h.emit.onCancel).toHaveBeenCalledWith();
    expect(h.emit.onError).not.toHaveBeenCalled();
    expect(h.emit.onCompleted).not.toHaveBeenCalled();
    // The sheet is already dismissed; completing it would be a second settle.
    expect(session.handle.completePayment).not.toHaveBeenCalled();
  });

  it('releases the session, so a later authorization is dropped', async () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    await session.handlers.onCancel();
    await session.handlers.onPaymentAuthorized(TOKEN);

    expect(h.processSpy).not.toHaveBeenCalled();
  });
});

describe('ApplePayCheckoutService.abort (T9)', () => {
  it('aborts a live session exactly once and is a no-op afterwards', () => {
    const h = harness();
    h.checkout.start(startInput());
    const session = h.sessions[0];

    h.checkout.abort();
    h.checkout.abort();

    expect(session.handle.abort).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no session is live', () => {
    const h = harness();

    expect(() => h.checkout.abort()).not.toThrow();
  });
});

describe('The Apple Pay /process body comes from the shared builder (D3, T13)', () => {
  it('calls the same exported buildProcessBody function pay() delegates to', async () => {
    const spy = vi.spyOn(processBody, 'buildProcessBody');
    const h = harness();
    h.checkout.start(startInput());

    await h.sessions[0].handlers.onPaymentAuthorized(TOKEN);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('produces a body identical to the pay() body outside payment_method, with the token BY REFERENCE', async () => {
    const captured: unknown[] = [];
    const processHttp = asHttpPort((request: HttpRequestOptions) => {
      captured.push(request.body);
      return Promise.resolve(backendResponse());
    });
    const { port, sessions } = fakeApplePayPort();
    const checkout = new ApplePayCheckoutService({
      applePay: port,
      validation: new ApplePayService(asHttpPort(() => Promise.resolve({}))),
      directApi: new DirectApiService(processHttp),
      getContext: () => context(),
      emit: fakeSink(),
    });

    checkout.start(startInput());
    await sessions[0].handlers.onPaymentAuthorized(TOKEN);

    // The reference body: what the SAME builder produces for the SAME input on
    // the card path. Exact toEqual, not objectContaining — the drift this
    // guards against (a field added to PayInput reaching one path only) is
    // precisely an EXTRA key, which objectContaining would wave through.
    const expected = processBody.buildProcessBody({
      payment: payment(),
      paymentMethod: { type: 'CARD', card_number: 'tok' },
      customer: CUSTOMER,
      currency: 'MXN',
      presentationMode: 'redirect',
    });

    const actual = captured[0] as Record<string, unknown>;
    const { payment_method: actualMethod, ...actualRest } = actual;
    const { payment_method: _ignored, ...expectedRest } =
      expected as unknown as Record<string, unknown>;

    expect(actualRest).toEqual(expectedRest);
    expect(actualMethod).toEqual({ type: 'APPLE_PAY', token: TOKEN });
    // toBe, so a JSON round trip or a spread copy fails.
    expect((actualMethod as { token: unknown }).token).toBe(TOKEN);
  });

  it('scopes the idempotency key by the business pk, like pay() does', async () => {
    const headers: unknown[] = [];
    const processHttp = asHttpPort((request: HttpRequestOptions) => {
      headers.push(request.headers);
      return Promise.resolve(backendResponse());
    });
    const { port, sessions } = fakeApplePayPort();
    const checkout = new ApplePayCheckoutService({
      applePay: port,
      validation: new ApplePayService(asHttpPort(() => Promise.resolve({}))),
      directApi: new DirectApiService(processHttp),
      getContext: () => context(),
      emit: fakeSink(),
    });

    checkout.start(
      startInput({ payment: payment({ idempotency_key: 'key-1' }) }),
    );
    await sessions[0].handlers.onPaymentAuthorized(TOKEN);

    expect(headers[0]).toEqual({ 'X-Request-Id': '7_key-1' });
  });

  it('reads the live context at authorization time, not at start()', async () => {
    let ctx = context({ presentationMode: 'redirect' });
    const captured: unknown[] = [];
    const processHttp = asHttpPort((request: HttpRequestOptions) => {
      captured.push(request.body);
      return Promise.resolve(backendResponse());
    });
    const { port, sessions } = fakeApplePayPort();
    const checkout = new ApplePayCheckoutService({
      applePay: port,
      validation: new ApplePayService(asHttpPort(() => Promise.resolve({}))),
      directApi: new DirectApiService(processHttp),
      getContext: () => ctx,
      emit: fakeSink(),
    });

    checkout.start(startInput());
    ctx = context({ presentationMode: 'embedded' });
    await sessions[0].handlers.onPaymentAuthorized(TOKEN);

    expect(
      (captured[0] as { presentation_mode: string }).presentation_mode,
    ).toBe('embedded');
  });
});
