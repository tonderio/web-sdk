import type { CardService } from './card.service';
import type { SaveCardBackendResponse } from '../../models/card.model';
import type { TokenizerPort } from '../../ports/tokenizer.port';
import type {
  AcquirerPort,
  CofCardTokens,
  CofContact,
} from '../../ports/acquirer.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Default currency for a COF subscription when the caller omits it. */
const DEFAULT_CURRENCY = 'MXN';

/** Parameters shared by both enrollment paths. */
export interface EnrollParams {
  businessPk: number;
  secureToken: string;
  userToken: string;
  merchantId: string;
  contact: CofContact;
  currency?: string;
}

/** Internal result of an enrollment (mapped to the public `EnrollResult`). */
export interface CofEnrollOutcome {
  cardId: string;
  subscriptionId?: string;
}

/**
 * Orchestrates card enrollment (Card on File). PURE: depends only on the
 * injected {@link CardService}, {@link TokenizerPort}, and {@link AcquirerPort}
 * — never on the DOM, `fetch`, or any acquirer SDK.
 *
 * Two paths:
 * - {@link saveCardPlain}: collect → save the card → return `{ cardId }`.
 * - {@link enrollCard}: collect → save → create the acquirer subscription →
 *   re-save with the `subscription_id`. Any failure AFTER the first save rolls
 *   the card back (best-effort `removeCard`) so a partial enrollment never
 *   lingers.
 */
export class CofService {
  private readonly cardService: CardService;
  private readonly tokenizer: TokenizerPort;
  private readonly acquirer: AcquirerPort;

  constructor(
    cardService: CardService,
    tokenizer: TokenizerPort,
    acquirer: AcquirerPort,
  ) {
    this.cardService = cardService;
    this.tokenizer = tokenizer;
    this.acquirer = acquirer;
  }

  public async saveCardPlain(params: EnrollParams): Promise<CofEnrollOutcome> {
    const tokens = await this.tokenizer.collect();
    const cardId = CofService.skyflowId(tokens);
    await this.saveCardReference(params, cardId);
    return { cardId };
  }

  public async saveExistingCardPlain(
    params: EnrollParams,
    cardId: string,
  ): Promise<CofEnrollOutcome> {
    await this.tokenizer.collect(`update:${cardId}`);
    await this.saveCardReference(params, cardId);
    return { cardId };
  }

  public async enrollCard(params: EnrollParams): Promise<CofEnrollOutcome> {
    const tokens = await this.tokenizer.collect();
    const cardId = CofService.skyflowId(tokens);
    return this.enrollCollectedCard(params, cardId, tokens, true);
  }

  public async enrollExistingCard(
    params: EnrollParams,
    cardId: string,
  ): Promise<CofEnrollOutcome> {
    const tokens = await this.tokenizer.collect(`update:${cardId}`);
    return this.enrollCollectedCard(params, cardId, tokens, false);
  }

  private async enrollCollectedCard(
    params: EnrollParams,
    cardId: string,
    tokens: Record<string, string>,
    rollbackOnFailure: boolean,
  ): Promise<CofEnrollOutcome> {
    // First save gets the card BIN needed by the acquirer subscription flow.
    const firstSave = await this.saveCardReference(params, cardId);

    try {
      if (!firstSave.card_bin) {
        throw new AppError({ errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED });
      }

      const { subscriptionId } = await this.acquirer.createCofSubscription({
        merchantId: params.merchantId,
        cardBin: firstSave.card_bin,
        cardTokens: CofService.cardTokens(tokens),
        contact: params.contact,
        customerId: params.userToken,
        currency: params.currency ?? DEFAULT_CURRENCY,
      });

      await this.cardService.saveCard(
        params.businessPk,
        { skyflow_id: cardId, subscription_id: subscriptionId },
        params.secureToken,
        params.userToken,
      );

      return { cardId, subscriptionId };
    } catch (error) {
      if (rollbackOnFailure) {
        await this.rollback(params, cardId);
      }
      if (error instanceof AppError) throw error;
      throw new AppError({
        errorCode: ErrorKeyEnum.CARD_ON_FILE_DECLINED,
        originalError: error,
      });
    }
  }

  private async saveCardReference(
    params: EnrollParams,
    cardId: string,
  ): Promise<SaveCardBackendResponse> {
    return this.cardService.saveCard(
      params.businessPk,
      { skyflow_id: cardId },
      params.secureToken,
      params.userToken,
    );
  }

  /** Best-effort rollback: remove the just-saved card, swallowing its error. */
  private async rollback(params: EnrollParams, cardId: string): Promise<void> {
    try {
      await this.cardService.removeCard(
        params.businessPk,
        cardId,
        params.secureToken,
        params.userToken,
      );
    } catch {
      // Swallow — the original enrollment error is the one that matters.
    }
  }

  private static skyflowId(tokens: Record<string, string>): string {
    const id = tokens.skyflow_id;
    if (!id) {
      throw new AppError({ errorCode: ErrorKeyEnum.SAVE_CARD_ERROR });
    }
    return id;
  }

  private static cardTokens(tokens: Record<string, string>): CofCardTokens {
    return {
      name: tokens.cardholder_name ?? '',
      number: tokens.card_number ?? '',
      expiryMonth: tokens.expiration_month ?? '',
      expiryYear: tokens.expiration_year ?? '',
      cvv: tokens.cvv ?? '',
    };
  }
}
