import { describe, it, expect, vi } from 'vitest';
import { BusinessService } from './business.service';
import type { HttpPort } from '../../ports/http.port';
import type { BusinessConfig } from '../../models/business.model';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const API_KEY = 'pk_test_123';

function makeConfig(): BusinessConfig {
  return {
    business: {
      pk: 1,
      name: 'Acme',
      categories: [{ pk: 1, name: 'retail' }],
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

function mockHttp(impl: HttpPort['request']): HttpPort {
  return { request: vi.fn(impl) } as unknown as HttpPort;
}

describe('BusinessService.fetchBusinessConfig', () => {
  it('GETs the business endpoint with the apiKey and returns the typed config', async () => {
    const config = makeConfig();
    const requestSpy = vi.fn().mockResolvedValue(config);
    const http: HttpPort = { request: requestSpy };
    const service = new BusinessService(http);

    const result = await service.fetchBusinessConfig(API_KEY);

    expect(result).toEqual(config);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: `/api/v1/payments/business/${API_KEY}`,
      }),
    );
  });

  it('re-wraps an inner REQUEST_FAILED AppError as AppError(FETCH_BUSINESS_ERROR)', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
    const http = mockHttp(() => Promise.reject(inner));
    const service = new BusinessService(http);

    const err = await service.fetchBusinessConfig(API_KEY).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_BUSINESS_ERROR);
  });

  it('re-wraps an unknown rejection as AppError(FETCH_BUSINESS_ERROR)', async () => {
    const http = mockHttp(() => Promise.reject(new Error('boom')));
    const service = new BusinessService(http);

    await expect(service.fetchBusinessConfig(API_KEY)).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_BUSINESS_ERROR,
    });
  });
});
