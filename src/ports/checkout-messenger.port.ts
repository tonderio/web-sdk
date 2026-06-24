/**
 * Driven port: the PRIMARY embedded 3DS completion signal. The payflow iframe
 * posts a `MessageEvent` to the host window when the embedded checkout settles;
 * an adapter behind this port translates that into a resolved promise.
 *
 * Signal-only by design: `waitForCompletion` resolves `void` — it ONLY reports
 * that the embedded page is done, it never fetches or classifies a transaction.
 * The facade owns the authoritative post-signal reconciliation read
 * (`getTransaction`, then polled to a FINAL status), so there is a
 * single source of truth for status. Keeping the port `void` also keeps the
 * adapter free of any model/HTTP knowledge.
 *
 * The core/facade depends only on this port; all DOM/`window` access lives in
 * the browser adapter, so tests inject a fake messenger.
 */
export interface CheckoutMessengerPort {
  /**
   * Resolve when the embedded checkout page signals completion. Rejects with
   * `AppError(REQUEST_ABORTED)` if `signal` aborts (including a pre-aborted
   * signal). Non-completion messages leave the promise pending.
   */
  waitForCompletion(signal: AbortSignal): Promise<void>;
}
