import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Domain service for the Apple Pay merchant-validation round trip.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * The service is constructed by nothing but its own test until the change that
 * gives it a caller; it is exported from no barrel and registered in no
 * service locator.
 *
 * Every transport failure is wrapped UNCONDITIONALLY as
 * `AppError(APPLE_PAY_VALIDATION_ERROR)` — including an incoming `AppError`,
 * which is re-wrapped rather than re-thrown. The transport produces
 * `REQUEST_FAILED` for every 4xx, 5xx and network failure, so an
 * `instanceof AppError` re-throw guard here would mean
 * `APPLE_PAY_VALIDATION_ERROR` is never thrown in production. Collapsing a
 * double wrap is the CONSUMER's job.
 */
export class ApplePayService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }

  /**
   * Request an Apple Pay merchant session from the backend.
   *
   * The request body is EMPTY and the method takes NO parameters. The backend
   * resolves `merchantIdentifier`, `displayName` and `initiativeContext` from
   * the business tied to the api_key, using the browser-set `Origin` header.
   * Nothing client-controlled travels — in particular `event.validationURL` is
   * never read, because letting the browser choose where a certificate-bearing
   * backend connects is an SSRF surface with no upside. No `Authorization`
   * header is set here either; auth is the transport's job.
   *
   * Returns Apple's opaque `merchantSession` VERBATIM. The SDK is a courier: it
   * does not parse, validate, reshape or log this value, and does not type it
   * beyond `unknown` — the only legal thing to do with it is hand it to
   * `ApplePaySessionHandle.completeMerchantValidation`.
   *
   * STATELESS BY REQUIREMENT: no cache, no retry, no in-flight deduplication.
   * Apple requires a new session per transaction, single use, expiring in five
   * minutes — each of those additions would replay a spent session.
   *
   * @throws AppError(APPLE_PAY_VALIDATION_ERROR) on any transport failure.
   */
  public async validateMerchant(): Promise<unknown> {
    try {
      return await this.http.request<unknown>({
        method: 'POST',
        path: '/api/v1/payments/apple-pay/validate-merchant/',
        body: {},
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR,
        originalError: error,
      });
    }
  }
}
