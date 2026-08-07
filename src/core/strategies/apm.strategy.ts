/**
 * Alternative Payment Method (APM) and SPEI payment-method strategies.
 *
 * These helpers build payment-method request data for OXXO, SafetyPay, SPEI,
 * and other configured alternative payment methods. They do not touch DOM,
 * network, or card data.
 */

/** Payment-method request data for an alternative-method charge. */
export interface ApmPaymentMethod {
  /** Payment method code, exactly as the merchant wrote it. */
  type: string;
  /** Optional method-specific configuration (country, channel, bank_ids, …). */
  apm_config?: Record<string, unknown>;
}

/**
 * Build payment-method data from a public payment method code and optional
 * config. `apm_config` is included only when a non-empty config object is
 * provided.
 *
 * The code travels through EXACTLY as the merchant wrote it. The SDK used to
 * re-case it, which meant the same value reached Tonder differently depending
 * on whether it arrived through the SDK or server-to-server — and the backend
 * stores this string verbatim, so the merchant's own webhook then echoed a
 * spelling they never typed. Comparisons downstream normalize on their side.
 *
 * Card is the one exception, and not by preference: `saved_card` has no
 * backend counterpart and has to be translated to `CARD` + token, so the card
 * paths emit `CARD` to keep one merchant's card and saved-card charges from
 * reporting under two different values.
 */
export function buildApmPaymentMethod({
  apm,
  config,
}: {
  apm: string;
  config?: Record<string, unknown>;
}): ApmPaymentMethod {
  const method: ApmPaymentMethod = { type: apm };
  if (config && Object.keys(config).length > 0) {
    method.apm_config = config;
  }
  return method;
}

/** Build the SPEI `payment_method`. */
