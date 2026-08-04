import { describe, it, expect, vi } from 'vitest';
import { DirectApiService } from './direct-api.service';
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
        pk: 7,
        payment_method: 'oxxopay',
        priority: 10,
        category: 'cash',
      },
      {
        pk: 9,
        payment_method: 'apple_pay_debit_card',
        priority: 1,
        category: 'wallet',
      },
    ];
  }

  it('GETs /api/v1/payment_methods?status=active and returns the RAW, unmapped, unfiltered array', async () => {
    const spy = vi.fn().mockResolvedValue(rawCatalog());
    const service = new DirectApiService({ request: spy });

    const result = await service.getPaymentMethodCatalog();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/payment_methods?status=active',
      }),
    );
    expect(result).toEqual(rawCatalog());
  });

  it('flattens a paginated envelope into the raw array', async () => {
    const service = new DirectApiService({
      request: vi.fn().mockResolvedValue({
        count: 2,
        next: null,
        previous: null,
        results: rawCatalog(),
      }),
    });

    await expect(service.getPaymentMethodCatalog()).resolves.toEqual(
      rawCatalog(),
    );
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
  const API_KEY = 'pk test/123';

  function backendPaymentMethodBanks(): unknown {
    return {
      cash: [
        {
          id: 1,
          bank: {
            id: 11,
            name: 'Banco Cash',
            bank_code: 'BC',
            logo: 'https://logo/cash.png',
            country: 'MX',
            country_name: 'Mexico',
            is_active: true,
          },
          payment_type: 'cash',
          is_enabled: true,
          priority: 5,
        },
      ],
      transfer: [
        {
          id: 2,
          bank: {
            id: 22,
            name: 'Banco Transfer',
            bank_code: 'BT',
            country: 'MX',
            country_name: 'Mexico',
            is_active: false,
          },
          payment_type: 'transfer',
          is_enabled: false,
          priority: 6,
        },
      ],
    };
  }

  it('GETs /api/v1/safetypay/banks/{apiKey}/ with the apiKey URI-encoded in the path and maps groups', async () => {
    const spy = vi.fn().mockResolvedValue(backendPaymentMethodBanks());
    const service = new DirectApiService({ request: spy });

    const result = await service.getPaymentMethodBanks(API_KEY);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: `/api/v1/safetypay/banks/${encodeURIComponent(API_KEY)}/`,
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

  it('re-wraps a transport failure as AppError(FETCH_PAYMENT_METHOD_BANKS_ERROR)', async () => {
    const service = new DirectApiService(
      asHttpPort(() => Promise.reject(new Error('boom'))),
    );

    const err = await service.getPaymentMethodBanks(API_KEY).catch((e) => e);

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
