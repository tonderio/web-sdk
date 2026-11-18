import type { BusinessConfig } from '../../models/business.model';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Domain service that loads the merchant's business configuration.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * Any transport failure (the port throws `REQUEST_FAILED`/`REQUEST_ABORTED` or
 * an unknown error) is re-wrapped as a domain-level
 * `AppError(FETCH_BUSINESS_ERROR)` so callers branch on one stable code.
 */
export class BusinessService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }

  /**
   * The business is the credential's own: the key travels in the auth header,
   * never in the path.
   */
  public async fetchBusinessConfig(): Promise<BusinessConfig> {
    try {
      return await this.http.request<BusinessConfig>({
        method: 'GET',
        path: '/transactions/v1/business/config',
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_BUSINESS_ERROR,
        originalError: error,
      });
    }
  }
}
