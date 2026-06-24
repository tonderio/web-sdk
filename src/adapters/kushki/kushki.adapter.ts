import type { HttpPort } from '../../ports/http.port';
import type {
  AcquirerPort,
  CofSubscriptionInput,
  CofSubscriptionResult,
} from '../../ports/acquirer.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import type {
  KushkiInstance,
  KushkiSdkLoader,
  KushkiSecureInitResponse,
  KushkiStatic,
  KushkiValidate3DSResponse,
} from './kushki-loader';

/** Milliseconds before a pending acquirer SDK callback is treated as declined. */
const CALLBACK_TIMEOUT_MS = 15000;

/** 3DS validation success code returned by the acquirer SDK. */
const THREE_DS_OK_CODE = '3DS000';

/** Dependencies injected into the adapter (the testability seam). */
export interface KushkiAdapterDeps {
  loader: KushkiSdkLoader;
  /** HTTP transport bound to the acquirer base URL (paths are `/acq-kushki/*`). */
  http: HttpPort;
  /** Publishable key sent as `Authorization: Token <apiKey>`. */
  apiKey: string;
  isTestEnvironment: boolean;
}

/** Raw token response from `/acq-kushki/subscription/token` (root or nested). */
interface TokenResponseShape {
  token?: string;
  secureId?: string;
  security?: unknown;
  details?: {
    token?: string;
    secureId?: string;
    security?: unknown;
  };
}

/**
 * Card-on-File acquirer adapter. Implements {@link AcquirerPort} and is the ONLY
 * place that touches the external acquirer SDK. Initialization is lazy: the SDK
 * loads and `new Kushki(...)` runs on the first `createCofSubscription`.
 *
 * The SDK loader and {@link HttpPort} are injected so unit tests run with a fake
 * acquirer and a mock transport — no script injection, network, or real browser.
 * The two SDK callbacks (`requestSecureInit`, `requestValidate3DS`) are
 * promisified with a 15s timeout; any timeout or decline surfaces as
 * `AppError(CARD_ON_FILE_DECLINED)`.
 */
export class KushkiAdapter implements AcquirerPort {
  private readonly deps: KushkiAdapterDeps;
  private kushki: KushkiStatic | null = null;
  private instance: KushkiInstance | null = null;
  private instanceMerchantId: string | null = null;

  constructor(deps: KushkiAdapterDeps) {
    this.deps = deps;
  }

  public async createCofSubscription(
    input: CofSubscriptionInput,
  ): Promise<CofSubscriptionResult> {
    const instance = await this.ensureInstance(input.merchantId);

    const jwt = await this.requestSecureInit(instance, input.cardBin);
    const { token, secureId, security } = await this.requestToken(input, jwt);
    await this.requestValidate3DS(instance, secureId, security);
    const subscriptionId = await this.requestCreate(input, token);

    return { subscriptionId };
  }

  /** Lazily loads the SDK and constructs a `Kushki` instance once per merchant. */
  private async ensureInstance(merchantId: string): Promise<KushkiInstance> {
    if (this.instance && this.instanceMerchantId === merchantId) {
      return this.instance;
    }
    if (!this.kushki) {
      this.kushki = await this.deps.loader();
    }
    const instance = new this.kushki({
      merchantId,
      inTestEnvironment: this.deps.isTestEnvironment,
    });
    this.instance = instance;
    this.instanceMerchantId = merchantId;
    return instance;
  }

  private async requestSecureInit(
    instance: KushkiInstance,
    cardBin: string,
  ): Promise<string> {
    const response = await this.promisifyWithTimeout<KushkiSecureInitResponse>(
      (cb) => instance.requestSecureInit({ card: { number: cardBin } }, cb),
    );
    if (response.code || !response.jwt) {
      throw new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED });
    }
    return response.jwt;
  }

  private async requestToken(
    input: CofSubscriptionInput,
    jwt: string,
  ): Promise<{ token: string; secureId: string; security: unknown }> {
    const raw = await this.deps.http.request<TokenResponseShape>({
      method: 'POST',
      path: '/acq-kushki/subscription/token',
      headers: this.authHeaders(),
      body: {
        card: {
          name: input.cardTokens.name,
          number: input.cardTokens.number,
          expiryMonth: input.cardTokens.expiryMonth,
          expiryYear: input.cardTokens.expiryYear,
          cvv: input.cardTokens.cvv,
        },
        currency: input.currency,
        jwt,
      },
    });
    const source = raw.details ?? raw;
    if (!source.token || !source.secureId) {
      throw new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED });
    }
    return {
      token: source.token,
      secureId: source.secureId,
      security: source.security,
    };
  }

  private async requestValidate3DS(
    instance: KushkiInstance,
    secureId: string,
    security: unknown,
  ): Promise<void> {
    const response = await this.promisifyWithTimeout<KushkiValidate3DSResponse>(
      (cb) => instance.requestValidate3DS({ secureId, security }, cb),
    );
    const ok =
      response.code === THREE_DS_OK_CODE ||
      (response.code === undefined && response.isValid !== false);
    if (!ok) {
      throw new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED });
    }
  }

  private async requestCreate(
    input: CofSubscriptionInput,
    token: string,
  ): Promise<string> {
    const raw = await this.deps.http.request<{ subscriptionId?: string }>({
      method: 'POST',
      path: '/acq-kushki/subscription/create',
      headers: this.authHeaders(),
      body: {
        token,
        contactDetails: {
          firstName: input.contact.firstName,
          lastName: input.contact.lastName,
          email: input.contact.email,
        },
        metadata: { customerId: input.customerId },
        currency: input.currency,
      },
    });
    if (!raw.subscriptionId) {
      throw new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED });
    }
    return raw.subscriptionId;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Token ${this.deps.apiKey}` };
  }

  /**
   * Wrap a callback-style SDK call in a promise that rejects with
   * `CARD_ON_FILE_DECLINED` if the callback does not fire within 15s.
   */
  private promisifyWithTimeout<T>(
    run: (callback: (response: T) => void) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED }));
      }, CALLBACK_TIMEOUT_MS);

      run((response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      });
    });
  }
}
