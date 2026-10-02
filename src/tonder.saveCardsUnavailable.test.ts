import { describe, it, expect, vi, afterEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { AcquirerPort } from './ports/acquirer.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { PayInput, TonderConfig } from './shared/types';

type Customer = NonNullable<TonderConfig['session']>['customer'];

const WITH_PHONE: Customer = { email: 'ada@example.com', phone: '5512345678' };
const NO_PHONE: Customer = { email: 'ada@example.com' };
const BLANK_PHONE: Customer = { email: 'ada@example.com', phone: '   ' };

function makeBusinessConfig(
  overrides: Partial<BusinessConfig> = {},
): BusinessConfig {
  return {
    business: {
      pk: 7,
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
    },
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
    ...overrides,
  };
}

const TOKENS = {
  card_number: 'tok_cn',
  cvv: 'tok_cvv',
  expiration_month: 'tok_m',
  expiration_year: 'tok_y',
  cardholder_name: 'tok_name',
  skyflow_id: 'sky_1',
};

function tokenizer(): TokenizerPort & { collect: ReturnType<typeof vi.fn> } {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve(TOKENS)),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function acquirer(): AcquirerPort & {
  createCofSubscription: ReturnType<typeof vi.fn>;
} {
  return {
    createCofSubscription: vi.fn(() =>
      Promise.resolve({ subscriptionId: 'sub_1' }),
    ),
  };
}

/** Every request except the init business GET, as `METHOD path`. */
function build(options: {
  business?: Partial<BusinessConfig>;
  customer?: Customer;
}) {
  const calls: string[] = [];
  const http: HttpPort = asHttpPort((request: HttpRequestOptions) => {
    if (request.path.startsWith('/api/v1/payments/business/')) {
      return Promise.resolve(makeBusinessConfig(options.business));
    }
    calls.push(`${request.method} ${request.path}`);
    if (request.path === '/api/v1/customer/') {
      return Promise.resolve({ id: 42, auth_token: 'cust_tok_1' });
    }
    if (request.path === '/api/v1/process/') {
      return Promise.resolve({
        id: 'tx_1',
        status: 'Authorized',
        amount: 150,
        currency: 'MXN',
        created_at: '2026-01-01T00:00:00Z',
      });
    }
    if (request.method === 'GET' && request.path.endsWith('/cards/')) {
      return Promise.resolve({ user_id: 'u_1', cards: [] });
    }
    if (request.method === 'POST' && request.path.endsWith('/cards/')) {
      return Promise.resolve({
        skyflow_id: 'sky_1',
        user_id: 'u_1',
        card_bin: '411111',
      });
    }
    return Promise.resolve({ message: 'ok' });
  });
  const tk = tokenizer();
  const acq = acquirer();
  const tonder = _createTonderWithDeps({
    config: {
      api_key: 'pk_test_123',
      environment: 'sandbox',
      session: { secure_token: 'secure_abc', customer: options.customer },
    },
    http,
    tokenizer: tk,
    acquirer: acq,
  });
  return { tonder, calls, tk, acq };
}

const COF = { cardonfile_keys: { public_key: 'cof_pub' } };
const PHONE_MODE = { save_cards_identifier_type: 'phone' as const };

const AVAILABLE: [string, Partial<BusinessConfig>, Customer][] = [
  ['email mode, no phone', { save_cards_identifier_type: 'email' }, NO_PHONE],
  ['field absent, no phone', {}, NO_PHONE],
  ['phone mode, phone present', PHONE_MODE, WITH_PHONE],
];

const UNAVAILABLE: [string, Customer][] = [
  ['phone missing', NO_PHONE],
  ['phone blank', BLANK_PHONE],
];

function cardPay(): PayInput {
  return {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    payment_method: { type: 'card' },
    client_reference: 'order_123',
  };
}

function savedCardPay(): PayInput {
  return {
    ...cardPay(),
    payment_method: { type: 'saved_card', card_id: 'c1' },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('saved-card calls in phone mode without a phone', () => {
  describe.each(UNAVAILABLE)('%s', (_name, customer) => {
    it('getCustomerCards rejects with SAVE_CARDS_UNAVAILABLE before any request', async () => {
      const { tonder, calls } = build({ business: PHONE_MODE, customer });
      await tonder.init();

      const err = await tonder.getCustomerCards().catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(ErrorKeyEnum.SAVE_CARDS_UNAVAILABLE);
      expect(calls).toEqual([]);
    });

    it.each([
      ['COF off', {}],
      ['COF on', COF],
    ])(
      'enrollCard rejects with SAVE_CARDS_UNAVAILABLE before any request (%s)',
      async (_cof, cof) => {
        const { tonder, calls, tk } = build({
          business: { ...PHONE_MODE, ...cof },
          customer,
        });
        await tonder.init();

        const err = await tonder.enrollCard().catch((e) => e);

        expect(err.code).toBe(ErrorKeyEnum.SAVE_CARDS_UNAVAILABLE);
        expect(calls).toEqual([]);
        expect(tk.collect).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['COF off', {}],
      ['COF on', COF],
    ])(
      'pay(saved_card) rejects with SAVE_CARDS_UNAVAILABLE before any request (%s)',
      async (_cof, cof) => {
        const { tonder, calls } = build({
          business: { ...PHONE_MODE, ...cof },
          customer,
        });
        await tonder.init();

        const err = await tonder.pay(savedCardPay()).catch((e) => e);

        expect(err.code).toBe(ErrorKeyEnum.SAVE_CARDS_UNAVAILABLE);
        expect(calls).toEqual([]);
      },
    );

    it('removeCustomerCard still calls the backend', async () => {
      const { tonder, calls } = build({ business: PHONE_MODE, customer });
      await tonder.init();

      await expect(tonder.removeCustomerCard('c1')).resolves.toBeUndefined();

      expect(calls).toContain('DELETE /api/v1/business/7/cards/c1/');
    });
  });

  it('keeps NOT_INITIALIZED ahead of SAVE_CARDS_UNAVAILABLE', async () => {
    const { tonder } = build({ business: PHONE_MODE, customer: NO_PHONE });

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
    await expect(tonder.pay(savedCardPay())).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
  });

  it('keeps MISSING_CUSTOMER ahead of SAVE_CARDS_UNAVAILABLE', async () => {
    const { tonder } = build({ business: PHONE_MODE });
    await tonder.init();

    await expect(tonder.getCustomerCards()).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    await expect(tonder.enrollCard()).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    await expect(tonder.pay(savedCardPay())).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
  });

  it('keeps INVALID_PAYMENT_REQUEST ahead of SAVE_CARDS_UNAVAILABLE for a bad amount', async () => {
    const { tonder } = build({ business: PHONE_MODE, customer: NO_PHONE });
    await tonder.init();

    await expect(
      tonder.pay({ ...savedCardPay(), amount: 0 }),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.INVALID_PAYMENT_REQUEST });
  });
});

describe('saved-card calls where saved cards are available', () => {
  describe.each(AVAILABLE)('%s', (_name, business, customer) => {
    it('getCustomerCards lists cards', async () => {
      const { tonder, calls } = build({ business, customer });
      await tonder.init();

      await expect(tonder.getCustomerCards()).resolves.toEqual([]);
      expect(calls).toContain('GET /api/v1/business/7/cards/');
    });

    it('enrollCard saves the card', async () => {
      const { tonder, calls } = build({ business, customer });
      await tonder.init();

      await expect(tonder.enrollCard()).resolves.toMatchObject({
        card_id: 'sky_1',
      });
      expect(calls).toContain('POST /api/v1/business/7/cards/');
    });
  });
});

describe('pay({ type: "card" }) with Card on File', () => {
  const warnPattern = /\[tonder\].*phone.*session\.customer\.phone/s;

  describe.each(UNAVAILABLE)('phone mode, %s', (_name, customer) => {
    it('skips the implicit enrollment, charges as a regular card, and warns once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { tonder, calls, tk, acq } = build({
        business: { ...PHONE_MODE, ...COF },
        customer,
      });
      await tonder.init();

      const tx = await tonder.pay(cardPay());

      expect(tx.status).toBe('Authorized');
      expect(calls.filter((c) => c.endsWith('/cards/'))).toEqual([]);
      expect(acq.createCofSubscription).not.toHaveBeenCalled();
      expect(tk.collect).toHaveBeenCalledTimes(1);
      expect(calls).toContain('POST /api/v1/process/');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(warnPattern);
    });
  });

  it('without Card on File: unchanged and no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tonder, calls } = build({
      business: PHONE_MODE,
      customer: NO_PHONE,
    });
    await tonder.init();

    const tx = await tonder.pay(cardPay());

    expect(tx.status).toBe('Authorized');
    expect(calls).toEqual(['POST /api/v1/process/']);
    expect(warn).not.toHaveBeenCalled();
  });

  describe.each(AVAILABLE)('%s', (_name, business, customer) => {
    it('still enrolls implicitly and does not warn', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { tonder, calls } = build({
        business: { ...business, ...COF },
        customer,
      });
      await tonder.init();

      await tonder.pay(cardPay());

      expect(calls).toContain('POST /api/v1/business/7/cards/');
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
