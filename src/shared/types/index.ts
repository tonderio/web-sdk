import type { TonderMode } from '../config/env';
import type { TonderCustomization } from '../../types/customization';

export type { RawTransaction } from '../../models/transaction.model';
export type { Card } from '../../models/card.model';

/**
 * Shopper session values accepted by `createTonder`.
 *
 * Omit `session.customer` for read-only flows such as `getTransaction()` on a
 * return_url page. Provide it when the SDK instance will call `pay()` or manage
 * saved cards. Session values are fixed for the life of the instance; create a
 * new instance when the shopper or secure token changes.
 */
export interface TonderSession {
  /**
   * Customer identity used for pay(), saved cards, and Card-on-File operations.
   * Not required for read-only methods such as getTransaction().
   */
  customer?: Customer;
  /** Secure token minted by your server for saved-card operations, including saved-card payments. */
  secure_token?: string;
}

/**
 * Presentation lifecycle callbacks for embedded hosted-page flows. Instance-
 * scoped (one modal at a time). Read from `config.events.presentation`.
 */
export interface PresentationEvents {
  /** Called once an embedded presentation modal has been mounted. */
  on_open?(): void;
  /**
   * Called when the shopper closes an embedded APM/SPEI modal (via the modal's
   * "X" or Escape). Not called for card 3DS (which is non-closable) nor for a
   * programmatic close on completion.
   */
  on_close?(): void;
}

/**
 * Namespaced event callbacks on `config`. Presentation callbacks live under
 * `presentation`; input-field events are per-component (on the `'card_fields'`
 * component options), NOT here.
 */
export interface TonderEvents {
  presentation?: PresentationEvents;
}

/**
 * Configuration accepted by `createTonder`.
 *
 * The `api_key` must be a publishable key. Do not place secret credentials in
 * browser code; provide short-lived session credentials from your server when
 * saved-card operations are needed.
 */
export interface TonderConfig {
  /** PUBLIC publishable key only — never a secret. */
  api_key: string;
  /** Target environment. */
  environment: TonderMode;
  /** Optional SDK UI customization, namespaced by surface. */
  customization?: TonderCustomization;
  /**
   * Session-scoped identity and credentials. These values are fixed for the SDK
   * instance lifetime; recreate the SDK instance to switch customers or refresh
   * an expired secure token.
   */
  session?: TonderSession;
  /**
   * How a hosted `next_action` flow (card 3DS or an APM/SPEI hosted page) is
   * presented by `pay()`. Default `'redirect'`: the browser navigates to the
   * hosted page and the merchant recovers status via `getTransaction` on
   * `return_url`. `'embedded'`: the SDK presents the hosted page in its own
   * full-screen modal (appended to `document.body`, CSS-isolated in a shadow
   * root) — there is no merchant container to provide.
   *
   * Presentation differs by flow: card 3DS completes in-session, so the modal
   * polls to a final status and auto-closes and is NOT dismissible by the
   * shopper. APMs settle asynchronously (via webhook), so the modal stays
   * visible (showing the CLABE/voucher) and `pay()` returns the pending
   * transaction immediately; the shopper closes it with the modal's own "X"
   * (or Escape), which fires `events.presentation.on_close`.
   */
  presentation_mode?: 'redirect' | 'embedded';
  /**
   * Namespaced event callbacks. Presentation lifecycle callbacks live under
   * `events.presentation`; they are read at FIRE time, so a config mutated
   * after `createTonder` is still honored. Input-field events do NOT live here
   * — they are per-component (`create('card_fields', { events })`).
   */
  events?: TonderEvents;
}

/**
 * Payment method selector accepted by `pay()`.
 */
export type PaymentMethod =
  | { type: 'card' }
  | { type: 'saved_card'; card_id: string }
  | { type: string; config?: Record<string, unknown> };

/**
 * A payment method enabled for your business, returned by `getPaymentMethods()`.
 */
export interface PaymentMethodInfo {
  /** Stable payment-method identifier. */
  id: number;
  /** Canonical method code, e.g. `'oxxopay'`, `'spei'`, `'card'`. */
  payment_method: string;
  /** Human-readable display label. Empty when no label is available. */
  label: string;
  /** Logo/icon URL for rendering payment-method selectors. */
  logo: string;
  /** Grouping category, e.g. `'cash'`, `'transfer'`, `'card'`. */
  category: string;
}

/**
 * Bank option for bank-backed alternative payment methods, returned by
 * `getPaymentMethodBanks()`. For SafetyPay payments, pass the bank routing
 * `code` as `{ id: bank.code }` inside `payment_method.config.bank_ids`.
 */
export interface PaymentMethodBank {
  /** Tonder bank record identifier for display/debugging. Do not use for SafetyPay routing. */
  id: number;
  /** Human-readable bank name. */
  name: string;
  /** Bank routing code to pass as `config.bank_ids[].id` for SafetyPay. */
  code: string;
  /** Human-readable country name expected by SafetyPay, e.g. `Mexico`. */
  country: string;
  /** SafetyPay channel code to pass in `config.channel` (`WP` for cash, `OL` for transfer). */
  channel: 'WP' | 'OL';
  /** Optional logo URL. */
  logo?: string;
}

/**
 * Result of `getPaymentMethodBanks()`: bank options grouped by settlement channel.
 */
export interface PaymentMethodBanks {
  /** Cash-channel bank options for `payment_method.type = 'safetypayCash'`. */
  cash: PaymentMethodBank[];
  /** Transfer-channel bank options for `payment_method.type = 'safetypayTransfer'`. */
  transfer: PaymentMethodBank[];
}

/**
 * Unified customer identity, set once via `config.session.customer`. `email` is
 * required; optional identity fields improve cardholder and reconciliation data.
 * This is the only customer shape accepted by the public API.
 */
export interface Customer {
  /**
   * Customer email. Required for payment and saved-card operations.
   */
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/**
 * Result of `enrollCard()`. `card_id` is always returned; `subscription_id` is
 * present only when the business has Card-on-File enabled and the subscription
 * was created.
 */
export interface EnrollResult {
  card_id: string;
  subscription_id?: string;
}

/**
 * Input accepted by `pay()`.
 *
 * Customer data is not passed per payment. Configure the shopper once through
 * `config.session.customer` when creating the SDK instance.
 */
/**
 * Optional customer billing address. Every field is optional — provide as much as you
 * have. Some payment methods may require it; when in doubt, send the full address.
 */
export interface BillingAddress {
  street?: string;
  street2?: string;
  state?: string;
  country?: string;
  zip_code?: string;
}

export interface PayInput {
  /** Charge amount. Must be greater than 0. */
  amount: number;
  /** ISO 4217 currency code. Defaults to `'MXN'` when omitted. */
  currency?: string;
  /** Mandatory landing URL for 3DS/redirect flows for this transaction. */
  return_url: string;
  /**
   * The payment method to charge: a fresh card (`{ type: 'card' }`), a stored card
   * (`{ type: 'saved_card', card_id }`), or any configured alternative method
   * directly by code (`{ type: 'spei' }`, `{ type: 'oxxopay' }`,
   * `{ type: 'safetypayCash', config }`, etc.).
   */
  payment_method: PaymentMethod;
  /** Arbitrary merchant metadata echoed back on the transaction. */
  metadata?: Record<string, unknown>;
  /** Optional customer billing address. */
  billing_address?: BillingAddress;
  /** Required merchant-side business reference for reconciliation, dashboards, exports, and webhooks. */
  client_reference: string;
  /**
   * Optional retry-safe key for this payment attempt. Reusing the same key lets
   * Tonder recognize duplicate submissions for the same business account.
   * This is separate from `client_reference`, which remains the merchant-facing
   * order/deposit reference used for reconciliation.
   */
  idempotency_key?: string;
}
