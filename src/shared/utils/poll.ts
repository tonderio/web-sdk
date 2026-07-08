/**
 * Pure, cancelable polling utility.
 *
 * PURE: no DOM, no `fetch`, no `core/` imports. The data source is the injected
 * `fetchFn`; the only ambient globals used are `setTimeout`/`clearTimeout`,
 * which keeps it fake-timer friendly (`vi.useFakeTimers()`).
 *
 * Design constraints (so this never clashes with the future payflow
 * CheckoutMessenger):
 * - **Cancelable** via `AbortSignal`.
 * - **Single-resolution** — a `resolved` guard ensures the returned promise
 *   settles exactly once: the FIRST of final-status / timeout / abort wins.
 * - **Never auto-started** — this util only runs when a caller invokes it.
 * - **Recursive `setTimeout`** (NOT `setInterval`) — the next tick is scheduled
 *   only after the previous fetch settles, so requests never overlap.
 */

import { AppError } from '../errors/AppError';
import { ErrorKeyEnum } from '../errors/ErrorKeyEnum';

/**
 * Statuses where the SDK considers the outcome KNOWN and stops polling
 * (case-insensitive). This list is payment-focused; withdrawal-only provider
 * vocabulary such as `paid_full` intentionally does not belong in the Web SDK.
 * Async methods (SPEI/OXXO) rest at `pending` and rely on webhooks — polling
 * them would time out, by design.
 */
export const FINAL_STATUSES: ReadonlySet<string> = new Set([
  'success',
  'authorized',
  'declined',
  'failed',
  'rejected',
  'expired',
  'cancelled',
  'canceled',
]);

/** Tuning knobs for {@link pollUntilFinal}. All optional with sane defaults. */
export interface PollOptions {
  /** First wait between polls, in ms. Default 2000. */
  intervalMs?: number;
  /** Upper bound for the backoff interval, in ms. Default 5000. */
  maxIntervalMs?: number;
  /** Backoff multiplier applied after each poll. Default 1.5. */
  factor?: number;
  /** Total deadline before giving up, in ms. Default 180000 (3 min). */
  timeoutMs?: number;
  /** Caller signal to cancel the poll and any in-flight fetch. */
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const DEFAULT_FACTOR = 1.5;
const DEFAULT_TIMEOUT_MS = 180000;

/** Shape the poll needs from each fetched item: a string `status`. */
interface HasStatus {
  status: string;
}

/**
 * Poll `fetchFn(id, signal)` until its result reaches a {@link FINAL_STATUSES}
 * status, then resolve with that result. Rejects with:
 * - `AppError(POLL_TIMEOUT_ERROR)` if `timeoutMs` elapses first.
 * - `AppError(REQUEST_ABORTED)` if `options.signal` aborts (including a
 *   pre-aborted signal, in which case `fetchFn` is never called).
 *
 * The poll owns its own `AbortController`, derived from `options.signal`, so the
 * in-flight `fetchFn` is canceled the instant the caller aborts or the deadline
 * trips. Single-resolution is enforced by the `resolved` flag.
 */
export function pollUntilFinal<T extends HasStatus>(
  fetchFn: (id: string, signal: AbortSignal) => Promise<T>,
  id: string,
  options: PollOptions = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const externalSignal = options.signal;

  return new Promise<T>((resolve, reject) => {
    let resolved = false;
    let nextDelay = intervalMs;
    let tickTimer: ReturnType<typeof setTimeout> | undefined;

    // Pre-aborted signal: reject immediately, never schedule anything or call
    // fetchFn.
    if (externalSignal?.aborted) {
      reject(new AppError({ errorCode: ErrorKeyEnum.REQUEST_ABORTED }));
      return;
    }

    // The poll's own controller cancels in-flight fetches on abort/timeout.
    const controller = new AbortController();

    // Overall deadline. Fires once; first-wins via the `resolved` guard. The
    // callback runs async, after every binding below is initialized.
    const deadlineTimer = setTimeout(() => {
      settleReject(ErrorKeyEnum.POLL_TIMEOUT_ERROR);
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(deadlineTimer);
      if (tickTimer !== undefined) clearTimeout(tickTimer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    };

    const settleResolve = (value: T): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (errorCode: ErrorKeyEnum, cause?: unknown): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      controller.abort();
      reject(new AppError({ errorCode, originalError: cause }));
    };

    // Reject with a GENUINE fetchFn error, preserving its code/statusCode. Used
    // for real transport failures (e.g. a 502 → FETCH_TRANSACTION_ERROR) — these
    // must NOT be masked as REQUEST_ABORTED. (Abort/timeout settle first and flip
    // `resolved`, so this path is only reached for real fetch rejections.)
    const settleRejectError = (error: unknown): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      controller.abort();
      reject(
        error instanceof AppError
          ? error
          : new AppError({
              errorCode: ErrorKeyEnum.REQUEST_FAILED,
              originalError: error,
            }),
      );
    };

    function onAbort(): void {
      settleReject(ErrorKeyEnum.REQUEST_ABORTED);
    }

    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const tick = (): void => {
      if (resolved) return;
      fetchFn(id, controller.signal)
        .then((result) => {
          if (resolved) return;
          if (FINAL_STATUSES.has(result.status.toLowerCase())) {
            settleResolve(result);
            return;
          }
          // Schedule the next poll, then grow the backoff (capped).
          tickTimer = setTimeout(tick, nextDelay);
          nextDelay = Math.min(nextDelay * factor, maxIntervalMs);
        })
        .catch((error) => {
          if (resolved) return;
          // Reached only for a REAL fetch rejection: abort/timeout settle first
          // (flipping `resolved`), so their induced fetch rejection early-returns
          // above. Propagate the genuine error instead of masking it as aborted.
          settleRejectError(error);
        });
    };

    // Kick off the first poll synchronously (no initial wait).
    tick();
  });
}
