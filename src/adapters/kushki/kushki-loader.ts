import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** URL of the acquirer browser SDK. */
const ACQUIRER_SDK_URL = 'https://cdn.kushkipagos.com/kushki.min.js';

/** Card payload accepted by the acquirer secure-init call. */
export interface KushkiSecureInitRequest {
  card: { number: string };
}

/** Result of the acquirer secure-init call (carries the device data token). */
export interface KushkiSecureInitResponse {
  jwt?: string;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

/** Input for the acquirer 3DS validation call. */
export interface KushkiValidate3DSRequest {
  secureId: string;
  security: unknown;
}

/** Result of the acquirer 3DS validation call. */
export interface KushkiValidate3DSResponse {
  code?: string;
  isValid?: boolean;
  message?: string;
  [key: string]: unknown;
}

/** Node-style callback used by the acquirer SDK. */
export type KushkiCallback<T> = (response: T) => void;

/** A live acquirer instance created via `new Kushki(options)`. */
export interface KushkiInstance {
  requestSecureInit(
    request: KushkiSecureInitRequest,
    callback: KushkiCallback<KushkiSecureInitResponse>,
  ): void;
  requestValidate3DS(
    request: KushkiValidate3DSRequest,
    callback: KushkiCallback<KushkiValidate3DSResponse>,
  ): void;
}

/** Options accepted by the acquirer constructor. */
export interface KushkiInitOptions {
  merchantId: string;
  inTestEnvironment: boolean;
}

/**
 * The constructable `window.Kushki` surface used by the adapter. Typing only
 * what we touch keeps the dependency on the external SDK explicit and narrow.
 */
export interface KushkiStatic {
  new (options: KushkiInitOptions): KushkiInstance;
}

/**
 * Loads the acquirer SDK and resolves with its constructable surface. Injectable
 * so unit tests can substitute a fake (`() => Promise.resolve(fakeKushki)`) with
 * no script injection, network, or `window.Kushki`.
 */
export type KushkiSdkLoader = () => Promise<KushkiStatic>;

interface KushkiWindow extends Window {
  Kushki?: KushkiStatic;
}

/**
 * Production loader: lazily injects the acquirer `<script>` once and resolves
 * with `window.Kushki`. If the global is already present, it resolves
 * immediately without injecting. The single-load promise dedupes
 * concurrent/repeat calls; a load failure rejects with
 * `AppError(ACQUIRER_LOAD_ERROR)`.
 *
 * jsdom does NOT execute injected script tags, so the injection path is
 * exercised by integration tests only — unit tests inject a fake loader instead.
 */
export function createKushkiLoader(): KushkiSdkLoader {
  let loadPromise: Promise<KushkiStatic> | null = null;

  return () => {
    const win = window as KushkiWindow;
    if (typeof win.Kushki !== 'undefined') {
      return Promise.resolve(win.Kushki);
    }
    if (loadPromise) return loadPromise;

    loadPromise = new Promise<KushkiStatic>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ACQUIRER_SDK_URL;
      script.async = true;
      script.onload = () => {
        const loaded = (window as KushkiWindow).Kushki;
        if (typeof loaded === 'undefined') {
          reject(new AppError({ errorCode: ErrorKeyEnum.ACQUIRER_LOAD_ERROR }));
          return;
        }
        resolve(loaded);
      };
      script.onerror = () => {
        loadPromise = null;
        reject(new AppError({ errorCode: ErrorKeyEnum.ACQUIRER_LOAD_ERROR }));
      };
      document.head.appendChild(script);
    });
    return loadPromise;
  };
}
