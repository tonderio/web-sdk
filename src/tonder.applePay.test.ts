/**
 * `isApplePayAvailable()` and the Apple Pay adapter injection.
 *
 * Each unavailable case forces the OTHER checks to PASS, so the reported code
 * is attributable to exactly one cause. Asserting `available: false` with two
 * causes failing would be trivially green against an implementation that
 * ignored one of them — the same wrong-reason class the earlier phases hit.
 *
 * The business country is NOT one of those causes: it resolves to a default at
 * the read site, so a business without one is available like any other. The
 * country cases below assert `available: true` for exactly that reason.
 *
 * The precedence block asserts parity with the `mount()` gate by running BOTH
 * against the same instance and comparing codes, rather than restating the
 * expected order as a literal. A hardcoded order would stay green after
 * `mount()` reordered its gates, which is the exact drift it must catch.
 */
import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps, createTonder } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import { MESSAGES_EN } from './shared/errors/messages';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type {
  ApplePayAdapter,
  ApplePayButtonRenderOptions,
} from './ports/apple-pay.port';
import type { ApplePayConfig, BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  session: { customer: { email: 'ada@example.com', first_name: 'Ada' } },
};

const ENABLED: ApplePayConfig = { enabled: true };

// No default parameter on either argument: `undefined` must mean "the backend
// sent no country_code" / "the backend sent no apple_pay block", and a default
// would silently substitute a passing value and make the test green for the
// wrong reason.
function makeBusinessConfig(
  countryCode: string | undefined,
  applePay: ApplePayConfig | undefined,
) {
  return {
    business: {
      pk: 1,
      name: 'Acme',
      categories: [],
      web: 'https://acme.test',
      logo: 'logo.png',
      full_logo_url: 'https://acme.test/logo.png',
      background_color: '#fff',
      primary_color: '#000',
      checkout_mode: true,
      textCheckoutColor: '#111',
      textDetailsColor: '#222',
      checkout_logo: 'checkout.png',
      ...(countryCode === undefined ? {} : { country_code: countryCode }),
    },
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    ...(applePay === undefined ? {} : { apple_pay: applePay }),
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
  } as unknown as BusinessConfig;
}

function mockTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({})),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function mockHttp(
  countryCode: string | undefined,
  applePay: ApplePayConfig | undefined,
): HttpPort {
  return asHttpPort((_options: HttpRequestOptions) =>
    Promise.resolve(makeBusinessConfig(countryCode, applePay)),
  );
}

function fakeApplePay(canUse = true): ApplePayAdapter & {
  canUseApplePay: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
} {
  return {
    canUseApplePay: vi.fn(() => canUse),
    createSession: vi.fn(() => ({
      begin: vi.fn(),
      completeMerchantValidation: vi.fn(),
      completePayment: vi.fn(),
      abort: vi.fn(),
    })),
    render: vi.fn((_options: ApplePayButtonRenderOptions) => vi.fn()),
  };
}

interface TonderOptions {
  canUse?: boolean;
  applePayConfig?: ApplePayConfig | undefined;
  countryCode?: string | undefined;
}

function buildTonder(options: TonderOptions) {
  const applePay = fakeApplePay(options.canUse ?? true);
  // The transport fake is RETURNED, not recovered off the instance afterwards.
  // The instance holds nothing readable by name, and a test asserting on a
  // mock it created should hold that mock itself regardless.
  const http = mockHttp(
    'countryCode' in options ? options.countryCode : 'MX',
    'applePayConfig' in options ? options.applePayConfig : ENABLED,
  );
  const tonder = _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer: mockTokenizer(),
    applePay,
  });
  return { tonder, applePay, http };
}

async function readyTonder(options: TonderOptions) {
  const built = buildTonder(options);
  await built.tonder.init();
  return built;
}

const BUTTON_OPTIONS = {
  payment: {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    client_reference: 'order_123',
  },
};

/** The code `mount()` throws for the same instance, for precedence parity. */
async function mountCode(tonder: ReturnType<typeof createTonder>) {
  const button = tonder.create('apple_pay_button', BUTTON_OPTIONS);
  const error = await button.mount().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

describe('Tonder.isApplePayAvailable', () => {
  // The ALL-PASSING case. It is what proves the production code reads a
  // READABLE path: every unavailable case below would also be unavailable
  // against an implementation reading a misspelled path such as
  // `state.business?.business.apple_pay`.
  it('is available when the browser and apple_pay.enabled checks both pass', async () => {
    const { tonder } = await readyTonder({});

    const result = tonder.isApplePayAvailable();

    expect(result).toEqual({ available: true });
  });

  it('reports NOT_INITIALIZED before init(), with the other checks passing', async () => {
    const { tonder, applePay, http } = buildTonder({});

    const result = tonder.isApplePayAvailable();

    expect(result).toEqual({
      available: false,
      code: ErrorKeyEnum.NOT_INITIALIZED,
      message: MESSAGES_EN[ErrorKeyEnum.NOT_INITIALIZED],
    });
    // Synchronous and no network: the probe may run during a first render.
    expect(http.request).not.toHaveBeenCalled();
    // Short-circuits before the browser check, matching the mount() gate.
    expect(applePay.canUseApplePay).not.toHaveBeenCalled();
  });

  it('reports APPLE_PAY_UNSUPPORTED_BROWSER on the browser check alone', async () => {
    const { tonder, applePay } = await readyTonder({ canUse: false });

    const result = tonder.isApplePayAvailable();

    expect(result).toEqual({
      available: false,
      code: ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER,
      message: MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER],
    });
    expect(applePay.canUseApplePay).toHaveBeenCalled();
  });

  it('reports APPLE_PAY_NOT_ENABLED on apple_pay.enabled === FALSE alone', async () => {
    const { tonder } = await readyTonder({
      applePayConfig: { enabled: false },
    });

    const result = tonder.isApplePayAvailable();

    expect(result).toEqual({
      available: false,
      code: ErrorKeyEnum.APPLE_PAY_NOT_ENABLED,
      message: MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_NOT_ENABLED],
    });
  });

  it('reports APPLE_PAY_NOT_ENABLED on an ABSENT apple_pay block alone', async () => {
    // Distinct from `enabled: false` on the wire; both collapse to the same
    // code here and neither may throw.
    const { tonder } = await readyTonder({ applePayConfig: undefined });

    const result = tonder.isApplePayAvailable();

    expect(result).toEqual({
      available: false,
      code: ErrorKeyEnum.APPLE_PAY_NOT_ENABLED,
      message: MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_NOT_ENABLED],
    });
  });

  it('carries the same copy a thrown AppError would carry for that code', async () => {
    // The point of reusing MESSAGES_EN: a merchant reading `message` here sees
    // the string mount() would have thrown, not a second wording of it.
    const { tonder } = await readyTonder({ canUse: false });

    const result = tonder.isApplePayAvailable();

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.message).toBe(
      new AppError({ errorCode: result.code }).message,
    );
  });

  it('is available for an ABSENT country_code — the country resolves to a default', async () => {
    // The live case this behavior exists for: the business endpoint returns an
    // enabled `apple_pay` block but omits `business.country_code`. Availability
    // must not hinge on a field the backend does not send.
    const { tonder } = await readyTonder({ countryCode: undefined });

    expect(tonder.isApplePayAvailable()).toEqual({ available: true });
  });

  it('is available for an EMPTY country_code — an empty string is treated as absent', async () => {
    const { tonder } = await readyTonder({ countryCode: '' });

    expect(tonder.isApplePayAvailable()).toEqual({ available: true });
  });

  it('never throws, including before init()', () => {
    const { tonder } = buildTonder({});

    expect(() => tonder.isApplePayAvailable()).not.toThrow();
  });
});

describe('isApplePayAvailable precedence matches the mount() gate', () => {
  // Each case fails TWO checks at once. The probe must blame the same one
  // mount() throws, so a merchant who branches on `code` reads the reason the
  // real failure would have given.
  it('blames NOT_INITIALIZED when the browser check would also fail', async () => {
    const { tonder } = buildTonder({ canUse: false });

    const result = tonder.isApplePayAvailable();

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.code).toBe(await mountCode(tonder));
  });

  it('blames NOT_INITIALIZED when apple_pay is also disabled', async () => {
    const { tonder } = buildTonder({ applePayConfig: { enabled: false } });

    const result = tonder.isApplePayAvailable();

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.code).toBe(await mountCode(tonder));
  });

  it('blames the BROWSER when apple_pay is also disabled', async () => {
    const { tonder } = await readyTonder({
      canUse: false,
      applePayConfig: { enabled: false },
    });

    const result = tonder.isApplePayAvailable();

    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.code).toBe(await mountCode(tonder));
  });
});

describe('Apple Pay adapter injection (DD10)', () => {
  it('uses the injected adapter instead of constructing a browser one', async () => {
    const { tonder, applePay } = await readyTonder({});

    tonder.isApplePayAvailable();

    expect(applePay.canUseApplePay).toHaveBeenCalledTimes(1);
  });

  it('defaults to the browser adapter when none is supplied', async () => {
    // The default is constructed in the constructor and must be SSR-safe: the
    // browser adapter reads DOM and globals only inside method bodies, so
    // constructing one outside a browser cannot throw.
    expect(() => createTonder(CONFIG)).not.toThrow();

    const tonder = _createTonderWithDeps({
      config: CONFIG,
      http: mockHttp('MX', ENABLED),
      tokenizer: mockTokenizer(),
    });
    await tonder.init();

    // Initialized and apple_pay enabled, so the ONLY remaining check is the
    // browser one. There is no ApplePaySession global in jsdom, so this code is
    // reached only because a real adapter was constructed and consulted.
    expect(tonder.isApplePayAvailable()).toEqual({
      available: false,
      code: ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER,
      message: MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER],
    });
  });

  it('accepts the adapter as the seventh positional constructor parameter', async () => {
    // `_createTonderWithDeps` forwards its `applePay` key positionally; if it
    // landed in the wrong slot the injected fake would not be consulted and the
    // real browser adapter would answer instead.
    const { tonder, applePay } = await readyTonder({ canUse: false });

    expect(tonder.isApplePayAvailable().available).toBe(false);
    expect(applePay.canUseApplePay).toHaveBeenCalledTimes(1);
  });
});

describe('pay({ payment_method: { type: "apple_pay" } }) (D9)', () => {
  it('throws INVALID_PAYMENT_REQUEST naming create("apple_pay_button") before any network call', async () => {
    const { tonder, http } = await readyTonder({});
    const request = http.request as ReturnType<typeof vi.fn>;
    request.mockClear();

    const caught = await tonder
      .pay({
        amount: 150,
        return_url: 'https://merchant.example/return',
        client_reference: 'order_123',
        // This TYPE-CHECKS and always has: PaymentMethod's third member,
        // `{ type: string; config? }`, accepts any string literal. The compiler
        // structurally cannot be the guard here, so no assertion in this file
        // claims a compile error — the runtime check is the whole mechanism.
        payment_method: { type: 'apple_pay' },
      })
      .catch((error) => error);

    expect(caught).toBeInstanceOf(AppError);
    expect(caught.code).toBe(ErrorKeyEnum.INVALID_PAYMENT_REQUEST);
    expect(caught.details?.system_error).toBe(
      "Apple Pay is not a pay() method. Use create('apple_pay_button', { payment }).",
    );
    // Without the guard the call is treated as a generic APM and reaches
    // /process as { type: 'apple_pay' }, so the merchant sees a backend
    // rejection instead of a message naming the component.
    expect(request).not.toHaveBeenCalled();
  });
});
