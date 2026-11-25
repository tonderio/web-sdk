import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _createTonderWithDeps } from './tonder';
import { AppError } from './shared/errors/AppError';
import { ErrorKeyEnum } from './shared/errors/ErrorKeyEnum';
import type { HttpPort, HttpRequestOptions } from './ports/http.port';
import { asHttpPort } from './test-support/http.mock';
import type { TokenizerPort } from './ports/tokenizer.port';
import type { ThreeDsHostPort } from './ports/threeds-host.port';
import type { BusinessConfig } from './models/business.model';
import type { BackendTransactionResponse } from './models/transaction.model';
import type { PayInput, TonderConfig } from './shared/types';

const CONFIG: TonderConfig = {
  api_key: 'api_key_under_test',
  environment: 'sandbox',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
};

const LEGACY_PROCESS = '/api/v1/process/';
const CORE_PROCESS = '/transactions/v1/process';
const CORE_CONFIG = '/transactions/v1/business/config';
const PAYFLOW = 'https://payflow.example/oxxo-pay?token=display_tok';

const BUSINESS = {
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
};

function businessConfig(coreEnabled?: unknown): BusinessConfig {
  return {
    business: BUSINESS,
    openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
    fintoc_keys: { public_key: 'pk_fi' },
    mercado_pago: { active: false },
    vault_id: 'vault-1',
    vault_url: 'https://vault.test',
    reference: 'TNDR-abc',
    is_installments_available: true,
    cardonfile_keys: null,
    ...(coreEnabled === undefined
      ? {}
      : { core_payments_enabled: coreEnabled }),
  } as BusinessConfig;
}

function pending(
  overrides: Partial<BackendTransactionResponse> = {},
): BackendTransactionResponse {
  return {
    id: 'tx_core_apm_1',
    operation_type: 'payment',
    status: 'Pending',
    amount: '150.00',
    currency: 'MXN',
    next_action: { redirect_to_url: { url: PAYFLOW } },
    ...overrides,
  };
}

function payInput(type: string, config?: Record<string, unknown>): PayInput {
  return {
    amount: 150,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    payment_method: { type, ...(config ? { config } : {}) } as never,
    client_reference: 'order_123',
  };
}

function tokenizer(): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    collect: vi.fn(() => Promise.reject(new Error('an APM never collects'))),
    reveal: vi.fn(() => Promise.resolve()),
  };
}

function host(): ThreeDsHostPort & {
  redirect: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
} {
  return {
    redirect: vi.fn<ThreeDsHostPort['redirect']>(),
    open: vi.fn<ThreeDsHostPort['open']>(),
    close: vi.fn<ThreeDsHostPort['close']>(),
  };
}

interface Routes {
  config?: BusinessConfig;
  coreProcess?: (o: HttpRequestOptions) => Promise<unknown>;
}

function mockHttp(routes: Routes = {}) {
  const calls: HttpRequestOptions[] = [];
  const http: HttpPort = asHttpPort((o: HttpRequestOptions) => {
    calls.push(o);
    if (o.path === CORE_CONFIG) {
      return Promise.resolve(routes.config ?? businessConfig(true));
    }
    if (o.path === CORE_PROCESS) {
      return (routes.coreProcess ?? (() => Promise.resolve(pending())))(o);
    }
    if (o.path === LEGACY_PROCESS) {
      return Promise.resolve(
        pending({
          id: 'tx_legacy_apm_1',
          next_action: { redirect_to_url: { url: 'https://legacy.example/x' } },
        }),
      );
    }
    if (o.path.startsWith('/transactions/v1/')) {
      const id = o.path.slice('/transactions/v1/'.length);
      return Promise.resolve(pending({ id, status: 'Success' }));
    }
    return Promise.reject(new Error(`unexpected ${o.method} ${o.path}`));
  });
  const paths = () => calls.map((c) => `${c.method} ${c.path}`);
  const processBody = (path: string) =>
    calls.find((c) => c.path === path)?.body as {
      payment_method: Record<string, unknown>;
    };
  return { http, calls, paths, processBody };
}

async function ready(
  http: HttpPort,
  extra: Partial<Parameters<typeof _createTonderWithDeps>[0]> = {},
) {
  const tonder = _createTonderWithDeps({
    config: CONFIG,
    http,
    tokenizer: tokenizer(),
    ...extra,
  });
  await tonder.init();
  return tonder;
}

const BANK_CONFIG = {
  country: 'Mexico',
  channel: 'WP',
  bank_ids: [{ id: '8186' }],
};

const CORE_APMS: [string, Record<string, unknown> | undefined][] = [
  ['oxxopay', undefined],
  ['mercadopago', undefined],
  ['safetypaycash', BANK_CONFIG],
  ['safetypaytransfer', BANK_CONFIG],
  ['neosurf', undefined],
  ['qr', undefined],
  ['transfer', undefined],
  ['SPEI', undefined],
  ['spei', undefined],
  ['Spei', undefined],
];

beforeEach(() => {
  sessionStorage.clear();
});

describe('Tonder APM engine — flag ON sends the APMs the core serves to the core', () => {
  it.each(CORE_APMS)(
    '%s goes to the core /process as written, with no monolith call and no card collection',
    async (code, config) => {
      const { http, paths, processBody } = mockHttp();
      const tonder = await ready(http, { host: host() });

      await tonder.pay(payInput(code, config));

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
      expect(processBody(CORE_PROCESS).payment_method).toEqual({
        type: code,
        ...(config ? { apm_config: config } : {}),
      });
    },
  );

  it.each(['OxxoPay', 'OXXOPAY', 'oxxopay'])(
    'the code %s reaches the core exactly as written',
    async (code) => {
      const { http, processBody } = mockHttp();
      const tonder = await ready(http, { host: host() });

      await tonder.pay(payInput(code));

      expect(processBody(CORE_PROCESS).payment_method.type).toBe(code);
    },
  );

  it('sends the same envelope fields the legacy path sends', async () => {
    const { http, calls } = mockHttp();
    const tonder = await ready(http, { host: host() });

    await tonder.pay({ ...payInput('oxxopay'), idempotency_key: 'key-1' });

    const call = calls.find((c) => c.path === CORE_PROCESS);
    expect(call?.headers).toEqual({ 'X-Request-Id': '7_key-1' });
    expect(call?.body).toMatchObject({
      operation_type: 'payment',
      amount: 150,
      currency: 'MXN',
      client_reference: 'order_123',
      return_url: 'https://merchant.example/return',
      presentation_mode: 'redirect',
      customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
    });
  });

  it('a padded code (" oxxopay") is not an APM the core serves: legacy route, as today', async () => {
    const { http, paths, processBody } = mockHttp();
    const tonder = await ready(http, { host: host() });

    await tonder.pay(payInput(' oxxopay'));

    expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
    expect(processBody(LEGACY_PROCESS).payment_method.type).toBe(' oxxopay');
  });

  it.each(['wallet'])(
    '%s is not an APM the core serves: legacy route, type as written',
    async (code) => {
      const { http, paths, processBody } = mockHttp();
      const tonder = await ready(http, { host: host() });

      await tonder.pay(payInput(code));

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
      expect(processBody(LEGACY_PROCESS).payment_method.type).toBe(code);
    },
  );

  it('the retired { type: "apm" } wrapper is rejected before any process call', async () => {
    const { http, paths } = mockHttp();
    const tonder = await ready(http, { host: host() });

    await expect(tonder.pay(payInput('apm'))).rejects.toMatchObject({
      code: ErrorKeyEnum.INVALID_PAYMENT_REQUEST,
    });

    expect(paths()).toEqual([`GET ${CORE_CONFIG}`]);
  });

  it('SafetyPay bank_ids carry the bank code (bank.code of the banks list) unchanged', async () => {
    const config = {
      country: 'Mexico',
      channel: 'WP',
      bank_ids: [{ id: '8186' }],
    };
    const { http, processBody } = mockHttp();
    const tonder = await ready(http, { host: host() });

    await tonder.pay(payInput('safetypaycash', config));

    expect(processBody(CORE_PROCESS).payment_method.apm_config).toEqual(config);
  });

  it.each(['oxxopay', 'SPEI'])(
    'a core %s failure is never retried on the monolith',
    async (code) => {
      const { http, paths } = mockHttp({
        coreProcess: () =>
          Promise.reject(
            new AppError({
              errorCode: ErrorKeyEnum.REQUEST_FAILED,
              status_code: 503,
            }),
          ),
      });
      const tonder = await ready(http, { host: host() });

      await expect(tonder.pay(payInput(code))).rejects.toBeInstanceOf(AppError);

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    },
  );
});

describe('Tonder APM engine — flag OFF or not strictly true keeps the legacy path', () => {
  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['the number 1', 1],
    ['null', null],
  ])('core_payments_enabled %s', async (_label, flag) => {
    for (const [code, config] of CORE_APMS) {
      sessionStorage.clear();
      const { http, paths, processBody } = mockHttp({
        config: businessConfig(flag),
      });
      const tonder = await ready(http, { host: host() });

      await tonder.pay(payInput(code, config));

      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${LEGACY_PROCESS}`]);
      expect(processBody(LEGACY_PROCESS).payment_method).toEqual({
        type: code,
        ...(config ? { apm_config: config } : {}),
      });
    }
  });
});

describe("Tonder APM engine — the core's answer is handled as the monolith's", () => {
  const displays = [
    ['oxxopay', PAYFLOW],
    ['SPEI', 'https://payflow.example/spei?token=core_display_tok'],
  ];

  it.each(displays)(
    'redirect mode for %s: the buyer goes to next_action.redirect_to_url.url, no poll',
    async (code, url) => {
      const h = host();
      const { http, paths } = mockHttp({
        coreProcess: () =>
          Promise.resolve(
            pending({ next_action: { redirect_to_url: { url } } }),
          ),
      });
      const tonder = await ready(http, { host: h });

      const result = await tonder.pay(payInput(code));

      expect(h.redirect).toHaveBeenCalledWith(url);
      expect(result.status).toBe('Pending');
      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    },
  );

  it.each(displays)(
    'embedded mode for %s: the page opens in the host and stays up, no poll',
    async (code, url) => {
      const h = host();
      const { http, paths } = mockHttp({
        coreProcess: () =>
          Promise.resolve(
            pending({ next_action: { redirect_to_url: { url } } }),
          ),
      });
      const tonder = await ready(http, {
        host: h,
        config: { ...CONFIG, presentation_mode: 'embedded' },
      });

      const result = await tonder.pay(payInput(code));

      expect(result.status).toBe('Pending');
      expect(h.open).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ closable: true, allowClipboard: true }),
      );
      expect(h.close).not.toHaveBeenCalled();
      expect(paths()).toEqual([`GET ${CORE_CONFIG}`, `POST ${CORE_PROCESS}`]);
    },
  );

  it('a display_* block is returned to the merchant untouched', async () => {
    const next_action = {
      redirect_to_url: { url: PAYFLOW },
      display_bank_transfer: { cvu: '0000', alias: 'a.b.c' },
    };
    const { http } = mockHttp({
      coreProcess: () => Promise.resolve(pending({ next_action })),
    });
    const tonder = await ready(http, { host: host() });

    const result = await tonder.pay(payInput('transfer'));

    expect(result.next_action).toEqual(next_action);
  });

  it('an answer with no redirect (display_* only) opens nothing', async () => {
    const h = host();
    const { http } = mockHttp({
      coreProcess: () =>
        Promise.resolve(
          pending({ next_action: { display_qr_code: { qr: 'x' } } }),
        ),
    });
    const tonder = await ready(http, { host: h });

    const result = await tonder.pay(payInput('qr'));

    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    expect(result.next_action).toEqual({ display_qr_code: { qr: 'x' } });
  });

  it('getTransaction() of a core APM payment reads the core route', async () => {
    const { http, paths } = mockHttp();
    const tonder = await ready(http, { host: host() });
    await tonder.pay(payInput('oxxopay'));

    const tx = await tonder.getTransaction('tx_core_apm_1');

    expect(paths().at(-1)).toBe('GET /transactions/v1/tx_core_apm_1');
    expect(tx.status).toBe('Success');
  });
});
