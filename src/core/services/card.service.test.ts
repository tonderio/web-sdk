import { describe, it, expect, vi } from 'vitest';
import { CardService } from './card.service';
import type { HttpPort } from '../../ports/http.port';
import { asHttpPort } from '../../test-support/http.mock';
import type {
  BackendCardsResponse,
  SaveCardBackendResponse,
} from '../../models/card.model';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const BUSINESS_PK = 7;
const SECURE_TOKEN = 'secure_abc';
const USER_TOKEN = 'cust_tok_1';

function cardsResponse(): BackendCardsResponse {
  return {
    user_id: 'u_1',
    cards: [
      {
        fields: {
          card_number: 'XXXX-XXXX-XXXX-1234',
          expiration_month: '12',
          expiration_year: '2030',
          skyflow_id: 'sky_1',
          subscription_id: null,
          card_scheme: 'visa',
        },
      },
    ],
  };
}

describe('CardService.getCards', () => {
  it('GETs /api/v1/business/{pk}/cards/ with Bearer + User-Token and maps to Card[]', async () => {
    const requestSpy = vi.fn().mockResolvedValue(cardsResponse());
    const service = new CardService({ request: requestSpy });

    const result = await service.getCards(
      BUSINESS_PK,
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(result).toEqual([
      {
        card_id: 'sky_1',
        card_number: 'XXXX-XXXX-XXXX-1234',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: null,
      },
    ]);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: `/api/v1/business/${BUSINESS_PK}/cards/`,
        headers: {
          Authorization: `Bearer ${SECURE_TOKEN}`,
          'User-Token': USER_TOKEN,
        },
      }),
    );
  });

  it('re-wraps a transport failure as AppError(FETCH_CARDS_ERROR)', async () => {
    const http = asHttpPort(() => Promise.reject(new Error('boom')));
    const service = new CardService(http);

    await expect(
      service.getCards(BUSINESS_PK, SECURE_TOKEN, USER_TOKEN),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.FETCH_CARDS_ERROR });
  });
});

describe('CardService.removeCard', () => {
  it('DELETEs /api/v1/business/{pk}/cards/{card_id}/ with the auth headers and resolves void on success', async () => {
    const requestSpy = vi.fn().mockResolvedValue({ message: 'deleted' });
    const service = new CardService({ request: requestSpy });

    const result = await service.removeCard(
      BUSINESS_PK,
      'sky_1',
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(result).toBeUndefined();
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: `/api/v1/business/${BUSINESS_PK}/cards/sky_1/`,
        headers: {
          Authorization: `Bearer ${SECURE_TOKEN}`,
          'User-Token': USER_TOKEN,
        },
      }),
    );
  });

  it('re-wraps a transport failure as AppError(REMOVE_CARD_ERROR)', async () => {
    const inner = new AppError({ errorCode: ErrorKeyEnum.REQUEST_FAILED });
    const http = asHttpPort(() => Promise.reject(inner));
    const service = new CardService(http);

    await expect(
      service.removeCard(BUSINESS_PK, 'sky_1', SECURE_TOKEN, USER_TOKEN),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.REMOVE_CARD_ERROR });
  });
});

describe('CardService.saveCard', () => {
  function saveResponse(): SaveCardBackendResponse {
    return { skyflow_id: 'sky_new', user_id: 'u_1', card_bin: '411111' };
  }

  it('POSTs /api/v1/business/{pk}/cards/ with Bearer + User-Token and the body, returning the response', async () => {
    const requestSpy = vi.fn().mockResolvedValue(saveResponse());
    const service = new CardService({ request: requestSpy });

    const result = await service.saveCard(
      BUSINESS_PK,
      { skyflow_id: 'sky_new', subscription_id: 'sub_1' },
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(result).toEqual({
      skyflow_id: 'sky_new',
      user_id: 'u_1',
      card_bin: '411111',
    });
    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: `/api/v1/business/${BUSINESS_PK}/cards/`,
        body: { skyflow_id: 'sky_new', subscription_id: 'sub_1' },
        headers: {
          Authorization: `Bearer ${SECURE_TOKEN}`,
          'User-Token': USER_TOKEN,
        },
      }),
    );
  });

  it('sends a body without subscription_id when omitted', async () => {
    const requestSpy = vi.fn().mockResolvedValue(saveResponse());
    const service = new CardService({ request: requestSpy });

    await service.saveCard(
      BUSINESS_PK,
      { skyflow_id: 'sky_new' },
      SECURE_TOKEN,
      USER_TOKEN,
    );

    const sent = requestSpy.mock.calls[0][0];
    expect(sent.body).toEqual({ skyflow_id: 'sky_new' });
  });

  it('re-wraps a transport failure as AppError(SAVE_CARD_ERROR)', async () => {
    const http = asHttpPort(() => Promise.reject(new Error('boom')));
    const service = new CardService(http);

    await expect(
      service.saveCard(
        BUSINESS_PK,
        { skyflow_id: 'sky_new' },
        SECURE_TOKEN,
        USER_TOKEN,
      ),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.SAVE_CARD_ERROR });
  });
});

describe('CardService on the transactions API (flag ON)', () => {
  function coreService(
    core: ReturnType<typeof vi.fn>,
    legacy: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
  ) {
    return new CardService(
      { request: legacy as unknown as HttpPort['request'] },
      {
        http: { request: core as unknown as HttpPort['request'] },
        enabled: () => true,
      },
    );
  }
  // The core's answers (public-api.md, SDK support routes).
  function coreCards() {
    return {
      customer_id: 123,
      data: [
        {
          id: 'sky_1',
          card_number: 'XXXX-XXXX-XXXX-1234',
          expiration_month: '12',
          expiration_year: '2030',
          card_scheme: 'visa',
          subscription_id: null,
        },
      ],
    };
  }
  const AUTH = {
    Authorization: `Bearer ${SECURE_TOKEN}`,
    'User-Token': USER_TOKEN,
  };

  it('GETs /transactions/v1/cards with only Bearer + User-Token and no business in the path', async () => {
    const legacy = vi.fn();
    const core = vi.fn().mockResolvedValue(coreCards());

    const result = await coreService(core, legacy).getCards(
      BUSINESS_PK,
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(result).toEqual([
      {
        card_id: 'sky_1',
        card_number: 'XXXX-XXXX-XXXX-1234',
        expiration_month: '12',
        expiration_year: '2030',
        card_scheme: 'visa',
        subscription_id: null,
      },
    ]);
    expect(legacy).not.toHaveBeenCalled();
    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/transactions/v1/cards',
        headers: AUTH,
      }),
    );
  });

  it('POSTs /transactions/v1/cards with the {skyflow_id, subscription_id?} body', async () => {
    const core = vi.fn().mockResolvedValue({
      id: 'sky_new',
      customer_id: 123,
      subscription_id: 'sub_1',
      card_scheme: 'visa',
      card_bin: '411111',
    });

    const saved = await coreService(core).saveCard(
      BUSINESS_PK,
      { skyflow_id: 'sky_new', subscription_id: 'sub_1' },
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/transactions/v1/cards',
        body: { skyflow_id: 'sky_new', subscription_id: 'sub_1' },
        headers: AUTH,
      }),
    );
    expect(saved).toEqual({
      skyflow_id: 'sky_new',
      user_id: '123',
      card_bin: '411111',
    });
  });

  it('maps a card saved without a BIN to the same answer without card_bin', async () => {
    const core = vi.fn().mockResolvedValue({
      id: 'sky_new',
      customer_id: 123,
      subscription_id: null,
    });

    const saved = await coreService(core).saveCard(
      BUSINESS_PK,
      { skyflow_id: 'sky_new' },
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(saved).toEqual({ skyflow_id: 'sky_new', user_id: '123' });
  });

  it('answers the monolith soft PHONE_REQUIRED result for a 409 customer_phone_required', async () => {
    const core = vi.fn().mockRejectedValue(
      new AppError({
        errorCode: ErrorKeyEnum.REQUEST_FAILED,
        status_code: 409,
        originalError: { error_code: 'customer_phone_required' },
      }),
    );

    const saved = await coreService(core).saveCard(
      BUSINESS_PK,
      { skyflow_id: 'sky_new' },
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(saved).toEqual({
      skyflow_id: 'sky_new',
      user_id: '',
      saved: false,
      code: 'PHONE_REQUIRED',
    });
  });

  it('keeps the status and the core code of a card_limit_reached refusal inside AppError(SAVE_CARD_ERROR)', async () => {
    const inner = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 409,
      originalError: { error_code: 'card_limit_reached' },
    });
    const core = vi.fn().mockRejectedValue(inner);

    const err = await coreService(core)
      .saveCard(BUSINESS_PK, { skyflow_id: 's' }, SECURE_TOKEN, USER_TOKEN)
      .catch((e) => e);

    expect(err.code).toBe(ErrorKeyEnum.SAVE_CARD_ERROR);
    expect(err.status_code).toBe(409);
    expect(err.originalError.originalError).toEqual({
      error_code: 'card_limit_reached',
    });
  });

  it.each([
    [401, 'invalid_customer_token'],
    [403, 'secure_token_required'],
    [404, 'not_found'],
    [409, 'customer_phone_required'],
    [503, 'dependency_unavailable'],
  ])(
    'a core %s %s refusal of the list is AppError(FETCH_CARDS_ERROR) with that status',
    async (status, code) => {
      const core = vi.fn().mockRejectedValue(
        new AppError({
          errorCode: ErrorKeyEnum.REQUEST_FAILED,
          status_code: status,
          originalError: { error_code: code },
        }),
      );

      const err = await coreService(core)
        .getCards(BUSINESS_PK, SECURE_TOKEN, USER_TOKEN)
        .catch((e) => e);

      expect(err.code).toBe(ErrorKeyEnum.FETCH_CARDS_ERROR);
      expect(err.status_code).toBe(status);
    },
  );

  it('refuses a list answer that is not the core list', async () => {
    const core = vi.fn().mockResolvedValue({ user_id: 'u', cards: [] });

    await expect(
      coreService(core).getCards(BUSINESS_PK, SECURE_TOKEN, USER_TOKEN),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.FETCH_CARDS_ERROR });
  });

  it('DELETEs /transactions/v1/cards/{skyflow_id} with the id URI-encoded', async () => {
    const core = vi.fn().mockResolvedValue(null);

    await coreService(core).removeCard(
      BUSINESS_PK,
      'sky/1',
      SECURE_TOKEN,
      USER_TOKEN,
    );

    expect(core).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: '/transactions/v1/cards/sky%2F1',
        headers: AUTH,
      }),
    );
  });

  it('resolves on a 204 with no body and refuses a 404 as AppError(REMOVE_CARD_ERROR)', async () => {
    await expect(
      coreService(vi.fn().mockResolvedValue(null)).removeCard(
        BUSINESS_PK,
        'sky_1',
        SECURE_TOKEN,
        USER_TOKEN,
      ),
    ).resolves.toBeUndefined();

    const err = await coreService(
      vi.fn().mockRejectedValue(
        new AppError({
          errorCode: ErrorKeyEnum.REQUEST_FAILED,
          status_code: 404,
          originalError: { error_code: 'not_found' },
        }),
      ),
    )
      .removeCard(BUSINESS_PK, 'sky_1', SECURE_TOKEN, USER_TOKEN)
      .catch((e) => e);
    expect(err.code).toBe(ErrorKeyEnum.REMOVE_CARD_ERROR);
    expect(err.status_code).toBe(404);
  });

  it('keeps the same AppError codes for core failures', async () => {
    const failing = () => vi.fn().mockRejectedValue(new Error('boom'));
    const service = (core: ReturnType<typeof vi.fn>) => coreService(core);

    await expect(
      service(failing()).getCards(BUSINESS_PK, SECURE_TOKEN, USER_TOKEN),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.FETCH_CARDS_ERROR });
    await expect(
      service(failing()).saveCard(
        BUSINESS_PK,
        { skyflow_id: 's' },
        SECURE_TOKEN,
        USER_TOKEN,
      ),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.SAVE_CARD_ERROR });
    await expect(
      service(failing()).removeCard(BUSINESS_PK, 's', SECURE_TOKEN, USER_TOKEN),
    ).rejects.toMatchObject({ code: ErrorKeyEnum.REMOVE_CARD_ERROR });
  });

  it('keeps calling the monolith while the flag is OFF', async () => {
    const legacy = vi.fn().mockResolvedValue(cardsResponse());
    const core = vi.fn();
    const service = new CardService(
      { request: legacy },
      {
        http: { request: core as unknown as HttpPort['request'] },
        enabled: () => false,
      },
    );

    await service.getCards(BUSINESS_PK, SECURE_TOKEN, USER_TOKEN);

    expect(core).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/business/${BUSINESS_PK}/cards/`,
      }),
    );
  });
});
