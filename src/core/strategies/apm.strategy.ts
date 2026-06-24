/**
 * Alternative Payment Method (APM) and SPEI payment-method strategies.
 *
 * Pure functions: build the `payment_method` block of the `/api/v1/process/`
 * body for an APM (OXXO, SafetyPay, etc.), SPEI, or any other configured alternative payment method. The facade owns
 * validation and decides which builder to call; these shapers stay pure.
 *
 * PURE: no DOM, HTTP, or external-SDK imports.
 */

/** The `payment_method` block sent to the Direct API for an alternative-method charge. */
export interface ApmPaymentMethod {
  /** Payment method code sent to the Direct API. SafetyPay is canonicalized for the downstream processor. */
  type: string;
  /** Optional method-specific configuration (country, channel, bank_ids, …). */
  apm_config?: Record<string, unknown>;
}

/**
 * Build the Direct API `payment_method` from a public payment method code and optional config. The code
 * is normalized into `type`; `apm_config` is included only when a non-empty
 * config object is provided (an absent or empty config is omitted entirely).
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
