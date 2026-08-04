import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
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
    const http: HttpPort = asHttpPort((options: HttpRequestOptions) => {
      if (options.path === '/api/v1/payment_methods?status=active') {
        return Promise.resolve(backendPaymentMethods());
      }
      return Promise.reject(new Error('unexpected path'));
    });
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

describe('Tonder.getPaymentMethods — Apple Pay entries are never returned', () => {
  /** Business config so the init()-dependent cases can reach ready. */
  function businessConfig(): unknown {
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

  function catalogWithApplePay(): unknown {
    return [
      { pk: 1, payment_method: 'card', priority: 1, category: 'card' },
      {
        pk: 2,
        payment_method: 'apple_pay_debit_card',
        priority: 2,
        category: 'wallet',
      },
      {
        pk: 3,
        payment_method: 'apple_pay_credit_card',
        priority: 3,
        category: 'wallet',
      },
      { pk: 4, payment_method: 'spei', priority: 4, category: 'transfer' },
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

  function catalogHttp(catalog: unknown): HttpPort {
    return asHttpPort((options: HttpRequestOptions) => {
      if (options.path === '/api/v1/payment_methods?status=active') {
        return Promise.resolve(catalog);
      }
      return Promise.resolve(businessConfig());
    });
  }

  it('excludes both apple_pay_* entries and keeps every other method intact', async () => {
    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http: catalogHttp(catalogWithApplePay()),
    });

    const result = await tonder.getPaymentMethods();
    const codes = result.map((method) => method.payment_method);

    // BOTH excluded codes are named explicitly. A bare length check would pass
    // with the wrong entries surviving, which is the failure this guards.
    expect(codes).not.toContain('apple_pay_debit_card');
    expect(codes).not.toContain('apple_pay_credit_card');
    // And the survivors are asserted POSITIVELY, by value and in order.
    expect(codes).toEqual(['card', 'spei', 'oxxopay']);
    expect(JSON.stringify(result)).not.toContain('apple_pay');
    expect(result).toContainEqual({
      id: 7,
      payment_method: 'oxxopay',
      label: 'Oxxo Pay',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxopay.png',
      category: 'cash',
    });
  });

  it('a catalog with no Apple Pay entry produces the pre-change output', async () => {
    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http: catalogHttp(backendPaymentMethods()),
    });

    await expect(tonder.getPaymentMethods()).resolves.toEqual([
      {
        id: 7,
        payment_method: 'oxxopay',
        label: 'Oxxo Pay',
        logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxopay.png',
        category: 'cash',
      },
    ]);
  });

  it('issues its OWN request after init(), which fetches no catalog at all', async () => {
    // The SDK caches no catalog, so this call has nothing to be served from.
    // The count is what proves it: `init()` contributes zero requests to this
    // path, and each public call contributes exactly one.
    let catalogCalls = 0;
    const http: HttpPort = asHttpPort((options: HttpRequestOptions) => {
      if (options.path === '/api/v1/payment_methods?status=active') {
        catalogCalls += 1;
        return Promise.resolve(catalogWithApplePay());
      }
      return Promise.resolve(businessConfig());
    });
    const tonder = _createTonderWithDeps({ config: CONFIG, http });

    await tonder.init();
    expect(catalogCalls).toBe(0);

    const result = await tonder.getPaymentMethods();

    expect(catalogCalls).toBe(1);
    expect(result.map((method) => method.payment_method)).toEqual([
      'card',
      'spei',
      'oxxopay',
    ]);

    // A second call fetches again rather than replaying the first result.
    await tonder.getPaymentMethods();
    expect(catalogCalls).toBe(2);
  });
});
