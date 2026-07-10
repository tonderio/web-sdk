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
import { TonderCore } from './core/TonderCore';
import { toRawTransaction } from './models/transaction.model';
import type { RawTransaction } from './models/transaction.model';
import { Browser3dsHost } from './adapters/browser/browser-3ds-host.adapter';
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
import type { Card } from './models/card.model';
import type {
  PaymentMethodBanks,
  EnrollResult,
  PayInput,
  PaymentMethodInfo,
  TonderConfig,
} from './shared/types';
import type {
  CardFieldsComponent,
  CardFieldsOptions,
  CardFieldEntry,
  ComponentOptionsByType,
  RevealCardFieldsInput,
  TonderComponent,
  TonderComponentType,
} from './types/card';
import type { CardFieldsCustomization } from './types/customization';

const VALID_MODES = ['production', 'sandbox', 'stage'] as const;

/** ServiceManager key for the business-config service. */
const BUSINESS_SERVICE_KEY = 'business';

/** ServiceManager key for the vault-token service. */
const VAULT_SERVICE_KEY = 'vault';

/** ServiceManager key for the payment-processing service. */
const DIRECT_API_SERVICE_KEY = 'directApi';

/** ServiceManager key for the customer service. */
const CUSTOMER_SERVICE_KEY = 'customer';

/** ServiceManager key for the saved-card service. */
const CARD_SERVICE_KEY = 'card';

/** Default currency when the caller omits `pay({ currency })`. */
const DEFAULT_CURRENCY = 'MXN';

/** Default presentation mode when the caller omits `config.presentation_mode`. */
const DEFAULT_PRESENTATION_MODE = 'redirect' as const;

/** Short post-message reconciliation window for embedded card 3DS. */
const EMBEDDED_RECONCILE_TIMEOUT_MS = 30_000;

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
  private readonly core: TonderCore;
  private readonly services: ServiceManager;
  private readonly env: TonderBaseUrls;
  private readonly http: HttpPort;
  private readonly businessService: BusinessService;
  private readonly vaultService: VaultService;
  private readonly directApiService: DirectApiService;
  private readonly customerService: CustomerService;
  private readonly cardService: CardService;
  private readonly tokenizer: TokenizerPort;
  private readonly acquirer: AcquirerPort;
  private readonly cofService: CofService;
  private readonly host: ThreeDsHostPort;
  private readonly messenger: CheckoutMessengerPort;
  private readonly mountedCardFields = new Map<string, CardFieldsOptions>();

  constructor(
    config: TonderConfig,
    http?: HttpPort,
    tokenizer?: TokenizerPort,
    acquirer?: AcquirerPort,
    host?: ThreeDsHostPort,
    messenger?: CheckoutMessengerPort,
  ) {
    assertValidConfig(config);
    this.core = new TonderCore(config);
    this.services = new ServiceManager();
    this.env = resolveEnv(config.environment);
    this.http = http ?? new FetchHttpClient(this.env.api, config.api_key);
    this.businessService = new BusinessService(this.http);
    this.vaultService = new VaultService(this.http);
    this.directApiService = new DirectApiService(this.http);
    this.customerService = new CustomerService(this.http);
    this.cardService = new CardService(this.http);
    this.services.register(BUSINESS_SERVICE_KEY, this.businessService);
    this.services.register(VAULT_SERVICE_KEY, this.vaultService);
    this.services.register(DIRECT_API_SERVICE_KEY, this.directApiService);
    this.services.register(CUSTOMER_SERVICE_KEY, this.customerService);
    this.services.register(CARD_SERVICE_KEY, this.cardService);
    const card_fieldsCustomization = config.customization?.card_fields;
    this.tokenizer =
      tokenizer ??
      new SkyflowAdapter({
        loader: createSkyflowLoader(),
        vaultService: this.vaultService,
        getVaultConfig: () => {
          const business = this.core.getState().business;
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
    this.acquirer =
      acquirer ??
      new KushkiAdapter({
        loader: createKushkiLoader(),
        http: new FetchHttpClient(this.env.acquirer, config.api_key),
        apiKey: config.api_key,
        isTestEnvironment: config.environment !== 'production',
      });
    this.cofService = new CofService(
      this.cardService,
      this.tokenizer,
      this.acquirer,
    );
    this.host = host ?? new Browser3dsHost();
    this.messenger =
      messenger ?? new BrowserCheckoutMessenger(new Set([this.env.payflow]));
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
  ): TonderComponent {
    if (type === 'card_fields') {
      return this.createCardFieldsComponent(options as CardFieldsOptions);
    }
    throw new AppError({ errorCode: ErrorKeyEnum.INVALID_COMPONENT_TYPE });
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
        await this.tokenizer.mount(normalizedOptions);
        this.mountedCardFields.set(contextKey, normalizedOptions);
      },
      unmount: (): void => {
        this.tokenizer.unmount(contextKey);
        this.mountedCardFields.delete(contextKey);
      },
      reveal: async (request: RevealCardFieldsInput): Promise<void> => {
        this.assertReady();
        await this.tokenizer.reveal(request);
      },
    };
  }

  /** Guard: throws `NOT_INITIALIZED` until `init()` makes us ready. */
  private assertReady(): void {
    if (this.core.getState().lifecycle !== 'ready') {
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
   */
  public async init(): Promise<void> {
    if (this.core.getState().lifecycle === 'ready') {
      return;
    }
    try {
      this.core.setState({ lifecycle: 'initializing' });
      const config = this.core.getConfig();
      const business = await this.businessService.fetchBusinessConfig(
        config.api_key,
      );
      this.core.setState({ lifecycle: 'ready', business });
    } catch (error) {
      this.core.setState({
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
    if (this.core.getState().lifecycle !== 'ready') {
      throw new AppError({ errorCode: ErrorKeyEnum.NOT_INITIALIZED });
    }

    // Customer is session config-only and REQUIRED to pay. Pre-flight guard: throw
    // before validating the input shape or touching the network, for EVERY
    // payment method (the payment service requires customer on all payment operations).
    // Precedence: NOT_INITIALIZED → MISSING_CUSTOMER → INVALID_PAYMENT_REQUEST.
    if (!this.core.getConfig().session?.customer) {
      throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
    }

    Tonder.assertValidPayInput(input);

    // Capture the requested payment-type BEFORE resolving the method block: it
    // is the single discriminator the facade uses to drive presentation. APM/
    // SPEI settle async (webhook) → return raw Pending (never polled); card/
    // 3DS keeps the next_action → poll path. The pure models never learn the
    // request type.
    const inputType = input.payment_method.type;

    const resolved = await this.resolvePaymentMethod(input);
    const body = this.buildProcessBody(input, resolved.paymentMethod);
    let raw;

    try {
      const requestId = this.buildProcessRequestId(input.idempotency_key);
      raw = await this.directApiService.processPayment(body, requestId);
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
    if (tx.status !== 'Success' && tx.status !== 'Authorized') {
      return;
    }

    const context = this.cardFieldsContextForPayment(inputType, input);
    if (!context) {
      return;
    }

    await this.resetMountedCardFields(context);
  }

  private async resetMountedCardFields(context: string): Promise<void> {
    const options = this.mountedCardFields.get(context);
    if (!options) {
      return;
    }

    this.tokenizer.unmount(context);
    await this.tokenizer.mount(options);
    this.mountedCardFields.set(context, options);
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
   * - `'redirect'` (default): navigate the browser to the `next_action` redirect
   *   URL via the host, then return the raw `Pending` transaction unchanged. The
   *   page navigates away; the merchant recovers the final status with
   *   `getTransaction` on the `return_url`.
   * - `'embedded'`: present the redirect URL in the SDK-owned NON-closable modal
   *   (`host.open(url, { closable: false })`), wait for the PRIMARY
   *   `messenger.waitForCompletion` signal from the payflow iframe, then run a
   *   short authoritative reconciliation poll via `getTransaction`. A
   *   still-`Pending` reconciliation read is NOT settled — `pollUntilFinal` keeps
   *   polling until a `FINAL_STATUSES` status is reached, so the caller never
   *   receives an intermediate `Pending`/`requires_action` transaction as the
   *   final embedded-3DS result. There is intentionally no abandonment polling
   *   while the iframe is open, so a shopper is not cut off by an SDK deadline
   *   during the challenge. After the completion signal, the modal is closed in a
   *   `finally`; any reconciliation error (including timeout) propagates. The
   *   resolved value from `pay()` is the final transaction for embedded card 3DS.
   */
  private async handleRequiresAction(
    tx: RawTransaction,
  ): Promise<RawTransaction> {
    const redirectUrl = tx.next_action?.redirect_to_url?.url ?? '';
    const config = this.core.getConfig();
    const mode = config.presentation_mode ?? DEFAULT_PRESENTATION_MODE;

    if (mode === 'embedded') {
      this.host.open(redirectUrl, {
        closable: false,
        onOpen: config.events?.presentation?.on_open,
      });

      const controller = new AbortController();

      try {
        await this.messenger.waitForCompletion(controller.signal);
        return await this.pollTransactionUntilFinal(tx.id, {
          signal: controller.signal,
          timeoutMs: EMBEDDED_RECONCILE_TIMEOUT_MS,
        });
      } finally {
        controller.abort();
        this.host.close();
      }
    }

    this.host.redirect(redirectUrl);
    return tx;
  }

  /**
   * Present an APM/SPEI `Pending` transaction per the configured
   * `presentation_mode` and return it UNCHANGED as a {@link RawTransaction}.
   *
   * Parallel to {@link handleRequiresAction} but it NEVER polls — APMs settle
   * asynchronously via webhook, so the SDK never drives an APM to a final status
   * in-session. The merchant reconciles later from the webhook (or by reading
   * the transaction). The returned value carries the backend's own settlement
   * data (`next_action`/`clabe`/`bank_name`/`payment_instructions`) verbatim.
   *
   * - no redirect URL (instructions-only OXXO/SPEI): return the transaction
   *   unchanged.
   * - `'redirect'` (default): navigate to the redirect URL, return the tx.
   * - `'embedded'`: open the SDK-owned CLOSABLE modal and LEAVE IT OPEN, then
   *   return the pending tx immediately (no poll, no await on completion). The
   *   modal persists so the shopper sees the CLABE/voucher inline; the shopper
   *   closes it via the modal's own "X"/Escape, which invokes
   *   `config.events.presentation.on_close` (wired as the modal's `onUserClose`).
   *   Returning without polling AND without
   *   closing IS the async-isolation contract.
   */
  private async handleApmResult(tx: RawTransaction): Promise<RawTransaction> {
    const redirectUrl = tx.next_action?.redirect_to_url?.url;
    if (!redirectUrl) {
      return tx;
    }

    const config = this.core.getConfig();
    const mode = config.presentation_mode ?? DEFAULT_PRESENTATION_MODE;

    if (mode === 'embedded') {
      // Open and leave it up: the shopper needs to see the hosted page (CLABE/
      // voucher). Settlement happens async via webhook — do NOT close here. The
      // shopper dismisses it through the modal's own control (onUserClose).
      this.host.open(redirectUrl, {
        closable: true,
        onOpen: config.events?.presentation?.on_open,
        onUserClose: config.events?.presentation?.on_close,
      });
      return tx;
    }

    this.host.redirect(redirectUrl);
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
        const { cardId } = await this.cofService.enrollCard(params);
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
        tokens = await this.tokenizer.collect();
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
        await this.cofService.enrollExistingCard(params, card_id);
      } else {
        await this.cofService.saveExistingCardPlain(params, card_id);
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
      const cards = await this.cardService.getCards(
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
   * required field is missing. The strategy stays a pure shaper — validation
   * lives in the facade (consistent with saved-card `card_id` validation).
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
   */
  public async getPaymentMethods(): Promise<PaymentMethodInfo[]> {
    try {
      return await this.directApiService.getPaymentMethods();
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
      return await this.directApiService.getPaymentMethodBanks(
        this.core.getConfig().api_key,
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
   * Internal polling helper used by embedded card 3DS reconciliation. Polls a transaction
   * until it reaches a final status (see `FINAL_STATUSES`),
   * with capped exponential backoff. Resolves with the final bare
   * {@link RawTransaction}; rejects with `AppError(POLL_TIMEOUT_ERROR)` on
   * deadline or `AppError(REQUEST_ABORTED)` if `options.signal` aborts.
   *
   * COMPOSITION SEAM (payflow CheckoutMessenger — wired in
   * `handleRequiresAction`): the embedded messenger is the PRIMARY completion
   * signal, and this poll runs only after that signal as a short reconciliation
   * loop. This helper merges `options.signal` into its internal controller and
   * is single-resolution + cancelable by design.
   *
   * Intentionally PRIVATE: merchants own their polling policy through
   * `getTransaction()`. The SDK only polls internally when it owns the hosted
   * 3DS presentation flow.
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
        await this.cofService.enrollCard(params);
      await this.resetMountedCardFields('create');
      return { card_id: cardId, subscription_id: subscriptionId };
    }

    const { cardId } = await this.cofService.saveCardPlain(params);
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
      const cards = await this.cardService.getCards(
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
      await this.cardService.removeCard(
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
    return Boolean(this.core.getState().business?.cardonfile_keys?.public_key);
  }

  private async buildCofEnrollParams(currency?: string): Promise<EnrollParams> {
    const { businessPk, secureToken, userToken } = await this.resolveCardAuth();
    const state = this.core.getState();
    const customerInput =
      state.customerInput ?? this.core.getConfig().session?.customer;
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
      await this.cardService.removeCard(
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
   * Shared guard + credential resolution for the saved-card endpoints. Enforces
   * `ready` → customer registered → non-empty `config.session.secureToken`
   * (absent/empty → `SECURE_TOKEN_REQUIRED`). Returns the integer
   * `business.pk`, the secure token, and the customer's `User-Token`.
   */
  /**
   * Resolve the customer's `User-Token`, registering transparently if needed.
   *
   * Memoized seam for the saved-card endpoints: if a `customerAuthToken` is
   * already cached from a prior call it is returned WITHOUT a network
   * round-trip. Otherwise the customer identity is resolved from
   * `config.session.customer` (set once at `createTonder`); when it is absent an
   * `AppError(MISSING_CUSTOMER)` is thrown. The resolved input is sent to
   * `CustomerService.registerOrFetch` and the returned token + input are cached
   * (the cached `customerInput` supplies the `enrollCard` subscription contact)
   * so subsequent COF operations never re-register.
   */
  private async ensureCustomerRegistered(): Promise<string> {
    const state = this.core.getState();
    if (state.customerAuthToken) {
      return state.customerAuthToken;
    }
    const input = this.core.getConfig().session?.customer;
    if (!input) {
      throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
    }
    const customer = await this.customerService.registerOrFetch(
      this.core.getConfig().api_key,
      input,
    );
    this.core.setState({
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
    const state = this.core.getState();
    const secureToken = this.core.getConfig().session?.secure_token ?? '';
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
      const raw = await this.directApiService.getTransaction(id, signal);
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
   * Build the payment request body. Customer is sent inline from the configured
   * session. `client_reference` remains merchant reconciliation data; the
   * optional idempotency key is handled separately from the body.
   */
  private buildProcessBody(
    input: PayInput,
    paymentMethod: ProcessPaymentBody['payment_method'],
  ): ProcessPaymentBody {
    // Customer is guaranteed by the pay() pre-flight guard. Derive the charge
    // `name` by joining the config identity fields; only `{ name, email }` is
    // sent to the payment request (phone is intentionally never forwarded to the charge).
    const customer = this.core.getConfig().session?.customer;
    if (!customer) {
      throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
    }
    const name = [customer.first_name, customer.last_name]
      .filter(Boolean)
      .join(' ');
    const body: ProcessPaymentBody = {
      operation_type: 'payment',
      amount: input.amount,
      currency: input.currency ?? DEFAULT_CURRENCY,
      return_url: input.return_url,
      presentation_mode:
        this.core.getConfig().presentation_mode ?? DEFAULT_PRESENTATION_MODE,
      customer: { name, email: customer.email },
      payment_method: paymentMethod,
      client_reference: input.client_reference,
    };
    if (input.metadata !== undefined) {
      body.metadata = input.metadata;
    }
    return body;
  }

  /**
   * Scope merchant-provided idempotency keys by the initialized business before
   * sending them, preventing collisions across business accounts.
   */
  private buildProcessRequestId(idempotencyKey?: string): string | undefined {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) {
      return undefined;
    }

    const businessPk = this.core.getState().business?.business.pk;
    return businessPk === undefined
      ? normalizedKey
      : `${businessPk}_${normalizedKey}`;
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
}): Tonder {
  return new Tonder(
    deps.config,
    deps.http,
    deps.tokenizer,
    deps.acquirer,
    deps.host,
    deps.messenger,
  );
}
