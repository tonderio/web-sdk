import { describe, it, expect, vi } from 'vitest';
import { BusinessService } from './business.service';
import type { HttpPort } from '../../ports/http.port';
import type { BusinessConfig } from '../../models/business.model';
import { asHttpPort } from '../../test-support/http.mock';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

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
    core_payments_enabled: false,
  };
}

describe('BusinessService.fetchBusinessConfig', () => {
  it('GETs the transactions API business config route without the key in the path and returns the typed config', async () => {
    const config = makeConfig();
    const requestSpy = vi.fn().mockResolvedValue(config);
    const http: HttpPort = { request: requestSpy };
    const service = new BusinessService(http);

    const result = await service.fetchBusinessConfig();

    expect(result).toEqual(config);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/business/config',
      }),
    );
  });

  it('re-wraps an inner REQUEST_FAILED AppError as AppError(FETCH_BUSINESS_ERROR)', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
    const http = asHttpPort(() => Promise.reject(inner));
    const service = new BusinessService(http);

    const err = await service.fetchBusinessConfig().catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_BUSINESS_ERROR);
  });

  it('keeps the received body as the original error, not in any merchant-facing field', async () => {
    const body = '<html>bad gateway</html>';
    const service = new BusinessService(
      asHttpPort(() => Promise.resolve(body)),
    );

    const err = await service.fetchBusinessConfig().catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.FETCH_BUSINESS_ERROR);
    expect(err.originalError).toBe(body);
    expect(err.message).not.toContain('bad gateway');
    expect(JSON.stringify(err.details)).not.toContain('bad gateway');
  });

  it('accepts a configuration with its optional blocks absent', async () => {
    const minimal = makeConfig();
    const service = new BusinessService(
      asHttpPort(() => Promise.resolve(minimal)),
    );

    await expect(service.fetchBusinessConfig()).resolves.toEqual(minimal);
    expect(minimal.apple_pay).toBeUndefined();
    expect(minimal.cardonfile_keys).toBeNull();
  });

  it('re-wraps an unknown rejection as AppError(FETCH_BUSINESS_ERROR)', async () => {
    const http = asHttpPort(() => Promise.reject(new Error('boom')));
    const service = new BusinessService(http);

    await expect(service.fetchBusinessConfig()).rejects.toMatchObject({
      code: ErrorKeyEnum.FETCH_BUSINESS_ERROR,
    });
  });

  it.each([
    ['an HTML page', '<html>bad gateway</html>'],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['an array', []],
    ['an object without a business', { detail: 'ok' }],
    ['a business that is not an object', { business: 'x' }],
  ])(
    'rejects a 2xx answer that is %s as FETCH_BUSINESS_ERROR',
    async (_label, body) => {
      const http = asHttpPort(() => Promise.resolve(body));
      const service = new BusinessService(http);

      await expect(service.fetchBusinessConfig()).rejects.toMatchObject({
        code: ErrorKeyEnum.FETCH_BUSINESS_ERROR,
      });
    },
  );
});
