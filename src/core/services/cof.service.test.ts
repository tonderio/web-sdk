import { describe, it, expect, vi } from 'vitest';
import { CofService } from './cof.service';
import type { CardService } from './card.service';
import type { TokenizerPort } from '../../ports/tokenizer.port';
import type { AcquirerPort } from '../../ports/acquirer.port';
import type { SaveCardBackendResponse } from '../../models/card.model';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const BUSINESS_PK = 7;
const SECURE_TOKEN = 'secure_abc';
const USER_TOKEN = 'cust_tok_1';
const MERCHANT_ID = 'merchant_1';

function collectedTokens(): Record<string, string> {
  return {
    skyflow_id: 'sky_new',
    card_number: 'tok_number',
    cardholder_name: 'tok_name',
    expiration_month: 'tok_mm',
    expiration_year: 'tok_yy',
    cvv: 'tok_cvv',
  };
}

function contact() {
  return { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };
}

function params(overrides: Record<string, unknown> = {}) {
  return {
    businessPk: BUSINESS_PK,
    secureToken: SECURE_TOKEN,
    userToken: USER_TOKEN,
    merchantId: MERCHANT_ID,
    contact: contact(),
    ...overrides,
  };
}

function fakeTokenizer(tokens = collectedTokens()): TokenizerPort {
  return {
    mount: vi.fn(() => Promise.resolve()),
    unmount: vi.fn(),
    reveal: vi.fn(() => Promise.resolve()),
    collect: vi.fn(() => Promise.resolve(tokens)),
  };
}

function fakeCardService(opts: {
  saveResponses?: SaveCardBackendResponse[];
  saveImpl?: (call: number) => Promise<SaveCardBackendResponse>;
  removeImpl?: () => Promise<void>;
}): {
  service: CardService;
  saveSpy: ReturnType<typeof vi.fn>;
  removeSpy: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const saveSpy = vi.fn(() => {
    const current = call++;
    if (opts.saveImpl) return opts.saveImpl(current);
    const resp = opts.saveResponses?.[current];
    return Promise.resolve(resp);
  });
  const removeSpy = vi.fn(opts.removeImpl ?? (() => Promise.resolve()));
  const service = {
    saveCard: saveSpy,
    removeCard: removeSpy,
  } as unknown as CardService;
  return { service, saveSpy, removeSpy };
}

function fakeAcquirer(impl?: AcquirerPort['createCofSubscription']): {
  acquirer: AcquirerPort;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(
    impl ?? (() => Promise.resolve({ subscriptionId: 'sub_1' })),
  );
  return { acquirer: { createCofSubscription: spy }, spy };
}

describe('CofService.enrollCard (COF path)', () => {
  it('collects → save#1 → createCofSubscription → save#2 with subscription_id → { cardId, subscriptionId }', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, saveSpy } = fakeCardService({
      saveResponses: [
        { skyflow_id: 'sky_new', user_id: 'u_1', card_bin: '411111' },
        { skyflow_id: 'sky_new', user_id: 'u_1' },
      ],
    });
    const { acquirer, spy: acqSpy } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    const result = await cof.enrollCard(params());

    expect(result).toEqual({ cardId: 'sky_new', subscriptionId: 'sub_1' });

    expect(saveSpy).toHaveBeenNthCalledWith(
      1,
      BUSINESS_PK,
      { skyflow_id: 'sky_new' },
      SECURE_TOKEN,
      USER_TOKEN,
    );
    expect(acqSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: MERCHANT_ID,
        cardBin: '411111',
        customerId: USER_TOKEN,
        contact: contact(),
        currency: 'MXN',
        cardTokens: {
          name: 'tok_name',
          number: 'tok_number',
          expiryMonth: 'tok_mm',
          expiryYear: 'tok_yy',
          cvv: 'tok_cvv',
        },
      }),
    );
    expect(saveSpy).toHaveBeenNthCalledWith(
      2,
      BUSINESS_PK,
      { skyflow_id: 'sky_new', subscription_id: 'sub_1' },
      SECURE_TOKEN,
      USER_TOKEN,
    );
  });

  it('throws CARD_ON_FILE_DECLINED (no acquirer call) and rolls back when save#1 returns no card_bin', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, removeSpy } = fakeCardService({
      saveResponses: [{ skyflow_id: 'sky_new', user_id: 'u_1' }],
    });
    const { acquirer, spy: acqSpy } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.enrollCard(params())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
    expect(acqSpy).not.toHaveBeenCalled();
    // save#1 succeeded → the saved card must be rolled back.
    expect(removeSpy).toHaveBeenCalled();
  });

  it('does NOT roll back when save#1 itself fails (nothing was saved)', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, removeSpy } = fakeCardService({
      saveImpl: () =>
        Promise.reject(
          new AppError({ errorCode: ErrorKeyEnum.SAVE_CARD_ERROR }),
        ),
    });
    const { acquirer, spy: acqSpy } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.enrollCard(params())).rejects.toBeInstanceOf(AppError);
    expect(acqSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('rolls back (removeCard) and surfaces CARD_ON_FILE_DECLINED when the acquirer rejects', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, removeSpy } = fakeCardService({
      saveResponses: [
        { skyflow_id: 'sky_new', user_id: 'u_1', card_bin: '411111' },
      ],
    });
    const { acquirer } = fakeAcquirer(() =>
      Promise.reject(
        new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED }),
      ),
    );
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.enrollCard(params())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
    expect(removeSpy).toHaveBeenCalledWith(
      BUSINESS_PK,
      'sky_new',
      SECURE_TOKEN,
      USER_TOKEN,
    );
  });

  it('rolls back when save#2 rejects', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, removeSpy } = fakeCardService({
      saveImpl: (call) =>
        call === 0
          ? Promise.resolve({
              skyflow_id: 'sky_new',
              user_id: 'u_1',
              card_bin: '411111',
            })
          : Promise.reject(
              new AppError({ errorCode: ErrorKeyEnum.SAVE_CARD_ERROR }),
            ),
    });
    const { acquirer } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.enrollCard(params())).rejects.toBeInstanceOf(AppError);
    expect(removeSpy).toHaveBeenCalledWith(
      BUSINESS_PK,
      'sky_new',
      SECURE_TOKEN,
      USER_TOKEN,
    );
  });

  it('swallows a rollback DELETE error and surfaces the original error', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards } = fakeCardService({
      saveResponses: [
        { skyflow_id: 'sky_new', user_id: 'u_1', card_bin: '411111' },
      ],
      removeImpl: () =>
        Promise.reject(
          new AppError({ errorCode: ErrorKeyEnum.REMOVE_CARD_ERROR }),
        ),
    });
    const { acquirer } = fakeAcquirer(() =>
      Promise.reject(
        new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED }),
      ),
    );
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.enrollCard(params())).rejects.toMatchObject({
      code: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
    });
  });

  it('passes a caller-provided currency through to the acquirer', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards } = fakeCardService({
      saveResponses: [
        { skyflow_id: 'sky_new', user_id: 'u_1', card_bin: '411111' },
        { skyflow_id: 'sky_new', user_id: 'u_1' },
      ],
    });
    const { acquirer, spy: acqSpy } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    await cof.enrollCard(params({ currency: 'USD' }));

    expect(acqSpy).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD' }),
    );
  });
});

describe('CofService.saveCardPlain (non-COF path)', () => {
  it('collects → save#1 → { cardId } (no acquirer, no subscriptionId)', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards, saveSpy } = fakeCardService({
      saveResponses: [{ skyflow_id: 'sky_new', user_id: 'u_1' }],
    });
    const { acquirer, spy: acqSpy } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    const result = await cof.saveCardPlain(params());

    expect(result).toEqual({ cardId: 'sky_new' });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      BUSINESS_PK,
      { skyflow_id: 'sky_new' },
      SECURE_TOKEN,
      USER_TOKEN,
    );
    expect(acqSpy).not.toHaveBeenCalled();
  });

  it('surfaces SAVE_CARD_ERROR when the save rejects', async () => {
    const tokenizer = fakeTokenizer();
    const { service: cards } = fakeCardService({
      saveImpl: () =>
        Promise.reject(
          new AppError({ errorCode: ErrorKeyEnum.SAVE_CARD_ERROR }),
        ),
    });
    const { acquirer } = fakeAcquirer();
    const cof = new CofService(cards, tokenizer, acquirer);

    await expect(cof.saveCardPlain(params())).rejects.toMatchObject({
      code: ErrorKeyEnum.SAVE_CARD_ERROR,
    });
  });
});
