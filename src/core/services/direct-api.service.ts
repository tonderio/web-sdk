import type {
  CardPaymentMethod,
  SavedCardPaymentMethod,
} from '../strategies/card.strategy';
import type { ApmPaymentMethod } from '../strategies/apm.strategy';
import type { ApplePayPaymentMethod } from '../strategies/apple-pay.strategy';
import type { BackendTransactionResponse } from '../../models/transaction.model';
import type { BackendPaymentMethod } from '../../models/payment-method.model';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { BillingAddress, PaymentMethodBank } from '../../shared/types';

/**
 * One bank of the transactions API's SafetyPay list. Not part of the SDK's
 * public API — the merchant-facing shape is the mapped projection.
 */
interface CoreBank {
  /** The bank record's numeric id (a declared deviation of the core). */
  bank_id: number;
  code: string;
  name: string;
  payment_type: string;
  country_name: string;
  logo_url?: string | null;
}

/** Pure projection of one bank option onto the public {@link PaymentMethodBank}. */
function mapPaymentMethodBank(
  raw: CoreBank,
  group: 'cash' | 'transfer',
): PaymentMethodBank {
  const bank: PaymentMethodBank = {
    id: raw.bank_id,
    name: raw.name,
    code: raw.code,
    country: raw.country_name,
    channel: group === 'transfer' ? 'OL' : 'WP',
  };
  if (typeof raw.logo_url === 'string' && raw.logo_url !== '') {
    bank.logo = raw.logo_url;
  }
  return bank;
}

/**
 * The `data` array of a transactions API list answer. A 2xx body that is not
 * one (a proxy's HTML page, an empty body) is a failure, not an empty list.
 */
function listOf<T>(raw: unknown): T[] {
  const data = (raw as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error('The answer is not a transactions API list.');
  }
  return data as T[];
}

/** Payment request body used by the SDK runtime. */
export interface ProcessPaymentBody {
  operation_type: 'payment';
  amount: number;
  currency: string;
  return_url: string;
  presentation_mode?: 'redirect' | 'embedded';
  customer: { name: string; email: string };
  /**
   * `ApplePayPaymentMethod` is listed EXPLICITLY rather than left to
   * `ApmPaymentMethod`'s structural `type: string`, which already makes it
   * assignable. Relying on that accident would make this union a lie: it would
   * read as "card, saved card or APM" while silently also accepting a wallet
   * block, and a later tightening of `ApmPaymentMethod` would break Apple Pay
   * with no signal at this declaration.
   */
  payment_method:
    | CardPaymentMethod
    | SavedCardPaymentMethod
    | ApmPaymentMethod
    | ApplePayPaymentMethod;
  client_reference: string;
  metadata?: Record<string, unknown>;
  billing_address?: BillingAddress;
}

/** The two routes that differ between the engines a payment can run on. */
export interface PaymentRoutes {
  process: string;
  transaction: (id: string) => string;
}

/** Routes of the monolith's Direct API. */
export const LEGACY_API_ROUTES: PaymentRoutes = {
  process: '/api/v1/process/',
  transaction: (id) => `/api/v1/transactions/${id}/`,
};

/** Routes of the transactions API. */
export const CORE_API_ROUTES: PaymentRoutes = {
  process: '/transactions/v1/process',
  transaction: (id) => `/transactions/v1/${id}`,
};

/**
 * Whether a failed `processPayment` was the transactions API's emergency stop:
 * status `503` with the `operations_disabled` code, and only that status.
 * Nothing was created, so the same payment may be retried once on the Direct
 * API. Looks through the service's own wrapping. Any other failure is not it,
 * a bare `503` or another status carrying the code included.
 */
export function isOperationsDisabled(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && typeof current === 'object' && current;
    depth += 1
  ) {
    const record = current as {
      status_code?: unknown;
      error_code?: unknown;
      originalError?: unknown;
    };
    const cause = record.originalError as { error_code?: unknown } | undefined;
    if (
      record.error_code === 'operations_disabled' ||
      cause?.error_code === 'operations_disabled'
    ) {
      return record.status_code === 503;
    }
    current = record.originalError;
  }
  return false;
}

/**
 * Domain service that processes a one-shot payment via the Direct API.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * `processPayment` POSTs to the engine's process route with `X-Request-Id` only
 * when the caller supplies an idempotency key. `presentation_mode` travels in
 * the request body so Direct API users and SDK users share the same contract.
 * Every transport failure is wrapped UNCONDITIONALLY as
 * `AppError(PAYMENT_PROCESS_ERROR)` — including an incoming `AppError`, which
 * is re-wrapped rather than re-thrown. There is no `instanceof AppError`
 * re-throw guard on any method here. Collapsing a double wrap is the
 * CONSUMER's job. NOTE: a DECLINE is delivered as HTTP 200 with a decline
 * `status` in the body — it does NOT throw here.
 */
export class DirectApiService {
  private readonly http: HttpPort;
  private readonly routes: PaymentRoutes;

  constructor(http: HttpPort, routes: PaymentRoutes = LEGACY_API_ROUTES) {
    this.http = http;
    this.routes = routes;
  }

  public async processPayment(
    body: ProcessPaymentBody,
    requestId?: string,
  ): Promise<BackendTransactionResponse> {
    try {
      return await this.http.request<BackendTransactionResponse>({
        method: 'POST',
        path: this.routes.process,
        body,
        headers: {
          ...(requestId !== undefined ? { 'X-Request-Id': requestId } : {}),
        },
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Read a transaction's current state via `GET /api/v1/transactions/{id}/`.
   *
   * PURE: depends only on the injected {@link HttpPort}. The optional `signal`
   * is forwarded to the transport so the caller (or a poll) can cancel the
   * in-flight request. The GET body is a superset of the `/process` response, so
   * the same {@link BackendTransactionResponse} shape is reused (`updated_at` is
   * ignored). Any transport failure (404/400/network, or an unknown error) is
   * re-wrapped as `AppError(FETCH_TRANSACTION_ERROR)`; the original `statusCode`
   * is preserved via `originalError`.
   */
  public async getTransaction(
    id: string,
    signal?: AbortSignal,
  ): Promise<BackendTransactionResponse> {
    try {
      return await this.http.request<BackendTransactionResponse>({
        method: 'GET',
        path: this.routes.transaction(id),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Fetch the RAW active payment-method catalog via
   * `GET /transactions/v1/payment_methods?status=active`.
   *
   * Always the transactions API's route, for every business: build the service
   * with a port that reaches it.
   *
   * Unmapped and UNFILTERED — the result still contains the `apple_pay_*`
   * entries. Not public API, and never cached: this is the transport behind
   * `getPaymentMethods()`, which issues a fresh call every time. Never hand the
   * result to a merchant; only the public projection produces a merchant-facing
   * shape.
   *
   * The transactions API answers `{ data: [...] }`, never paged; the array is
   * unwrapped here so no reader repeats it. Any transport failure is re-wrapped as
   * `AppError(FETCH_PAYMENT_METHODS_ERROR)` — the same code the public call
   * uses, produced in exactly one place.
   */
  public async getPaymentMethodCatalog(): Promise<BackendPaymentMethod[]> {
    try {
      return listOf<BackendPaymentMethod>(
        await this.http.request<unknown>({
          method: 'GET',
          path: '/transactions/v1/payment_methods?status=active',
        }),
      );
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Fetch the payment method bank list via `GET /transactions/v1/safetypay/banks`.
   *
   * The business is the credential's own: the key travels in the auth header the
   * transport attaches, never in the path. Always the transactions API's route,
   * for every business: build the service with a port that reaches it.
   * PURE: depends only on the injected {@link HttpPort}. Returns the two channel
   * groups mapped to {@link PaymentMethodBank}. Any transport failure is re-wrapped as
   * `AppError(FETCH_PAYMENT_METHOD_BANKS_ERROR)`.
   */
  public async getPaymentMethodBanks(): Promise<{
    cash: PaymentMethodBank[];
    transfer: PaymentMethodBank[];
  }> {
    try {
      const banks = listOf<CoreBank>(
        await this.http.request<unknown>({
          method: 'GET',
          path: '/transactions/v1/safetypay/banks',
        }),
      );
      // One list for both payment types: the type names the group.
      return {
        cash: banks
          .filter((bank) => bank.payment_type === 'cash')
          .map((bank) => mapPaymentMethodBank(bank, 'cash')),
        transfer: banks
          .filter((bank) => bank.payment_type === 'transfer')
          .map((bank) => mapPaymentMethodBank(bank, 'transfer')),
      };
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR,
        originalError: error,
      });
    }
  }
}
