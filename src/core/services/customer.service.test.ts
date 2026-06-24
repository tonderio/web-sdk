import { describe, it, expect, vi } from 'vitest';
import { CustomerService } from './customer.service';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { Customer } from '../../shared/types';

const API_KEY = 'pk_test_123';

function mockHttp(impl: HttpPort['request']): HttpPort {
  return { request: vi.fn(impl) };
}

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
    const http = mockHttp(() => Promise.reject(new Error('boom')));
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
    const http = mockHttp(() => Promise.reject(inner));
    const service = new CustomerService(http);

    const err = await service
      .registerOrFetch(API_KEY, { email: 'a@b.com' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.CUSTOMER_OPERATION_ERROR);
  });
});
