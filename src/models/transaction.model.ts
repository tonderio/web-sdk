/**
 * Transaction types returned by payment and transaction-status APIs.
 *
 * `RawTransaction` is the public transaction shape returned by both `pay()` and
 * `getTransaction()`. It is intentionally snake_case to match webhook and API
 * payloads, with `amount` normalized to a number. Read payment state from the
 * `status` field; the SDK does not wrap the transaction in an additional
 * result object.
 */

/** Redirect information included when the shopper must complete an extra action. */
export interface BackendNextAction {
  redirect_to_url?: {
    url: string;
    verify_transaction_status_url?: string;
  };
}

/**
 * Transport transaction response before SDK normalization.
 *
 * Exported for internal SDK composition. External integrations should use
 * {@link RawTransaction}, returned by `pay()` and `getTransaction()`.
 */
export interface BackendTransactionResponse {
  id: string;
  operation_type: string;
  status: string;
  /** Amount before public normalization. */
  amount: string;
  currency: string;
  client_reference?: string;
  metadata?: Record<string, unknown>;
  provider?: string;
  created_at?: string;
  status_code?: number;
  next_action?: BackendNextAction;
  decline_code?: string;
  decline_reason?: string;
  /** APM/SPEI: human-readable settlement instructions (OXXO reference, etc.). */
  payment_instructions?: Record<string, unknown>;
  /** APM/SPEI: URL of a printable voucher/receipt. */
  voucher_pdf?: string;
  /** SPEI: destination CLABE the customer transfers to (flat top-level). */
  clabe?: string;
  /** SPEI: destination bank name (flat top-level). */
  bank_name?: string;
  /** Processor response envelope removed from the public transaction shape. */
  psp_response?: unknown;
  /** Additional fields preserved by the SDK. */
  [key: string]: unknown;
}

/**
 * Public transaction shape returned by `pay()` and `getTransaction()`.
 *
 * The payload is snake_case for consistency with Tonder API and webhook data.
 * Known fields are typed for developer experience, and additional fields are
 * preserved for forward compatibility. Read the payment state from `status`
 * (for example, `"Success"`, `"Declined"`, or `"Pending"`).
 *
 * Precision note: `amount` is an IEEE-754 double. Amounts are bounded in
 * practice, so this is an accepted tradeoff.
 */
export interface RawTransaction {
  id: string;
  operation_type: string;
  /** Single payment-state field, e.g. "Success", "Declined", or "Pending". */
  status: string;
  /** Transaction amount normalized to a number. */
  amount: number;
  currency: string;
  client_reference?: string;
  metadata?: Record<string, unknown>;
  provider?: string;
  created_at?: string;
  status_code?: number;
  /** 3DS redirect / APM presentation payload, when present. */
  next_action?: BackendNextAction;
  decline_code?: string;
  decline_reason?: string;
  /** APM/SPEI settlement instructions, when present. */
  payment_instructions?: Record<string, unknown>;
  /** APM/SPEI printable voucher URL, when present. */
  voucher_pdf?: string;
  /** SPEI destination CLABE, when present. */
  clabe?: string;
  /** SPEI destination bank name, when present. */
  bank_name?: string;
  /** Forward-compatible passthrough for additional transaction fields. */
  [key: string]: unknown;
}

/**
 * Final transaction status values that indicate an unsuccessful payment.
 * Matching is case-insensitive.
 */
export const DECLINED_FINAL_STATUSES: ReadonlySet<string> = new Set([
  'declined',
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'canceled',
]);

/**
 * Normalize a transport transaction into the public {@link RawTransaction}.
 *
 * The source `raw` is not mutated.
 */
export function toRawTransaction(
  raw: BackendTransactionResponse,
): RawTransaction {
  const result: Record<string, unknown> = { ...raw };
  delete result.psp_response;
  result.amount = Number(raw.amount);
  return result as RawTransaction;
}
