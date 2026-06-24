/** SDK runtime mode. Selects the base URL set used for all network calls. */
export type TonderMode = 'production' | 'sandbox' | 'stage';

/**
 * Resolved base hosts for a given {@link TonderMode}.
 *
 * Note: the Skyflow vault host is intentionally absent — `vault_id` / `vault_url`
 * are returned by the business-config endpoint at runtime, not hardcoded here.
 */
export interface TonderBaseUrls {
  /**
   * Tonder Direct API & core backend host. Serves `/api/v1/process/`,
   * `/api/v1/transactions/{id}/`, business config, `/customer/`, cards,
   * `/vault-token/`, `/tokenization/auth`, `/api/secure-token/`.
   */
  api: string;
  /**
   * Kushki acquirer microservices host. Serves `/acq-kushki/charge` and
   * `/acq-kushki/subscription/*` (used by the Card on File flow).
   */
  acquirer: string;
  /** Payflow SPA host — the 3DS / redirect landing the SDK embeds in an iframe. */
  payflow: string;
}

const ENV_URLS: Record<TonderMode, TonderBaseUrls> = {
  production: {
    api: 'https://app.tonder.io',
    acquirer: 'https://api.tonder.io',
    payflow: 'https://payflow.tonder.io',
  },
  stage: {
    api: 'https://stage.tonder.io',
    acquirer: 'https://api-stage.tonder.io',
    payflow: 'https://stage-payflow.tonder.io',
  },
  // There is no dedicated sandbox infrastructure — `sandbox` is an alias for the
  // stage environment (all hosts point at stage). Kept as a distinct, friendlier
  // mode name for integrators testing against stage.
  sandbox: {
    api: 'https://stage.tonder.io',
    acquirer: 'https://api-stage.tonder.io',
    payflow: 'https://stage-payflow.tonder.io',
  },
};

/**
 * Resolve the base URLs for a given mode. Defaults to `production` for any
 * unrecognized value to fail safe toward the locked-down environment.
 */
export function resolveEnv(mode: TonderMode): TonderBaseUrls {
  return ENV_URLS[mode] ?? ENV_URLS.production;
}
