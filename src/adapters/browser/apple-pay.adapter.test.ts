/**
 * The adapter is the only module allowed to touch `globalThis.ApplePaySession`,
 * so its test fakes the GLOBAL, not a port.
 *
 * The fake is a LOCAL class in this file, never a module under `src/`: a shipped
 * mock would be compiled, bundled and delivered to every merchant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserApplePay } from './apple-pay.adapter';
import type {
  ApplePayPaymentRequest,
  ApplePayPaymentToken,
  ApplePaySessionHandlers,
} from '../../ports/apple-pay.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import { MESSAGES_EN } from '../../shared/errors/messages';

const REQUEST: ApplePayPaymentRequest = {
  countryCode: 'MX',
  currencyCode: 'MXN',
  merchantCapabilities: ['supports3DS'],
  supportedNetworks: ['visa'],
  total: { label: 'Ada Store', amount: '10.00', type: 'final' },
};

const TOKEN = {
  paymentData: { version: 'EC_v1', data: 'opaque' },
  paymentMethod: { displayName: 'Visa 1234', network: 'Visa', type: 'debit' },
  transactionIdentifier: 'txn_1',
} as unknown as ApplePayPaymentToken;

class FakeApplePaySession {
  // The visible cost of normalizing status at the port: the numeric constants
  // are Apple's, so the fake must carry them.
  static readonly STATUS_SUCCESS = 0;
  static readonly STATUS_FAILURE = 1;
  static supportsVersion = vi.fn((_version: number) => true);
  static canMakePayments = vi.fn(() => true);
  static instances: FakeApplePaySession[] = [];

  onvalidatemerchant?: (event: unknown) => void;
  onpaymentauthorized?: (event: { payment: { token: unknown } }) => void;
  oncancel?: () => void;
  begin = vi.fn();
  completeMerchantValidation = vi.fn();
  completePayment = vi.fn();
  abort = vi.fn();

  constructor(
    readonly version: number,
    readonly request: unknown,
  ) {
    FakeApplePaySession.instances.push(this);
  }
}

function installFake(): typeof FakeApplePaySession {
  FakeApplePaySession.instances = [];
  FakeApplePaySession.supportsVersion = vi.fn(() => true);
  FakeApplePaySession.canMakePayments = vi.fn(() => true);
  vi.stubGlobal('ApplePaySession', FakeApplePaySession);
  return FakeApplePaySession;
}

function handlerBag(): ApplePaySessionHandlers & {
  [K in keyof ApplePaySessionHandlers]: ReturnType<typeof vi.fn>;
} {
  return {
    onValidateMerchant: vi.fn<ApplePaySessionHandlers['onValidateMerchant']>(),
    onPaymentAuthorized:
      vi.fn<ApplePaySessionHandlers['onPaymentAuthorized']>(),
    onCancel: vi.fn<ApplePaySessionHandlers['onCancel']>(),
  };
}

/** The only session the fake constructed. */
function lastSession(): FakeApplePaySession {
  const session = FakeApplePaySession.instances.at(-1);
  if (!session) throw new Error('no session was constructed');
  return session;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeApplePaySession.instances = [];
});

describe('BrowserApplePay.canUseApplePay', () => {
  it('returns false, without throwing, when the global is absent', () => {
    // No stub installed: jsdom has no ApplePaySession. Absence is a STATE, not
    // a failure — nothing here may throw.
    expect(() => new BrowserApplePay().canUseApplePay()).not.toThrow();
    expect(new BrowserApplePay().canUseApplePay()).toBe(false);
  });

  it('returns false, without throwing, when a foreign global throws', () => {
    // Not defensive coding against our own data: `globalThis.ApplePaySession`
    // is FOREIGN — an extension or a broken polyfill can define one that
    // throws. The contract is "returns a boolean, never throws".
    const Ctor = installFake();
    Ctor.supportsVersion = vi.fn(() => {
      throw new Error('broken polyfill');
    });

    expect(() => new BrowserApplePay().canUseApplePay()).not.toThrow();
    expect(new BrowserApplePay().canUseApplePay()).toBe(false);
  });

  it('returns true when both static checks pass, asking for version 3', () => {
    const Ctor = installFake();

    expect(new BrowserApplePay().canUseApplePay()).toBe(true);
    expect(Ctor.supportsVersion).toHaveBeenCalledWith(3);
    expect(Ctor.canMakePayments).toHaveBeenCalled();
  });

  it('returns false when supportsVersion fails but canMakePayments passes', () => {
    const Ctor = installFake();
    Ctor.supportsVersion = vi.fn(() => false);

    expect(new BrowserApplePay().canUseApplePay()).toBe(false);
  });

  it('returns false when canMakePayments fails but supportsVersion passes', () => {
    const Ctor = installFake();
    Ctor.canMakePayments = vi.fn(() => false);

    expect(new BrowserApplePay().canUseApplePay()).toBe(false);
  });

  // DECLARED, NOT VERIFIED HERE: what supportsVersion(3) and canMakePayments()
  // actually return on real Safari hardware. The tests above verify only how we
  // combine them. Real values are a Phase 7, on-device question.
});

describe('BrowserApplePay.createSession', () => {
  it('constructs the session with version 3 and the exact request object', () => {
    installFake();

    new BrowserApplePay().createSession(REQUEST, handlerBag());

    expect(lastSession().version).toBe(3);
    expect(lastSession().request).toBe(REQUEST);
  });

  it('constructs synchronously, before any already-queued microtask', async () => {
    // PROXY, NOT PROOF. Apple's real requirement is that the constructor runs
    // inside a user-gesture handler, and jsdom models no user activation at
    // all. Synchrony is what makes satisfying that requirement possible, and it
    // is all a fake can observe. Safari's actual enforcement is Phase 7,
    // on-device.
    installFake();
    const seen: string[] = [];
    void Promise.resolve().then(() => {
      seen.push(`microtask:${FakeApplePaySession.instances.length}`);
    });

    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());
    seen.push(`sync:${FakeApplePaySession.instances.length}`);

    await Promise.resolve();
    expect(seen).toEqual(['sync:1', 'microtask:1']);
    expect(handle).not.toBeInstanceOf(Promise);
  });

  it('invokes onValidateMerchant with zero arguments and never reads validationURL', () => {
    installFake();
    const handlers = handlerBag();
    new BrowserApplePay().createSession(REQUEST, handlers);

    let validationUrlWasRead = false;
    lastSession().onvalidatemerchant?.({
      get validationURL(): string {
        validationUrlWasRead = true;
        return 'https://apple-pay-gateway.apple.com/paymentservices/paymentSession';
      },
    });

    expect(handlers.onValidateMerchant).toHaveBeenCalledWith();
    // Forwarding a browser-supplied URL to a certificate-bearing backend is an
    // SSRF surface; Apple's guidance is a static hostname.
    expect(validationUrlWasRead).toBe(false);
  });

  it('invokes onPaymentAuthorized with only the token', () => {
    installFake();
    const handlers = handlerBag();
    new BrowserApplePay().createSession(REQUEST, handlers);

    lastSession().onpaymentauthorized?.({
      payment: { token: TOKEN, billingContact: { givenName: 'Ada' } },
    } as never);

    expect(handlers.onPaymentAuthorized).toHaveBeenCalledWith(TOKEN);
    expect(handlers.onPaymentAuthorized.mock.calls[0]).toHaveLength(1);
  });

  it('invokes onCancel with zero arguments', () => {
    installFake();
    const handlers = handlerBag();
    new BrowserApplePay().createSession(REQUEST, handlers);

    lastSession().oncancel?.();

    expect(handlers.onCancel).toHaveBeenCalledWith();
  });
});

describe('BrowserApplePay session handle', () => {
  it('delegates begin and abort to the underlying session', () => {
    installFake();
    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());

    handle.begin();
    handle.abort();

    expect(lastSession().begin).toHaveBeenCalledWith();
    expect(lastSession().abort).toHaveBeenCalledWith();
  });

  it('delegates completeMerchantValidation with the opaque blob untouched', () => {
    installFake();
    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());
    const merchantSession = { opaque: 'blob' };

    handle.completeMerchantValidation(merchantSession);

    expect(lastSession().completeMerchantValidation).toHaveBeenCalledWith(
      merchantSession,
    );
  });

  it('maps success to the v3 object form carrying STATUS_SUCCESS', () => {
    const Ctor = installFake();
    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());

    handle.completePayment({ status: 'success' });

    const [result] = lastSession().completePayment.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(result).toEqual({ status: Ctor.STATUS_SUCCESS });
    // The v3 object form, never a bare number.
    expect(typeof result).toBe('object');
  });

  it('maps failure and forwards supplied errors', () => {
    const Ctor = installFake();
    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());
    const errors = [{ code: 'unknown', message: 'Declined' }] as const;

    handle.completePayment({ status: 'failure', errors });

    expect(lastSession().completePayment).toHaveBeenCalledWith({
      status: Ctor.STATUS_FAILURE,
      errors: [{ code: 'unknown', message: 'Declined' }],
    });
  });

  it('omits errors entirely when none are supplied', () => {
    installFake();
    const handle = new BrowserApplePay().createSession(REQUEST, handlerBag());

    handle.completePayment({ status: 'failure' });

    const [result] = lastSession().completePayment.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(Object.keys(result)).toEqual(['status']);
  });

  // DECLARED, NOT VERIFIED HERE: whether real Safari's v3 completePayment
  // accepts exactly this shape, and whether it requires real ApplePayError
  // instances rather than plain objects. Apple's behavior, Phase 7.
});

describe('BrowserApplePay session failures', () => {
  it('wraps a throwing constructor as APPLE_PAY_SESSION_ERROR, preserving the cause', () => {
    const cause = new Error('insecure page');
    class ThrowingApplePaySession {
      static readonly STATUS_SUCCESS = 0;
      static readonly STATUS_FAILURE = 1;
      static supportsVersion = (): boolean => true;
      static canMakePayments = (): boolean => true;
      constructor() {
        throw cause;
      }
    }
    vi.stubGlobal('ApplePaySession', ThrowingApplePaySession);

    const create = (): unknown =>
      new BrowserApplePay().createSession(REQUEST, handlerBag());

    // Apple throws for an insecure page, an invalid request and a call outside
    // a gesture handler alike. All three are one code to the merchant, with the
    // original preserved for debugging; telling them apart needs real Safari.
    expect(create).toThrow(AppError);
    expect(create).toThrow(
      expect.objectContaining({
        code: ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
        originalError: cause,
      }),
    );
  });

  it('reports a missing constructor as APPLE_PAY_SESSION_ERROR rather than a raw TypeError', () => {
    // Unreachable behind the mount() gate that reads canUseApplePay(), but a
    // raw "Ctor is not a constructor" escaping a port method is strictly worse
    // than a code the merchant can look up.
    const create = (): unknown =>
      new BrowserApplePay().createSession(REQUEST, handlerBag());

    expect(create).toThrow(
      expect.objectContaining({
        code: ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
      }),
    );
  });

  it('resolves APPLE_PAY_SESSION_ERROR to its own copy, not the UNKNOWN_ERROR fallback', () => {
    const message = MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_SESSION_ERROR];

    expect(message).toBeDefined();
    expect(message).not.toBe(MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR]);
    expect(
      new AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_SESSION_ERROR }),
    ).toHaveProperty('message', message);
  });
});

/**
 * WHY THESE TESTS READ A `<style>` NODE'S `textContent` AND NEVER
 * `button.style.getPropertyValue(...)`:
 *
 * jsdom's CSS engine silently DROPS declarations whose property it does not
 * recognize, and `-apple-pay-button-type` / `-apple-pay-button-style` are
 * exactly that. An inline-style implementation would produce a customization
 * test asserting `''` — green, and proving nothing. A `<style>` element's
 * `textContent` is a string, and jsdom cannot drop a string.
 *
 * What that buys is honest but bounded: these assert the CSS TEXT WE EMIT. They
 * do NOT prove that WebKit renders the Apple mark, nor that the merchant's own
 * CSS does not out-specify ours — there is no shadow root. Both are Phase 7,
 * on real Safari.
 */
const CONTAINER_ID = '#tonder-apple-pay-button';

function mountContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'tonder-apple-pay-button';
  document.body.appendChild(container);
  return container;
}

function renderedButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button');
  if (!button) throw new Error('no button was rendered');
  return button;
}

function emittedCss(container: HTMLElement): string {
  const style = container.querySelector('style');
  if (!style) throw new Error('no style node was rendered');
  return style.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('BrowserApplePay.render', () => {
  it('appends a style node and a button to the matched container', () => {
    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      onClick: vi.fn(),
    });

    expect(container.querySelector('style')).not.toBeNull();
    expect(renderedButton(container).type).toBe('button');
  });

  it('renders an accessible, labelled button', () => {
    // A <button>, not Apple's <div> sample markup: keyboard-activatable, and a
    // keyboard activation still dispatches a real click. (Whether Safari counts
    // that as a user gesture is Phase 7.)
    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      onClick: vi.fn(),
    });

    const button = renderedButton(container);
    expect(button.getAttribute('aria-label')).toBe('Apple Pay');
    expect(button.className).toBe('tonder-apple-pay-button');
  });

  it('emits the WebKit appearance and every default when no customization is passed', () => {
    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      onClick: vi.fn(),
    });

    const css = emittedCss(container);
    expect(css).toContain('-webkit-appearance: -apple-pay-button');
    expect(css).toContain('-apple-pay-button-type: check-out');
    expect(css).toContain('-apple-pay-button-style: black');
    expect(css).toContain('width: 100%');
    expect(css).toContain('height: 48px');
    expect(css).toContain('border-radius: 8px');
  });

  it('emits a button type the CSS property actually accepts', () => {
    // WebKit drops an unrecognized value and renders the logo-only button, so
    // a wrong default is invisible in code and wrong on screen.
    const CSS_SUPPORTED_TYPES = [
      'buy',
      'donate',
      'plain',
      'set-up',
      'book',
      'check-out',
      'subscribe',
      'add-money',
      'contribute',
      'order',
      'reload',
      'rent',
      'support',
      'tip',
      'top-up',
      'continue',
    ];

    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      onClick: vi.fn(),
    });

    const emitted = emittedCss(container).match(
      /-apple-pay-button-type: ([^;]+);/,
    )?.[1];

    expect(emitted).toBeDefined();
    expect(CSS_SUPPORTED_TYPES).toContain(emitted);
  });

  it.each([
    ['style', { style: 'white' as const }, '-apple-pay-button-style: white'],
    ['type', { type: 'plain' as const }, '-apple-pay-button-type: plain'],
    ['height', { height: '64px' }, 'height: 64px'],
  ])(
    'keeps every other default when only %s is supplied',
    (_field, customization, expected) => {
      const container = mountContainer();

      new BrowserApplePay().render({
        containerId: CONTAINER_ID,
        customization,
        onClick: vi.fn(),
      });

      const css = emittedCss(container);
      expect(css).toContain(expected);

      const untouched = [
        '-apple-pay-button-type: check-out',
        '-apple-pay-button-style: black',
        'width: 100%',
        'height: 48px',
        'border-radius: 8px',
      ].filter(
        (declaration) => !expected.startsWith(declaration.split(':')[0]),
      );

      for (const declaration of untouched) {
        expect(css).toContain(declaration);
      }
    },
  );

  it('maps each supplied customization field onto its WebKit property', () => {
    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      customization: {
        type: 'donate',
        style: 'white-outline',
        locale: 'es-MX',
        width: '100%',
        height: '48px',
        border_radius: '8px',
      },
      onClick: vi.fn(),
    });

    const css = emittedCss(container);
    expect(css).toContain('-apple-pay-button-type: donate');
    expect(css).toContain('-apple-pay-button-style: white-outline');
    expect(css).toContain('width: 100%');
    expect(css).toContain('height: 48px');
    expect(css).toContain('border-radius: 8px');

    // `locale` is NOT a CSS property. Apple reads the button's language from
    // the `lang` attribute; a `-apple-pay-button-locale` declaration is inert.
    const button = container.querySelector('button');
    expect(button?.lang).toBe('es-MX');
    expect(css).not.toContain('locale');
  });

  it('leaves `lang` unset when no locale is supplied', () => {
    // Apple then localizes from the shopper's browser. Stamping a default here
    // would override a per-shopper answer with a per-merchant guess.
    // https://developer.apple.com/documentation/applepayontheweb/applepaybuttonlocale
    const container = mountContainer();

    new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      customization: { type: 'buy' },
      onClick: vi.fn(),
    });

    expect(container.querySelector('button')?.lang).toBe('');
  });

  it('throws APPLE_PAY_CONTAINER_NOT_FOUND when the selector matches nothing', () => {
    const render = (): unknown =>
      new BrowserApplePay().render({
        containerId: '#not-on-this-page',
        onClick: vi.fn(),
      });

    expect(render).toThrow(AppError);
    expect(render).toThrow(
      expect.objectContaining({
        code: ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND,
      }),
    );
  });

  it('invokes onClick through an addEventListener listener, not an inline onclick', () => {
    const container = mountContainer();
    const onClick = vi.fn();

    new BrowserApplePay().render({ containerId: CONTAINER_ID, onClick });
    const button = renderedButton(container);
    button.dispatchEvent(new Event('click'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.onclick).toBeNull();
  });

  it('disposes both nodes and the listener, and a second call changes nothing', () => {
    const container = mountContainer();
    const onClick = vi.fn();

    const dispose = new BrowserApplePay().render({
      containerId: CONTAINER_ID,
      onClick,
    });
    const button = renderedButton(container);

    dispose();

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('style')).toBeNull();
    button.dispatchEvent(new Event('click'));
    expect(onClick).not.toHaveBeenCalled();

    expect(() => dispose()).not.toThrow();
    expect(container.childElementCount).toBe(0);
  });

  it('resolves both new codes to their own copy, neither to the UNKNOWN_ERROR fallback', () => {
    const codes = [
      ErrorKeyEnum.APPLE_PAY_SESSION_ERROR,
      ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND,
    ];

    for (const code of codes) {
      expect(MESSAGES_EN[code]).toBeDefined();
      expect(MESSAGES_EN[code]).not.toBe(
        MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR],
      );
      expect(new AppError({ errorCode: code })).toHaveProperty(
        'message',
        MESSAGES_EN[code],
      );
    }
  });
});
