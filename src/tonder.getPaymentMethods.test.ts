import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

function backendPaymentMethods(): unknown {
  return [
    {
      pk: 7,
      payment_method: 'oxxopay',
      acquirer: 'safetypay',
      status: 'active',
      priority: 10,
      category: 'cash',
      unavailable_countries: [],
    },
  ];
}

describe('Tonder.getPaymentMethods', () => {
  it('delegates to DirectApiService and returns the mapped array (no ready guard)', async () => {
    const http: HttpPort = {
      request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/api/v1/payment_methods?status=active') {
          return Promise.resolve(backendPaymentMethods() as unknown as T);
        }
        return Promise.reject(new Error('unexpected path'));
      }),
    };
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    // No init() — read-only, works before ready.
    const result = await tonder.getPaymentMethods();

    expect(result).toEqual([
      {
        id: 7,
        payment_method: 'oxxopay',
        label: 'Oxxo Pay',
        logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxopay.png',
        category: 'cash',
      },
    ]);
  });

  it('re-throws an existing AppError unchanged', async () => {
    const http: HttpPort = {
      request: vi.fn(() =>
        Promise.reject(
          new AppError({ errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR }),
        ),
      ),
    };
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    const err = await tonder.getPaymentMethods().catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR);
  });
});
