import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KushkiAdapter } from './kushki.adapter';
import type {
  KushkiInstance,
  KushkiSdkLoader,
  KushkiSecureInitResponse,
  KushkiStatic,
  KushkiValidate3DSResponse,
} from './kushki-loader';
import type { HttpPort } from '../../ports/http.port';
import type { CofSubscriptionInput } from '../../ports/acquirer.port';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const MERCHANT_ID = 'merchant_1';
const API_KEY = 'pk_test_123';

function input(): CofSubscriptionInput {
  return {
    merchantId: MERCHANT_ID,
    cardBin: '411111',
    cardTokens: {
      name: 'tok_name',
      number: 'tok_number',
      expiryMonth: 'tok_mm',
      expiryYear: 'tok_yy',
      cvv: 'tok_cvv',
    },
    contact: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    },
    customerId: 'cust_tok_1',
    currency: 'MXN',
  };
}

/**
 * Build a fake acquirer static whose async callbacks resolve canned values.
 * `secureInit`/`validate3DS` control what each callback yields; passing `null`
 * makes that callback never fire (to exercise the timeout path).
 */
function fakeKushki(opts: {
  secureInit: KushkiSecureInitResponse | null;
  validate3DS: KushkiValidate3DSResponse | null;
  onConstruct?: (options: {
    merchantId: string;
    inTestEnvironment: boolean;
  }) => void;
}): KushkiStatic {
  return class FakeKushki implements KushkiInstance {
    constructor(options: { merchantId: string; inTestEnvironment: boolean }) {
      opts.onConstruct?.(options);
    }
    requestSecureInit(
      _req: unknown,
      cb: (r: KushkiSecureInitResponse) => void,
    ): void {
      if (opts.secureInit !== null) cb(opts.secureInit);
    }
    requestValidate3DS(
      _req: unknown,
      cb: (r: KushkiValidate3DSResponse) => void,
    ): void {
      if (opts.validate3DS !== null) cb(opts.validate3DS);
    }
  } as unknown as KushkiStatic;
}

function loaderOf(kushki: KushkiStatic): KushkiSdkLoader {
  return () => Promise.resolve(kushki);
}

/** Route /acq-kushki/* requests by path. tokenBody supports nesting under details. */
function acquirerHttp(opts: { tokenBody: unknown; createBody?: unknown }): {
  http: HttpPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn((options: { path: string }) => {
    if (options.path.endsWith('/subscription/token')) {
      return Promise.resolve(opts.tokenBody);
    }
    if (options.path.endsWith('/subscription/create')) {
      return Promise.resolve(opts.createBody ?? { subscriptionId: 'sub_1' });
    }
    return Promise.reject(new Error(`unexpected path ${options.path}`));
  });
  return { http: { request: spy as unknown as HttpPort['request'] }, spy };
}

function rootTokenBody() {
  return { token: 'kushki_tok', secureId: 'sec_1', security: { foo: 'bar' } };
}

describe('KushkiAdapter.createCofSubscription', () => {
  it('runs secureInit → token → validate3DS → create and returns { subscriptionId }', async () => {
    const onConstruct = vi.fn();
    const kushki = fakeKushki({
      secureInit: { jwt: 'jwt_1' },
      validate3DS: { code: '3DS000' },
      onConstruct,
    });
    const { http, spy } = acquirerHttp({
      tokenBody: rootTokenBody(),
      createBody: { subscriptionId: 'sub_99' },
    });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    const result = await adapter.createCofSubscription(input());

    expect(result).toEqual({ subscriptionId: 'sub_99' });
    expect(onConstruct).toHaveBeenCalledWith({
      merchantId: MERCHANT_ID,
      inTestEnvironment: true,
    });

    const tokenCall = spy.mock.calls.find((c) =>
      c[0].path.endsWith('/subscription/token'),
    )?.[0];
    expect(tokenCall).toMatchObject({
      method: 'POST',
      path: '/acq-kushki/subscription/token',
      headers: expect.objectContaining({ Authorization: `Token ${API_KEY}` }),
      body: {
        card: {
          name: 'tok_name',
          number: 'tok_number',
          expiryMonth: 'tok_mm',
          expiryYear: 'tok_yy',
          cvv: 'tok_cvv',
        },
        currency: 'MXN',
        jwt: 'jwt_1',
      },
    });

    const createCall = spy.mock.calls.find((c) =>
      c[0].path.endsWith('/subscription/create'),
    )?.[0];
    expect(createCall).toMatchObject({
      method: 'POST',
      path: '/acq-kushki/subscription/create',
      body: {
        token: 'kushki_tok',
        contactDetails: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
        },
        metadata: { customerId: 'cust_tok_1' },
        currency: 'MXN',
      },
    });
  });

  it('parses a token response nested under `details`', async () => {
    const kushki = fakeKushki({
      secureInit: { jwt: 'jwt_1' },
      validate3DS: { isValid: true },
    });
    const { http, spy } = acquirerHttp({
      tokenBody: {
        details: { token: 'nested_tok', secureId: 'sec_n', security: { a: 1 } },
      },
    });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: false,
    });

    const result = await adapter.createCofSubscription(input());

    expect(result).toEqual({ subscriptionId: 'sub_1' });
    const createCall = spy.mock.calls.find((c) =>
      c[0].path.endsWith('/subscription/create'),
    )?.[0];
    expect(createCall.body.token).toBe('nested_tok');
  });

  it('rejects CARD_ON_FILE_DECLINED when secureInit returns a code', async () => {
    const kushki = fakeKushki({
      secureInit: { code: 'K001', message: 'bad' },
      validate3DS: { code: '3DS000' },
    });
    const { http } = acquirerHttp({ tokenBody: rootTokenBody() });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    await expect(adapter.createCofSubscription(input())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
  });

  it('rejects CARD_ON_FILE_DECLINED when secureInit returns no jwt', async () => {
    const kushki = fakeKushki({
      secureInit: {},
      validate3DS: { code: '3DS000' },
    });
    const { http } = acquirerHttp({ tokenBody: rootTokenBody() });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    await expect(adapter.createCofSubscription(input())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
  });

  it('rejects CARD_ON_FILE_DECLINED when validate3DS returns a non-3DS000 code', async () => {
    const kushki = fakeKushki({
      secureInit: { jwt: 'jwt_1' },
      validate3DS: { code: '3DS500' },
    });
    const { http } = acquirerHttp({ tokenBody: rootTokenBody() });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    await expect(adapter.createCofSubscription(input())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
  });

  it('rejects CARD_ON_FILE_DECLINED when validate3DS reports isValid false', async () => {
    const kushki = fakeKushki({
      secureInit: { jwt: 'jwt_1' },
      validate3DS: { isValid: false },
    });
    const { http } = acquirerHttp({ tokenBody: rootTokenBody() });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    await expect(adapter.createCofSubscription(input())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
  });
});

describe('KushkiAdapter timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects CARD_ON_FILE_DECLINED when a secureInit callback never fires (15s timeout)', async () => {
    const kushki = fakeKushki({
      secureInit: null,
      validate3DS: { code: '3DS000' },
    });
    const { http } = acquirerHttp({ tokenBody: rootTokenBody() });
    const adapter = new KushkiAdapter({
      loader: loaderOf(kushki),
      http,
      apiKey: API_KEY,
      isTestEnvironment: true,
    });

    const promise = adapter.createCofSubscription(input());
    const assertion = expect(promise).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
});
