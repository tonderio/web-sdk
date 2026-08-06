/**
 * Browser implementation of the Apple Pay ports. This is the ONLY module in the
 * SDK that touches `globalThis.ApplePaySession` or the button DOM — `core/`
 * stays pure and every other consumer talks to the port types.
 */
import type {
  ApplePayButtonDisposer,
  ApplePayButtonPort,
  ApplePayButtonRenderOptions,
  ApplePayCompletion,
  ApplePayPaymentRequest,
  ApplePayPort,
  ApplePaySessionHandle,
  ApplePaySessionHandlers,
} from '../../ports/apple-pay.port';
import type { ApplePayButtonCustomization } from '../../types/customization';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Which version of Apple's JS API we speak. A CONSTANT, not a parameter:
 * `canUseApplePay` and `createSession` must not be able to disagree about it.
 */
const APPLE_PAY_JS_VERSION = 3;

type ApplePaySessionCtor = typeof ApplePaySession;

/**
 * `@types/applepayjs` declares `ApplePaySession` as a `declare class`, so the
 * bare identifier type-checks and then throws `ReferenceError` in Node;
 * `window` fails the same way under SSR. `globalThis` is defined everywhere.
 */
function getApplePaySessionCtor(): ApplePaySessionCtor | undefined {
  return (globalThis as { ApplePaySession?: ApplePaySessionCtor })
    .ApplePaySession;
}

const BUTTON_CLASS = 'tonder-apple-pay-button';
const DEFAULT_BUTTON_TYPE = 'buy';
const DEFAULT_BUTTON_STYLE = 'black';

/**
 * The CSS text for one rendered button.
 *
 * Styles go into an injected `<style>` element rather than `style.setProperty`,
 * following the same pattern as the 3DS host's own stylesheet. That is not a
 * preference: jsdom drops declarations for properties it does not recognize,
 * and `-apple-pay-button-*` are exactly those, so an inline-style
 * implementation could only ever be verified by a test asserting `''`.
 *
 * A field the merchant omitted is left OUT of the text entirely, so Apple's own
 * default applies instead of being overridden by ours.
 */
function buildButtonCss(customization?: ApplePayButtonCustomization): string {
  const declarations = [
    // Renders the native Apple mark in WebKit. Whether it does so is Apple's
    // business and is verified on a device, not here.
    '-webkit-appearance: -apple-pay-button',
    `-apple-pay-button-type: ${customization?.type ?? DEFAULT_BUTTON_TYPE}`,
    `-apple-pay-button-style: ${customization?.style ?? DEFAULT_BUTTON_STYLE}`,
    'display: inline-block',
    'cursor: pointer',
    'border: 0',
  ];

  if (customization?.locale) {
    declarations.push(`-apple-pay-button-locale: ${customization.locale}`);
  }
  if (customization?.height) {
    declarations.push(`height: ${customization.height}`);
  }
  if (customization?.border_radius) {
    declarations.push(`border-radius: ${customization.border_radius}`);
  }

  return `.${BUTTON_CLASS} {\n  ${declarations.join(';\n  ')};\n}\n`;
}

export class BrowserApplePay implements ApplePayPort, ApplePayButtonPort {
  public canUseApplePay(): boolean {
    const Ctor = getApplePaySessionCtor();
    if (!Ctor) return false;
    try {
      return (
        Ctor.supportsVersion(APPLE_PAY_JS_VERSION) && Ctor.canMakePayments()
      );
    } catch {
      // Not re-validating our own data: `globalThis.ApplePaySession` is FOREIGN
      // code, and an extension or polyfill can define a broken one. The
      // contract is "returns a boolean, never throws" — absence is a state.
      return false;
    }
  }

  public createSession(
    request: ApplePayPaymentRequest,
    handlers: ApplePaySessionHandlers,
  ): ApplePaySessionHandle {
    const Ctor = getApplePaySessionCtor();
    let session: ApplePaySession;
    try {
      if (!Ctor) {
        throw new Error('ApplePaySession is not available in this browser');
      }
      session = new Ctor(APPLE_PAY_JS_VERSION, request);
    } catch (error) {
      // Apple throws for an insecure page, an invalid request, and a call made
      // outside a user-gesture handler. All three are one code to the merchant,
      // with the original preserved for debugging.
      throw new AppError({
        errorCode: ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
        originalError: error,
      });
    }

    // Same tick as the constructor. There is deliberately no `await` anywhere
    // in this method: the whole call must be reachable from a click listener.
    session.onvalidatemerchant = () => {
      // `event.validationURL` is deliberately unread — see the port.
      void handlers.onValidateMerchant();
    };
    session.onpaymentauthorized = (event) => {
      void handlers.onPaymentAuthorized(event.payment.token);
    };
    session.oncancel = () => {
      void handlers.onCancel();
    };

    return {
      begin: () => session.begin(),
      completeMerchantValidation: (merchantSession) =>
        session.completeMerchantValidation(merchantSession),
      completePayment: (completion: ApplePayCompletion) =>
        session.completePayment({
          // The v3 object form, never a bare number. Apple's numeric constants
          // are read off the same constructor that built the session, so
          // `core/` never has to name a browser global.
          status:
            completion.status === 'success'
              ? Ctor.STATUS_SUCCESS
              : Ctor.STATUS_FAILURE,
          // Spread only when supplied: the object form always carries `status`,
          // and nothing in the SDK populates `errors` today.
          ...(completion.errors ? { errors: [...completion.errors] } : {}),
        }),
      abort: () => session.abort(),
    };
  }

  /**
   * ONE BUTTON PER CONTAINER is assumed. Two `render()` calls into the same
   * container would leave two style nodes and two buttons, and each disposer
   * removes only its own; nothing in the SDK does that.
   */
  public render(options: ApplePayButtonRenderOptions): ApplePayButtonDisposer {
    const container = document.querySelector(options.containerId);
    if (!container) {
      throw new AppError({
        errorCode: ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND,
      });
    }

    const style = document.createElement('style');
    style.textContent = buildButtonCss(options.customization);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute('aria-label', 'Apple Pay');

    // The listener is owned here so the click never crosses a merchant-visible
    // callback layer, which is how a gesture chain gets broken.
    const onClick = (): void => options.onClick();
    button.addEventListener('click', onClick);

    container.append(style, button);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      button.removeEventListener('click', onClick);
      button.remove();
      style.remove();
    };
  }
}
