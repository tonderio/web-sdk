/**
 * Card payment-method strategy.
 *
 * Pure function: builds the `payment_method` block of the `/api/v1/process/`
 * body from the Skyflow Collect tokens. The tokens are keyed by the INTERNAL
 * Skyflow snake_case column names returned by `TokenizerPort.collect()`
 * (`card_number, cvv, expiration_month, expiration_year, cardholder_name,
 * skyflow_id`). Only the five card fields are forwarded — `skyflow_id` and any
 * other key is intentionally dropped.
 *
 * PURE: no DOM, HTTP, or external-SDK imports.
 */

/** The `payment_method` block sent to the Direct API for a CARD charge. */
export interface CardPaymentMethod {
  type: 'CARD';
  card_number: string;
  cvv: string;
  expiration_month: string;
  expiration_year: string;
  cardholder_name: string;
}

/**
 * The `payment_method` block sent to the Direct API for a SAVED-card charge.
 * The stored `cardId` travels as `token`; the backend resolves it to the vault
 * references (and auto-detects the COF subscription). No raw card fields are
 * sent — nothing was collected.
 */
export interface SavedCardPaymentMethod {
  type: 'CARD';
  token: string;
}

/**
 * Build the CARD `payment_method` from the Skyflow snake_case collect tokens.
 * Tokens are vault references, not raw PAN/CVV — the SDK never sees card data.
 */
export function buildCardPaymentMethod(
  tokens: Record<string, string>,
): CardPaymentMethod {
  return {
    type: 'CARD',
    card_number: tokens.card_number ?? '',
    cvv: tokens.cvv ?? '',
    expiration_month: tokens.expiration_month ?? '',
    expiration_year: tokens.expiration_year ?? '',
    cardholder_name: tokens.cardholder_name ?? '',
  };
}

/**
 * Build the SAVED-card `payment_method` from a stored `cardId`. The id is
 * forwarded as `token`; the backend resolves it. Pure — no card data involved.
 */
export function buildSavedCardPaymentMethod(
  cardId: string,
): SavedCardPaymentMethod {
  return { type: 'CARD', token: cardId };
}
