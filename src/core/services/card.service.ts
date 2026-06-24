import {
  mapToCard,
  type BackendCardsResponse,
  type Card,
  type SaveCardBackendResponse,
  type SaveCardRequest,
} from '../../models/card.model';
import type { HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Domain service that reads and removes a customer's saved cards (Card on File).
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * Both operations target `/api/v1/business/{businessPk}/cards/...` where
 * `businessPk` is the INTEGER `business.pk` (not the apiKey). Auth is carried by
 * `Authorization: Bearer {secureToken}` and `User-Token` {customerAuthToken}.
 * HMAC headers are intentionally out of scope for the initial SDK surface.
 * Any transport failure is re-wrapped as
 * `AppError(FETCH_CARDS_ERROR)` / `AppError(REMOVE_CARD_ERROR)` so callers branch
 * on one stable code.
 */
export class CardService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }

  public async getCards(
    businessPk: number,
    secureToken: string,
    userToken: string,
  ): Promise<Card[]> {
    try {
      const raw = await this.http.request<BackendCardsResponse>({
        method: 'GET',
        path: `/api/v1/business/${businessPk}/cards/`,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
      return raw.cards.map(mapToCard);
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.FETCH_CARDS_ERROR,
        originalError: error,
      });
    }
  }

  public async saveCard(
    businessPk: number,
    body: SaveCardRequest,
    secureToken: string,
    userToken: string,
  ): Promise<SaveCardBackendResponse> {
    try {
      return await this.http.request<SaveCardBackendResponse>({
        method: 'POST',
        path: `/api/v1/business/${businessPk}/cards/`,
        body,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.SAVE_CARD_ERROR,
        originalError: error,
      });
    }
  }

  public async removeCard(
    businessPk: number,
    cardId: string,
    secureToken: string,
    userToken: string,
  ): Promise<void> {
    try {
      // Backend returns HTTP 200 `{ message }` (NOT 204). The transport treats
      // any 2xx as success, so reaching here means the card was removed.
      await this.http.request<unknown>({
        method: 'DELETE',
        path: `/api/v1/business/${businessPk}/cards/${cardId}/`,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.REMOVE_CARD_ERROR,
        originalError: error,
      });
    }
  }

  /** Build the saved-card auth block. */
  private static buildAuthHeaders(
    secureToken: string,
    userToken: string,
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${secureToken}`,
      'User-Token': userToken,
    };
  }
}
