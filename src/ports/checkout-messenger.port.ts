/**
 * Embedded hosted-page completion signal contract.
 *
 * `waitForCompletion` only reports that the embedded page is done. The SDK then
 * reads the transaction state through its normal payment-status flow.
 */
export interface CheckoutMessengerPort {
  /** Resolve when the embedded hosted page signals completion. */
  waitForCompletion(signal: AbortSignal): Promise<void>;
}
