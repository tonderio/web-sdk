/**
 * Saved-card types used by card enrollment and customer card management.
 *
 * The public {@link Card} shape contains display-safe card data only. The card
 * number is masked (for example, `"XXXX-XXXX-XXXX-1234"`) and never contains a
 * full PAN or CVV.
 */

/** Transport card entry before public mapping. */
export interface BackendCard {
  fields: {
    /** Masked PAN, e.g. `"XXXX-XXXX-XXXX-1234"`. */
    card_number: string;
    expiration_month: string;
    expiration_year: string;
    skyflow_id: string;
    subscription_id: string | null;
    card_scheme: string;
  };
}

/** Transport response for a customer's saved-card list. */
export interface BackendCardsResponse {
  user_id: string;
  cards: BackendCard[];
}

/** Public saved-card summary returned to integrations. Holds no secrets. */
export interface Card {
  card_id: string;
  /** Masked PAN — never the full card number. */
  card_number: string;
  expiration_month: string;
  expiration_year: string;
  card_scheme: string;
  subscription_id: string | null;
}

/** Request body used by the SDK when saving a card. */
export interface SaveCardRequest {
  skyflow_id: string;
  subscription_id?: string;
}

/** Transport response returned after saving a card. */
export interface SaveCardBackendResponse {
  skyflow_id: string;
  user_id: string;
  /** Card BIN (first digits), when available. */
  card_bin?: string;
}

/** Map a transport card entry to the public camelCase {@link Card}. */
export function mapToCard(raw: BackendCard): Card {
  const { fields } = raw;
  return {
    card_id: fields.skyflow_id,
    card_number: fields.card_number,
    expiration_month: fields.expiration_month,
    expiration_year: fields.expiration_year,
    card_scheme: fields.card_scheme,
    subscription_id: fields.subscription_id,
  };
}
