/**
 * Card payment-method strategy.
 *
 * These helpers build payment-method request data from secure card-field tokens
 * or saved-card identifiers. The SDK never handles raw PAN/CVV in merchant code.
 */

/** Payment-method request data for a new-card charge. */
export interface CardPaymentMethod {
  type: 'CARD';
  card_number: string;
  cvv: string;
  expiration_month: string;
  expiration_year: string;
  cardholder_name: string;
}

/**
 * Payment-method request data for a saved-card charge.
 * The stored `cardId` is sent as a token reference. No raw card fields are
 * collected or sent.
 */
export interface SavedCardPaymentMethod {
  type: 'CARD';
  token: string;
}

/**
 * Build new-card payment-method data from secure card-field tokens. Tokens are
 * references, not raw PAN/CVV.
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

/** Build saved-card payment-method data from a stored `cardId`. */
export function buildSavedCardPaymentMethod(
  cardId: string,
): SavedCardPaymentMethod {
  return { type: 'CARD', token: cardId };
}
