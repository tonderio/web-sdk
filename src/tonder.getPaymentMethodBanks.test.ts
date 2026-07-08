import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { _createTonderWithDeps, Tonder } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type {
  PaymentMethodBank,
  PaymentMethodBanks,
  TonderConfig,
} from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

function backendPaymentMethodBanks(): unknown {
  return {
    cash: [
      {
        id: 1,
        bank: {
          id: 11,
          name: 'Banco Cash',
          bank_code: 'BC',
          country: 'MX',
          country_name: 'Mexico',
          is_active: true,
        },
        payment_type: 'cash',
        is_enabled: true,
        priority: 5,
      },
    ],
    transfer: [],
  };
}

describe('Tonder.getPaymentMethodBanks', () => {
  it('reads apiKey from config, delegates to DirectApiService, returns { cash, transfer }', async () => {
    const requestSpy = vi.fn(
      <T>(options: Parameters<HttpPort['request']>[0]) => {
        if (
          options.path ===
          `/api/v1/safetypay/banks/${encodeURIComponent('pk_test_123')}/`
        ) {
          return Promise.resolve(backendPaymentMethodBanks() as unknown as T);
        }
        return Promise.reject(new Error('unexpected path'));
      },
    );
    const http: HttpPort = { request: requestSpy };
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    const result = await tonder.getPaymentMethodBanks();

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/safetypay/banks/pk_test_123/',
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
