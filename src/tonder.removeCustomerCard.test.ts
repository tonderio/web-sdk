import { describe, it, expect, vi } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort } from './ports/http.port';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { BusinessConfig } from './models/business.model';
import type { TonderConfig } from './shared/types';

const BASE_CONFIG: TonderConfig = {
  api_key: 'pk_test_123',
  environment: 'sandbox',
  return_url: 'https://merchant.example/return',
};

const CARD_ID = 'sky_1';

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

function noopTokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve({})),
  };
}

/** Routes business GET, customer POST, and the card DELETE (HTTP 200 body). */
function mockHttp(
  deleteImpl: HttpPort['request'] = () =>
    Promise.resolve({ message: 'deleted' }),
): { http: HttpPort; deleteSpy: ReturnType<typeof vi.fn> } {
  const deleteSpy = vi.fn(deleteImpl);
  const http: HttpPort = {
    request: vi.fn(<T>(options: Parameters<HttpPort['request']>[0]) => {
      if (options.path === '/api/v1/customer/') {
        return Promise.resolve({
          id: 1,
          auth_token: 'cust_tok_1',
        } as unknown as T);
      }
      if (options.method === 'DELETE') {
        return deleteSpy(options) as Promise<T>;
      }
      return Promise.resolve(makeBusinessConfig() as unknown as T);
    }),
  };
  return { http, deleteSpy };
}

async function readyWithCustomer(
  config: TonderConfig,
  http: HttpPort,
): Promise<ReturnType<typeof _createTonderWithDeps>> {
  const tonder = _createTonderWithDeps({
    config: {
      ...config,
      session: { ...config.session, customer: { email: 'ada@example.com' } },
    },
    http,
    tokenizer: noopTokenizer(),
  });
  await tonder.init();
  return tonder;
}

describe('Tonder.removeCustomerCard', () => {
  it('throws NOT_INITIALIZED before init()', async () => {
    const { http } = mockHttp();
    const tonder = _createTonderWithDeps({
      config: { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
      tokenizer: noopTokenizer(),
    });

    await expect(tonder.removeCustomerCard(CARD_ID)).rejects.toMatchObject({
      code: ErrorKeyEnum.NOT_INITIALIZED,
    });
  });

  it('throws MISSING_CUSTOMER when no customer is set in config', async () => {
    const { http, deleteSpy } = mockHttp();
    const tonder = _createTonderWithDeps({
      config: { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
      tokenizer: noopTokenizer(),
    });
    await tonder.init();

    await expect(tonder.removeCustomerCard(CARD_ID)).rejects.toMatchObject({
      code: ErrorKeyEnum.MISSING_CUSTOMER,
    });
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('throws SECURE_TOKEN_REQUIRED when secureToken is not configured', async () => {
    const { http } = mockHttp();
    const tonder = await readyWithCustomer(BASE_CONFIG, http);

    await expect(tonder.removeCustomerCard(CARD_ID)).rejects.toMatchObject({
      code: ErrorKeyEnum.SECURE_TOKEN_REQUIRED,
    });
  });

  it('resolves void on a 2xx delete and targets the integer business.pk + cardId', async () => {
    const { http, deleteSpy } = mockHttp();
    const tonder = await readyWithCustomer(
      {
        ...BASE_CONFIG,
        session: { secure_token: 'secure_abc' },
      },
      http,
    );

    await expect(tonder.removeCustomerCard(CARD_ID)).resolves.toBeUndefined();
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/api/v1/business/7/cards/${CARD_ID}/`,
        headers: expect.objectContaining({
          Authorization: 'Bearer secure_abc',
          'User-Token': 'cust_tok_1',
        }),
      }),
    );
  });

  it('wraps a transport failure as REMOVE_CARD_ERROR', async () => {
    const { http } = mockHttp(() => Promise.reject(new Error('boom')));
    const tonder = await readyWithCustomer(
      { ...BASE_CONFIG, session: { secure_token: 'secure_abc' } },
      http,
    );

    await expect(tonder.removeCustomerCard(CARD_ID)).rejects.toMatchObject({
      code: ErrorKeyEnum.REMOVE_CARD_ERROR,
    });
  });
});
