import { describe, it, expect, vi, afterEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    },
  };
}

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
  } as unknown as BusinessConfig;
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

function mockTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({ card_number: 'tok_cn' })),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

/** init() returns the business config; /process runs `processImpl`. */
function mockHttp(processImpl: () => Promise<unknown>): HttpPort {
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/process/') {
      return processImpl();
    }
    return Promise.resolve(makeBusinessConfig());
  });
}

async function readyTonder(
  config: TonderConfig,
  processImpl: () => Promise<unknown> = () =>
    Promise.resolve(backendResponse()),
) {
  const tonder = _createTonderWithDeps({
    config,
    http: mockHttp(processImpl),
    tokenizer: mockTokenizer(),
  });
  await tonder.init();
  return tonder;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config.events.payment — fired by pay()', () => {
  it('fires on_completed with the transaction for an authorized resolution', async () => {
    const on_completed = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed } };
    const tonder = await readyTonder(config);

    const tx = await tonder.pay(payInput());

    expect(on_completed).toHaveBeenCalledTimes(1);
    expect(on_completed).toHaveBeenCalledWith(tx);
  });

  it('fires on_completed — not on_error — for a declined resolution', async () => {
    const on_completed = vi.fn();
    const on_error = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed, on_error } };
    const tonder = await readyTonder(config, () =>
      Promise.resolve(backendResponse({ status: 'Declined' })),
    );

    const tx = await tonder.pay(payInput());

    expect(tx.status).toBe('Declined');
    expect(on_completed).toHaveBeenCalledTimes(1);
    expect(on_completed).toHaveBeenCalledWith(tx);
    expect(on_error).not.toHaveBeenCalled();
  });

  it('fires on_error with the AppError when pay() rejects', async () => {
    const on_completed = vi.fn();
    const on_error = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed, on_error } };
    const tonder = await readyTonder(config, () =>
      Promise.reject(new Error('network down')),
    );

    const caught = await tonder.pay(payInput()).catch((error) => error);

    expect(caught).toBeInstanceOf(AppError);
    expect(on_error).toHaveBeenCalledTimes(1);
    expect(on_error).toHaveBeenCalledWith(caught);
    expect(on_completed).not.toHaveBeenCalled();
  });

  it('never fires on_cancel, for either outcome', async () => {
    const on_cancel = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_cancel } };

    const resolving = await readyTonder(config);
    await resolving.pay(payInput());

    const rejecting = await readyTonder(config, () =>
      Promise.reject(new Error('network down')),
    );
    await rejecting.pay(payInput()).catch(() => undefined);

    expect(on_cancel).not.toHaveBeenCalled();
  });

  it('delivers to the callbacks passed at createTonder, not ones substituted later', async () => {
    // Wholesale replacement: the merchant's own object is left untouched, so
    // nothing they wrote looks different.
    const passed = vi.fn();
    const substituted = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed: passed } };
    const tonder = await readyTonder(config);

    config.events = { payment: { on_completed: substituted } };
    const tx = await tonder.pay(payInput());

    expect(passed).toHaveBeenCalledTimes(1);
    expect(passed).toHaveBeenCalledWith(tx);
    expect(substituted).not.toHaveBeenCalled();
  });

  it('leaves pay() unchanged when no callbacks are configured', async () => {
    const config = makeConfig();
    const tonder = await readyTonder(config);

    await expect(tonder.pay(payInput())).resolves.toMatchObject({
      id: 'tx_1',
      status: 'Authorized',
    });

    const rejecting = await readyTonder(makeConfig(), () =>
      Promise.reject(new Error('network down')),
    );
    const caught = await rejecting.pay(payInput()).catch((error) => error);
    expect(caught).toBeInstanceOf(AppError);
    expect(caught.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });
});

describe('config.events.payment — merchant callback isolation (DD7)', () => {
  it('a throwing on_completed still leaves pay() RESOLVED with the transaction', async () => {
    // The assertion is on the OUTCOME, not on console.warn: a test that only
    // checked the warning would go green on the log alone while the promise
    // still rejected — which is the failure this isolation exists to prevent
    // (a merchant holding a rejected promise for a charge that went through,
    // retrying, and paying twice).
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = makeConfig();
    config.events = {
      payment: {
        on_completed: () => {
          throw new Error('merchant analytics blew up');
        },
      },
    };
    const tonder = await readyTonder(config);

    const tx = await tonder.pay(payInput());

    expect(tx.id).toBe('tx_1');
    expect(tx.status).toBe('Authorized');
  });

  it('a throwing on_completed does not divert a success into on_error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const on_error = vi.fn();
    const config = makeConfig();
    config.events = {
      payment: {
        on_completed: () => {
          throw new Error('merchant analytics blew up');
        },
        on_error,
      },
    };
    const tonder = await readyTonder(config);

    await tonder.pay(payInput());

    expect(on_error).not.toHaveBeenCalled();
  });

  it('a throwing on_error still rejects pay() with the original AppError', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = makeConfig();
    config.events = {
      payment: {
        on_error: () => {
          throw new Error('merchant logger blew up');
        },
      },
    };
    const tonder = await readyTonder(config, () =>
      Promise.reject(new Error('network down')),
    );

    const caught = await tonder.pay(payInput()).catch((error) => error);

    expect(caught).toBeInstanceOf(AppError);
    expect(caught.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });
});
