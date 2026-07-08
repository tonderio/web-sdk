import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { AcquirerPort } from './ports/acquirer.port';
import type { TokenizerPort } from './ports/tokenizer.port';
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

/** Config WITHOUT a customer — used to assert the pay() MISSING_CUSTOMER guard. */
const CONFIG_NO_CUSTOMER: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

const COF_CONFIG: TonderConfig = {
  ...CONFIG,
  session: { ...CONFIG.session, secure_token: 'secure_abc' },
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

function makeCofBusinessConfig(): BusinessConfig {
  return {
    ...makeBusinessConfig(),
    business: { ...makeBusinessConfig().business, pk: 7 },
    cardonfile_keys: { public_key: 'cof_pub' },
  };
}

function mockAcquirer(): {
  acquirer: AcquirerPort;
  subscriptionSpy: ReturnType<typeof vi.fn>;
} {
  const subscriptionSpy = vi.fn(() =>
    Promise.resolve({ subscriptionId: 'sub_123' }),
  );
  return {
    acquirer: { createCofSubscription: subscriptionSpy },
    subscriptionSpy,
  };
}

function mockCofHttp(
  processImpl: HttpPort['request'] = () => Promise.resolve(backendResponse()),
  options: {
    savedCardSubscriptionId?: string | null;
    cofActive?: boolean;
    transactionResponse?: BackendTransactionResponse;
  } = {},
): {
  http: HttpPort;
  processSpy: ReturnType<typeof vi.fn>;
  customerSpy: ReturnType<typeof vi.fn>;
  cardSaveSpy: ReturnType<typeof vi.fn>;
  cardRemoveSpy: ReturnType<typeof vi.fn>;
  cardListSpy: ReturnType<typeof vi.fn>;
} {
  const processSpy = vi.fn(processImpl);
  const customerSpy = vi.fn(() =>
    Promise.resolve({ id: 42, auth_token: 'cust_tok_1' }),
  );
  const cardSaveSpy = vi.fn(() =>
    Promise.resolve({
      skyflow_id: 'sky_1',
      user_id: 'u_1',
      card_bin: '411111',
    }),
  );
  const cardRemoveSpy = vi.fn(() => Promise.resolve({ message: 'removed' }));
  const cardListSpy = vi.fn(() =>
    Promise.resolve({
      user_id: 'u_1',
      cards: [
        {
          fields: {
            skyflow_id: 'card_abc',
            card_number: 'XXXX-XXXX-XXXX-1234',
            expiration_month: '12',
            expiration_year: '2030',
            card_scheme: 'visa',
            subscription_id: options.savedCardSubscriptionId ?? null,
          },
        },
      ],
    }),
  );
  const http: HttpPort = {
    request: vi.fn(<T>(request: Parameters<HttpPort['request']>[0]) => {
      if (request.path === '/api/v1/process/') {
        return processSpy(request) as Promise<T>;
      }
      if (request.path === '/api/v1/customer/') {
        return customerSpy(request) as Promise<T>;
      }
      if (
        request.method === 'GET' &&
        request.path === '/api/v1/business/7/cards/'
      ) {
        return cardListSpy(request) as Promise<T>;
      }
      if (
        request.method === 'POST' &&
        request.path === '/api/v1/business/7/cards/'
      ) {
        return cardSaveSpy(request) as Promise<T>;
      }
      if (
        request.method === 'DELETE' &&
        request.path === '/api/v1/business/7/cards/sky_1/'
      ) {
        return cardRemoveSpy(request) as Promise<T>;
      }
      if (request.path.startsWith('/api/v1/transactions/')) {
        return Promise.resolve(
          (options.transactionResponse ?? backendResponse()) as unknown as T,
        );
      }
      const business =
        options.cofActive === false
          ? {
              ...makeBusinessConfig(),
              business: { ...makeBusinessConfig().business, pk: 7 },
            }
          : makeCofBusinessConfig();
      return Promise.resolve(business as unknown as T);
    }),
  };
  return {
    http,
    processSpy,
    customerSpy,
    cardSaveSpy,
    cardRemoveSpy,
    cardListSpy,
  };
}

async function readyCofTonder(
  http: HttpPort,
  tokenizer: TokenizerPort,
  acquirer: AcquirerPort = mockAcquirer().acquirer,
  config: TonderConfig = COF_CONFIG,
): Promise<ReturnType<typeof _createTonderWithDeps>> {
  const tonder = _createTonderWithDeps({ config, http, tokenizer, acquirer });
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

function mockTokenizer(
  collectImpl: () => Promise<Record<string, string>> = () =>
    Promise.resolve(SNAKE_TOKENS),
): TokenizerPort & { collect: ReturnType<typeof vi.fn> } {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(collectImpl),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

/** HTTP mock: business GET first (init), then the /process POST routed by path. */
function mockHttp(processImpl: HttpPort['request']): {
  http: HttpPort;
  processSpy: ReturnType<typeof vi.fn>;
} {
  const processSpy = vi.fn(processImpl);
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/process/') {
        return processSpy(options) as Promise<T>;
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
  return { http, processSpy };
}

/**
 * HTTP mock for the embedded 3DS flow: /process returns `processResponse`, the
 * GET /transactions/{id}/ poll returns `transactionResponse`, init returns the
 * business config.
 */
function mock3dsHttp(
  processResponse: BackendTransactionResponse,
  transactionResponse: BackendTransactionResponse,
): HttpPort {
  return {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/process/') {
        return Promise.resolve(processResponse as unknown as T);
      }
      if (options.path.startsWith('/api/v1/transactions/')) {
        return Promise.resolve(transactionResponse as unknown as T);
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
}

function completingMessenger(): CheckoutMessengerPort {
  return {
    waitForCompletion: vi.fn(() => Promise.resolve()),
  };
}

function mockHost(): {
  redirect: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  return { redirect: vi.fn(), open: vi.fn(), close: vi.fn() };
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

async function readyTonder(
  http: HttpPort,
  tokenizer: TokenizerPort,
): Promise<ReturnType<typeof _createTonderWithDeps>> {
  const tonder = _createTonderWithDeps({ config: CONFIG, http, tokenizer });
  await tonder.init();
  return tonder;
}

describe('Tonder.pay — PayInput has no customer field (type-level)', () => {
  it('passing a customer field on the pay input is a compile-time error', () => {
    const input: PayInput = {
      amount: 150,
      payment_method: { type: 'card' },
      client_reference: 'order_123',
      // @ts-expect-error — PayInput must NOT accept a customer field; it is
      // sourced exclusively from config.session.customer.
      customer: { name: 'Ada', email: 'ada@example.com' },
    };

    // Runtime shape is irrelevant here; the assertion is the @ts-expect-error
    // above. Reference `input` so it is not flagged as unused.
    expect(input.amount).toBe(150);
  });
});

describe('Tonder.pay — customer is config-only (MISSING_CUSTOMER pre-flight)', () => {
  const PAYMENT_METHODS: PayInput['payment_method'][] = [
    { type: 'card' },
    { type: 'saved_card', card_id: 'card_abc' },
    { type: 'OXXOPAY' },
    { type: 'spei' },
  ];

  it.each(PAYMENT_METHODS)(
    'without config.session.customer → throws MISSING_CUSTOMER before ANY network /process call (%o)',
    async (payment_method) => {
      const { http, processSpy } = mockHttp(() =>
        Promise.resolve(backendResponse()),
      );
      const tonder = _createTonderWithDeps({
        config: CONFIG_NO_CUSTOMER,
        http,
        tokenizer: mockTokenizer(),
      });
      await tonder.init();

      const err = await tonder
        .pay(payInput({ payment_method }))
        .catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(ErrorKeyEnum.MISSING_CUSTOMER);
      expect(processSpy).not.toHaveBeenCalled();
    },
  );

  it('MISSING_CUSTOMER precedes INVALID_PAYMENT_REQUEST when amount is also invalid', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = _createTonderWithDeps({
      config: CONFIG_NO_CUSTOMER,
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    // Both the customer AND the amount are invalid. The customer guard must win.
    const err = await tonder.pay(payInput({ amount: 0 })).catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.MISSING_CUSTOMER);
    expect(processSpy).not.toHaveBeenCalled();
  });
});

describe('Tonder.pay — /process customer name derivation', () => {
  async function payWithCustomer(
    customer: NonNullable<TonderConfig['session']>['customer'],
  ): Promise<Record<string, unknown>> {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG_NO_CUSTOMER, session: { customer } },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(payInput());

    return processSpy.mock.calls[0][0].body.customer as Record<string, unknown>;
  }

  it('firstName + lastName → name is "First Last", only { name, email } sent (no phone)', async () => {
    const sent = await payWithCustomer({
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+5215555555555',
    });

    expect(sent).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(sent).not.toHaveProperty('phone');
  });

  it('firstName only → name is "First"', async () => {
    const sent = await payWithCustomer({
      email: 'ada@example.com',
      first_name: 'Ada',
    });

    expect(sent).toEqual({ name: 'Ada', email: 'ada@example.com' });
  });

  it('lastName only → name is "Last"', async () => {
    const sent = await payWithCustomer({
      email: 'ada@example.com',
      last_name: 'Lovelace',
    });

    expect(sent).toEqual({ name: 'Lovelace', email: 'ada@example.com' });
  });

  it('neither firstName nor lastName → name is an empty string', async () => {
    const sent = await payWithCustomer({ email: 'ada@example.com' });

    expect(sent).toEqual({ name: '', email: 'ada@example.com' });
  });
});

describe('Tonder.pay — happy paths', () => {
  it('success → bare RawTransaction (no wrapper, amount coerced to number)', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse({ client_reference: 'ref-1' })),
    );
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(http, tokenizer);

    const result = await tonder.pay(payInput());

    // Bare transaction: the result IS the transaction, no { outcome, transaction }.
    expect(result).toEqual({
      id: 'tx_1',
      operation_type: 'payment',
      status: 'Authorized',
      amount: 150,
      currency: 'MXN',
      client_reference: 'ref-1',
    });
    expect('outcome' in result).toBe(false);
    expect('transaction' in result).toBe(false);
    expect(typeof result.amount).toBe('number');
    expect(tokenizer.collect).toHaveBeenCalledTimes(1);
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/process/',
        headers: {},
        body: expect.objectContaining({
          operation_type: 'payment',
          amount: 150,
          currency: 'MXN',
          return_url: 'https://merchant.example/return',
          customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
          payment_method: {
            type: 'CARD',
            card_number: 'tok_cn',
            cvv: 'tok_cvv',
            expiration_month: 'tok_m',
            expiration_year: 'tok_y',
            cardholder_name: 'tok_name',
          },
          client_reference: 'order_123',
        }),
      }),
    );
  });

  it('sends idempotency_key as a business-scoped X-Request-Id without putting it in the body', async () => {
    const { http, processSpy, cardSaveSpy } = mockCofHttp(
      () => Promise.resolve(backendResponse()),
      { cofActive: false },
    );
    const tokenizer = mockTokenizer();
    const tonder = await readyCofTonder(
      http,
      tokenizer,
      mockAcquirer().acquirer,
      COF_CONFIG,
    );

    await tonder.pay(payInput({ idempotency_key: ' idem-order-123 ' }));

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'X-Request-Id': '7_idem-order-123',
        },
        body: expect.not.objectContaining({
          idempotency_key: expect.anything(),
        }),
      }),
    );
  });

  it('defaults currency to MXN when omitted', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    await tonder.pay(payInput({ currency: undefined }));

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ currency: 'MXN' }),
      }),
    );
  });

  it('decline (body status Declined, HTTP 200) → bare RawTransaction carrying decline_code/decline_reason, NOT thrown', async () => {
    const { http } = mockHttp(() =>
      Promise.resolve(
        backendResponse({
          status: 'Declined',
          decline_code: 'insufficient_funds',
          decline_reason: 'Not enough funds',
        }),
      ),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    const result = await tonder.pay(payInput());

    expect(result.status).toBe('Declined');
    expect(result.decline_code).toBe('insufficient_funds');
    expect(result.decline_reason).toBe('Not enough funds');
    expect('outcome' in result).toBe(false);
  });

  it('redirect-mode 3DS (next_action present) → bare raw /process transaction (status Pending, carries next_action)', async () => {
    const { http } = mockHttp(() => Promise.resolve(requiresActionResponse()));
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http,
      tokenizer: mockTokenizer(),
      host,
      messenger: completingMessenger(),
    });
    await tonder.init();

    const result = await tonder.pay(payInput());

    // The bare raw /process transaction, returned before the host navigates.
    expect(result.id).toBe('tx_1');
    expect(result.status).toBe('Pending');
    expect(result.next_action).toEqual({
      redirect_to_url: {
        url: 'https://3ds.example/go',
        verify_transaction_status_url: 'https://api.example/verify',
      },
    });
    expect('outcome' in result).toBe(false);
    expect('transactionId' in result).toBe(false);
    expect('nextAction' in result).toBe(false);
  });

  it('resets mounted new-card fields after an Authorized card payment', async () => {
    const { http } = mockHttp(() => Promise.resolve(backendResponse()));
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(http, tokenizer);
    const cardFields = tonder.create('card_fields');

    await cardFields.mount();
    await tonder.pay(payInput());

    expect(tokenizer.unmount).toHaveBeenCalledWith('create');
    expect(tokenizer.mount).toHaveBeenCalledTimes(2);
  });

  it('keeps mounted new-card fields after a declined card payment', async () => {
    const { http } = mockHttp(() =>
      Promise.resolve(backendResponse({ status: 'Declined' })),
    );
    const tokenizer = mockTokenizer();
    const tonder = await readyTonder(http, tokenizer);
    const cardFields = tonder.create('card_fields');

    await cardFields.mount();
    await tonder.pay(payInput());

    expect(tokenizer.unmount).not.toHaveBeenCalled();
    expect(tokenizer.mount).toHaveBeenCalledTimes(1);
  });
});

describe('Tonder.pay — COF-active new-card auto enrollment', () => {
  it('enrolls before /process, collects once, then charges the enrolled saved-card token', async () => {
    const { http, processSpy, customerSpy, cardSaveSpy } = mockCofHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tokenizer = mockTokenizer();
    const { acquirer, subscriptionSpy } = mockAcquirer();
    const tonder = await readyCofTonder(http, tokenizer, acquirer);

    const result = await tonder.pay(payInput());

    expect(result.status).toBe('Authorized');
    expect(tokenizer.collect).toHaveBeenCalledTimes(1);
    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(cardSaveSpy).toHaveBeenCalledTimes(2);
    expect(subscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'cof_pub',
        cardBin: '411111',
        customerId: 'cust_tok_1',
        currency: 'MXN',
        contact: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
      }),
    );
    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(cardSaveSpy.mock.invocationCallOrder[1]).toBeLessThan(
      processSpy.mock.invocationCallOrder[0],
    );
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          payment_method: { type: 'CARD', token: 'sky_1' },
        }),
      }),
    );
  });

  it('/process payload is token-only and excludes raw card fields plus client COF fields', async () => {
    const { http, processSpy } = mockCofHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = await readyCofTonder(http, mockTokenizer());

    await tonder.pay(payInput({ metadata: { order: 'ord_1' } }));

    const body = processSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(body.payment_method).toEqual({ type: 'CARD', token: 'sky_1' });
    expect(body.payment_method).not.toHaveProperty('card_number');
    expect(body.payment_method).not.toHaveProperty('cvv');
    expect(body.payment_method).not.toHaveProperty('expiration_month');
    expect(body.payment_method).not.toHaveProperty('expiration_year');
    expect(body.payment_method).not.toHaveProperty('cardholder_name');
    expect(body).not.toHaveProperty('enable_card_on_file');
    expect(body).not.toHaveProperty('subscription_id');
  });

  it('non-COF pay(card) remains raw-card and does not enroll', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tokenizer = mockTokenizer();
    const { acquirer, subscriptionSpy } = mockAcquirer();
    const tonder = _createTonderWithDeps({
      config: COF_CONFIG,
      http,
      tokenizer,
      acquirer,
    });
    await tonder.init();

    await tonder.pay(payInput());

    expect(tokenizer.collect).toHaveBeenCalledTimes(1);
    expect(subscriptionSpy).not.toHaveBeenCalled();
    expect(processSpy.mock.calls[0][0].body.payment_method).toEqual({
      type: 'CARD',
      card_number: 'tok_cn',
      cvv: 'tok_cvv',
      expiration_month: 'tok_m',
      expiration_year: 'tok_y',
      cardholder_name: 'tok_name',
    });
  });

  it('pay(saved_card) with COF and subscription_id charges token without collecting CVV', async () => {
    const { http, processSpy, customerSpy, cardSaveSpy, cardListSpy } =
      mockCofHttp(() => Promise.resolve(backendResponse()), {
        savedCardSubscriptionId: 'sub_abc',
      });
    const tokenizer = mockTokenizer();
    const { acquirer, subscriptionSpy } = mockAcquirer();
    const tonder = await readyCofTonder(http, tokenizer, acquirer);

    await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(cardListSpy).toHaveBeenCalledTimes(1);
    expect(tokenizer.collect).not.toHaveBeenCalled();
    expect(cardSaveSpy).not.toHaveBeenCalled();
    expect(subscriptionSpy).not.toHaveBeenCalled();
    expect(processSpy.mock.calls[0][0].body.payment_method).toEqual({
      type: 'CARD',
      token: 'card_abc',
    });
  });

  it('pay(saved_card) with COF but no subscription_id collects saved-card CVV, enrolls, saves subscription_id, then charges token', async () => {
    const { http, processSpy, cardSaveSpy, cardListSpy } = mockCofHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tokenizer = mockTokenizer();
    const { acquirer, subscriptionSpy } = mockAcquirer();
    const tonder = await readyCofTonder(http, tokenizer, acquirer);

    await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(cardListSpy).toHaveBeenCalledTimes(1);
    expect(tokenizer.collect).toHaveBeenCalledWith('update:card_abc');
    expect(cardSaveSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ body: { skyflow_id: 'card_abc' } }),
    );
    expect(subscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'cof_pub',
        cardBin: '411111',
        customerId: 'cust_tok_1',
        cardTokens: {
          name: 'tok_name',
          number: 'tok_cn',
          expiryMonth: 'tok_m',
          expiryYear: 'tok_y',
          cvv: 'tok_cvv',
        },
      }),
    );
    expect(cardSaveSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: { skyflow_id: 'card_abc', subscription_id: 'sub_123' },
      }),
    );
    expect(processSpy.mock.calls[0][0].body.payment_method).toEqual({
      type: 'CARD',
      token: 'card_abc',
    });
  });

  it('process transport failure after auto-enrollment removes the just-enrolled card and rethrows PAYMENT_PROCESS_ERROR', async () => {
    const { http, cardRemoveSpy } = mockCofHttp(() =>
      Promise.reject(new Error('network down')),
    );
    const tonder = await readyCofTonder(http, mockTokenizer());

    const err = await tonder.pay(payInput()).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
    expect(cardRemoveSpy).toHaveBeenCalledTimes(1);
    expect(cardRemoveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: '/api/v1/business/7/cards/sky_1/',
        headers: {
          Authorization: 'Bearer secure_abc',
          'User-Token': 'cust_tok_1',
        },
      }),
    );
  });

  it('declined transaction body does not remove the auto-enrolled card', async () => {
    const { http, cardRemoveSpy } = mockCofHttp(() =>
      Promise.resolve(
        backendResponse({
          status: 'Declined',
          decline_code: 'do_not_honor',
          decline_reason: 'Do not honor',
        }),
      ),
    );
    const tonder = await readyCofTonder(http, mockTokenizer());

    const result = await tonder.pay(payInput());

    expect(result.status).toBe('Declined');
    expect(result.decline_code).toBe('do_not_honor');
    expect(cardRemoveSpy).not.toHaveBeenCalled();
  });

  it('pending embedded 3DS poll failure does not remove the auto-enrolled card', async () => {
    const host = mockHost();
    const { cardRemoveSpy, http } = mockCofHttp((options) => {
      if (options.path === '/api/v1/process/') {
        return Promise.resolve(requiresActionResponse());
      }
      return Promise.resolve(backendResponse());
    });
    const requestSpy = http.request as ReturnType<typeof vi.fn>;
    requestSpy.mockImplementation(
      <T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/api/v1/process/') {
          return Promise.resolve(requiresActionResponse() as unknown as T);
        }
        if (options.path === '/api/v1/customer/') {
          return Promise.resolve({
            id: 42,
            auth_token: 'cust_tok_1',
          } as unknown as T);
        }
        if (
          options.method === 'POST' &&
          options.path === '/api/v1/business/7/cards/'
        ) {
          return Promise.resolve({
            skyflow_id: 'sky_1',
            user_id: 'u_1',
            card_bin: '411111',
          } as unknown as T);
        }
        if (
          options.method === 'DELETE' &&
          options.path === '/api/v1/business/7/cards/sky_1/'
        ) {
          cardRemoveSpy(options);
          return Promise.resolve({ message: 'removed' } as unknown as T);
        }
        if (options.path.startsWith('/api/v1/transactions/')) {
          return Promise.reject(
            new AppError({ errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR }),
          );
        }
        return Promise.resolve(makeCofBusinessConfig() as unknown as T);
      },
    );
    const tonder = _createTonderWithDeps({
      config: { ...COF_CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
      acquirer: mockAcquirer().acquirer,
      host,
      messenger: completingMessenger(),
    });
    await tonder.init();

    const err = await tonder.pay(payInput()).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(cardRemoveSpy).not.toHaveBeenCalled();
  });
});

describe('Tonder.pay — saved card', () => {
  it('charges a non-COF saved card after collecting saved-card CVV and saving the card', async () => {
    const { http, processSpy, cardSaveSpy } = mockCofHttp(
      () => Promise.resolve(backendResponse()),
      { cofActive: false },
    );
    const tokenizer = mockTokenizer();
    const tonder = await readyCofTonder(
      http,
      tokenizer,
      mockAcquirer().acquirer,
      COF_CONFIG,
    );

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(result.status).toBe('Authorized');
    expect(tokenizer.collect).toHaveBeenCalledWith('update:card_abc');
    expect(cardSaveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: { skyflow_id: 'card_abc' } }),
    );
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/process/',
        headers: {},
        body: expect.objectContaining({
          operation_type: 'payment',
          amount: 150,
          currency: 'MXN',
          return_url: 'https://merchant.example/return',
          customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
          payment_method: { type: 'CARD', token: 'card_abc' },
          client_reference: 'order_123',
        }),
      }),
    );
  });

  it('charges a COF saved card with subscription_id by token without collecting', async () => {
    const { http, processSpy } = mockCofHttp(
      () => Promise.resolve(backendResponse()),
      { savedCardSubscriptionId: 'sub_abc' },
    );
    const tokenizer = mockTokenizer();
    const tonder = await readyCofTonder(http, tokenizer);

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(result.status).toBe('Authorized');
    expect(tokenizer.collect).not.toHaveBeenCalled();
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/process/',
        body: expect.objectContaining({
          payment_method: { type: 'CARD', token: 'card_abc' },
        }),
      }),
    );
  });

  it('decline on a saved card → bare RawTransaction (status Declined), NOT thrown', async () => {
    const { http } = mockCofHttp(
      () =>
        Promise.resolve(
          backendResponse({
            status: 'Declined',
            decline_code: 'do_not_honor',
            decline_reason: 'Do not honor',
          }),
        ),
      { savedCardSubscriptionId: 'sub_abc' },
    );
    const tonder = await readyCofTonder(http, mockTokenizer());

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(result.status).toBe('Declined');
  });

  it('next_action on a saved card (3DS, redirect) → bare Pending transaction', async () => {
    const { http } = mockCofHttp(
      () => Promise.resolve(requiresActionResponse()),
      { savedCardSubscriptionId: 'sub_abc' },
    );
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: COF_CONFIG,
      http,
      tokenizer: mockTokenizer(),
      host,
    });
    await tonder.init();

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(result.status).toBe('Pending');
    expect(result.next_action).toBeDefined();
  });

  it('missing card_id → INVALID_PAYMENT_REQUEST (no process call)', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    const err = await tonder
      .pay(payInput({ payment_method: { type: 'saved_card', card_id: '' } }))
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('saved_card with whitespace-only card_id → INVALID_PAYMENT_REQUEST', async () => {
    const tonder = await readyTonder(
      mockHttp(() => Promise.resolve(backendResponse())).http,
      mockTokenizer(),
    );

    const err = await tonder
      .pay(payInput({ payment_method: { type: 'saved_card', card_id: '   ' } }))
      .catch((e) => e);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
  });
});

describe('Tonder.pay — errors are thrown as AppError', () => {
  it('before ready → throws NOT_INITIALIZED', async () => {
    const { http } = mockHttp(() => Promise.resolve(backendResponse()));
    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http,
      tokenizer: mockTokenizer(),
    });

    const err = await tonder.pay(payInput()).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
  });

  it('amount <= 0 → INVALID_PAYMENT_REQUEST', async () => {
    const tonder = await readyTonder(
      mockHttp(() => Promise.resolve(backendResponse())).http,
      mockTokenizer(),
    );

    const err = await tonder.pay(payInput({ amount: 0 })).catch((e) => e);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
  });

  it('unknown non-card payment method type passes through as direct method code', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    await tonder.pay(payInput({ payment_method: { type: 'wallet' } }));

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ payment_method: { type: 'wallet' } }),
      }),
    );
  });

  it('tokenizer.collect rejects → throws AppError(PAYMENT_PROCESS_ERROR)', async () => {
    const tokenizer = mockTokenizer(() =>
      Promise.reject(
        new AppError({ errorCode: ErrorKeyEnum.MOUNT_COLLECT_ERROR }),
      ),
    );
    const tonder = await readyTonder(
      mockHttp(() => Promise.resolve(backendResponse())).http,
      tokenizer,
    );

    const err = await tonder.pay(payInput()).catch((e) => e);
    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });

  it('http transport failure → throws AppError(PAYMENT_PROCESS_ERROR)', async () => {
    const { http } = mockHttp(() =>
      Promise.reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_FAILED })),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    const err = await tonder.pay(payInput()).catch((e) => e);
    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });
});

describe('Tonder.pay — 3DS body shape (no embedded_completion flag)', () => {
  it('presentationMode embedded → /process body does NOT include embedded_completion', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(payInput());

    const body = processSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('embedded_completion');
  });

  it('presentationMode redirect → embedded_completion key ABSENT from body', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'redirect' },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(payInput());

    const body = processSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('embedded_completion');
  });

  it('presentationMode unset → embedded_completion key ABSENT from body', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    await tonder.pay(payInput());

    const body = processSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('embedded_completion');
  });

  it('REGRESSION: card body shape otherwise unchanged with presentationMode embedded', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(backendResponse()),
    );
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(payInput());

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          operation_type: 'payment',
          amount: 150,
          currency: 'MXN',
          return_url: 'https://merchant.example/return',
          customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
          payment_method: {
            type: 'CARD',
            card_number: 'tok_cn',
            cvv: 'tok_cvv',
            expiration_month: 'tok_m',
            expiration_year: 'tok_y',
            cardholder_name: 'tok_name',
          },
        }),
      }),
    );
  });

  it('REGRESSION: saved-card body shape unchanged regardless of presentationMode embedded', async () => {
    const { http, processSpy } = mockCofHttp(
      () => Promise.resolve(backendResponse()),
      { savedCardSubscriptionId: 'sub_abc' },
    );
    const tonder = _createTonderWithDeps({
      config: { ...COF_CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(
      payInput({ payment_method: { type: 'saved_card', card_id: 'card_abc' } }),
    );

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          payment_method: { type: 'CARD', token: 'card_abc' },
        }),
      }),
    );
  });
});

describe('Tonder.pay — 3DS presentation (presentationMode)', () => {
  async function readyTonderWithHost(
    config: TonderConfig,
    http: HttpPort,
    host: ReturnType<typeof mockHost>,
  ): Promise<ReturnType<typeof _createTonderWithDeps>> {
    const tonder = _createTonderWithDeps({
      config,
      http,
      tokenizer: mockTokenizer(),
      host,
      messenger: completingMessenger(),
    });
    await tonder.init();
    return tonder;
  }

  describe('redirect mode (default)', () => {
    it('requires_action → host.redirect(url) called, open NOT called, returns bare Pending transaction', async () => {
      const { http } = mockHttp(() =>
        Promise.resolve(requiresActionResponse()),
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(CONFIG, http, host);

      const result = await tonder.pay(payInput());

      expect(host.redirect).toHaveBeenCalledWith('https://3ds.example/go');
      expect(host.open).not.toHaveBeenCalled();
      expect(result.id).toBe('tx_1');
      expect(result.status).toBe('Pending');
      expect(result.next_action).toEqual({
        redirect_to_url: {
          url: 'https://3ds.example/go',
          verify_transaction_status_url: 'https://api.example/verify',
        },
      });
    });

    it('saved_card + requires_action → host.redirect called', async () => {
      const { http } = mockCofHttp(
        () => Promise.resolve(requiresActionResponse()),
        { savedCardSubscriptionId: 'sub_abc' },
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(COF_CONFIG, http, host);

      await tonder.pay(
        payInput({
          payment_method: { type: 'saved_card', card_id: 'card_abc' },
        }),
      );

      expect(host.redirect).toHaveBeenCalledWith('https://3ds.example/go');
    });
  });

  describe('embedded mode', () => {
    const EMBEDDED_CONFIG: TonderConfig = {
      ...CONFIG,
      presentation_mode: 'embedded',
    };

    it('requires_action → open(url, { closable: false }), completion signal reconciles final success transaction', async () => {
      const http = mock3dsHttp(
        requiresActionResponse(),
        backendResponse({ status: 'Authorized' }),
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(EMBEDDED_CONFIG, http, host);

      const result = await tonder.pay(payInput());

      expect(host.open).toHaveBeenCalledWith(
        'https://3ds.example/go',
        expect.objectContaining({ closable: false }),
      );
      expect(host.close).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('tx_1');
      expect(result.status).toBe('Authorized');
      expect('outcome' in result).toBe(false);
    });

    it('requires_action → declined final status resolves the declined transaction (after close)', async () => {
      const http = mock3dsHttp(
        requiresActionResponse(),
        backendResponse({
          status: 'Declined',
          decline_code: 'do_not_honor',
          decline_reason: 'Do not honor',
        }),
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(EMBEDDED_CONFIG, http, host);

      const result = await tonder.pay(payInput());

      expect(host.close).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('Declined');
      expect(result.decline_code).toBe('do_not_honor');
    });

    it('saved_card + requires_action → open + completion signal + close', async () => {
      const { http } = mockCofHttp(
        () => Promise.resolve(requiresActionResponse()),
        {
          savedCardSubscriptionId: 'sub_abc',
          transactionResponse: backendResponse({ status: 'Authorized' }),
        },
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(
        { ...COF_CONFIG, presentation_mode: 'embedded' },
        http,
        host,
      );

      const result = await tonder.pay(
        payInput({
          payment_method: { type: 'saved_card', card_id: 'card_abc' },
        }),
      );

      expect(host.open).toHaveBeenCalledTimes(1);
      expect(host.close).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('Authorized');
    });

    it('post-signal reconcile failure → close then rethrow AppError', async () => {
      const host = mockHost();
      const http: HttpPort = {
        request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
          if (options.path === '/api/v1/process/') {
            return Promise.resolve(requiresActionResponse() as unknown as T);
          }
          if (options.path.startsWith('/api/v1/transactions/')) {
            return Promise.reject(
              new AppError({ errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR }),
            );
          }
          return Promise.resolve(makeBusinessConfig() as unknown as T);
        }),
      };
      const tonder = await readyTonderWithHost(EMBEDDED_CONFIG, http, host);

      const err = await tonder.pay(payInput()).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
      expect(host.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('no action (regression)', () => {
    it('success result → no host call', async () => {
      const { http } = mockHttp(() => Promise.resolve(backendResponse()));
      const host = mockHost();
      const tonder = await readyTonderWithHost(CONFIG, http, host);

      const result = await tonder.pay(payInput());

      expect(result.status).toBe('Authorized');
      expect(host.redirect).not.toHaveBeenCalled();
      expect(host.open).not.toHaveBeenCalled();
    });

    it('declined result → no host call', async () => {
      const { http } = mockHttp(() =>
        Promise.resolve(backendResponse({ status: 'Declined' })),
      );
      const host = mockHost();
      const tonder = await readyTonderWithHost(CONFIG, http, host);

      const result = await tonder.pay(payInput());

      expect(result.status).toBe('Declined');
      expect(host.redirect).not.toHaveBeenCalled();
      expect(host.open).not.toHaveBeenCalled();
    });
  });
});

/**
 * HTTP mock for APM/SPEI flows. `/process` returns `processResponse`; any
 * `/transactions/` GET (a poll) is tracked via `pollSpy` so tests can assert it
 * is NEVER called for a pending result; init returns the business config.
 */
function mockApmHttp(processResponse: BackendTransactionResponse): {
  http: HttpPort;
  pollSpy: ReturnType<typeof vi.fn>;
  processSpy: ReturnType<typeof vi.fn>;
} {
  const pollSpy = vi.fn();
  const processSpy = vi.fn();
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/process/') {
        processSpy(options);
        return Promise.resolve(processResponse as unknown as T);
      }
      if (options.path.startsWith('/api/v1/transactions/')) {
        pollSpy();
        return Promise.resolve(processResponse as unknown as T);
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
  return { http, pollSpy, processSpy };
}

function apmRedirectResponse(): BackendTransactionResponse {
  return backendResponse({
    status: 'Pending',
    next_action: { redirect_to_url: { url: 'https://apm.example/go' } },
  });
}

function apmInstructionsResponse(): BackendTransactionResponse {
  return backendResponse({
    status: 'Pending',
    payment_instructions: { reference: 'OXXO-123' },
  });
}

describe('Tonder.pay — APM input validation', () => {
  it('legacy apm wrapper → INVALID_PAYMENT_REQUEST (no process call)', async () => {
    const { http, processSpy } = mockHttp(() =>
      Promise.resolve(apmInstructionsResponse()),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    const err = await tonder
      .pay(
        payInput({
          payment_method: {
            type: 'apm',
          } as unknown as PayInput['payment_method'],
        }),
      )
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('empty payment method type → INVALID_PAYMENT_REQUEST', async () => {
    const { http } = mockHttp(() => Promise.resolve(apmInstructionsResponse()));
    const tonder = await readyTonder(http, mockTokenizer());

    const err = await tonder
      .pay(payInput({ payment_method: { type: '   ' } }))
      .catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
  });

  it.each(['country', 'channel', 'bank_ids'])(
    'safetypaycash missing config.%s → INVALID_APM_CONFIG',
    async (missing) => {
      const fullConfig: Record<string, unknown> = {
        country: 'MX',
        channel: 'cash',
        bank_ids: [1],
      };
      delete fullConfig[missing];
      const { http, processSpy } = mockHttp(() =>
        Promise.resolve(apmInstructionsResponse()),
      );
      const tonder = await readyTonder(http, mockTokenizer());

      const err = await tonder
        .pay(
          payInput({
            payment_method: {
              type: 'safetypaycash',
              config: fullConfig,
            },
          }),
        )
        .catch((e) => e);

      expect(err.code).toBe(ErrorKeyEnum.INVALID_APM_CONFIG);
      expect(processSpy).not.toHaveBeenCalled();
    },
  );

  it('safetypaycash with no config → INVALID_APM_CONFIG', async () => {
    const { http } = mockHttp(() => Promise.resolve(apmInstructionsResponse()));
    const tonder = await readyTonder(http, mockTokenizer());

    const err = await tonder
      .pay(payInput({ payment_method: { type: 'safetypaycash' } }))
      .catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.INVALID_APM_CONFIG);
  });

  it('non-SafetyPay APM (oxxopay) with no config passes through to /process', async () => {
    const { http, processSpy } = mockApmHttp(apmInstructionsResponse());
    const tonder = await readyTonder(http, mockTokenizer());

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'OXXOPAY' } }),
    );

    expect(result.status).toBe('Pending');
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          payment_method: { type: 'oxxopay' },
        }),
      }),
    );
  });
});

describe('Tonder.pay — APM/SPEI pending result (never polled)', () => {
  it('APM redirect with url → host.redirect once, NO poll, bare Pending transaction returned', async () => {
    const { http, pollSpy } = mockApmHttp(apmRedirectResponse());
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http,
      tokenizer: mockTokenizer(),
      host,
    });
    await tonder.init();

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'OXXOPAY' } }),
    );

    expect(host.redirect).toHaveBeenCalledTimes(1);
    expect(host.redirect).toHaveBeenCalledWith('https://apm.example/go');
    expect(host.open).not.toHaveBeenCalled();
    expect(pollSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('Pending');
    expect(result.next_action).toEqual({
      redirect_to_url: { url: 'https://apm.example/go' },
    });
  });

  it('APM embedded with url → open(closable:true), NO poll, modal LEFT open, bare Pending transaction returned', async () => {
    const { http, pollSpy } = mockApmHttp(apmRedirectResponse());
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
      host,
    });
    await tonder.init();

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'OXXOPAY' } }),
    );

    expect(host.open).toHaveBeenCalledWith(
      'https://apm.example/go',
      expect.objectContaining({ closable: true }),
    );
    expect(pollSpy).not.toHaveBeenCalled();
    // APMs settle async — the hosted page stays visible until the shopper
    // closes it via the modal's own X/Escape; pay() must NOT close it.
    expect(host.close).not.toHaveBeenCalled();
    expect(result.status).toBe('Pending');
  });

  it('APM embedded wires events.presentation.on_close as the modal onUserClose', async () => {
    const onClose = vi.fn();
    const { http } = mockApmHttp(apmRedirectResponse());
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: {
        ...CONFIG,
        presentation_mode: 'embedded',
        events: { presentation: { on_close: onClose } },
      },
      http,
      tokenizer: mockTokenizer(),
      host,
    });
    await tonder.init();

    await tonder.pay(payInput({ payment_method: { type: 'OXXOPAY' } }));

    const opts = host.open.mock.calls[0][1] as { onUserClose?: () => void };
    opts.onUserClose?.();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('APM instructions-only (no url) → no redirect, no open, no poll, bare Pending transaction with payment_instructions', async () => {
    const { http, pollSpy } = mockApmHttp(apmInstructionsResponse());
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
      host,
    });
    await tonder.init();

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'OXXOPAY' } }),
    );

    expect(host.redirect).not.toHaveBeenCalled();
    expect(host.open).not.toHaveBeenCalled();
    expect(host.close).not.toHaveBeenCalled();
    expect(pollSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('Pending');
    expect(result.payment_instructions).toEqual({ reference: 'OXXO-123' });
  });

  it('SPEI pay → NO poll, bare Pending transaction carrying clabe/bank_name, body payment_method is { type: spei }', async () => {
    const { http, pollSpy, processSpy } = mockApmHttp(
      backendResponse({
        status: 'Pending',
        clabe: '012345678901234567',
        bank_name: 'STP',
      }),
    );
    const tonder = await readyTonder(http, mockTokenizer());

    const result = await tonder.pay(
      payInput({ payment_method: { type: 'spei' } }),
    );

    expect(pollSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('Pending');
    expect(result.clabe).toBe('012345678901234567');
    expect(result.bank_name).toBe('STP');
    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ payment_method: { type: 'spei' } }),
      }),
    );
  });

  it('REGRESSION: APM body shape unchanged regardless of presentationMode', async () => {
    const { http, processSpy } = mockApmHttp(apmInstructionsResponse());
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    await tonder.pay(payInput({ payment_method: { type: 'OXXOPAY' } }));

    expect(processSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ payment_method: { type: 'oxxopay' } }),
      }),
    );
  });

  it('REGRESSION: card 3DS embedded still opens + reconciles to a non-pending result', async () => {
    const http = mock3dsHttp(
      requiresActionResponse(),
      backendResponse({ status: 'Authorized' }),
    );
    const host = mockHost();
    const tonder = _createTonderWithDeps({
      config: { ...CONFIG, presentation_mode: 'embedded' },
      http,
      tokenizer: mockTokenizer(),
      host,
      messenger: completingMessenger(),
    });
    await tonder.init();

    const result = await tonder.pay(payInput());

    expect(host.open).toHaveBeenCalledTimes(1);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('Authorized');
    expect(result.status).not.toBe('Pending');
  });
});
