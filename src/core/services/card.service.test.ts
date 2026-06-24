import { describe, it, expect, vi } from 'vitest';
import { CardService } from './card.service';
import type { HttpPort } from '../../ports/http.port';
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

function mockHttp(impl: HttpPort['request']): HttpPort {
  return { request: vi.fn(impl) };
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
    const http = mockHttp(() => Promise.reject(new Error('boom')));
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
    const http = mockHttp(() => Promise.reject(inner));
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
    const http = mockHttp(() => Promise.reject(new Error('boom')));
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
