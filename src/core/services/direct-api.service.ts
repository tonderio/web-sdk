import type {
  CardPaymentMethod,
  SavedCardPaymentMethod,
} from '../strategies/card.strategy';
import type { ApmPaymentMethod } from '../strategies/apm.strategy';
import type { ApplePayPaymentMethod } from '../strategies/apple-pay.strategy';
import type { BackendTransactionResponse } from '../../models/transaction.model';
import type {
  BackendPaymentMethod,
  BackendPaymentMethodsPage,
} from '../../models/payment-method.model';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { BillingAddress, PaymentMethodBank } from '../../shared/types';

/**
 * Raw snake_case body of one bank option in the payment-method banks response.
 * Not part of the SDK's public API — the merchant-facing shape is the mapped
 * projection.
 */
interface BackendPaymentMethodBank {
  id: number;
  bank: {
    id: number;
    name: string;
    bank_code: string;
    logo?: string;
    country: string;
    country_name: string;
    is_active: boolean;
  };
  payment_type: string;
  is_enabled: boolean;
  priority: number;
}

/** SDK transport shape for SafetyPay bank groups. */
interface BackendPaymentMethodBanksResponse {
  cash?: BackendPaymentMethodBank[];
  transfer?: BackendPaymentMethodBank[];
}

/** Pure snake→camel projection of one payment method bank option (promotes `bank.*`). */
function mapPaymentMethodBank(
  raw: BackendPaymentMethodBank,
  group: 'cash' | 'transfer',
): PaymentMethodBank {
  const bank: PaymentMethodBank = {
    id: raw.bank.id,
    name: raw.bank.name,
    code: raw.bank.bank_code,
    country: raw.bank.country_name,
    channel: group === 'transfer' ? 'OL' : 'WP',
  };
  if (raw.bank.logo !== undefined) bank.logo = raw.bank.logo;
  return bank;
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

/**
 * Domain service that processes a one-shot payment via the Direct API.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * `processPayment` POSTs to `/api/v1/process/` with `X-Request-Id` only
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

  constructor(http: HttpPort) {
    this.http = http;
  }

  public async processPayment(
    body: ProcessPaymentBody,
    requestId?: string,
  ): Promise<BackendTransactionResponse> {
    try {
      return await this.http.request<BackendTransactionResponse>({
        method: 'POST',
        path: '/api/v1/process/',
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
        path: `/api/v1/transactions/${id}/`,
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
   * `GET /api/v1/payment_methods?status=active`.
   *
   * Unmapped and UNFILTERED — the result still contains the `apple_pay_*`
   * entries. Not public API, and never cached: this is the transport behind
   * `getPaymentMethods()`, which issues a fresh call every time. Never hand the
   * result to a merchant; only the public projection produces a merchant-facing
   * shape.
   *
   * The paginated envelope is flattened here so no reader has to repeat the
   * `Array.isArray` normalization; the pagination fields are transport metadata
   * the SDK ignores. Any transport failure is re-wrapped as
   * `AppError(FETCH_PAYMENT_METHODS_ERROR)` — the same code the public call
   * uses, produced in exactly one place.
   */
  public async getPaymentMethodCatalog(): Promise<BackendPaymentMethod[]> {
    try {
      const raw = await this.http.request<
        BackendPaymentMethod[] | BackendPaymentMethodsPage
      >({
        method: 'GET',
        path: '/api/v1/payment_methods?status=active',
      });
      return Array.isArray(raw) ? raw : raw.results;
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Fetch the payment method bank list via `GET /api/v1/safetypay/banks/{apiKey}/`.
   *
   * The `apiKey` travels in the URL PATH (URI-encoded), not the auth header —
   * the SafetyPay view resolves the business from the path token. The transport
   * still attaches its `Token` auth header; that header is ignored by this view.
   * PURE: depends only on the injected {@link HttpPort}. Returns the two channel
   * groups mapped to {@link PaymentMethodBank}. Any transport failure is re-wrapped as
   * `AppError(FETCH_PAYMENT_METHOD_BANKS_ERROR)`.
   */
  public async getPaymentMethodBanks(
    apiKey: string,
  ): Promise<{ cash: PaymentMethodBank[]; transfer: PaymentMethodBank[] }> {
    try {
      const raw = await this.http.request<BackendPaymentMethodBanksResponse>({
        method: 'GET',
        path: `/api/v1/safetypay/banks/${encodeURIComponent(apiKey)}/`,
      });
      return {
        cash: (raw.cash ?? []).map((bank) =>
          mapPaymentMethodBank(bank, 'cash'),
        ),
        transfer: (raw.transfer ?? []).map((bank) =>
          mapPaymentMethodBank(bank, 'transfer'),
        ),
      };
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR,
        originalError: error,
      });
    }
  }
}
