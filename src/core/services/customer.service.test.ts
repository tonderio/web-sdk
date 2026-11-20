import { describe, it, expect, vi } from 'vitest';
import { CustomerService } from './customer.service';
import type { HttpPort } from '../../ports/http.port';
import { asHttpPort } from '../../test-support/http.mock';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { Customer } from '../../shared/types';

const API_KEY = 'pk_test_123';

describe('CustomerService.registerOrFetch', () => {
  it('POSTs /api/v1/customer/ with Token apiKey + email body and maps auth_token → authToken', async () => {
    const requestSpy = vi.fn().mockResolvedValue({
      id: 42,
      auth_token: 'cust_tok_1',
    });
    const http: HttpPort = { request: requestSpy };
    const service = new CustomerService(http);
    const input: Customer = {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+5215555555555',
    };

    const result = await service.registerOrFetch(API_KEY, input);

    expect(result).toEqual({ id: 42, authToken: 'cust_tok_1' });
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/customer/',
        headers: { Authorization: `Token ${API_KEY}` },
        body: {
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone: '+5215555555555',
        },
      }),
    );
  });

  it('omits optional identity fields from the body when not provided', async () => {
    const requestSpy = vi.fn().mockResolvedValue({ id: 1, auth_token: 't' });
    const service = new CustomerService({ request: requestSpy });

    await service.registerOrFetch(API_KEY, { email: 'a@b.com' });

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ body: { email: 'a@b.com' } }),
    );
  });

  it('re-wraps an unknown rejection as AppError(CUSTOMER_OPERATION_ERROR)', async () => {
    const http = asHttpPort(() => Promise.reject(new Error('boom')));
    const service = new CustomerService(http);

    await expect(
      service.registerOrFetch(API_KEY, { email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.CUSTOMER_OPERATION_ERROR });
  });

  it('re-wraps an inner REQUEST_FAILED AppError as AppError(CUSTOMER_OPERATION_ERROR)', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 500,
    });
    const http = asHttpPort(() => Promise.reject(inner));
    const service = new CustomerService(http);

    const err = await service
      .registerOrFetch(API_KEY, { email: 'a@b.com' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.CUSTOMER_OPERATION_ERROR);
  });
});

describe('CustomerService on the transactions API (flag ON)', () => {
  // The core's 201 body (public-api.md, SDK support routes).
  function coreCustomer() {
    return {
      customer_id: 123,
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: '',
      auth_token: 'core_tok',
      auth_token_expires_at: '2026-11-20T18:00:00Z',
    };
  }

  it('POSTs /transactions/v1/customer on the core transport with the same Token credential and body, and maps customer_id → id', async () => {
    const legacy = vi.fn();
    const core = vi.fn().mockResolvedValue(coreCustomer());
    const service = new CustomerService(
      { request: legacy },
      {
        http: { request: core },
        enabled: () => true,
      },
    );

    const result = await service.registerOrFetch(API_KEY, {
      email: 'ada@example.com',
      first_name: 'Ada',
    });

    expect(result).toEqual({ id: 123, authToken: 'core_tok' });
    expect(legacy).not.toHaveBeenCalled();
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/transactions/v1/customer',
        headers: { Authorization: `Token ${API_KEY}` },
        body: { email: 'ada@example.com', first_name: 'Ada' },
      }),
    );
  });

  it('keeps calling the monolith while the flag is OFF', async () => {
    const legacy = vi.fn().mockResolvedValue({ id: 1, auth_token: 't' });
    const core = vi.fn();
    const service = new CustomerService(
      { request: legacy },
      {
        http: { request: core },
        enabled: () => false,
      },
    );

    await service.registerOrFetch(API_KEY, { email: 'a@b.com' });

    expect(core).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/v1/customer/' }),
    );
  });

  it('re-wraps a core failure as AppError(CUSTOMER_OPERATION_ERROR)', async () => {
    const service = new CustomerService(
      asHttpPort(() => Promise.resolve({})),
      {
        http: asHttpPort(() => Promise.reject(new Error('boom'))),
        enabled: () => true,
      },
    );

    await expect(
      service.registerOrFetch(API_KEY, { email: 'a@b.com' }),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.CUSTOMER_OPERATION_ERROR });
  });

  it.each([
    [422, 'customer_email_not_allowed'],
    [400, 'invalid_request'],
    [401, 'invalid_customer_token'],
    [503, 'dependency_unavailable'],
  ])(
    'a core %s %s answer becomes AppError(CUSTOMER_OPERATION_ERROR) keeping the status and the core code',
    async (status, code) => {
      const inner = new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        status_code: status,
        originalError: { error_code: code },
      });
      const service = new CustomerService(
        asHttpPort(() => Promise.resolve({})),
        { http: asHttpPort(() => Promise.reject(inner)), enabled: () => true },
      );

      const err = await service
        .registerOrFetch(API_KEY, { email: 'a@b.com' })
        .catch((e) => e);

      expect(err.code).toBe(ErrorKeyEnum.CUSTOMER_OPERATION_ERROR);
      expect(err.status_code).toBe(status);
      expect(err.originalError.originalError).toEqual({ error_code: code });
    },
  );
});
