import { describe, it, expect, vi } from 'vitest';
import {
  CORE_API_ROUTES,
  DirectApiService,
  isOperationsDisabled,
} from './direct-api.service';
import { asHttpPort } from '../../test-support/http.mock';
import type { ProcessPaymentBody } from './direct-api.service';
import { buildApplePayPaymentMethod } from '../strategies/apple-pay.strategy';
import type { BackendTransactionResponse } from '../../models/transaction.model';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const REQUEST_ID = 'idem_abc_123';

function makeBody(): ProcessPaymentBody {
  return {
    operation_type: 'payment',
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
    client_reference: 'order_123',
    payment_method: {
      type: 'CARD',
      card_number: 'tok_cn',
      cvv: 'tok_cvv',
      expiration_month: 'tok_m',
      expiration_year: 'tok_y',
      cardholder_name: 'tok_name',
    },
  };
}

function makeResponse(): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'Authorized',
    amount: '150.00',
    currency: 'MXN',
  };
}

describe('DirectApiService.processPayment', () => {
  it('POSTs the body to /api/v1/process/ with X-Request-Id only when a request id is provided and returns the raw response', async () => {
    const response = makeResponse();
    const spy = vi.fn().mockResolvedValue(response);
    const service = new DirectApiService({ request: spy });
    const body = makeBody();

    const result = await service.processPayment(body, REQUEST_ID);

    expect(result).toEqual(response);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/process/',
        body,
        headers: {
          'X-Request-Id': REQUEST_ID,
        },
      }),
    );
  });

  it('omits X-Request-Id when no idempotency key is provided', async () => {
    const spy = vi.fn().mockResolvedValue(makeResponse());
    const service = new DirectApiService({ request: spy });
    const body = makeBody();

    await service.processPayment(body, undefined);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/process/',
        body,
        headers: {},
      }),
    );
  });

  it('re-wraps a transport AppError as AppError(PAYMENT_PROCESS_ERROR)', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 502,
    });
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(inner)),
    );

    const err = await service
      .processPayment(makeBody(), REQUEST_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.PAYMENT_PROCESS_ERROR);
  });

  it('re-wraps an unknown rejection as AppError(PAYMENT_PROCESS_ERROR)', async () => {
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(new Error('boom'))),
    );

    await expect(
      service.processPayment(makeBody(), REQUEST_ID),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.PAYMENT_PROCESS_ERROR });
  });
});

describe('DirectApiService.getTransaction', () => {
  it('GETs /api/v1/transactions/{id}/ and returns the raw response', async () => {
    const response = makeResponse();
    const spy = vi.fn().mockResolvedValue(response);
    const service = new DirectApiService({ request: spy });

    const result = await service.getTransaction('tx_1');

    expect(result).toEqual(response);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/transactions/tx_1/',
      }),
    );
  });

  it('passes the AbortSignal through to HttpPort.request', async () => {
    const spy = vi.fn().mockResolvedValue(makeResponse());
    const service = new DirectApiService({ request: spy });
    const controller = new AbortController();

    await service.getTransaction('tx_1', controller.signal);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('re-wraps a transport AppError as AppError(FETCH_TRANSACTION_ERROR), preserving status_code', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(inner)),
    );

    const err = await service.getTransaction('tx_404').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
    expect(err.status_code).toBe(404);
  });

  it('re-wraps an unknown rejection as AppError(FETCH_TRANSACTION_ERROR)', async () => {
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(new Error('boom'))),
    );

    await expect(service.getTransaction('tx_1')).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
    });
  });
});

describe('DirectApiService.getPaymentMethodCatalog', () => {
  // Transport only. The service moves bytes and normalizes the paginated
  // envelope; projection into the merchant-facing shape, and the Apple Pay
  // filter, live in `models/payment-method.model.ts` and are tested there.
  function rawCatalog(): unknown {
    return [
      {
        id: '7',
        payment_method: 'oxxopay',
        priority: 10,
        category: 'cash',
      },
      {
        id: '9',
        payment_method: 'apple_pay_debit_card',
        priority: 1,
        category: 'wallet',
      },
    ];
  }

  it('GETs /transactions/v1/payment_methods?status=active and returns data[] RAW, unmapped, unfiltered', async () => {
    const spy = vi.fn().mockResolvedValue({ data: rawCatalog() });
    const service = new DirectApiService({ request: spy });

    const result = await service.getPaymentMethodCatalog();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/payment_methods?status=active',
      }),
    );
    expect(result).toEqual(rawCatalog());
  });

  it('reads the core list as it is, without pagination fields', async () => {
    const service = new DirectApiService({
      request: vi.fn().mockResolvedValue({ data: [] }),
    });

    await expect(service.getPaymentMethodCatalog()).resolves.toEqual([]);
  });

  it('refuses an answer that is not the core list', async () => {
    const service = new DirectApiService({
      request: vi.fn().mockResolvedValue('<html>'),
    });

    await expect(service.getPaymentMethodCatalog()).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR,
    });
  });

  it('re-wraps a transport failure as AppError(FETCH_PAYMENT_METHODS_ERROR)', async () => {
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(new Error('boom'))),
    );

    const err = await service.getPaymentMethodCatalog().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR);
  });
});

describe('DirectApiService.getPaymentMethodBanks', () => {
  function backendPaymentMethodBanks(): unknown {
    return {
      data: [
        {
          bank_id: 11,
          code: 'BC',
          name: 'Banco Cash',
          payment_type: 'cash',
          priority: 5,
          logo_url: 'https://logo/cash.png',
          country_name: 'Mexico',
          channels: ['WP'],
          limits: { min: '1.00', max: '100.00' },
          currency: 'MXN',
          locations_url: null,
        },
        {
          bank_id: 22,
          code: 'BT',
          name: 'Banco Transfer',
          payment_type: 'transfer',
          priority: 6,
          logo_url: null,
          country_name: 'Mexico',
          channels: ['OL'],
          limits: null,
          currency: 'MXN',
          locations_url: null,
        },
        {
          bank_id: 33,
          code: 'BX',
          name: 'Banco Other',
          payment_type: 'other',
          priority: 7,
          logo_url: null,
          country_name: 'Mexico',
          channels: [],
          limits: null,
          currency: 'MXN',
          locations_url: null,
        },
      ],
    };
  }

  it('GETs /transactions/v1/safetypay/banks with no key in the path and maps groups', async () => {
    const spy = vi.fn().mockResolvedValue(backendPaymentMethodBanks());
    const service = new DirectApiService({ request: spy });

    const result = await service.getPaymentMethodBanks();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/safetypay/banks',
      }),
    );
    expect(result.cash).toEqual([
      {
        id: 11,
        name: 'Banco Cash',
        code: 'BC',
        country: 'Mexico',
        channel: 'WP',
        logo: 'https://logo/cash.png',
      },
    ]);
    expect(result.transfer).toEqual([
      {
        id: 22,
        name: 'Banco Transfer',
        code: 'BT',
        country: 'Mexico',
        channel: 'OL',
      },
    ]);
    expect('logo' in result.transfer[0]).toBe(false);
  });

  it('answers empty groups for an empty list and refuses a body that is not the core list', async () => {
    const empty = new DirectApiService({
      request: vi.fn().mockResolvedValue({ data: [] }),
    });
    await expect(empty.getPaymentMethodBanks()).resolves.toEqual({
      cash: [],
      transfer: [],
    });

    const bad = new DirectApiService({
      request: vi.fn().mockResolvedValue({ cash: [] }),
    });
    await expect(bad.getPaymentMethodBanks()).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR,
    });
  });

  it('re-wraps a transport failure as AppError(FETCH_PAYMENT_METHOD_BANKS_ERROR)', async () => {
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(new Error('boom'))),
    );

    const err = await service.getPaymentMethodBanks().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR);
  });
});

describe('ProcessPaymentBody.payment_method — Apple Pay member', () => {
  it('forwards an APPLE_PAY payment-method block verbatim, token by reference', async () => {
    // `ApplePayPaymentMethod` is an EXPLICIT member of the union rather than
    // relying on `ApmPaymentMethod`'s structural `type: string` accident, which
    // would make the union a lie. That membership is enforced by
    // `npm run typecheck` at the compiled call site in the checkout service —
    // `*.test.ts` is excluded from `tsconfig.json`, so no assertion in this
    // file can prove it. What this test does prove is that the block, and the
    // opaque token inside it, reach `/process` untouched.
    const token = buildApplePayPaymentMethod({
      paymentData: { signature: 'sig' },
    } as unknown as Parameters<typeof buildApplePayPaymentMethod>[0]);
    const spy = vi.fn().mockResolvedValue(makeResponse());
    const service = new DirectApiService({ request: spy });
    const body: ProcessPaymentBody = {
      ...makeBody(),
      payment_method: token,
    };

    await service.processPayment(body);

    const sent = spy.mock.calls[0][0].body as ProcessPaymentBody;
    expect(sent).toBe(body);
    expect(sent.payment_method).toBe(token);
    expect(sent.payment_method).toEqual({
      type: 'APPLE_PAY',
      token: { paymentData: { signature: 'sig' } },
    });
  });
});

describe('DirectApiService on the transactions API routes', () => {
  it('POSTs to /transactions/v1/process and GETs /transactions/v1/{id}', async () => {
    const spy = vi.fn().mockResolvedValue(makeResponse());
    const service = new DirectApiService({ request: spy }, CORE_API_ROUTES);

    await service.processPayment(makeBody(), REQUEST_ID);
    await service.getTransaction('0190-abc');

    expect(spy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        path: '/transactions/v1/process',
        headers: { 'X-Request-Id': REQUEST_ID },
      }),
    );
    expect(spy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/0190-abc',
      }),
    );
  });

  it('keeps wrapping a transport failure as PAYMENT_PROCESS_ERROR / FETCH_TRANSACTION_ERROR', async () => {
    const service = new DirectApiService(
      { request: vi.fn().mockRejectedValue(new Error('boom')) },
      CORE_API_ROUTES,
    );

    await expect(service.processPayment(makeBody())).rejects.toMatchObject({
      code: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
    });
    await expect(service.getTransaction('x')).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
    });
  });
});

describe('isOperationsDisabled', () => {
  const disabled = new AppError({
    errorCode: ErrorKeyEnum.REQUEST_FAILED,
    status_code: 503,
    originalError: { error_code: 'operations_disabled' },
  });

  it('recognises the emergency-stop answer through the service wrapping', async () => {
    const service = new DirectApiService(
      { request: vi.fn().mockRejectedValue(disabled) },
      CORE_API_ROUTES,
    );

    const err = await service.processPayment(makeBody()).catch((e) => e);

    expect(isOperationsDisabled(err)).toBe(true);
  });

  it.each([500, 502, 504, 429])(
    'does not match a %s that carries the code (only a 503 is the stop)',
    async (status) => {
      const err = new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        status_code: status,
        originalError: { error_code: 'operations_disabled' },
      });
      const service = new DirectApiService(
        { request: vi.fn().mockRejectedValue(err) },
        CORE_API_ROUTES,
      );

      const wrapped = await service.processPayment(makeBody()).catch((e) => e);

      expect(isOperationsDisabled(err)).toBe(false);
      expect(isOperationsDisabled(wrapped)).toBe(false);
    },
  );

  it('recognises the code on the error itself, not only on its cause', () => {
    expect(
      isOperationsDisabled({
        status_code: 503,
        error_code: 'operations_disabled',
      }),
    ).toBe(true);
    expect(
      isOperationsDisabled({
        status_code: 500,
        error_code: 'operations_disabled',
      }),
    ).toBe(false);
  });

  it('takes the status of the record that carries the code, whatever wraps it', () => {
    const cause = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 503,
      originalError: { error_code: 'operations_disabled' },
    });
    const wrapper = Object.assign(new Error('wrapped'), {
      status_code: 500,
      originalError: cause,
    });

    expect(isOperationsDisabled(wrapper)).toBe(true);
  });

  it('does not match a network failure', () => {
    const net = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      originalError: new TypeError('Failed to fetch'),
    });
    expect(isOperationsDisabled(net)).toBe(false);
  });

  it('does not match another 503, another code or a non-error', () => {
    const plain503 = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 503,
    });
    const otherCode = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 503,
      originalError: { error_code: 'service_unavailable' },
    });

    expect(isOperationsDisabled(plain503)).toBe(false);
    expect(isOperationsDisabled(otherCode)).toBe(false);
    expect(isOperationsDisabled(undefined)).toBe(false);
    expect(isOperationsDisabled(new Error('x'))).toBe(false);
  });
});
