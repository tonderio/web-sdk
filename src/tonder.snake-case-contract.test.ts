import { describe, expect, it, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { mapToCard } from './models/card.model';
import { AppError } from './shared/errors/AppError';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { BusinessConfig } from './models/business.model';

function business(): BusinessConfig {
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
      checkout_environment: true,
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
  };
}

function transaction(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_1',
    operation_type: 'payment',
    status: 'Authorized',
    amount: '100.00',
    currency: 'MXN',
    ...overrides,
  };
}

function tokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() =>
      Promise.resolve({
        card_number: 'tok_cn',
        cvv: 'tok_cvv',
        expiration_month: 'tok_m',
        expiration_year: 'tok_y',
        cardholder_name: 'tok_name',
      }),
    ),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

describe('public snake_case contract', () => {
  it('accepts snake_case createTonder config and pay input, then sends return_url and presentation_mode to /process', async () => {
    const processSpy = vi.fn(() => Promise.resolve(transaction()));
    const http: HttpPort = {
      request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
        if (options.path === '/api/v1/process/')
          return processSpy(options) as Promise<T>;
        return Promise.resolve(business() as unknown as T);
      }),
    };
    const tonder = _createTonderWithDeps({
      config: {
        api_key: 'pk_test_123',
        environment: 'sandbox',
        presentation_mode: 'embedded',
        session: {
          secure_token: 'secure_abc',
          customer: {
            email: 'ada@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
          },
        },
      },
      http,
      tokenizer: tokenizer(),
    });

    await tonder.init();
    await tonder.pay({
      amount: 100,
      return_url: 'https://merchant.example/return/tx_1',
      client_reference: 'order_123',
      payment_method: { type: 'card' },
    });

    expect(processSpy).toHaveBeenCalledOnce();
    expect(processSpy.mock.calls[0][0].headers).toEqual({});
    expect(processSpy.mock.calls[0][0].body).toMatchObject({
      return_url: 'https://merchant.example/return/tx_1',
      presentation_mode: 'embedded',
      customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
      client_reference: 'order_123',
      payment_method: {
        type: 'CARD',
        card_number: 'tok_cn',
      },
    });
  });

  it('returns payment-method discovery objects with payment_method and no payment_method alias', async () => {
    const http: HttpPort = {
      request: vi.fn(<T>() =>
        Promise.resolve([
          { pk: 7, payment_method: 'oxxopay', priority: 10, category: 'cash' },
        ] as unknown as T),
      ),
    };
    const tonder = _createTonderWithDeps({
      config: { api_key: 'pk_test_123', environment: 'sandbox' },
      http,
    });

    const [method] = await tonder.getPaymentMethods();

    expect(method).toEqual({
      id: 7,
      payment_method: 'oxxopay',
      label: 'Oxxo Pay',
      logo: 'https://d35a75syrgujp0.cloudfront.net/payment_methods/oxxopay.png',
      category: 'cash',
    });
    expect('paymentMethod' in method).toBe(false);
  });

  it('maps saved cards to snake_case fields and no camelCase aliases', () => {
    const card = mapToCard({
      fields: {
        skyflow_id: 'sky_123',
        card_number: 'XXXX-XXXX-XXXX-4242',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: 'sub_1',
      },
    });

    expect(card).toEqual({
      card_id: 'sky_123',
      card_number: 'XXXX-XXXX-XXXX-4242',
      expiration_month: '12',
      expiration_year: '2030',
      card_scheme: 'visa',
      subscription_id: 'sub_1',
    });
    expect('cardId' in card).toBe(false);
  });

  it('exposes AppError status_code and details.system_error only', () => {
    const error = new AppError({
      errorCode: 'SAMPLE',
      status_code: 422,
      details: { system_error: 'input.return_url is required.' },
    });

    expect(error.status_code).toBe(422);
    expect(error.details.system_error).toBe('input.return_url is required.');
    expect('statusCode' in error).toBe(false);
    expect('systemError' in error.details).toBe(false);
  });
});
