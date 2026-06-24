import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { Customer } from '../../shared/types';

/** SDK transport shape for customer lookup/registration. */
interface CustomerRequestBody {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/** SDK transport shape returned for customer lookup/registration. */
interface BackendCustomerResponse {
  id: number | string;
  auth_token: string;
}

/** PUBLIC result of registering/fetching a customer. camelCase. */
export interface CustomerResult {
  id: number | string;
  /** Customer auth token used as `User-Token` on card endpoints. */
  authToken: string;
}

/**
 * Domain service that registers (or idempotently fetches) a customer.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * `registerOrFetch` POSTs to `/api/v1/customer/` with `Authorization: Token
 * {apiKey}` (the backend get-or-creates by email) and maps the snake_case
 * response to a camelCase {@link CustomerResult}. Any failure — transport or an
 * existing `AppError` — is re-wrapped as `AppError(CUSTOMER_OPERATION_ERROR)` so
 * callers branch on one stable code.
 */
export class CustomerService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }

  public async registerOrFetch(
    apiKey: string,
    input: Customer,
  ): Promise<CustomerResult> {
    try {
      const body: CustomerRequestBody = { email: input.email };
      if (input.first_name !== undefined) body.first_name = input.first_name;
      if (input.last_name !== undefined) body.last_name = input.last_name;
      if (input.phone !== undefined) body.phone = input.phone;

      const raw = await this.http.request<BackendCustomerResponse>({
        method: 'POST',
        path: '/api/v1/customer/',
        headers: { Authorization: `Token ${apiKey}` },
        body,
      });

      return { id: raw.id, authToken: raw.auth_token };
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.CUSTOMER_OPERATION_ERROR,
        originalError: error,
      });
    }
  }
}
