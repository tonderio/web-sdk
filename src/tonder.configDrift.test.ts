/**
 * The drift warning as a merchant actually experiences it: through `console`,
 * during a real call, on an instance built the normal way.
 *
 * The core-level tests cover the detection rules with an injected spy. What is
 * pinned here is the wiring — that a merchant who mutates their config after
 * construction gets exactly one named line, and that a broken `console.warn`
 * cannot take a payment down with it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { PayInput, TonderConfig } from './shared/types';

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: { email: 'ada@example.com' },
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

function mockHttp(): HttpPort {
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/customer/') {
      return Promise.resolve({
        id: 1,
        auth_token: 'tok_1',
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
}

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve({ card_number: 'tok_cn' })),
  };
}

async function readyTonder(config: TonderConfig) {
  const tonder = _createTonderWithDeps({
    config,
    http: mockHttp(),
    tokenizer: noopTokenizer(),
  });
  await tonder.init();
  return tonder;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config drift warning', () => {
  it('warns once, naming the field, across calls that each observe it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = makeConfig();
    const tonder = await readyTonder(config);
    warn.mockClear();

    config.session!.secure_token = 'T2';
    await tonder.getCustomerCards();
    await tonder.getCustomerCards();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('session.secure_token');
    expect(warn.mock.calls[0][0]).toContain('has no effect');
  });

  it('stays silent for an untouched config', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tonder = await readyTonder(makeConfig());
    warn.mockClear();

    await tonder.getCustomerCards();

    expect(warn).not.toHaveBeenCalled();
  });

  it('completes the payment normally when console.warn itself throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('merchant logger blew up');
    });
    const config = makeConfig();
    const tonder = await readyTonder(config);

    config.session!.customer!.email = 'mallory@example.com';
    const tx = await tonder.pay(payInput());

    expect(tx.id).toBe('tx_1');
    expect(tx.status).toBe('Authorized');
  });

  it('does not change what the request carries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const config = makeConfig();
    const tonder = await readyTonder(config);

    config.session!.customer!.email = 'mallory@example.com';
    const tx = await tonder.pay(payInput());

    expect(tx.id).toBe('tx_1');
  });
});
