import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** URL of the Skyflow Collect/Reveal browser SDK. */
const SKYFLOW_SDK_URL = 'https://js.skyflow.com/v1/index.js';

/**
 * State object Skyflow passes to an element event listener (CHANGE/BLUR/FOCUS/
 * READY). Mirrors the runtime payload used by the legacy Tonder SDKs; Skyflow's
 * own `.on()` handler is typed as `Function`, so this is the documented shape the
 * adapter reads (a superset of `CollectElement.getState()` plus `elementType`).
 */
export interface SkyflowElementState {
  elementType: string;
  isEmpty: boolean;
  isFocused: boolean;
  isValid: boolean;
  value: string;
}

/**
 * A mounted/created Skyflow Collect or Reveal element. Only the surface the
 * adapter uses is typed; Skyflow's real element exposes more.
 *
 * `on`/`setError`/`resetError`/`update` mirror the real `skyflow-js`
 * `CollectElement` signatures (validated against `skyflow-js` type defs and the
 * legacy Tonder SDKs) and are used to restore SDK-owned error labels on blur.
 */
export interface SkyflowElement {
  mount(domSelector: string): void;
  unmount?(): void;
  /** Subscribe to a Skyflow element event (`Skyflow.EventName.*`). */
  on?(eventName: string, handler: (state: SkyflowElementState) => void): void;
  /** Render a client-side error message inside the field. */
  setError?(message: string): void;
  /** Hosted Checkout-compatible error override API exposed by Skyflow runtime. */
  setErrorOverride?(message: string): void;
  /** Clear any error message previously set by `setError`. */
  resetError?(): void;
  /** Update element options (e.g. `errorTextStyles`) in place. */
  update?(options: Record<string, unknown>): void;
}

/** A Skyflow Collect container created from the Skyflow instance. */
export interface SkyflowCollectContainer {
  create(
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): SkyflowElement;
  collect(): Promise<{ records: { fields: Record<string, string> }[] }>;
}

/** A Skyflow Reveal container created from the Skyflow instance. */
export interface SkyflowRevealContainer {
  create(input: Record<string, unknown>): SkyflowElement;
  reveal(): Promise<unknown>;
}

/** A live Skyflow instance returned by `Skyflow.init`. */
export interface SkyflowInstance {
  container(type: string): SkyflowCollectContainer | SkyflowRevealContainer;
}

/** Options accepted by `Skyflow.init`. */
export interface SkyflowInitConfig {
  vaultID: string;
  vaultURL: string;
  getBearerToken: () => Promise<string>;
  options: { logLevel: string; env: string };
}

/**
 * The static `window.Skyflow` surface used by the adapter. Typing only what we
 * touch keeps the dependency on the external SDK explicit and narrow.
 */
export interface SkyflowStatic {
  init(config: SkyflowInitConfig): SkyflowInstance;
  ContainerType: { COLLECT: string; REVEAL: string };
  ElementType: {
    CVV: string;
    CARD_NUMBER: string;
    EXPIRATION_MONTH: string;
    EXPIRATION_YEAR: string;
    CARDHOLDER_NAME: string;
    INPUT_FIELD: string;
  };
  LogLevel: { ERROR: string };
  Env: { DEV: string; PROD: string };
  RedactionType: { MASKED: string; PLAIN_TEXT: string; [key: string]: string };
  ValidationRuleType: {
    LENGTH_MATCH_RULE: string;
    REGEX_MATCH_RULE: string;
  };
  /**
   * Skyflow element event names. Mirrors `skyflow-js`'s `EventName` enum
   * (`CHANGE`, `READY`, `FOCUS`, `BLUR`, `SUBMIT`); only the four the adapter
   * wires are typed here.
   */
  EventName: {
    CHANGE: string;
    BLUR: string;
    FOCUS: string;
    READY: string;
  };
}

/**
 * Loads the Skyflow SDK and resolves with its static surface. Injectable so unit
 * tests can substitute a fake (`() => Promise.resolve(fakeSkyflow)`) with no
 * script injection, network, or `window.Skyflow`.
 */
export type SkyflowSdkLoader = () => Promise<SkyflowStatic>;

interface SkyflowWindow extends Window {
  Skyflow?: SkyflowStatic;
}

/**
 * Production loader: lazily injects the Skyflow `<script>` once and resolves with
 * `window.Skyflow`. If the global is already present, it resolves immediately
 * without injecting. The single-load promise dedupes concurrent/repeat calls; a
 * load failure rejects with `AppError(SECURE_FIELDS_LOAD_ERROR)`.
 *
 * jsdom does NOT execute injected script tags, so the injection path is exercised
 * by integration tests only — unit tests inject a fake loader instead.
 */
export function createSkyflowLoader(): SkyflowSdkLoader {
  let loadPromise: Promise<SkyflowStatic> | null = null;

  return () => {
    const win = window as SkyflowWindow;
    if (typeof win.Skyflow !== 'undefined') {
      return Promise.resolve(win.Skyflow);
    }
    if (loadPromise) return loadPromise;

    loadPromise = new Promise<SkyflowStatic>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SKYFLOW_SDK_URL;
      script.async = true;
      script.onload = () => {
        const loaded = (window as SkyflowWindow).Skyflow;
        if (typeof loaded === 'undefined') {
          reject(
            new AppError({ errorCode: ErrorKeyEnum.SECURE_FIELDS_LOAD_ERROR }),
          );
          return;
        }
        resolve(loaded);
      };
      script.onerror = () => {
        loadPromise = null;
        reject(
          new AppError({ errorCode: ErrorKeyEnum.SECURE_FIELDS_LOAD_ERROR }),
        );
      };
      document.head.appendChild(script);
    });
    return loadPromise;
  };
}
