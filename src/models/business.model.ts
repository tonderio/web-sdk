/**
 * Business configuration returned by `GET /api/v1/payments/business/{apiKey}`.
 *
 * Mirrors the backend shape, plus the defaults for its own optional fields. NO
 * imports from `core/`, to avoid dependency cycles.
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
  /**
   * ISO 3166-1 alpha-2 country of the merchant, e.g. `'MX'`. Optional: the
   * backend does not always send it.
   *
   * NOT normalized here — this field reports what the API actually sent, so
   * "omitted" stays distinguishable from "sent MX" in captured state. Consumers
   * resolve {@link DEFAULT_BUSINESS_COUNTRY_CODE} at the point of READ instead.
   */
  country_code?: string;
}

/**
 * Country assumed when the business config carries no {@link
 * BusinessProfile.country_code}.
 *
 * Applied where the value is read, never written back into the model. Declared
 * beside the field it defaults rather than in a payment-method module, so a
 * second country-gated method cannot end up with a default that drifts.
 */
export const DEFAULT_BUSINESS_COUNTRY_CODE = 'MX';

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
 * Root-level Apple Pay block on the business config, sibling of `mercado_pago`.
 * Optional: the backend omits it for a business that was never enabled.
 */
export interface ApplePayConfig {
  enabled: boolean;
  /**
   * DECLARED, NEVER READ. It is not a field of `ApplePayPaymentRequest`; the
   * backend uses it server-side when it requests the merchant session. Typed so
   * the response shape is honest. Do NOT wire it in.
   */
  merchant_identifier?: string;
  /** PENDING: backend field name unconfirmed. Absent ⇒ SDK default. */
  supported_networks?: string[];
  /** PENDING: backend field name unconfirmed. Absent ⇒ capability omitted. */
  supports_debit?: boolean;
  /** PENDING: backend field name unconfirmed. Absent ⇒ capability omitted. */
  supports_credit?: boolean;
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
  /** Absent for a business the backend never enabled for Apple Pay. */
  apple_pay?: ApplePayConfig;
  vault_id: string;
  vault_url: string;
  /** Backend returns `"TNDR-{uuid}"` — a string, not a number. */
  reference: string;
  is_installments_available: boolean;
  cardonfile_keys: CardOnFileKeys | null;
}
