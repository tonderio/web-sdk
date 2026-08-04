/**
 * The merchant keeps their own reference to the config object they passed to
 * `createTonder()`. Writing through it after construction must not change a
 * single byte the SDK puts on the wire.
 *
 * Every assertion here is on the OUTGOING REQUEST, captured at the `HttpPort`
 * seam. That boundary is entirely inside this SDK's control. What a backend
 * decides to answer with — A's cards, an empty list, a 403 — is an
 * authorization decision belonging to someone else's service, and asserting on
 * it would make these tests go red for reasons this change cannot fix.
 *
 * This file is the in-repo stand-in for QA's `cardsC_firstCallAfterPreMutation`
 * probe, which lives in a repository that could not be reached.
 */
import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { PayInput, TonderConfig } from './shared/types';

const CUSTOMER_A = {
  email: 'ada@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

const CUSTOMER_B = {
  email: 'mallory@example.com',
  first_name: 'Mallory',
  last_name: 'Intruder',
};

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: { ...CUSTOMER_A },
      secure_token: 'T1',
    },
  };
}

function makeBusinessConfig(): BusinessConfig {
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
  } as unknown as BusinessConfig;
}

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve({ card_number: 'tok_cn' })),
  };
}

/**
 * Records every outgoing request and derives the customer token FROM the posted
 * email, so a `User-Token` on a later request traces back to the identity the
 * SDK actually registered rather than to a constant the fake chose.
 */
function recordingHttp(): { http: HttpPort; recorded: HttpRequestOptions[] } {
  const recorded: HttpRequestOptions[] = [];
  const http: HttpPort = asHttpPort((options: HttpRequestOptions) => {
    recorded.push(options);
    if (options.path === '/api/v1/customer/') {
      const body = options.body as { email: string };
      return Promise.resolve({
        id: 1,
        auth_token: `tok_${body.email}`,
      });
    }
    if (options.path.endsWith('/cards/')) {
      return Promise.resolve({ user_id: 'u_1', cards: [] });
    }
    if (options.path === '/api/v1/process/') {
      return Promise.resolve({
        id: 'tx_1',
        operation_type: 'payment',
        status: 'Authorized',
        amount: '150.00',
        currency: 'MXN',
      });
    }
    return Promise.resolve(makeBusinessConfig());
  });
  return { http, recorded };
}

function cardsRequests(recorded: HttpRequestOptions[]): HttpRequestOptions[] {
  return recorded.filter((entry) => entry.path.endsWith('/cards/'));
}

function customerRequests(
  recorded: HttpRequestOptions[],
): HttpRequestOptions[] {
  return recorded.filter((entry) => entry.path === '/api/v1/customer/');
}

function serialize(recorded: HttpRequestOptions[]): string {
  return JSON.stringify(recorded);
}

function payInput(): PayInput {
  return {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    payment_method: { type: 'card' },
    client_reference: 'order_123',
  };
}

describe('config snapshot — mutation after construction is inert', () => {
  it('keeps the construction-time secure_token on every later request', async () => {
    // The widest mutation window in the SDK: `secure_token` is re-read on every
    // saved-card call and never memoized, so a live config would leak the new
    // value on the very next call.
    const { http, recorded } = recordingHttp();
    const config = makeConfig();
    const tonder = _createTonderWithDeps({
      config,
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();

    config.session!.secure_token = 'T2';
    await tonder.getCustomerCards();
    await tonder.getCustomerCards();

    const cards = cardsRequests(recorded);
    expect(cards).toHaveLength(2);
    for (const request of cards) {
      expect(request.headers?.Authorization).toBe('Bearer T1');
    }
    expect(serialize(recorded)).not.toContain('T2');
  });

  it('ignores a pre-first-call mutation of customer, in place and by replacement', async () => {
    // Both mutation shapes in one test on purpose. In-place defeats a fix that
    // only compares reference identity; replacement defeats a fix that memoizes
    // a value once and never re-derives it. A test covering one shape passes
    // against half a fix.
    const { http, recorded } = recordingHttp();
    const config = makeConfig();
    const tonder = _createTonderWithDeps({
      config,
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();

    config.session!.customer!.email = CUSTOMER_B.email;
    config.session!.customer = { ...CUSTOMER_B };

    await tonder.getCustomerCards();

    const registrations = customerRequests(recorded);
    expect(registrations).toHaveLength(1);
    expect((registrations[0].body as { email: string }).email).toBe(
      CUSTOMER_A.email,
    );

    const cards = cardsRequests(recorded);
    expect(cards).toHaveLength(1);
    expect(cards[0].headers?.['User-Token']).toBe(`tok_${CUSTOMER_A.email}`);
    expect(cards[0].headers?.Authorization).toBe('Bearer T1');

    expect(serialize(recorded)).not.toContain(CUSTOMER_B.email);
    expect(serialize(recorded)).not.toContain(CUSTOMER_B.first_name);
  });

  it('keeps sending customer A after a mutation that follows a successful call', async () => {
    const { http, recorded } = recordingHttp();
    const config = makeConfig();
    const tonder = _createTonderWithDeps({
      config,
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();
    await tonder.pay(payInput());

    config.session!.customer = { ...CUSTOMER_B };
    await tonder.pay(payInput());

    const processed = recorded.filter(
      (entry) => entry.path === '/api/v1/process/',
    );
    expect(processed).toHaveLength(2);
    for (const request of processed) {
      const body = request.body as { customer?: { email?: string } };
      expect(body.customer?.email).toBe(CUSTOMER_A.email);
    }
    expect(serialize(recorded)).not.toContain(CUSTOMER_B.email);
  });

  it('never throws on any of those mutations, at write time or on the next call', async () => {
    // Bundled ESM is always strict, so a stray freeze anywhere in this path
    // would turn a merchant's late write into a TypeError in a shopper's
    // browser. Inert is the goal; rejected is not.
    const { http } = recordingHttp();
    const config = makeConfig();
    const tonder = _createTonderWithDeps({
      config,
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();

    expect(() => {
      config.session!.secure_token = 'T2';
      config.session!.customer!.email = CUSTOMER_B.email;
      config.session!.customer = { ...CUSTOMER_B };
      config.presentation_mode = 'embedded';
      config.events = { payment: {} };
    }).not.toThrow();

    await expect(tonder.getCustomerCards()).resolves.toEqual([]);
  });
});
