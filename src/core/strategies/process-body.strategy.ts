/**
 * The `/process` request primitives, shared by every payment method.
 *
 * PURE: no DOM, no globals, no network, no `this`. Extracted from
 * `Tonder.buildProcessBody` / `Tonder.buildProcessRequestId` so the Apple Pay
 * charge and `pay()` cannot drift. A COPY would diverge the first time a
 * field joins `PayInput` — `billing_address` was added three commits ago — and
 * the SDK would then charge Apple Pay differently from cards with nothing
 * reporting it. One module makes that impossible by construction.
 */
import type { ProcessPaymentBody } from '../services/direct-api.service';
import type { Customer, PayInput } from '../../shared/types';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Default currency when the caller omits `pay({ currency })`. */
export const DEFAULT_CURRENCY = 'MXN';

/** Default presentation mode when the caller omits `config.presentation_mode`. */
export const DEFAULT_PRESENTATION_MODE = 'redirect' as const;

export interface BuildProcessBodyInput {
  /**
   * Everything the merchant supplied EXCEPT the method.
   *
   * `Omit<PayInput, 'payment_method'>` rather than `PayInput`, because
   * `ApplePayPaymentInput` IS that type: it makes "the builder never reads
   * `payment_method`" structural instead of documentary, and spares the Apple
   * Pay caller from synthesizing a method field the builder ignores.
   */
  payment: Omit<PayInput, 'payment_method'>;
  paymentMethod: ProcessPaymentBody['payment_method'];
  /** From `config.session.customer`. Throws `MISSING_CUSTOMER` when absent. */
  customer: Customer | undefined;
  /**
   * ISO 4217, ALREADY RESOLVED by the caller. Required and never defaulted
   * here: the Apple Pay sheet and the charge must share ONE resolved currency
   * (`buildApplePayPaymentRequest` takes the same pre-resolved value), and two
   * independent defaults can drift.
   */
  currency: string;
  presentationMode: 'redirect' | 'embedded';
}

/**
 * Build the `/process` request body.
 *
 * The charge `name` is derived by joining the configured identity fields; only
 * `{ name, email }` travels (phone is intentionally never forwarded to the
 * charge).
 *
 * @throws AppError(MISSING_CUSTOMER) when `customer` is absent. `pay()`
 *   pre-flights this, but the throw moved here VERBATIM — relocating a throw
 *   and dropping it is a behavior change, not a refactor.
 */
export function buildProcessBody(
  input: BuildProcessBodyInput,
): ProcessPaymentBody {
  const customer = input.customer;
  if (!customer) {
    throw new AppError({ errorCode: ErrorKeyEnum.MISSING_CUSTOMER });
  }
  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ');
  const body: ProcessPaymentBody = {
    operation_type: 'payment',
    amount: input.payment.amount,
    currency: input.currency,
    return_url: input.payment.return_url,
    presentation_mode: input.presentationMode,
    customer: { name, email: customer.email },
    payment_method: input.paymentMethod,
    client_reference: input.payment.client_reference,
  };
  if (input.payment.metadata !== undefined) {
    body.metadata = input.payment.metadata;
  }
  if (input.payment.billing_address !== undefined) {
    body.billing_address = input.payment.billing_address;
  }
  return body;
}

/**
 * Scope a merchant-provided idempotency key by the initialized business before
 * sending it, preventing collisions across business accounts.
 *
 * Extracted alongside the body builder rather than left private on `Tonder`:
 * `ApplePayPaymentInput` inherits `idempotency_key` from `PayInput`, so a
 * private scoper would mean the button accepts the key and silently ignores it.
 */
export function scopeRequestId(
  idempotencyKey: string | undefined,
  businessPk: number | undefined,
): string | undefined {
  const normalizedKey = idempotencyKey?.trim();
  if (!normalizedKey) {
    return undefined;
  }

  return businessPk === undefined
    ? normalizedKey
    : `${businessPk}_${normalizedKey}`;
}
