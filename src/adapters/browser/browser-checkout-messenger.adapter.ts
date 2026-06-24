import type { CheckoutMessengerPort } from '../../ports/checkout-messenger.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

/**
 * `data.event` values the embedded payflow page emits to signal completion.
 * Anything else (e.g. `checkout.redirected`) is NOT a final signal and is
 * ignored — the SDK keeps waiting for a completion signal.
 */
const COMPLETION_EVENTS: ReadonlySet<string> = new Set([
  'checkout.completed',
  'checkout.failed',
]);

/** Shape gate: a `MessageEvent.data` carrying a recognized completion event. */
function isCompletionMessage(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const event = (data as { event?: unknown }).event;
  return typeof event === 'string' && COMPLETION_EVENTS.has(event);
}

/**
 * Browser implementation of {@link CheckoutMessengerPort}. The ONLY place that
 * touches `window`/`postMessage` for embedded 3DS completion — the core and the
 * facade stay DOM-free and tests inject a fake messenger.
 *
 * `waitForCompletion` attaches a `window` `"message"` listener and the signal's
 * `"abort"` listener. A single `cleanup()` removes BOTH before every resolve or
 * reject, so the listeners never leak (mirrors `poll.ts`). Origin and shape are
 * validated on every message; mismatches are silently ignored (no public error
 * code), leaving the promise pending until a valid completion signal arrives.
 */
export class BrowserCheckoutMessenger implements CheckoutMessengerPort {
  constructor(private readonly allowedOrigins: ReadonlySet<string>) {}

  public waitForCompletion(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Pre-aborted signal: reject immediately, attach NOTHING.
      if (signal.aborted) {
        reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
        return;
      }

      let settled = false;

      const cleanup = (): void => {
        window.removeEventListener('message', onMessage);
        signal.removeEventListener('abort', onAbort);
      };

      const onMessage = (event: MessageEvent): void => {
        if (settled) return;
        // Origin gate — silently ignore anything not from an allowed origin.
        if (!this.allowedOrigins.has(event.origin)) return;
        // Shape gate — only recognized completion events settle the flow.
        if (!isCompletionMessage(event.data)) return;
        settled = true;
        cleanup();
        resolve();
      };

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
      };

      window.addEventListener('message', onMessage);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
