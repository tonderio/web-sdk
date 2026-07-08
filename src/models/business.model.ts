/**
 * Business configuration returned by `GET /api/v1/payments/business/{apiKey}`.
 *
 * EXACT backend shape. Ported from ionic-lite's `Business` type with two bug
 * fixes vs. that source:
 *   1. `reference` is a `string` (backend returns `"TNDR-{uuid}"`), not a number.
 *   2. `cardonfile_keys` is `{ public_key: string | null } | null` — the backend
 *      omits/ nulls the COF block for merchants without Card-on-File enabled.
 *
 * Pure type module: NO imports from `core/` to avoid dependency cycles.
 */

/** A merchant category tag attached to the business. */
export interface BusinessCategory {
  pk: number;
  name: string;
}

/** Branding + identity block for the merchant. */
export interface BusinessProfile {
  pk: number;
  name: string;
  categories: BusinessCategory[];
  web: string;
  logo: string;
  full_logo_url: string;
  background_color: string;
  primary_color: string;
  checkout_mode: boolean;
  textCheckoutColor: string;
  textDetailsColor: string;
  checkout_logo: string;
}

/** Openpay acquirer credentials (publishable). */
export interface OpenpayKeys {
  merchant_id: string;
  public_key: string;
}

/** Fintoc acquirer credentials (publishable). */
export interface FintocKeys {
  public_key: string;
}

/** Mercado Pago availability flag. */
export interface MercadoPagoConfig {
  active: boolean;
}

/**
 * Card-on-File publishable key block. Nullable: backend returns `null` (or omits
 * `public_key`) for merchants without COF enabled.
 */
export interface CardOnFileKeys {
  public_key: string | null;
}

/** Full business configuration document. */
export interface BusinessConfig {
  business: BusinessProfile;
  openpay_keys: OpenpayKeys;
  fintoc_keys: FintocKeys;
  mercado_pago: MercadoPagoConfig;
  vault_id: string;
  vault_url: string;
  /** Backend returns `"TNDR-{uuid}"` — a string, not a number. */
  reference: string;
  is_installments_available: boolean;
  cardonfile_keys: CardOnFileKeys | null;
}
