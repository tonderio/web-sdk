import type {
  CardPaymentMethod,
  SavedCardPaymentMethod,
} from '../strategies/card.strategy';
import type { ApmPaymentMethod } from '../strategies/apm.strategy';
import type { BackendTransactionResponse } from '../../models/transaction.model';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type { PaymentMethodBank, PaymentMethodInfo } from '../../shared/types';
import { getPaymentMethodCatalogDetails } from '../../shared/payment-method-catalog';

/** SDK transport shape for one payment-method record. */
interface BackendPaymentMethod {
  pk: number;
  payment_method: string;
  acquirer?: string;
  status?: string;
  priority: number;
  category: string;
  label?: string;
  name?: string;
  logo?: string;
  icon?: string;
  unavailable_countries?: string[];
}

/** SDK transport shape for a paginated payment-method response. */
interface BackendPaymentMethodsPage {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results: BackendPaymentMethod[];
}

/** INTERNAL snake_case body of one bank option in the payment-method banks response. */
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

/** Pure snake→camel projection of one payment-method record. */
function mapPaymentMethod(raw: BackendPaymentMethod): PaymentMethodInfo {
  const catalog = getPaymentMethodCatalogDetails(raw.payment_method);
  return {
    id: raw.pk,
    payment_method: raw.payment_method,
    label: raw.label ?? raw.name ?? catalog.label,
    logo: raw.logo ?? raw.icon ?? catalog.logo,
    category: raw.category,
  };
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
  payment_method: CardPaymentMethod | SavedCardPaymentMethod | ApmPaymentMethod;
  client_reference: string;
  metadata?: Record<string, unknown>;
}

/**
 * Domain service that processes a one-shot payment via the Direct API.
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * `processPayment` POSTs to `/api/v1/process/` with `X-Request-Id` only
 * when the caller supplies an idempotency key. `presentation_mode` travels in
 * the request body so Direct API users and SDK users share the same contract.
 * Any transport
 * failure (the port throws, or an unknown error) is re-wrapped as
 * `AppError(PAYMENT_PROCESS_ERROR)`. An existing
 * `AppError` is re-thrown unchanged (no double-wrap), then normalized by the
 * caller. NOTE: a DECLINE is delivered as HTTP 200 with a decline `status` in
 * the body — it does NOT throw here.
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
   * List the business's active payment methods via
   * `GET /api/v1/payment_methods?status=active`.
   *
   * PURE: depends only on the injected {@link HttpPort}; the `Token` auth header
   * is attached by the transport. The snake_case records are mapped to the
   * public {@link PaymentMethodInfo} shape. Any transport failure is re-wrapped
   * as `AppError(FETCH_PAYMENT_METHODS_ERROR)`.
   */
  public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
    try {
      const raw = await this.http.request<
        BackendPaymentMethod[] | BackendPaymentMethodsPage
      >({
        method: 'GET',
        path: '/api/v1/payment_methods?status=active',
      });
      const methods = Array.isArray(raw) ? raw : raw.results;
      return methods.map(mapPaymentMethod);
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
