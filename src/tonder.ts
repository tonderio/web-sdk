import { FetchHttpClient } from './adapters/http/fetch-http.client';
import { createKushkiLoader } from './adapters/kushki/kushki-loader';
import { KushkiAdapter } from './adapters/kushki/kushki.adapter';
import { createSkyflowLoader } from './adapters/skyflow/skyflow-loader';
import { SkyflowAdapter } from './adapters/skyflow/skyflow.adapter';
import { ServiceManager } from './core/ServiceManager';
import { BusinessService } from './core/services/business.service';
import { CardService } from './core/services/card.service';
import { CofService, type EnrollParams } from './core/services/cof.service';
import { CustomerService } from './core/services/customer.service';
import {
  DirectApiService,
  type ProcessPaymentBody,
} from './core/services/direct-api.service';
import { VaultService } from './core/services/vault.service';
import {
  buildCardPaymentMethod,
  buildSavedCardPaymentMethod,
} from './core/strategies/card.strategy';
import { buildApmPaymentMethod } from './core/strategies/apm.strategy';
import {
  buildProcessBody,
  scopeRequestId,
  DEFAULT_CURRENCY,
  DEFAULT_PRESENTATION_MODE,
} from './core/strategies/process-body.strategy';
import { TonderCore } from './core/TonderCore';
import {
  isSuccessfulStatus,
  toRawTransaction,
} from './models/transaction.model';
import { toPublicPaymentMethods } from './models/payment-method.model';
import { DEFAULT_BUSINESS_COUNTRY_CODE } from './models/business.model';
import type { RawTransaction } from './models/transaction.model';
import { Browser3dsHost } from './adapters/browser/browser-3ds-host.adapter';
import { BrowserApplePay } from './adapters/browser/apple-pay.adapter';
import { ApplePayService } from './core/services/apple-pay.service';
import { ApplePayCheckoutService } from './core/services/apple-pay-checkout.service';
import type {
  ApplePayAdapter,
  ApplePayButtonDisposer,
} from './ports/apple-pay.port';
import type {
  ApplePayAvailability,
  ApplePayButtonComponent,
  ApplePayButtonOptions,
} from './types/apple-pay';
import { BrowserCheckoutMessenger } from './adapters/browser/browser-checkout-messenger.adapter';
import type { ThreeDsHostPort } from './ports/threeds-host.port';
import type { CheckoutMessengerPort } from './ports/checkout-messenger.port';
import { pollUntilFinal, type PollOptions } from './shared/utils/poll';
import type { AcquirerPort } from './ports/acquirer.port';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import { resolveEnv, type TonderBaseUrls } from './shared/config/env';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import { invokeMerchantCallback } from './shared/merchant-callback';
import type { Card } from './models/card.model';
import type {
  PaymentMethodBanks,
  EnrollResult,
  PayInput,
  PaymentEvents,
  PaymentEventSink,
  PaymentMethodInfo,
  PresentationEvents,
  TonderConfig,
} from './shared/types';
import type {
  CardFieldsComponent,
  CardFieldsOptions,
  CardFieldEntry,
  ComponentByType,
  ComponentOptionsByType,
  RevealCardFieldsInput,
  TonderComponentType,
} from './types/card';
import type { CardFieldsCustomization } from './types/customization';

const VALID_MODES = ['production', 'sandbox', 'stage'] as const;

const BUSINESS_SERVICE_KEY = 'business';
const VAULT_SERVICE_KEY = 'vault';
const DIRECT_API_SERVICE_KEY = 'directApi';
const CUSTOMER_SERVICE_KEY = 'customer';
const CARD_SERVICE_KEY = 'card';

/** Container selector used when `ApplePayButtonOptions.container_id` is omitted. */
const DEFAULT_APPLE_PAY_CONTAINER_ID = '#tonder-apple-pay-button';

/** Short post-message reconciliation window for embedded card 3DS. */
const EMBEDDED_RECONCILE_TIMEOUT_MS = 30_000;

/**
 * Unavailable answer for the Apple Pay probe.
 *
 * The message comes from the same resolver `AppError` uses, so the reason a
 * merchant reads here is word-for-word the one the matching thrown error
 * carries. No `Error` is constructed: nothing here is exceptional, and the
 * probe may run on every render.
 */
function unavailableApplePay(code: string): ApplePayAvailability {
  return {
    available: false,
    code,
    message: AppError.resolveMessage(code),
  };
}

const DEFAULT_CARD_FIELDS: CardFieldEntry[] = [
  'cardholder_name',
  'card_number',
  'expiration_month',
  'expiration_year',
  'cvv',
];

interface ResolvedPaymentMethod {
  paymentMethod: ProcessPaymentBody['payment_method'];
  enrolledCardId?: string;
  rollbackAuth?: Pick<EnrollParams, 'businessPk' | 'secureToken' | 'userToken'>;
}

function assertValidConfig(config: TonderConfig): void {
  if (!config || typeof config !== 'object') {
    throw new AppError({ errorCode: ErrorKeyEnum.INIT_ERROR });
  }
  if (!config.api_key || typeof config.api_key !== 'string') {
    throw new AppError({
      errorCode: ErrorKeyEnum.INIT_ERROR,
      details: { system_error: 'config.api_key is required.' },
    });
  }
  if (!VALID_MODES.includes(config.environment)) {
    throw new AppError({
      errorCode: ErrorKeyEnum.INIT_ERROR,
      details: { system_error: 'config.environment is required.' },
    });
  }
}

/**
 * Main Tonder Web SDK client.
 *
 * Create one instance per shopper/session with {@link createTonder}. Read-only
 * methods such as {@link getTransaction} can be used without `session.customer`;
 * customer-dependent methods such as {@link pay}, {@link enrollCard},
 * {@link getCustomerCards}, and {@link removeCustomerCard} require it.
 */
export class Tonder {
  readonly #core: TonderCore;
  readonly #services: ServiceManager;
  readonly #env: TonderBaseUrls;
  readonly #http: HttpPort;
  readonly #businessService: BusinessService;
  readonly #vaultService: VaultService;
  readonly #directApiService: DirectApiService;
  readonly #customerService: CustomerService;
  readonly #cardService: CardService;
  readonly #tokenizer: TokenizerPort;
  readonly #acquirer: AcquirerPort;
  readonly #cofService: CofService;
  readonly #host: ThreeDsHostPort;
  readonly #messenger: CheckoutMessengerPort;
  readonly #applePay: ApplePayAdapter;
  readonly #applePayService: ApplePayService;
  readonly #mountedCardFields = new Map<string, CardFieldsOptions>();

  constructor(
    config: TonderConfig,
    http?: HttpPort,
    tokenizer?: TokenizerPort,
    acquirer?: AcquirerPort,
    host?: ThreeDsHostPort,
    messenger?: CheckoutMessengerPort,
    // TYPED `unknown` ON PURPOSE. `rollup-plugin-dts` inlines every public
    // signature into `dist/index.d.ts`, so typing this `ApplePayAdapter` drags
    // in the ambient `ApplePayJS` namespace from the `@types/applepayjs`
    // devDependency: the published declarations then fail to compile for every
    // merchant without Apple's types, with `TS2503: Cannot find namespace
    // 'ApplePayJS'`. The fully-typed injection seam is
    // `_createTonderWithDeps({ applePay })` below, which never ships.
    applePay?: unknown,
  ) {
    assertValidConfig(config);
    // Supplied from here rather than the core, so `core/` stays free of browser
    // globals.
    this.#core = new TonderCore(config, (field) => {
      console.warn(
        `[tonder] config.${field} was changed after createTonder() and has no effect. ` +
          `The config is copied when the instance is created — create a new instance to change it.`,
      );
    });
    this.#services = new ServiceManager();
    this.#env = resolveEnv(config.environment);
    this.#http = http ?? new FetchHttpClient(this.#env.api, config.api_key);
    this.#businessService = new BusinessService(this.#http);
    this.#vaultService = new VaultService(this.#http);
    this.#directApiService = new DirectApiService(this.#http);
    this.#customerService = new CustomerService(this.#http);
    this.#cardService = new CardService(this.#http);
    this.#applePayService = new ApplePayService(this.#http);
    this.#services.register(BUSINESS_SERVICE_KEY, this.#businessService);
    this.#services.register(VAULT_SERVICE_KEY, this.#vaultService);
    this.#services.register(DIRECT_API_SERVICE_KEY, this.#directApiService);
    this.#services.register(CUSTOMER_SERVICE_KEY, this.#customerService);
    this.#services.register(CARD_SERVICE_KEY, this.#cardService);
    // Off the core's copy, not the parameter: the tokenizer keeps this
    // sub-object for the instance's lifetime, so reading the merchant's own
    // object would leave them holding a live wire into it.
    const card_fieldsCustomization =
      this.#core.getConfig().customization?.card_fields;
    this.#tokenizer =
      tokenizer ??
      new SkyflowAdapter({
        loader: createSkyflowLoader(),
        vaultService: this.#vaultService,
        getVaultConfig: () => {
          const business = this.#core.getState().business;
          return business
            ? { vault_id: business.vault_id, vault_url: business.vault_url }
            : null;
        },
        mode: config.environment,
        customization: card_fieldsCustomization as
          | CardFieldsCustomization
          | undefined,
        error_messages: card_fieldsCustomization?.error_messages,
      });
    this.#acquirer =
      acquirer ??
      new KushkiAdapter({
        loader: createKushkiLoader(),
        http: new FetchHttpClient(this.#env.acquirer, config.api_key),
        apiKey: config.api_key,
        isTestEnvironment: config.environment !== 'production',
      });
    this.#cofService = new CofService(
      this.#cardService,
      this.#tokenizer,
      this.#acquirer,
    );
    this.#host = host ?? new Browser3dsHost();
    this.#messenger =
      messenger ?? new BrowserCheckoutMessenger(new Set([this.#env.payflow]));
    // SSR-safe: the browser adapter's DOM and `globalThis` reads all live
    // inside method bodies, so constructing one outside a browser cannot throw.
    // The cast is checked one level up by `_createTonderWithDeps`.
    this.#applePay =
      (applePay as ApplePayAdapter | undefined) ?? new BrowserApplePay();
  }

  /**
   * Whether Apple Pay can be offered right now, and why not when it cannot.
   *
   * Returns `{ available: true }`, or `{ available: false, code, message }`.
   * Branch on `available` — TypeScript narrows the reason fields from it. The
   * `code` is one of:
   *
   * - `NOT_INITIALIZED` — `init()` has not finished yet.
   * - `APPLE_PAY_UNSUPPORTED_BROWSER` — this browser cannot run Apple Pay.
   * - `APPLE_PAY_NOT_ENABLED` — Apple Pay is off for this business.
   *
   * WHAT `available: true` MEANS: the browser exposes Apple Pay and your
   * business has it enabled. It does NOT promise the payment sheet will open.
   * No synchronous check can promise that — in the iOS Simulator, for example,
   * the browser reports it can make payments and Apple then dismisses the sheet
   * as soon as the button is tapped. Treat `true` as "render the button" and
   * handle the payment events for what happens after the tap.
   *
   * Synchronous, no network, and NEVER throws — including before `init()`.
   *
   * When two reasons apply at once, the reported one is the first in the list
   * above, which is the order `mount()` checks them in. `mount()` deliberately
   * does NOT call this method: it throws a distinct code per failed check, so
   * the two must be kept in step by hand.
   *
   * The business country is deliberately NOT a term here — it resolves to
   * {@link DEFAULT_BUSINESS_COUNTRY_CODE} at every read site, so testing it
   * would gate nothing while hiding the button from an enabled business.
   */
  public isApplePayAvailable(): ApplePayAvailability {
    const state = this.#core.getState();
    if (state.lifecycle !== 'ready') {
      return unavailableApplePay(ErrorKeyEnum.NOT_INITIALIZED);
    }
    if (!this.#applePay.canUseApplePay()) {
      return unavailableApplePay(ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER);
    }
    if (!state.business?.apple_pay?.enabled) {
      return unavailableApplePay(ErrorKeyEnum.APPLE_PAY_NOT_ENABLED);
    }
    return { available: true };
  }

  /**
   * Create a UI component handle.
   *
   * Today the supported component type is `'card_fields'`. Use the returned
   * handle to mount secure card fields, unmount them, or reveal display-safe
   * saved-card values. Pass `card_id` in the component options when collecting
   * the CVV for a saved card.
   */
  public create<T extends TonderComponentType>(
    type: T,
    options?: ComponentOptionsByType[T],
  ): ComponentByType[T] {
    if (type === 'card_fields') {
      // TypeScript cannot narrow a generic return type from a value-level
      // `type === ...` check, so the dispatch branch carries the cast.
      return this.createCardFieldsComponent(
        options as CardFieldsOptions,
      ) as ComponentByType[T];
    }
    if (type === 'apple_pay_button') {
      return this.createApplePayButtonComponent(
        options as ApplePayButtonOptions,
      ) as ComponentByType[T];
    }
    throw new AppError({ errorCode: ErrorKeyEnum.INVALID_COMPONENT_TYPE });
  }

  /**
   * Build an `'apple_pay_button'` component handle.
   *
   * `dispose` and `checkout` are CLOSURE variables, so every component owns its
   * own session. With one service per `Tonder`, a second button's `unmount()`
   * would abort the first button's live sheet.
   */
  private createApplePayButtonComponent(
    options: ApplePayButtonOptions | undefined,
  ): ApplePayButtonComponent {
    // `create<T>()`'s `options?` is optional for every `T`, so this call
    // type-checks with nothing passed even though `payment` is required.
    // Guarding here keeps the failure at `create()` instead of a `TypeError`
    // reading `.amount` at click time.
    if (!options?.payment) {
      throw new AppError({
        errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
        details: {
          system_error: "create('apple_pay_button') requires options.payment.",
        },
      });
    }

    let dispose: ApplePayButtonDisposer | undefined;
    const checkout = new ApplePayCheckoutService({
      applePay: this.#applePay,
      validation: this.#applePayService,
      directApi: this.#directApiService,
      getContext: () => {
        const state = this.#core.getState();
        return {
          applePay: state.business?.apple_pay,
          customer: this.#core.getConfig().session?.customer,
          presentationMode:
            this.#core.getConfig().presentation_mode ??
            DEFAULT_PRESENTATION_MODE,
          businessPk: state.business?.business.pk,
        };
      },
      emit: this.#paymentEvents,
    });

    return {
      // `async` only because `TonderMountableComponent.mount()` says so. It
      // awaits nothing, and it is not part of the click path.
      mount: async (): Promise<void> => {
        this.assertReady();
        if (!this.#applePay.canUseApplePay()) {
          throw new AppError({
            errorCode: ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER,
          });
        }
        const state = this.#core.getState();
        if (!state.business?.apple_pay?.enabled) {
          throw new AppError({
            errorCode: ErrorKeyEnum.APPLE_PAY_NOT_ENABLED,
          });
        }
        // Resolved HERE, not in the business-model mapping, so the cached
        // config keeps reporting what the API actually sent.
        //
        // `||`, not `??`: the backend sends `''` for "nothing" as readily as it
        // omits the key, and `??` would forward that empty string to Apple's
        // constructor as a region.
        const countryCode =
          state.business.business.country_code || DEFAULT_BUSINESS_COUNTRY_CODE;
        const merchantName = state.business.business.name;

        // Idempotent-by-disposal: a second mount() replaces the button but does
        // NOT abort a session already in flight — only unmount() does that.
        dispose?.();
        dispose = this.#applePay.render({
          containerId: options.container_id ?? DEFAULT_APPLE_PAY_CONTAINER_ID,
          customization: this.#core.getConfig().customization?.apple_pay_button,
          onClick: () =>
            checkout.start({
              payment: options.payment,
              countryCode,
              merchantName,
            }),
        });
      },
      unmount: (): void => {
        // Abort FIRST: the sheet must be dismissed before its container
        // disappears. Both calls are idempotent.
        checkout.abort();
        dispose?.();
        dispose = undefined;
      },
    };
  }

  /** Build a `'card_fields'` component handle for the requested fields. */
  private createCardFieldsComponent(
    options: CardFieldsOptions = {},
  ): CardFieldsComponent {
    const normalizedOptions: CardFieldsOptions = {
      ...options,
      fields:
        options.fields && options.fields.length > 0
          ? options.fields
          : DEFAULT_CARD_FIELDS,
    };
    const contextKey = normalizedOptions.card_id
      ? `update:${normalizedOptions.card_id}`
      : 'create';
    return {
      mount: async (): Promise<void> => {
        this.assertReady();
        await this.#tokenizer.mount(normalizedOptions);
        this.#mountedCardFields.set(contextKey, normalizedOptions);
      },
      unmount: (): void => {
        this.#tokenizer.unmount(contextKey);
        this.#mountedCardFields.delete(contextKey);
      },
      reveal: async (request: RevealCardFieldsInput): Promise<void> => {
        this.assertReady();
        await this.#tokenizer.reveal(request);
      },
    };
  }

  /**
   * The ONE place a `config.events.payment` callback is invoked.
   *
   * Injected into the Apple Pay orchestration so `core/` never learns how a
   * merchant callback is called.
   */
  readonly #paymentEvents: PaymentEventSink = {
    onCompleted: (tx) =>
      this.emitPayment('on_completed', (h) => h.on_completed?.(tx)),
    onError: (e) => this.emitPayment('on_error', (h) => h.on_error?.(e)),
    onCancel: () => this.emitPayment('on_cancel', (h) => h.on_cancel?.()),
  };

  /**
   * Invoke one payment callback. NEVER throws — see
   * {@link invokeMerchantCallback} for why the isolation is mandatory.
   *
   * FIRE-TIME read, mirroring `events.presentation`: both the getter and the
   * optional call run here, so a config mutated after `createTonder` is
   * honored and nothing is captured at construction.
   */
  private emitPayment(
    name: string,
    invoke: (handlers: PaymentEvents) => void,
  ): void {
    const handlers = this.#core.getConfig().events?.payment;
    if (!handlers) return;
    invokeMerchantCallback(`events.payment.${name}`, () => invoke(handlers));
  }

  /**
   * Invoke one presentation callback. NEVER throws.
   *
   * A FIRE-TIME read like {@link emitPayment}: the wrapper handed to the host
   * looks the handler up when the modal actually opens or closes.
   *
   * These fire from inside `pay()`, while a charge is in flight, so an
   * unisolated throw here would reject a payment that already went through.
   */
  private emitPresentation(
    name: string,
    invoke: (handlers: PresentationEvents) => void,
  ): void {
    const handlers = this.#core.getConfig().events?.presentation;
    if (!handlers) return;
    invokeMerchantCallback(`events.presentation.${name}`, () =>
      invoke(handlers),
    );
  }

  /**
   * Isolated presentation callbacks handed to the host. Safe to pass
   * unconditionally: with no merchant handler configured they do nothing.
   *
   * `#`-private rather than a `private` class field so the instance keeps ZERO
   * own enumerable properties — the facade must still spread and serialize to
   * `{}` so credentials and shopper data can never reach a log line.
   */
  readonly #presentationOnOpen = (): void =>
    this.emitPresentation('on_open', (h) => h.on_open?.());

  readonly #presentationOnClose = (): void =>
    this.emitPresentation('on_close', (h) => h.on_close?.());

  /** Guard: throws `NOT_INITIALIZED` until `init()` makes us ready. */
  private assertReady(): void {
    if (this.#core.getState().lifecycle !== 'ready') {
      throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
    }
  }

  /**
   * Initialize the SDK instance.
   *
   * Call this once before mounting card fields, enrolling cards, or charging a
   * payment. The method is idempotent: after the instance is ready, later calls
   * return without repeating setup. Initialization failures throw
   * `AppError(INIT_ERROR)`.
   *
   * One request is issued: the business config. It is fatal — every
   * ready-gated method dereferences it — so a failure moves the instance to
   * `error` rather than reaching `ready` with nothing configured.
   */
  public async init(): Promise<void> {
    if (this.#core.getState().lifecycle === 'ready') {
      return;
    }
    try {
      this.#core.setState({ lifecycle: 'initializing' });
      const config = this.#core.getConfig();

      const business = await this.#businessService.fetchBusinessConfig(
        config.api_key,
      );

      this.#core.setState({ lifecycle: 'ready', business });
    } catch (error) {
      this.#core.setState({
        lifecycle: 'error',
        lastErrorCode: ErrorKeyEnum.INIT_ERROR,
      });
      throw new AppError({
        errorCode: ErrorKeyEnum.INIT_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Charge a payment and return the resulting {@link RawTransaction}.
   *
   * There is no wrapper object and no `outcome` field; read the payment state
   * from `transaction.status`. Declines are returned as transactions with a
   * declined status and optional decline details. Operational failures throw
   * {@link AppError} with a stable {@link ErrorKeyEnum} code.
   *
   * Card payments use the mounted `'card_fields'` component for new cards, or
   * `payment_method: { type: 'saved_card', card_id }` for stored cards. Hosted
   * authentication or alternative-payment flows are presented according to
   * `config.presentation_mode`.
   */
  public async pay(input: PayInput): Promise<RawTransaction> {
    try {
      const tx = await this.runPay(input);
      // Cannot throw (see `emitPayment`), so a successful payment can never
      // fall into the catch below and report itself as a failure.
      this.#paymentEvents.onCompleted(tx);
      return tx;
    } catch (error) {
      // Only `AppError` produces `on_error`: `PaymentEvents.on_error(error:
      // AppError)` is a published contract. A non-AppError still rejects the
      // promise, it is just not duplicated onto the callback.
      if (error instanceof AppError) {
        this.#paymentEvents.onError(error);
      }
      throw error;
    }
  }

  /**
   * The payment itself. `pay()` is the thin wrapper that adds one emit per
   * outcome, instead of threading emits through this method's four returns.
   */
  private async runPay(input: PayInput): Promise<RawTransaction> {
    if (this.#core.getState().lifecycle !== 'ready') {
      throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
    }

    // A customer is required for EVERY payment method, so this runs before the
    // input shape is validated or the network is touched. Precedence:
    // NOT_INITIALIZED → MISSING_CUSTOMER → INVALID_PAYMENT_REQUEST.
    if (!this.#core.getConfig().session?.customer) {
      throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
    }

    Tonder.assertValidPayInput(input);

    // Captured BEFORE the method block is resolved: this is the single
    // discriminator that drives presentation. APM/SPEI settle async via webhook
    // and are never polled; card/3DS follows the `next_action` poll path.
    const inputType = input.payment_method.type;

    const resolved = await this.resolvePaymentMethod(input);
    const config = this.#core.getConfig();
    const body = buildProcessBody({
      payment: input,
      paymentMethod: resolved.paymentMethod,
      customer: config.session?.customer,
      currency: input.currency ?? DEFAULT_CURRENCY,
      presentationMode: config.presentation_mode ?? DEFAULT_PRESENTATION_MODE,
    });
    let raw;

    try {
      const requestId = scopeRequestId(
        input.idempotency_key,
        this.#core.getState().business?.business.pk,
      );
      raw = await this.#directApiService.processPayment(body, requestId);
    } catch (error) {
      await this.rollbackAutoEnrolledCard(resolved);
      // DirectApiService already wraps transport failures as
      // PAYMENT_PROCESS_ERROR; re-throw any AppError as-is, wrap the rest.
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
        originalError: error,
      });
    }

    const tx = toRawTransaction(raw);

    if (inputType !== 'card' && inputType !== 'saved_card') {
      return await this.handleApmResult(tx);
    }

    // A `next_action.redirect_to_url.url` on the RAW body means the backend
    // needs an extra step (3DS). Present it per `presentation_mode`; otherwise the
    // transaction is already final (frictionless success/decline).
    const finalTx = raw.next_action?.redirect_to_url?.url
      ? await this.handleRequiresAction(tx)
      : tx;

    await this.resetCardFieldsAfterSuccessfulPayment(inputType, input, finalTx);
    return finalTx;
  }

  private async resetCardFieldsAfterSuccessfulPayment(
    inputType: string,
    input: PayInput,
    tx: RawTransaction,
  ): Promise<void> {
    if (!isSuccessfulStatus(tx.status)) {
      return;
    }

    const context = this.cardFieldsContextForPayment(inputType, input);
    if (!context) {
      return;
    }

    await this.resetMountedCardFields(context);
  }

  private async resetMountedCardFields(context: string): Promise<void> {
    const options = this.#mountedCardFields.get(context);
    if (!options) {
      return;
    }

    this.#tokenizer.unmount(context);
    await this.#tokenizer.mount(options);
    this.#mountedCardFields.set(context, options);
  }

  private cardFieldsContextForPayment(
    inputType: string,
    input: PayInput,
  ): string | null {
    if (inputType === 'card') {
      return 'create';
    }

    if (inputType === 'saved_card' && 'card_id' in input.payment_method) {
      return `update:${input.payment_method.card_id}`;
    }

    return null;
  }

  /**
   * Present a card 3DS (`next_action`) transaction per the configured
   * `presentation_mode` and resolve to a {@link RawTransaction}.
   *
   * - `'redirect'` (default): navigate to the `next_action` URL and return the
   *   raw `Pending` transaction. The page navigates away; the merchant recovers
   *   the final status with `getTransaction` on the `return_url`.
   * - `'embedded'`: present the URL in the SDK-owned NON-closable modal, wait
   *   for the hosted checkout's completion signal, then reconcile by polling to
   *   a final status — so `pay()` never resolves with an intermediate
   *   `Pending`. There is deliberately no polling deadline while the iframe is
   *   open, so a shopper is not cut off mid-challenge.
   */
  private async handleRequiresAction(
    tx: RawTransaction,
  ): Promise<RawTransaction> {
    const redirectUrl = tx.next_action?.redirect_to_url?.url ?? '';
    const config = this.#core.getConfig();
    const mode = config.presentation_mode ?? DEFAULT_PRESENTATION_MODE;

    if (mode === 'embedded') {
      this.#host.open(redirectUrl, {
        closable: false,
        onOpen: this.#presentationOnOpen,
      });

      const controller = new AbortController();

      try {
        await this.#messenger.waitForCompletion(controller.signal);
        return await this.pollTransactionUntilFinal(tx.id, {
          signal: controller.signal,
          timeoutMs: EMBEDDED_RECONCILE_TIMEOUT_MS,
        });
      } finally {
        controller.abort();
        this.#host.close();
      }
    }

    this.#host.redirect(redirectUrl);
    return tx;
  }

  /**
   * Present an APM/SPEI `Pending` transaction per the configured
   * `presentation_mode` and return it UNCHANGED as a {@link RawTransaction}.
   *
   * Parallel to {@link handleRequiresAction} but it NEVER polls — APMs settle
   * asynchronously via webhook, so the SDK cannot drive one to a final status
   * in-session. The merchant reconciles from the webhook. Settlement data
   * (`next_action`/`clabe`/`bank_name`/`payment_instructions`) travels verbatim.
   *
   * - no redirect URL (instructions-only OXXO/SPEI): return the tx unchanged.
   * - `'redirect'` (default): navigate to the redirect URL, return the tx.
   * - `'embedded'`: open the SDK-owned CLOSABLE modal and LEAVE IT OPEN so the
   *   shopper can read the CLABE/voucher; the shopper dismisses it themselves,
   *   which fires `config.events.presentation.on_close`.
   */
  private async handleApmResult(tx: RawTransaction): Promise<RawTransaction> {
    const redirectUrl = tx.next_action?.redirect_to_url?.url;
    if (!redirectUrl) {
      return tx;
    }

    const config = this.#core.getConfig();
    const mode = config.presentation_mode ?? DEFAULT_PRESENTATION_MODE;

    if (mode === 'embedded') {
      // Leave it up: settlement happens async via webhook, so closing here
      // would take the CLABE/voucher off screen before the shopper reads it.
      this.#host.open(redirectUrl, {
        closable: true,
        onOpen: this.#presentationOnOpen,
        onUserClose: this.#presentationOnClose,
      });
      return tx;
    }

    this.#host.redirect(redirectUrl);
    return tx;
  }

  /**
   * Resolve the payment-method block for the requested method.
   *
   * - `'card'`      collects the secure tokens (failures normalized to
   *                 `PAYMENT_PROCESS_ERROR`) and builds the CARD body.
   * - `'saved_card'` validates `card_id` (`INVALID_PAYMENT_REQUEST` if missing),
   *                 looks up the saved-card record, and only skips CVV collection
   *                 when COF is active and the card already has `subscription_id`.
   *                 Otherwise it collects the saved-card CVV context and saves/
   *                 updates the card before building the token-only CARD body.
   * - other         → `INVALID_PAYMENT_REQUEST_CARD_PM`.
   */
  private async resolvePaymentMethod(
    input: PayInput,
  ): Promise<ResolvedPaymentMethod> {
    const method = input.payment_method;

    if (method.type === 'card') {
      if (this.isCofActive()) {
        const params = await this.buildCofEnrollParams(input.currency);
        const { cardId } = await this.#cofService.enrollCard(params);
        return {
          paymentMethod: buildSavedCardPaymentMethod(cardId),
          enrolledCardId: cardId,
          rollbackAuth: {
            businessPk: params.businessPk,
            secureToken: params.secureToken,
            userToken: params.userToken,
          },
        };
      }
      // Tokenizer failures (e.g. MOUNT_COLLECT_ERROR) are normalized to
      // PAYMENT_PROCESS_ERROR — pay() exposes a single failure code for the
      // collect → process path.
      let tokens: Record<string, string>;
      try {
        tokens = await this.#tokenizer.collect();
      } catch (error) {
        throw new AppError({
          errorCode: ErrorKeyEnum.PAYMENT_PROCESS_ERROR,
          originalError: error,
        });
      }
      return { paymentMethod: buildCardPaymentMethod(tokens) };
    }

    if (method.type === 'saved_card') {
      const card_id = 'card_id' in method ? method.card_id : undefined;
      if (!card_id || card_id.trim() === '') {
        throw new AppError({
          errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
          details: { system_error: 'payment_method.card_id is required.' },
        });
      }

      const params = await this.buildCofEnrollParams(input.currency);
      const selectedCard = await this.findCustomerCard(card_id, params);

      if (this.isCofActive() && selectedCard.subscription_id) {
        return { paymentMethod: buildSavedCardPaymentMethod(card_id) };
      }

      if (this.isCofActive()) {
        await this.#cofService.enrollExistingCard(params, card_id);
      } else {
        await this.#cofService.saveExistingCardPlain(params, card_id);
      }

      return { paymentMethod: buildSavedCardPaymentMethod(card_id) };
    }

    if (!method.type || method.type.trim() === '') {
      throw new AppError({
        errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
        details: { system_error: 'payment_method.type is required.' },
      });
    }

    // Backwards-incompatible by design: payment methods are represented directly
    // as `{ type: 'spei' }`, `{ type: 'oxxopay' }`, etc. The old wrapper
    // `{ type: 'apm', apm: 'oxxopay' }` is intentionally not accepted.
    if (method.type.toLowerCase() === 'apm') {
      throw new AppError({
        errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
        details: {
          system_error:
            "Use the payment method code directly, e.g. { type: 'oxxopay' }, not { type: 'apm', apm: ... }.",
        },
      });
    }

    const alternativeMethod = method as {
      type: string;
      config?: Record<string, unknown>;
    };
    Tonder.assertApmConfig(alternativeMethod.type, alternativeMethod.config);
    return {
      paymentMethod: buildApmPaymentMethod({
        apm: alternativeMethod.type,
        config: alternativeMethod.config,
      }),
    };
  }

  private async findCustomerCard(
    card_id: string,
    params: Pick<EnrollParams, 'businessPk' | 'secureToken' | 'userToken'>,
  ): Promise<Card> {
    try {
      const cards = await this.#cardService.getCards(
        params.businessPk,
        params.secureToken,
        params.userToken,
      );
      const selectedCard = cards.find((card) => card.card_id === card_id);
      if (!selectedCard) {
        throw new AppError({
          errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
          details: { system_error: 'payment_method.card_id was not found.' },
        });
      }
      return selectedCard;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_CARDS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Validate the APM config for the SafetyPay cash/transfer methods, which the
   * backend requires to carry `country`, `channel`, and `bank_ids`. Other APMs
   * pass their config through unvalidated. Throws `INVALID_APM_CONFIG` when a
   * required field is missing.
   */
  private static assertApmConfig(
    apm: string,
    config?: Record<string, unknown>,
  ): void {
    const code = apm.toLowerCase();
    if (code !== 'safetypaycash' && code !== 'safetypaytransfer') {
      return;
    }
    const required = ['country', 'channel', 'bank_ids'] as const;
    const missing =
      !config ||
      required.some((field) => {
        const value = config[field];
        return value === undefined || value === null || value === '';
      });
    if (missing) {
      throw new AppError({ errorCode: ErrorKeyEnum.INVALID_APM_CONFIG });
    }
  }

  /**
   * Read a transaction's current status by id.
   *
   * This read-only method can be used before `init()`, which is useful after a
   * redirect flow returns to your site. It returns the same public
   * {@link RawTransaction} shape as {@link pay}. Failures are normalized to
   * `AppError(FETCH_TRANSACTION_ERROR)` unless an `AppError` is already thrown.
   */
  public async getTransaction(id: string): Promise<RawTransaction> {
    return this.getTransactionMapped(id);
  }

  /**
   * List the active payment methods configured for your business.
   *
   * This read-only method can be used before `init()`. Failures are normalized
   * to `AppError(FETCH_PAYMENT_METHODS_ERROR)` unless an `AppError` is already
   * thrown.
   *
   * Issues its OWN request on every call — the SDK caches no catalog, so there
   * is nothing stale to serve and no `init()` dependency.
   */
  public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
    try {
      return toPublicPaymentMethods(
        await this.#directApiService.getPaymentMethodCatalog(),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHODS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Fetch bank options for bank-backed alternative payment methods.
   *
   * Use the returned ids in `payment_method.config.bank_ids` when charging a
   * method that requires bank selection. This read-only method can be used
   * before `init()`.
   */
  public async getPaymentMethodBanks(): Promise<PaymentMethodBanks> {
    try {
      return await this.#directApiService.getPaymentMethodBanks(
        this.#core.getConfig().api_key,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_PAYMENT_METHOD_BANKS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Polls a transaction to a final status with capped exponential backoff.
   * Rejects with `AppError(POLL_TIMEOUT_ERROR)` on deadline or
   * `AppError(REQUEST_ABORTED)` if `options.signal` aborts.
   *
   * The hosted checkout iframe's completion message — not this poll — is the
   * PRIMARY completion signal; this runs after it as a reconciliation loop.
   *
   * Intentionally PRIVATE: merchants own their polling policy through
   * `getTransaction()`. The SDK polls only when it owns the presentation flow.
   */
  private async pollTransactionUntilFinal(
    id: string,
    options: PollOptions = {},
  ): Promise<RawTransaction> {
    const controller = new AbortController();
    const externalSignal = options.signal;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else
        externalSignal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
    }

    return pollUntilFinal<RawTransaction>(
      (txId, signal) => this.getTransactionMapped(txId, signal),
      id,
      { ...options, signal: controller.signal },
    );
  }

  /**
   * Save the currently mounted new card for the configured customer.
   *
   * Requires `init()`, `config.session.customer`, `config.session.secure_token`,
   * and a mounted new-card `'card_fields'` component. Returns the saved
   * `card_id`, plus `subscription_id` when card-on-file enrollment is enabled
   * for the business.
   */
  public async enrollCard(): Promise<EnrollResult> {
    const params = await this.buildCofEnrollParams();

    if (this.isCofActive()) {
      const { cardId, subscriptionId } =
        await this.#cofService.enrollCard(params);
      await this.resetMountedCardFields('create');
      return { card_id: cardId, subscription_id: subscriptionId };
    }

    const { cardId } = await this.#cofService.saveCardPlain(params);
    await this.resetMountedCardFields('create');
    return { card_id: cardId };
  }

  /**
   * List saved cards for the configured customer.
   *
   * Requires `init()`, `config.session.customer`, and
   * `config.session.secure_token`. Returned cards contain masked, display-safe
   * values only.
   */
  public async getCustomerCards(): Promise<Card[]> {
    const { businessPk, secureToken, userToken } = await this.resolveCardAuth();
    try {
      const cards = await this.#cardService.getCards(
        businessPk,
        secureToken,
        userToken,
      );
      if (this.isCofActive()) {
        return cards;
      }
      return cards.map((card) => ({ ...card, subscription_id: null }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_CARDS_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Remove one saved card for the configured customer by `card_id`.
   *
   * Requires the same session data as {@link getCustomerCards}. Resolves when
   * the card is removed; failures are normalized to `AppError(REMOVE_CARD_ERROR)`.
   */
  public async removeCustomerCard(card_id: string): Promise<void> {
    const { businessPk, secureToken, userToken } = await this.resolveCardAuth();
    try {
      await this.#cardService.removeCard(
        businessPk,
        card_id,
        secureToken,
        userToken,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.REMOVE_CARD_ERROR,
        originalError: error,
      });
    }
  }

  private isCofActive(): boolean {
    return Boolean(this.#core.getState().business?.cardonfile_keys?.public_key);
  }

  private async buildCofEnrollParams(currency?: string): Promise<EnrollParams> {
    const { businessPk, secureToken, userToken } = await this.resolveCardAuth();
    const state = this.#core.getState();
    const customerInput =
      state.customerInput ?? this.#core.getConfig().session?.customer;
    return {
      businessPk,
      secureToken,
      userToken,
      merchantId: state.business?.cardonfile_keys?.public_key ?? '',
      contact: {
        firstName: customerInput?.first_name ?? '',
        lastName: customerInput?.last_name ?? '',
        email: customerInput?.email ?? '',
      },
      currency: currency ?? DEFAULT_CURRENCY,
    };
  }

  private async rollbackAutoEnrolledCard(
    resolved: ResolvedPaymentMethod,
  ): Promise<void> {
    if (!resolved.enrolledCardId || !resolved.rollbackAuth) return;
    try {
      await this.#cardService.removeCard(
        resolved.rollbackAuth.businessPk,
        resolved.enrolledCardId,
        resolved.rollbackAuth.secureToken,
        resolved.rollbackAuth.userToken,
      );
    } catch {
      // Best-effort rollback: the original payment error is the one that matters.
    }
  }

  /**
   * Resolve the customer's `User-Token`, registering transparently if needed.
   *
   * Memoized: the cached token and input are reused so subsequent COF
   * operations never re-register. The cached `customerInput` also supplies the
   * `enrollCard` subscription contact.
   */
  private async ensureCustomerRegistered(): Promise<string> {
    const state = this.#core.getState();
    if (state.customerAuthToken) {
      return state.customerAuthToken;
    }
    const input = this.#core.getConfig().session?.customer;
    if (!input) {
      throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
    }
    const customer = await this.#customerService.registerOrFetch(
      this.#core.getConfig().api_key,
      input,
    );
    this.#core.setState({
      customerAuthToken: customer.authToken,
      customerInput: input,
    });
    return customer.authToken;
  }

  private async resolveCardAuth(): Promise<{
    businessPk: number;
    secureToken: string;
    userToken: string;
  }> {
    this.assertReady();
    const userToken = await this.ensureCustomerRegistered();
    const state = this.#core.getState();
    const secureToken = this.#core.getConfig().session?.secure_token ?? '';
    if (!secureToken) {
      throw new AppError({ errorCode: ErrorKeyEnum.SECURE_TOKEN_REQUIRED });
    }
    // `business` is guaranteed non-null once `ready` (init stored it).
    const businessPk = state.business?.business.pk as number;
    return { businessPk, secureToken, userToken };
  }

  /**
   * Shared read+map path for `getTransaction` and internal polling. Forwards the
   * optional `signal` to the service so an in-flight request can be canceled.
   */
  private async getTransactionMapped(
    id: string,
    signal?: AbortSignal,
  ): Promise<RawTransaction> {
    try {
      const raw = await this.#directApiService.getTransaction(id, signal);
      return toRawTransaction(raw);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
        originalError: error,
      });
    }
  }

  /**
   * Validate the pay input amount. Throws `INVALID_PAYMENT_REQUEST`. The
   * customer is NOT validated here — it is sourced from `config.session.customer` and
   * guarded by the pay() MISSING_CUSTOMER pre-flight before this runs.
   */
  private static assertValidPayInput(input: PayInput): void {
    const invalid = (system_error: string): never => {
      throw new AppError({
        errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
        details: { system_error },
      });
    };
    if (!input || typeof input !== 'object')
      invalid('pay() requires an input object.');
    if (
      typeof input.client_reference !== 'string' ||
      !input.client_reference.trim()
    ) {
      invalid('pay().client_reference is required.');
    }
    if (typeof input.amount !== 'number' || !(input.amount > 0)) {
      invalid('input.amount must be greater than 0.');
    }
    // Has to be a RUNTIME guard: `PaymentMethod`'s `{ type: string; config? }`
    // member accepts any string literal, so the compiler structurally cannot
    // reject this call. Without the guard it reaches `/process` as a generic
    // APM and the merchant gets a backend rejection instead of a message
    // naming the component they actually need.
    if (input.payment_method?.type === 'apple_pay') {
      invalid(
        "Apple Pay is not a pay() method. Use create('apple_pay_button', { payment }).",
      );
    }
  }
}

/**
 * Factory that builds and wires a {@link Tonder} instance. Throws an
 * {@link AppError} with `code: INIT_ERROR` on invalid config.
 */
export function createTonder(config: TonderConfig): Tonder {
  return new Tonder(config);
}

/**
 * Internal test factory for dependency injection.
 *
 * @internal
 */
export function _createTonderWithDeps(deps: {
  config: TonderConfig;
  http: HttpPort;
  tokenizer?: TokenizerPort;
  acquirer?: AcquirerPort;
  host?: ThreeDsHostPort;
  messenger?: CheckoutMessengerPort;
  applePay?: ApplePayAdapter;
}): Tonder {
  return new Tonder(
    deps.config,
    deps.http,
    deps.tokenizer,
    deps.acquirer,
    deps.host,
    deps.messenger,
    deps.applePay,
  );
}
