/**
 * The Apple Pay button component: the `create()` guard, the four-gate `mount()`
 * (T3), click delegation, and `unmount()`'s abort (D8).
 *
 * Every gate test asserts the code AND that no later check ran — a test that
 * only asserted the code would stay green against an implementation that ran
 * all four and reported the first failure it collected, which is a different
 * thing from stopping.
 *
 * `expect.objectContaining` is banned here too (DD12).
 */
import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type {
  ApplePayAdapter,
  ApplePayButtonRenderOptions,
  ApplePayPaymentToken,
  ApplePaySessionHandlers,
} from './ports/apple-pay.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';
import type { ApplePayButtonOptions } from './types/apple-pay';
import type { ApplePayConfig } from './models/business.model';

const ENABLED: ApplePayConfig = { enabled: true, supports_debit: true };

const TOKEN = {
  paymentData: { version: 'EC_v1', data: 'opaque' },
} as unknown as ApplePayPaymentToken;

function makeConfig(overrides: Partial<TonderConfig> = {}): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: { customer: { email: 'ada@example.com', first_name: 'Ada' } },
    ...overrides,
  };
}

function makeBusinessConfig(
  countryCode: string | undefined,
  applePay: ApplePayConfig | undefined,
) {
  return {
    business: {
      pk: 7,
      name: 'Ada Store',
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
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/process/') {
      return Promise.resolve({
        id: 'tx_1',
        operation_type: 'payment',
        status: 'Authorized',
        amount: '150.00',
        currency: 'MXN',
      });
    }
    return Promise.resolve(makeBusinessConfig(countryCode, applePay));
  });
}

interface FakeAdapter {
  adapter: ApplePayAdapter;
  canUseApplePay: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  disposers: ReturnType<typeof vi.fn>[];
  clicks: (() => void)[];
  handlers: ApplePaySessionHandlers[];
  handles: {
    begin: ReturnType<typeof vi.fn>;
    completeMerchantValidation: ReturnType<typeof vi.fn>;
    completePayment: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  }[];
}

function fakeAdapter(
  options: { canUse?: boolean; renderThrows?: boolean } = {},
): FakeAdapter {
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const clicks: (() => void)[] = [];
  const handlers: ApplePaySessionHandlers[] = [];
  const handles: FakeAdapter['handles'] = [];

  const canUseApplePay = vi.fn(() => options.canUse ?? true);
  const render = vi.fn((renderOptions: ApplePayButtonRenderOptions) => {
    if (options.renderThrows) {
      throw new AppError({
        errorCode: ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND,
      });
    }
    clicks.push(renderOptions.onClick);
    const dispose = vi.fn();
    disposers.push(dispose);
    return dispose;
  });
  const createSession = vi.fn(
    (_request: unknown, sessionHandlers: ApplePaySessionHandlers) => {
      handlers.push(sessionHandlers);
      const handle = {
        begin: vi.fn(),
        completeMerchantValidation: vi.fn(),
        completePayment: vi.fn(),
        abort: vi.fn(),
      };
      handles.push(handle);
      return handle;
    },
  );

  return {
    adapter: { canUseApplePay, createSession, render },
    canUseApplePay,
    createSession,
    render,
    disposers,
    clicks,
    handlers,
    handles,
  };
}

function buildTonder(options: {
  canUse?: boolean;
  renderThrows?: boolean;
  applePayConfig?: ApplePayConfig | undefined;
  countryCode?: string | undefined;
  config?: TonderConfig;
}) {
  const fake = fakeAdapter({
    canUse: options.canUse,
    renderThrows: options.renderThrows,
  });
  const tonder = _createTonderWithDeps({
    config: options.config ?? makeConfig(),
    http: mockHttp(
      'countryCode' in options ? options.countryCode : 'MX',
      'applePayConfig' in options ? options.applePayConfig : ENABLED,
    ),
    tokenizer: mockTokenizer(),
    applePay: fake.adapter,
  });
  return { tonder, fake };
}

async function readyTonder(
  options: Parameters<typeof buildTonder>[0] = {},
): Promise<ReturnType<typeof buildTonder>> {
  const built = buildTonder(options);
  await built.tonder.init();
  return built;
}

function buttonOptions(
  overrides: Partial<ApplePayButtonOptions> = {},
): ApplePayButtonOptions {
  return {
    payment: {
      amount: 150,
      currency: 'MXN',
      return_url: 'https://merchant.example/return',
      client_reference: 'order_123',
    },
    ...overrides,
  };
}

describe('create("apple_pay_button")', () => {
  it('returns a handle with mount and unmount', async () => {
    const { tonder } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());

    expect(typeof button.mount).toBe('function');
    expect(typeof button.unmount).toBe('function');
  });

  it('throws INVALID_PAYMENT_REQUEST naming the component when options.payment is missing', async () => {
    const { tonder } = await readyTonder();

    let caught: unknown;
    try {
      // `create<T>()`'s `options?` is optional for every T, so this
      // type-checks even though `payment` is required. The guard is what makes
      // the failure land here instead of as a TypeError at click time.
      tonder.create('apple_pay_button');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe(
      ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
    );
    expect((caught as AppError).details?.system_error).toBe(
      "create('apple_pay_button') requires options.payment.",
    );
  });
});

describe('Apple Pay button mount() — the four ordered gates (T3)', () => {
  it('gate 1 — NOT_INITIALIZED before init(), with no later check reached', async () => {
    const { tonder, fake } = buildTonder({});

    const button = tonder.create('apple_pay_button', buttonOptions());
    const error = await button.mount().catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorKeyEnum.NOT_INITIALIZED);
    expect(fake.canUseApplePay).not.toHaveBeenCalled();
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('gate 2 — APPLE_PAY_UNSUPPORTED_BROWSER, with the enabled and container checks skipped', async () => {
    // `apple_pay.enabled` and country BOTH pass here, so the failure is
    // attributable to the browser check alone.
    const { tonder, fake } = await readyTonder({ canUse: false });

    const button = tonder.create('apple_pay_button', buttonOptions());
    const error = await button.mount().catch((e) => e);

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_UNSUPPORTED_BROWSER);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('gate 3 — APPLE_PAY_NOT_ENABLED for apple_pay.enabled === false, container check skipped', async () => {
    // Browser and country both pass, so the failure is attributable to the
    // enabled flag alone.
    const { tonder, fake } = await readyTonder({
      applePayConfig: { enabled: false },
    });

    const button = tonder.create('apple_pay_button', buttonOptions());
    const error = await button.mount().catch((e) => e);

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_NOT_ENABLED);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('gate 3 — APPLE_PAY_NOT_ENABLED for an ABSENT apple_pay block, container check skipped', async () => {
    const { tonder, fake } = await readyTonder({ applePayConfig: undefined });

    const button = tonder.create('apple_pay_button', buttonOptions());
    const error = await button.mount().catch((e) => e);

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_NOT_ENABLED);
    expect(fake.render).not.toHaveBeenCalled();
  });

  it('mounts with an ABSENT country code — the country is not a gate', async () => {
    // The live case: an enabled `apple_pay` block with no `business.country_code`
    // on the wire. Gate 3 reads the enabled flag only, so mount() reaches
    // render() and the button appears.
    const { tonder, fake } = await readyTonder({ countryCode: undefined });

    const button = tonder.create('apple_pay_button', buttonOptions());

    await expect(button.mount()).resolves.toBeUndefined();
    expect(fake.render).toHaveBeenCalledTimes(1);
  });

  it('gate 4 — APPLE_PAY_CONTAINER_NOT_FOUND propagates from render()', async () => {
    const { tonder } = await readyTonder({ renderThrows: true });

    const button = tonder.create('apple_pay_button', buttonOptions());
    const error = await button.mount().catch((e) => e);

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND);
  });

  it('renders with the default container id and no customization when none is configured', async () => {
    const { tonder, fake } = await readyTonder();

    await tonder.create('apple_pay_button', buttonOptions()).mount();

    const passed = fake.render.mock.calls[0][0];
    expect(passed.containerId).toBe('#tonder-apple-pay-button');
    expect(passed.customization).toBeUndefined();
    expect(typeof passed.onClick).toBe('function');
  });

  it('translates container_id to containerId and forwards the configured customization unchanged', async () => {
    const customization = { type: 'buy' as const, style: 'black' as const };
    const { tonder, fake } = await readyTonder({
      config: makeConfig({
        customization: { apple_pay_button: customization },
      }),
    });

    await tonder
      .create('apple_pay_button', buttonOptions({ container_id: '#pay-here' }))
      .mount();

    const passed = fake.render.mock.calls[0][0];
    expect(passed.containerId).toBe('#pay-here');
    // Forwarded unchanged in CONTENT, not by reference: `container_id →
    // containerId` is still the one snake→camel translation at this boundary,
    // but the config is copied at construction now, so what reaches the
    // renderer is the copy. Reference identity here would mean the merchant
    // still holds a live wire into a mounted button's styling.
    expect(passed.customization).toStrictEqual(customization);
  });

  it('a second mount() disposes the first button before rendering again', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    await button.mount();

    expect(fake.render).toHaveBeenCalledTimes(2);
    expect(fake.disposers[0]).toHaveBeenCalledTimes(1);
    expect(fake.disposers[0].mock.invocationCallOrder[0]).toBeLessThan(
      fake.render.mock.invocationCallOrder[1],
    );
  });

  it('a second mount() does NOT abort a session in flight from the first mount', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();
    await button.mount();

    // Only unmount() aborts. A re-mount is idempotent-by-disposal.
    expect(fake.handles[0].abort).not.toHaveBeenCalled();
  });
});

/**
 * Mount, click, and read back the `countryCode` the request builder received.
 *
 * Reads the real built request off `createSession`, not the value handed to the
 * checkout service: the assertion has to survive the whole path from the
 * business config to Apple's constructor argument.
 */
async function sentCountryCode(
  countryCode: string | undefined,
): Promise<unknown> {
  const { tonder, fake } = await readyTonder({ countryCode });

  const button = tonder.create('apple_pay_button', buttonOptions());
  await button.mount();
  fake.clicks[0]();

  return (fake.createSession.mock.calls[0][0] as { countryCode: unknown })
    .countryCode;
}

describe('Apple Pay button — click delegation', () => {
  it('starts a checkout with the business country code and merchant name', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();

    expect(fake.createSession).toHaveBeenCalledTimes(1);
    expect(fake.createSession.mock.calls[0][0]).toEqual({
      countryCode: 'MX',
      currencyCode: 'MXN',
      supportedNetworks: ['visa', 'masterCard'],
      merchantCapabilities: ['supports3DS', 'supportsDebit'],
      total: { label: 'Ada Store', amount: '150.00', type: 'final' },
    });
    expect(fake.handles[0].begin).toHaveBeenCalledTimes(1);
  });

  it('sends the default country when the business config carries none', async () => {
    expect(await sentCountryCode(undefined)).toBe('MX');
  });

  it('sends the default country for an empty country_code', async () => {
    // An empty string is the backend saying nothing, not a country. Passing
    // `''` through would reach Apple's constructor as an invalid region.
    expect(await sentCountryCode('')).toBe('MX');
  });

  it('sends the CONFIGURED country, never the default, when the business has one', async () => {
    // The discriminating case. A default that overrode an explicit value would
    // charge every non-Mexican merchant through a Mexican region — a worse bug
    // than the missing-country one this default exists to fix. `'US'` is chosen
    // precisely because it cannot be confused with the default.
    expect(await sentCountryCode('US')).toBe('US');
  });

  it('reports a click-path failure through events.payment.on_error', async () => {
    const on_error = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_error } };
    const { tonder, fake } = await readyTonder({ config });

    const button = tonder.create(
      'apple_pay_button',
      buttonOptions({
        payment: {
          amount: 0,
          return_url: 'https://merchant.example/return',
          client_reference: 'order_123',
        },
      }),
    );
    await button.mount();
    fake.clicks[0]();

    expect(fake.createSession).not.toHaveBeenCalled();
    expect(on_error).toHaveBeenCalledTimes(1);
    expect(on_error.mock.calls[0][0].code).toBe(
      ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
    );
  });

  it('routes the authorized result to events.payment.on_completed', async () => {
    const on_completed = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed } };
    const { tonder, fake } = await readyTonder({ config });

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();
    await fake.handlers[0].onPaymentAuthorized(TOKEN);

    expect(fake.handles[0].completePayment).toHaveBeenCalledWith({
      status: 'success',
    });
    expect(on_completed).toHaveBeenCalledTimes(1);
    expect(on_completed.mock.calls[0][0].id).toBe('tx_1');
  });

  it('a throwing on_completed does not disturb the settled sheet (DD7)', async () => {
    // DD7 on the click-driven path. `pay()` covers the promise side of this;
    // here there is no promise to corrupt, so the property is about the SHEET:
    // `completePayment` runs before the callback (D2), so a merchant throw
    // arrives after Apple has already been told the outcome and must not
    // produce a second, contradicting settlement.
    //
    // Asserted on the outcome, never on the console.warn the sink emits —
    // asserting the log would go green while the sheet was left unsettled.
    const on_completed = vi.fn(() => {
      throw new Error('merchant analytics blew up');
    });
    const config = makeConfig();
    config.events = { payment: { on_completed } };
    const { tonder, fake } = await readyTonder({ config });

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();

    await expect(
      fake.handlers[0].onPaymentAuthorized(TOKEN),
    ).resolves.not.toThrow();

    expect(on_completed).toHaveBeenCalledTimes(1);
    expect(fake.handles[0].completePayment).toHaveBeenCalledTimes(1);
    expect(fake.handles[0].completePayment).toHaveBeenCalledWith({
      status: 'success',
    });
    expect(fake.handles[0].abort).not.toHaveBeenCalled();
  });
});

describe('Apple Pay button unmount() (D8)', () => {
  it('aborts a live session and disposes the button', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();
    button.unmount();

    expect(fake.handles[0].abort).toHaveBeenCalledTimes(1);
    expect(fake.disposers[0]).toHaveBeenCalledTimes(1);
    // Abort first: the sheet must be dismissed before its container disappears.
    expect(fake.handles[0].abort.mock.invocationCallOrder[0]).toBeLessThan(
      fake.disposers[0].mock.invocationCallOrder[0],
    );
  });

  it('disposes without calling abort when no session is live', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    button.unmount();

    expect(fake.handles).toHaveLength(0);
    expect(fake.disposers[0]).toHaveBeenCalledTimes(1);
  });

  it('a second unmount() is a no-op — no second dispose, no second abort, no throw', async () => {
    const { tonder, fake } = await readyTonder();

    const button = tonder.create('apple_pay_button', buttonOptions());
    await button.mount();
    fake.clicks[0]();
    button.unmount();

    expect(() => button.unmount()).not.toThrow();
    expect(fake.disposers[0]).toHaveBeenCalledTimes(1);
    expect(fake.handles[0].abort).toHaveBeenCalledTimes(1);
  });

  it('one button unmount() does not abort another button live session (DD3)', async () => {
    const { tonder, fake } = await readyTonder();

    const first = tonder.create('apple_pay_button', buttonOptions());
    const second = tonder.create('apple_pay_button', buttonOptions());
    await first.mount();
    await second.mount();

    fake.clicks[0]();
    second.unmount();

    // One checkout service PER COMPONENT: a shared instance would let button
    // B's unmount abort button A's live sheet.
    expect(fake.handles[0].abort).not.toHaveBeenCalled();
  });
});
