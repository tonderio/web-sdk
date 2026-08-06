import { describe, it, expect, vi } from 'vitest';
import { ApplePayService } from './apple-pay.service';
import type { HttpPort, HttpRequestOptions } from '../../ports/http.port';
import { rejectionOf } from '../../test-support/rejection';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import { MESSAGES_EN } from '../../shared/errors/messages';

const VALIDATE_PATH = '/api/v1/payments/apple-pay/validate-merchant/';

type FakeRequest = (options: HttpRequestOptions) => Promise<unknown>;

/** Fake transport. Returns the spy too so the recorded options can be read back. */
function fakeHttp(impl: FakeRequest) {
  const request = vi.fn(impl);
  return { http: { request } as unknown as HttpPort, request };
}

describe('ApplePayService.validateMerchant', () => {
  // 1 — exact method and path, and NOTHING else in the request
  it('POSTs an empty body to the merchant-validation path and sends nothing else', async () => {
    const { http, request } = fakeHttp(async () => ({ opaque: true }));

    await new ApplePayService(http).validateMerchant();

    expect(request).toHaveBeenCalledTimes(1);
    // EXACT deep equality, never expect.objectContaining: an extra key is
    // precisely the regression this assertion exists to catch, and
    // objectContaining PASSES when extra keys are present — it would go green
    // with a validationURL in the body, asserting the opposite of its own name.
    // The neighbouring service tests use objectContaining; do not "align" this
    // one with them.
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: VALIDATE_PATH,
      body: {},
    });
  });

  // 2 — the absence assertions, spelled out so a failure names the thing that leaked
  it('sends no client-derived value and sets no auth header of its own', async () => {
    const { http, request } = fakeHttp(async () => ({}));

    await new ApplePayService(http).validateMerchant();

    const [options] = request.mock.calls[0] as [HttpRequestOptions];
    expect(Object.keys(options.body as Record<string, unknown>)).toHaveLength(
      0,
    );
    expect(options.headers).toBeUndefined(); // auth is the transport's job
    expect(JSON.stringify(options)).not.toMatch(
      /validationURL|merchant_identifier|domain_name|initiative_context/i,
    );
  });

  // 3 — pass-through by IDENTITY, not deep equality
  it('returns the opaque merchant session verbatim, unparsed', async () => {
    const merchantSession = {
      epochTimestamp: 1,
      signature: 'opaque',
      nested: { a: [1, 2] },
    };
    const { http } = fakeHttp(async () => merchantSession);

    const result = await new ApplePayService(http).validateMerchant();

    // toBe, not toEqual: identity proves the service neither copied nor
    // re-serialized the blob. toEqual would pass on a structural clone.
    expect(result).toBe(merchantSession);
  });

  // 4 — the response is not assumed to be an object
  it('passes a non-object response through without parsing it', async () => {
    const { http } = fakeHttp(async () => 'an-opaque-string');

    await expect(new ApplePayService(http).validateMerchant()).resolves.toBe(
      'an-opaque-string',
    );
  });

  // 5 — DD3: an AppError from the transport is RE-WRAPPED, not re-thrown
  it('wraps a transport AppError as APPLE_PAY_VALIDATION_ERROR and keeps the original', async () => {
    const transportError = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
    const { http } = fakeHttp(async () => {
      throw transportError;
    });

    const error = await rejectionOf(() =>
      new ApplePayService(http).validateMerchant(),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR);
    expect(error.originalError).toBe(transportError);
    expect(error.status_code).toBe(404); // survives the wrap
  });

  // 6 — the MESSAGES_EN entry: the only thing that catches a missing one
  it('resolves the merchant-validation copy instead of the UNKNOWN_ERROR fallback', async () => {
    const { http } = fakeHttp(async () => {
      throw new Error('boom');
    });

    const error = await rejectionOf(() =>
      new ApplePayService(http).validateMerchant(),
    );

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR);
    // LOAD-BEARING: resolveMessage falls back to the UNKNOWN_ERROR copy for any
    // code MESSAGES_EN does not know, so this line is what fails when the entry
    // is missing. It is the assertion that does the work.
    expect(error.message).not.toBe(MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR]);
    // SECONDARY and partly tautological — it compares against the same map it
    // verifies. Kept because it documents intent, not because it proves much.
    expect(error.message).toBe(
      MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR],
    );
  });

  // 7 — DD6: no memory between calls
  it('issues a fresh request on every call — no cache, no deduplication', async () => {
    const { http, request } = fakeHttp(async () => ({}));
    const service = new ApplePayService(http);

    await service.validateMerchant();
    await service.validateMerchant();

    expect(request).toHaveBeenCalledTimes(2);
  });

  // 8 — DD6, failure branch: a rejected call is not retried
  it('does not retry a rejected call', async () => {
    const { http, request } = fakeHttp(async () => {
      throw new Error('boom');
    });

    await new ApplePayService(http).validateMerchant().catch(() => undefined);

    expect(request).toHaveBeenCalledTimes(1);
  });
});
