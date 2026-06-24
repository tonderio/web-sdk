// Centralized env-var access for the E2E suite. NO secrets live in the repo —
// every credential and test PAN is supplied at run time via these vars. Reads
// are lazy: `requireEnv` throws a descriptive error only when a test actually
// needs a missing var (never at module load), so the suite stays importable and
// `--list`-able with zero env configured.

/** Names of every env var the suite understands. */
export const ENV_KEYS = {
  api_key: 'TONDER_STAGE_API_KEY',
  secure_tokenEndpoint: 'TONDER_STAGE_SECURE_TOKEN_ENDPOINT',
  customerEmail: 'TONDER_STAGE_CUSTOMER_EMAIL',
  panFrictionless: 'TONDER_SKYFLOW_PAN_FRICTIONLESS',
  panThreeDsChallenge: 'TONDER_SKYFLOW_PAN_THREEDS_CHALLENGE',
  panDecline: 'TONDER_SKYFLOW_PAN_DECLINE',
  existingTxId: 'TONDER_STAGE_EXISTING_TX_ID',
  devs2245OnStage: 'TONDER_DEVS_2245_ON_STAGE',
} as const;

/** Read an optional env var (undefined when unset or empty). */
export function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value : undefined;
}

/** Read a required env var or throw a descriptive error at call time. */
export function requireEnv(key: string): string {
  const value = readEnv(key);
  if (value === undefined) {
    throw new Error(
      `[e2e] Required environment variable ${key} is not set. ` +
        `This test needs live STAGE credentials; set it or let the suite skip.`,
    );
  }
  return value;
}

/** Resolved, typed access to the common credentials a test uses. */
export const env = {
  api_key: () => requireEnv(ENV_KEYS.api_key),
  secure_tokenEndpoint: () => requireEnv(ENV_KEYS.secure_tokenEndpoint),
  customerEmail: () => requireEnv(ENV_KEYS.customerEmail),
  panFrictionless: () => requireEnv(ENV_KEYS.panFrictionless),
  panThreeDsChallenge: () => requireEnv(ENV_KEYS.panThreeDsChallenge),
  panDecline: () => requireEnv(ENV_KEYS.panDecline),
  existingTxId: () => readEnv(ENV_KEYS.existingTxId),
  devs2245OnStage: () => readEnv(ENV_KEYS.devs2245OnStage) !== undefined,
} as const;

/** Stable return URL pointing back at the fixture page for redirect flows. */
export function fixtureReturnUrl(baseURL: string): string {
  return new URL('/checkout.html', baseURL).toString();
}
