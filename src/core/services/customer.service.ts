import type { CoreTarget, HttpPort } from '../../ports/http.port';
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

/** The transactions API's customer (its 201 body; only what the SDK reads). */
interface CoreCustomerResponse {
  customer_id: number | string;
  auth_token: string;
}

/** The transactions API's customer (its 201 body; only what the SDK reads). */
interface CoreCustomerResponse {
  customer_id: number | string;
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
 * {apiKey}` (the backend get-or-creates by email), or to the transactions API's
 * `/transactions/v1/customer` with the same credential and body while the
 * business runs on it, and maps the snake_case
 * response to a camelCase {@link CustomerResult}. Any failure — transport or an
 * existing `AppError` — is re-wrapped as `AppError(CUSTOMER_OPERATION_ERROR)` so
 * callers branch on one stable code.
 */
export class CustomerService {
  private readonly http: HttpPort;
  private readonly core?: CoreTarget;

  constructor(http: HttpPort, core?: CoreTarget) {
    this.http = http;
    this.core = core;
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

      const onCore = this.core?.enabled() === true;
      const raw = await (
        onCore && this.core ? this.core.http : this.http
      ).request<BackendCustomerResponse | CoreCustomerResponse>({
        method: 'POST',
        path: onCore ? '/transactions/v1/customer' : '/api/v1/customer/',
        headers: { Authorization: `Token ${apiKey}` },
        body,
      });

      if (onCore) {
        const customer = raw as CoreCustomerResponse;
        if (
          customer.customer_id === undefined ||
          typeof customer.auth_token !== 'string'
        ) {
          throw new Error('The answer is not a transactions API customer.');
        }
        return { id: customer.customer_id, authToken: customer.auth_token };
      }
      const legacy = raw as BackendCustomerResponse;
      return { id: legacy.id, authToken: legacy.auth_token };
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.CUSTOMER_OPERATION_ERROR,
        originalError: error,
      });
    }
  }
}
