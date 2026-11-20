import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { _createTonderWithDeps, Tonder } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type {
  PaymentMethodBank,
  PaymentMethodBanks,
  TonderConfig,
} from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
};

function backendPaymentMethodBanks(): unknown {
  return {
    data: [
      {
        bank_id: 11,
        code: 'BC',
        name: 'Banco Cash',
        payment_type: 'cash',
        priority: 5,
        logo_url: null,
        country_name: 'Mexico',
        channels: ['WP'],
        limits: null,
        currency: 'MXN',
        locations_url: null,
      },
    ],
  };
}

describe('Tonder.getPaymentMethodBanks', () => {
  it('delegates to DirectApiService on the transactions API, returns { cash, transfer }', async () => {
    const requestSpy = vi.fn(
      <T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/transactions/v1/safetypay/banks') {
          return Promise.resolve(backendPaymentMethodBanks() as unknown as T);
        }
        return Promise.reject(new Error('unexpected path'));
      },
    );
    const http: HttpPort = asHttpPort(requestSpy);
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    const result = await tonder.getPaymentMethodBanks();

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/safetypay/banks',
      }),
    );
    expect(result.cash).toHaveLength(1);
    expect(result.cash[0]).toEqual({
      id: 11,
      name: 'Banco Cash',
      code: 'BC',
      country: 'Mexico',
      channel: 'WP',
    });
    expect(result.transfer).toEqual([]);

    // Named PaymentMethodBanks return shape (not anonymous/PaymentMethodBanksResult).
    const banks: PaymentMethodBanks = result;
    expectTypeOf(banks.cash).toEqualTypeOf<PaymentMethodBank[]>();
    expectTypeOf(banks.transfer).toEqualTypeOf<PaymentMethodBank[]>();
    expectTypeOf<ReturnType<Tonder['getPaymentMethodBanks']>>().toEqualTypeOf<
      Promise<PaymentMethodBanks>
    >();
  });

  it('re-throws an existing AppError unchanged', async () => {
    const http: HttpPort = {
      request: vi.fn(() =>
        Promise.reject(
          new AppError({
            errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR,
          }),
        ),
      ),
    };
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    const err = await tonder.getPaymentMethodBanks().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR);
  });
});
