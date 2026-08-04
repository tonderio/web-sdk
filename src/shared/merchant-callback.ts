/**
 * Invoke merchant-supplied code so that a throw inside it can never change what
 * the SDK already did. NEVER throws.
 *
 * A merchant callback is FOREIGN code running inside an SDK code path, and a
 * null field in their analytics call is enough to make one throw. Unwrapped,
 * that throw travels wherever the SDK invoked it from: it can reject a `pay()`
 * whose charge SUCCEEDED — the merchant retries and there are two charges — and
 * it can abort SDK work queued after the callback, such as the error-label
 * update that follows a card-field event.
 *
 * Not swallowed: the throw is reported through `console.warn`, so the
 * merchant's own bug stays visible.
 *
 * @param label Where the callback came from, e.g. `events.presentation.on_open`.
 * @param run   Thunk that reads the handler and calls it.
 *
 * @internal
 */
export function invokeMerchantCallback(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    try {
      console.warn(`[${label}] merchant callback threw:`, error);
    } catch {
      // `console.warn` is patchable by the page, so it can throw too. A failure
      // to REPORT must not resurrect the throw this wrapper exists to contain.
    }
  }
}
