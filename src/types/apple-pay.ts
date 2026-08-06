/**
 * Apple Pay contract surface: the availability probe's result and the button
 * component's options and handle.
 *
 * Every type here is re-exported from `src/index.ts`, because each one is
 * either produced or consumed by a public method. A merchant who assigns one to
 * a variable must be able to name it.
 */

import type { PayInput } from '../shared/types';
import type { TonderMountableComponent } from './component';

/**
 * Result of `tonder.isApplePayAvailable()`.
 *
 * A discriminated union on `available`: check that flag first and TypeScript
 * narrows the rest, so `code` and `message` exist exactly where a reason does.
 *
 * `code` is an `ErrorKeyEnum` value and `message` is the same copy the
 * matching thrown error carries, so the probe and the real failure speak one
 * vocabulary. It is deliberately a plain object rather than an `Error`: the
 * probe is a cheap synchronous question that may be asked on every render, and
 * an unavailable answer is not an exceptional condition.
 */
export type ApplePayAvailability =
  | { available: true }
  | { available: false; code: string; message: string };

/**
 * Everything `pay()` accepts except the method, which this component implies.
 * Derived from {@link PayInput} so it inherits future payment fields with no
 * edit to this file.
 */
export type ApplePayPaymentInput = Omit<PayInput, 'payment_method'>;

/** Construction options for the Apple Pay button component. */
export interface ApplePayButtonOptions {
  /** Container id. Defaults to '#tonder-apple-pay-button'. */
  container_id?: string;
  /**
   * Payment data for the charge. Object for a fixed amount, function for a cart
   * that can change after mount. Called SYNCHRONOUSLY inside the click handler.
   */
  payment: ApplePayPaymentInput | (() => ApplePayPaymentInput);
}

/**
 * Handle returned by `tonder.create('apple_pay_button', options)` once the
 * component exists. Adds no members of its own today.
 *
 * Declared as an alias rather than an empty `extends` interface: the component
 * map needs a distinct, nameable handle per component, and an alias provides
 * that without the lint suppression an empty interface would require. Convert
 * it to an interface in the phase that gives the button a method of its own.
 */
export type ApplePayButtonComponent = TonderMountableComponent;
