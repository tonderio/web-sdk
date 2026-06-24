import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollUntilFinal, FINAL_STATUSES } from './poll';
import { AppError } from '../errors/AppError';
import { ErrorKeyEnum } from '../errors/ErrorKeyEnum';

interface Tx {
  id: string;
  status: string;
}

function tx(status: string): Tx {
  return { id: 'tx_1', status };
}

describe('FINAL_STATUSES', () => {
  it('includes terminal payment statuses so the poll does not spin', () => {
    for (const s of [
      'success',
      'authorized',
      'declined',
      'failed',
      'rejected',
      'expired',
      'cancelled',
      'canceled',
    ]) {
      expect(FINAL_STATUSES.has(s)).toBe(true);
    }
  });

  it('does NOT include non-final statuses', () => {
    for (const s of [
      'pending',
      'in review',
      'needs response',
      'waiting',
      'paid_full',
      'refunded',
    ]) {
      expect(FINAL_STATUSES.has(s)).toBe(false);
    }
  });
});

describe('pollUntilFinal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately (after first fetch) when the status is already final', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tx('success'));

    const result = await pollUntilFinal<Tx>(fetchFn, 'tx_1');

    expect(result).toEqual(tx('success'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('tx_1', expect.any(AbortSignal));
  });

  it('matches final status case-insensitively', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tx('Authorized'));

    const result = await pollUntilFinal<Tx>(fetchFn, 'tx_1');

    expect(result).toEqual(tx('Authorized'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('polls N times before a final status, honoring backoff (start 2s ×1.5 cap 5s)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tx('pending'))
      .mockResolvedValueOnce(tx('pending'))
      .mockResolvedValueOnce(tx('pending'))
      .mockResolvedValueOnce(tx('pending'))
      .mockResolvedValue(tx('success'));

    const promise = pollUntilFinal<Tx>(fetchFn, 'tx_1');

    // 1st fetch fires synchronously on start.
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // 2nd fetch after 2000ms.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // 3rd after 3000ms (2000 * 1.5).
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // 4th after 4500ms (3000 * 1.5).
    await vi.advanceTimersByTimeAsync(4500);
    expect(fetchFn).toHaveBeenCalledTimes(4);

    // 5th after 5000ms (cap, since 4500 * 1.5 = 6750 > 5000).
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchFn).toHaveBeenCalledTimes(5);

    await expect(promise).resolves.toEqual(tx('success'));
  });

  it('rejects with AppError(POLL_TIMEOUT_ERROR) when the deadline passes before a final status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tx('pending'));

    const promise = pollUntilFinal<Tx>(fetchFn, 'tx_1', {
      intervalMs: 1000,
      factor: 1,
      timeoutMs: 5000,
    });
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(6000);

    const err = await settled;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.POLL_TIMEOUT_ERROR);
  });

  it('rejects with AppError(REQUEST_ABORTED) on abort and makes no further fetchFn calls', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn().mockResolvedValue(tx('pending'));

    const promise = pollUntilFinal<Tx>(fetchFn, 'tx_1', {
      intervalMs: 1000,
      signal: controller.signal,
    });
    const settled = promise.catch((e) => e);

    // Let the first fetch resolve and schedule the next tick.
    await vi.advanceTimersByTimeAsync(1000);
    const callsAtAbort = fetchFn.mock.calls.length;

    controller.abort();

    const err = await settled;
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.REQUEST_ABORTED);

    // No further calls after abort.
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchFn).toHaveBeenCalledTimes(callsAtAbort);
  });

  it('rejects immediately when the signal is already aborted and never calls fetchFn', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn().mockResolvedValue(tx('success'));

    const err = await pollUntilFinal<Tx>(fetchFn, 'tx_1', {
      signal: controller.signal,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.REQUEST_ABORTED);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('propagates a genuine fetchFn rejection with its own error code (not masked as REQUEST_ABORTED)', async () => {
    const transportError = new AppError({
      errorCode: ErrorKeyEnum.FETCH_TRANSACTION_ERROR,
      status_code: 502,
    });
    const fetchFn = vi.fn().mockRejectedValue(transportError);

    const err = await pollUntilFinal<Tx>(fetchFn, 'tx_1').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.FETCH_TRANSACTION_ERROR);
    expect(err.status_code).toBe(502);
    // The real cause must NOT be hidden behind REQUEST_ABORTED.
    expect(err.code).not.toBe(ErrorKeyEnum.REQUEST_ABORTED);
  });

  it('wraps a non-AppError fetchFn rejection as AppError(REQUEST_FAILED)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('boom'));

    const err = await pollUntilFinal<Tx>(fetchFn, 'tx_1').catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ErrorKeyEnum.REQUEST_FAILED);
  });

  it('is single-resolution: a final status wins and a later timeout does not reject', async () => {
    const fetchFn = vi.fn().mockResolvedValue(tx('success'));

    const promise = pollUntilFinal<Tx>(fetchFn, 'tx_1', {
      timeoutMs: 1000,
    });

    await expect(promise).resolves.toEqual(tx('success'));

    // Advancing past the timeout must NOT cause an unhandled rejection or a
    // second settlement — the promise already resolved.
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
