/** SDK runtime mode. Selects the base URL set used for all network calls. */
export type TonderMode = 'production' | 'sandbox' | 'stage';

/**
 * Resolved base hosts for a given {@link TonderMode}.
 *
 * Note: secure card-field hosts are resolved at runtime from the business
 * configuration instead of being hardcoded here.
 */
export interface TonderBaseUrls {
  /** Tonder API host used by the SDK runtime. */
  api: string;
  /** Card processing host used by card and Card-on-File flows. */
  acquirer: string;
  /** Hosted payment/authentication page host used for embedded or redirect flows. */
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
