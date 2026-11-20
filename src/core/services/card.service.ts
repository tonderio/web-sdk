import {
  mapToCard,
  type CoreCardsResponse,
  type CoreSavedCard,
  type BackendCardsResponse,
  type Card,
  type SaveCardBackendResponse,
  type SaveCardRequest,
} from '../../models/card.model';
import type { CoreTarget, HttpPort } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * Domain service that reads and removes a customer's saved cards (Card on File).
 *
 * PURE: depends only on the injected {@link HttpPort} — never on `fetch`/DOM.
 * The monolith's routes are `/api/v1/business/{businessPk}/cards/...` where
 * `businessPk` is the INTEGER `business.pk` (not the apiKey). While the business
 * runs on the transactions API they are `/transactions/v1/cards[/{card_id}]`
 * instead: the business comes from the credential there, never from the path.
 * Customer and cards must be on the same engine, since the customer token is
 * not interchangeable. Auth is the same on both:
 * `Authorization: Bearer {secureToken}` and `User-Token` {customerAuthToken}.
 * HMAC headers are intentionally out of scope for the initial SDK surface.
 * Any transport failure is re-wrapped as
 * `AppError(FETCH_CARDS_ERROR)` / `AppError(REMOVE_CARD_ERROR)` so callers branch
 * on one stable code.
 */
export class CardService {
  private readonly http: HttpPort;
  private readonly core?: CoreTarget;

  constructor(http: HttpPort, core?: CoreTarget) {
    this.http = http;
    this.core = core;
  }

  /** The transport and the collection route of the engine the business runs on. */
  private target(businessPk: number): {
    http: HttpPort;
    base: string;
    onCore: boolean;
  } {
    return this.core?.enabled() === true
      ? { http: this.core.http, base: '/transactions/v1/cards', onCore: true }
      : {
          http: this.http,
          base: `/api/v1/business/${businessPk}/cards/`,
          onCore: false,
        };
  }

  /**
   * Whether `error` is the transactions API's refusal with this status and
   * machine code. The transport carries both on the error it throws.
   */
  private static isCoreRefusal(
    error: unknown,
    status: number,
    code: string,
  ): boolean {
    const refusal = error as {
      status_code?: unknown;
      originalError?: { error_code?: unknown };
    } | null;
    return (
      refusal?.status_code === status &&
      refusal.originalError?.error_code === code
    );
  }

  public async getCards(
    businessPk: number,
    secureToken: string,
    userToken: string,
  ): Promise<Card[]> {
    try {
      const { http, base, onCore } = this.target(businessPk);
      const raw = await http.request<BackendCardsResponse | CoreCardsResponse>({
        method: 'GET',
        path: base,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
      const list = onCore
        ? CardService.fromCoreList(raw)
        : (raw as BackendCardsResponse);
      return list.cards.map(mapToCard);
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
      const { http, base, onCore } = this.target(businessPk);
      const raw = await http.request<SaveCardBackendResponse | CoreSavedCard>({
        method: 'POST',
        path: base,
        body,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
      return onCore
        ? CardService.fromCoreSaved(raw as CoreSavedCard)
        : (raw as SaveCardBackendResponse);
    } catch (error) {
      if (
        this.core?.enabled() === true &&
        CardService.isCoreRefusal(error, 409, 'customer_phone_required')
      ) {
        // The monolith answers this case 200 with a soft body; same here.
        return {
          skyflow_id: body.skyflow_id,
          user_id: '',
          saved: false,
          code: 'PHONE_REQUIRED',
        };
      }
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
      // The monolith answers 200 `{ message }` and the transactions API 204 with
      // no body. The transport treats any 2xx as success, so reaching here means
      // the card was removed.
      const { http, base, onCore } = this.target(businessPk);
      await http.request<unknown>({
        method: 'DELETE',
        path: onCore
          ? `${base}/${encodeURIComponent(cardId)}`
          : `${base}${cardId}/`,
        headers: CardService.buildAuthHeaders(secureToken, userToken),
      });
    } catch (error) {
      throw new AppError({
        errorCode: ErrorKeyEnum.REMOVE_CARD_ERROR,
        originalError: error,
      });
    }
  }

  /** The transactions API's list in the shape the monolith's list has. */
  private static fromCoreList(raw: unknown): BackendCardsResponse {
    const list = raw as Partial<CoreCardsResponse> | null;
    if (!Array.isArray(list?.data)) {
      throw new Error('The answer is not a transactions API card list.');
    }
    return {
      user_id: String(list.customer_id),
      cards: list.data.map((card) => ({
        fields: {
          card_number: card.card_number,
          expiration_month: card.expiration_month,
          expiration_year: card.expiration_year,
          skyflow_id: card.id,
          subscription_id: card.subscription_id,
          card_scheme: card.card_scheme,
        },
      })),
    };
  }

  /** The transactions API's saved card in the shape the monolith answers. */
  private static fromCoreSaved(raw: CoreSavedCard): SaveCardBackendResponse {
    return {
      skyflow_id: raw.id,
      user_id: String(raw.customer_id),
      ...(raw.card_bin !== undefined ? { card_bin: raw.card_bin } : {}),
    };
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
