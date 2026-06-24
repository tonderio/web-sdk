/**
 * Alternative Payment Method (APM) and SPEI payment-method strategies.
 *
 * These helpers build payment-method request data for OXXO, SafetyPay, SPEI,
 * and other configured alternative payment methods. They do not touch DOM,
 * network, or card data.
 */

/** Payment-method request data for an alternative-method charge. */
export interface ApmPaymentMethod {
  /** Payment method code. SafetyPay codes are normalized by the SDK runtime. */
  type: string;
  /** Optional method-specific configuration (country, channel, bank_ids, …). */
  apm_config?: Record<string, unknown>;
}

/**
 * Build payment-method data from a public payment method code and optional
 * config. The code is normalized into `type`; `apm_config` is included only
 * when a non-empty config object is provided.
 */
export function buildApmPaymentMethod({
  apm,
  config,
}: {
  apm: string;
  config?: Record<string, unknown>;
}): ApmPaymentMethod {
  const method: ApmPaymentMethod = { type: normalizeApmType(apm) };
  if (config && Object.keys(config).length > 0) {
    method.apm_config = config;
  }
  return method;
}

function normalizeApmType(apm: string): string {
  const normalized = apm.toLowerCase();
  if (normalized === 'safetypaycash') {
    return 'safetypayCash';
  }
  if (normalized === 'safetypaytransfer') {
    return 'safetypayTransfer';
  }
  return normalized;
}

/** Build the SPEI `payment_method`. */
