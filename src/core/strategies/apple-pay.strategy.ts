/**
 * Pure builders for the Apple Pay sheet request and the `/process`
 * payment-method block, plus the network and capability resolutions they
 * consume.
 *
 * PURE: no DOM, no globals, no network. Every `ports/` and `models/` import is
 * type-only and erased at build, so `core/` stays runtime-pure.
 */
import type {
  ApplePayMerchantCapability,
  ApplePayPaymentRequest,
  ApplePayPaymentToken,
} from '../../ports/apple-pay.port';
import type { ApplePayConfig } from '../../models/business.model';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/** Networks assumed when the business config carries none. */
export const DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard'] as const;

/**
 * Supported card networks for the sheet, from the business config's
 * `apple_pay` block.
 *
 * NOT case-normalized: Apple's tokens are case-sensitive (`masterCard`, not
 * `mastercard`), so lowercasing would corrupt a valid one.
 *
 * An absent block, an absent field and an empty array all resolve to a FRESH
 * copy of {@link DEFAULT_APPLE_PAY_NETWORKS}. The configured branch is copied
 * too — returning it by reference would hand the caller a live handle into the
 * cached `BusinessConfig`, where one `.push()` mutates every later request.
 *
 * Returns `string[]` rather than Apple's typed literals: the value arrives off
 * the wire untyped, and the module that owns `ApplePayJS.*` does the narrowing.
 */
export function resolveApplePayNetworks(
  applePay: ApplePayConfig | undefined,
): string[] {
  const networks = applePay?.supported_networks ?? [];
  return networks.length > 0 ? [...networks] : [...DEFAULT_APPLE_PAY_NETWORKS];
}

/**
 * Apple Pay `merchantCapabilities` derived from the `apple_pay` block.
 *
 * `supports3DS` denotes EMV CRYPTOGRAM support, NOT 3-D Secure — the names
 * collide, the meanings do not. It is MANDATORY on every Apple Pay request:
 * omit it and the `ApplePaySession` constructor throws. Do NOT delete it as
 * contradictory with "Apple Pay bypasses 3DS"; that is about 3-D Secure.
 *
 * ABSENT `supports_debit` / `supports_credit` MEANS "DO NOT FILTER BY THAT CARD
 * TYPE", not "that card type is unsupported". Both field names are unconfirmed
 * backend contract, so silence means "unknown" and the permissive outcome is
 * the correct degradation. Sending `supports_debit: true` still earns its keep:
 * a debit-only business gets credit cards greyed out in the sheet instead of
 * declined by the acquirer after Face ID.
 */
export function resolveApplePayMerchantCapabilities(
  applePay: ApplePayConfig | undefined,
): string[] {
  const capabilities = ['supports3DS'];
  if (applePay?.supports_debit) capabilities.push('supportsDebit');
  if (applePay?.supports_credit) capabilities.push('supportsCredit');
  return capabilities;
}

/**
 * The `/process` `payment_method` block for an Apple Pay charge.
 *
 * NOT Apple's own type of the same name, which is the card DISPLAY info nested
 * inside the token. This is our wire block, sibling to the card and APM blocks.
 *
 * Deliberately NOT a member of the public `PaymentMethod` union: rejecting
 * `pay({ payment_method: { type: 'apple_pay' } })` cannot be done with a type,
 * so it is a runtime guard in the facade instead.
 */
export interface ApplePayPaymentMethod {
  /** Uppercase, matching the card block's `type = 'CARD'`. */
  type: 'APPLE_PAY';
  /**
   * `event.payment.token` VERBATIM — the whole PKPaymentToken as an object,
   * never `JSON.stringify`. The SDK does not decide which parts the backend
   * needs.
   */
  token: ApplePayPaymentToken;
}

export function buildApplePayPaymentMethod(
  token: ApplePayPaymentToken,
): ApplePayPaymentMethod {
  return { type: 'APPLE_PAY', token };
}

export interface BuildApplePayPaymentRequestInput {
  /** The same NUMBER `/process` and `PayInput.amount` carry. */
  amount: number;
  /**
   * ISO 4217, ALREADY RESOLVED by the caller. Never defaulted here: the caller
   * defaults it for the `/process` body too, and a second independent default
   * could drift, letting the sheet and the charge disagree.
   */
  currencyCode: string;
  /** The merchant's country, ALREADY RESOLVED — same reason as `currencyCode`. */
  countryCode: string;
  /** Sheet label. `business.name`. */
  merchantName: string;
  /**
   * The business config's `apple_pay` block. Networks and capabilities are
   * derived HERE, so a caller cannot forget them or recompute them differently.
   * `undefined` is valid input for a pure function — the `mount()` gate decides
   * whether production ever gets here with it.
   */
  applePay: ApplePayConfig | undefined;
}

/**
 * Assemble the request object Apple's constructor accepts.
 *
 * @throws AppError(INVALID_PAYMENT_REQUEST) for a non-positive, non-finite, or
 *   non-two-decimal-representable amount.
 */
export function buildApplePayPaymentRequest(
  input: BuildApplePayPaymentRequestInput,
): ApplePayPaymentRequest {
  // One expression covering 0, negatives, NaN and Infinity. Apple's own
  // constructor throws on a total of zero or less; failing here keeps the
  // cause distinguishable from "the session failed".
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new AppError({ errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST });
  }

  // The sheet must not display an amount different from the one charged.
  // `total.amount` is `toFixed(2)` while `/process` carries the raw number, so
  // if those disagree the shopper authorizes one price, is charged another, and
  // neither system reports an error.
  //
  // ASSUMES A TWO-DECIMAL CURRENCY. JPY has zero minor units, KWD has three;
  // for those, both this check and the string below are wrong.
  if (Number(input.amount.toFixed(2)) !== input.amount) {
    throw new AppError({ errorCode: ErrorKeyEnum.INVALID_PAYMENT_REQUEST });
  }

  const capabilities = resolveApplePayMerchantCapabilities(input.applePay);

  return {
    countryCode: input.countryCode,
    currencyCode: input.currencyCode,
    supportedNetworks: resolveApplePayNetworks(input.applePay),
    // The assertion NARROWS, it does not validate:
    // `resolveApplePayMerchantCapabilities` is the single producer and emits
    // only Apple's known tokens (see its note on `supports3DS`), but returns
    // `string[]` because the config arrives off the wire untyped.
    merchantCapabilities: capabilities as ApplePayMerchantCapability[],
    total: {
      label: input.merchantName,
      // Apple requires a 2-DECIMAL STRING. `/process` carries the SAME money as
      // a NUMBER. Two representations of one amount, both correct — do not
      // "fix" either one to match the other.
      amount: input.amount.toFixed(2),
      type: 'final',
    },
  };
}
