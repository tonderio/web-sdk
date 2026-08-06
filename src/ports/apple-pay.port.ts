/**
 * Apple Pay port contracts.
 *
 * TYPE-ONLY: this module emits no runtime code. It is also the ONLY module in
 * `src/` allowed to write the identifier `ApplePayJS`. `@types/applepayjs`
 * declares that namespace globally — ambient, so any module could name it with
 * no import — which makes "keep Apple's types confined" unenforceable by the
 * module graph alone. Confining it here turns the rule into a grep.
 *
 * Everything else in the SDK consumes the aliases below.
 */
import type { ApplePayButtonCustomization } from '../types/customization';

/** Apple's request object. Alias so `ApplePayJS` is named in exactly one module. */
export type ApplePayPaymentRequest = ApplePayJS.ApplePayPaymentRequest;

/**
 * Apple's `merchantCapabilities` literal union. Needed to narrow the resolver's
 * `string[]` output, which is untyped because it arrives off the wire.
 */
export type ApplePayMerchantCapability = ApplePayJS.ApplePayMerchantCapability;

/** The opaque `PKPaymentToken`. Forwarded to `/process` verbatim; never inspected. */
export type ApplePayPaymentToken = ApplePayJS.ApplePayPaymentToken;

/**
 * Normalized session callbacks. Handed to `createSession` so create-and-wire in
 * one tick is a type-level guarantee rather than a convention a future author
 * must remember. Apple's event objects are unwrapped by the adapter and never
 * reach `core/`.
 *
 * camelCase: this is an internal port, matching `ThreeDsHostOptions.onOpen` /
 * `onUserClose`. The snake_case rule binds merchant-facing surfaces; none of
 * this is one.
 *
 * Handlers return `void | Promise<void>`. The adapter cannot await them —
 * Apple's callbacks are fire-and-forget — but returning the promise gives a
 * test driving the flow a join point, instead of microtask flushing that breaks
 * the day someone adds an `await`.
 */
export interface ApplePaySessionHandlers {
  /**
   * Apple is showing the sheet and wants a merchant session.
   *
   * NO ARGUMENT. `event.validationURL` is deliberately unread: letting the
   * browser choose where a certificate-bearing backend connects is an SSRF
   * surface, and Apple's current guidance is a static hostname. A port that
   * passed it through would invite a caller to forward it.
   */
  onValidateMerchant(): void | Promise<void>;

  /** The shopper authenticated. Receives ONLY the opaque token. */
  onPaymentAuthorized(token: ApplePayPaymentToken): void | Promise<void>;

  /** The sheet was dismissed without authorizing. Carries no data. */
  onCancel(): void | Promise<void>;
}

/**
 * A custom error to display on the sheet.
 *
 * Declared so the completion mapping has somewhere to put them; NOTHING in this
 * change populates it. Whether Apple requires real `ApplePayError` instances
 * rather than plain objects is a Safari-only question.
 */
export interface ApplePayCompletionError {
  /** Apple `ApplePayErrorCode`. */
  code: 'unknown';
  message: string;
}

/**
 * Result the SDK reports back to the sheet.
 *
 * `status` is OUR token, not Apple's numeric constant. `STATUS_SUCCESS` /
 * `STATUS_FAILURE` are statics on the global `ApplePaySession` class, and
 * `core/` may not read a browser global; the adapter maps this to them.
 */
export interface ApplePayCompletion {
  status: 'success' | 'failure';
  errors?: readonly ApplePayCompletionError[];
}

/** What the caller can do once the session exists. */
export interface ApplePaySessionHandle {
  /** Present the sheet and start merchant validation. Apple: `begin()`. */
  begin(): void;
  /**
   * Hand Apple the opaque merchant session. Apple:
   * `completeMerchantValidation()`.
   *
   * `unknown`, not `any`: the SDK is a courier and never parses Apple's blob,
   * so `unknown` is the honest type — `any` would let a future author read a
   * field off it.
   */
  completeMerchantValidation(merchantSession: unknown): void;
  /** Settle the authorization. Apple: `completePayment({ status, errors })`. */
  completePayment(completion: ApplePayCompletion): void;
  /** Dismiss the sheet without completing. Apple: `abort()`. */
  abort(): void;
}

export interface ApplePayPort {
  /**
   * Whether this browser can run an Apple Pay session at all.
   *
   * BROWSER-ONLY: `globalThis.ApplePaySession` present, `supportsVersion(3)`,
   * `canMakePayments()`. No business config, no country code — those are the
   * other half
   * of the composition, and this half must stay testable without a business
   * fixture.
   *
   * Returns a plain boolean and NEVER throws. Apple Pay being absent is a
   * state. `APPLE_PAY_UNSUPPORTED_BROWSER` is raised by the `mount()` gate that
   * reads this boolean, not here.
   */
  canUseApplePay(): boolean;

  /**
   * Create and wire an Apple Pay session. SYNCHRONOUS — it must be reachable
   * from a click listener with no `await` before it, because Apple's
   * constructor throws outside a user-gesture handler.
   *
   * The Apple Pay JS version is NOT a parameter: which version of Apple's API
   * we speak is a property of our integration, not a decision a caller is
   * entitled to make, so `canUseApplePay` and `createSession` cannot disagree
   * about it.
   *
   * @throws AppError(APPLE_PAY_SESSION_ERROR) when Apple's constructor rejects.
   */
  createSession(
    request: ApplePayPaymentRequest,
    handlers: ApplePaySessionHandlers,
  ): ApplePaySessionHandle;
}

/** Removes the rendered button and its listener. Idempotent. */
export type ApplePayButtonDisposer = () => void;

export interface ApplePayButtonRenderOptions {
  /** CSS selector for the merchant container, e.g. '#tonder-apple-pay-button'. */
  containerId: string;
  /**
   * Styles to apply. This is the real parameter, fully implemented — only its
   * source is deferred: today the adapter's own test passes it, and the code
   * that mounts the button reads it from merchant customization. When absent
   * the adapter emits the documented defaults.
   */
  customization?: ApplePayButtonCustomization;
  /**
   * Invoked on click. The listener is owned by the adapter so the gesture chain
   * never crosses a merchant-visible callback layer.
   */
  onClick(): void;
}

/**
 * The single object the facade injects for Apple Pay.
 *
 * A TYPE ALIAS over the intersection, not a new interface, and it adds no
 * members: `BrowserApplePay` already implements both halves, so the
 * intersection describes the object that exists rather than inventing a third
 * contract to keep in sync. One constructor parameter instead of two, for one
 * adapter.
 */
export type ApplePayAdapter = ApplePayPort & ApplePayButtonPort;

export interface ApplePayButtonPort {
  /**
   * Render the button into the container and attach the click listener.
   *
   * `containerId` is camelCase while the merchant-facing
   * `ApplePayButtonOptions.container_id` is snake_case: the facade performs the
   * one translation at the one boundary where translation belongs.
   *
   * @returns a disposer removing BOTH the nodes and the listener. Idempotent.
   * @throws AppError(APPLE_PAY_CONTAINER_NOT_FOUND) when the selector matches nothing.
   */
  render(options: ApplePayButtonRenderOptions): ApplePayButtonDisposer;
}
