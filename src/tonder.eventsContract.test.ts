/**
 * Characterization tests for the published `config.events` contract.
 *
 * README documents that a merchant may assign `config.events.payment` AFTER
 * `createTonder()` — including when no `events` key existed at construction.
 * These two tests pin that contract BEFORE the config snapshot lands, so they
 * act as a tripwire: if the snapshot work ever swallows `events`, they go red
 * here rather than silently in a shopper's browser, where a payment that
 * succeeded looks to the merchant like it vanished.
 *
 * They deliberately cover the two shapes `tonder.paymentEvents.test.ts` does
 * not: an IN-PLACE nested mutation (the existing file only replaces the whole
 * `events` object) and an assignment where there was no key to alias at all.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

function makeConfig(): TonderConfig {
  return {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: {
      customer: {
        email: 'ada@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
      },
    },
  };
}

function makeBusinessConfig(): BusinessConfig {
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

function backendResponse(): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'Authorized',
    amount: '150.00',
    currency: 'MXN',
  };
}

function mockTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.resolve({ card_number: 'tok_cn' })),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function mockHttp(): HttpPort {
  return asHttpPort((options: HttpRequestOptions) => {
    if (options.path === '/api/v1/process/') {
      return Promise.resolve(backendResponse());
    }
    return Promise.resolve(makeBusinessConfig());
  });
}

async function readyTonder(config: TonderConfig) {
  const tonder = _createTonderWithDeps({
    config,
    http: mockHttp(),
    tokenizer: mockTokenizer(),
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

describe('config.events stays live after createTonder()', () => {
  it('honors an IN-PLACE swap of events.payment.on_completed', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const config = makeConfig();
    config.events = { payment: { on_completed: h1 } };
    const tonder = await readyTonder(config);

    // In place, through the SAME `events` and `events.payment` objects. A fix
    // that kept `events` by reference-identity only would still pass this one;
    // it is the ABSENT-at-construction case below that defeats that shortcut.
    config.events.payment!.on_completed = h2;
    const tx = await tonder.pay(payInput());

    expect(h2).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledWith(tx);
    expect(h1).not.toHaveBeenCalled();
  });

  it('honors events assigned when NO events key existed at construction', async () => {
    const h1 = vi.fn();
    const config = makeConfig();
    expect(config.events).toBeUndefined();
    const tonder = await readyTonder(config);

    // There is no key to alias here. Only a design that resolves `events` from
    // the merchant's original object at fire time can see this assignment.
    config.events = { payment: { on_completed: h1 } };
    const tx = await tonder.pay(payInput());

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h1).toHaveBeenCalledWith(tx);
  });
});
