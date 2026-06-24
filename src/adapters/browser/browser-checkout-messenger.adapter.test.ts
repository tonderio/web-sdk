import { describe, it, expect, vi, afterEach } from 'vitest';
import { BrowserCheckoutMessenger } from './browser-checkout-messenger.adapter';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

const ORIGIN = 'https://payflow.tonder.io';
const ALLOWED = new Set([ORIGIN]);

function dispatch(origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

/** Settle next microtask so a resolved/rejected promise can be observed. */
function flush(): Promise<void> {
  return Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrowserCheckoutMessenger.waitForCompletion', () => {
  it('resolves on checkout.completed from an allowed origin', async () => {
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    const promise = messenger.waitForCompletion(controller.signal);
    dispatch(ORIGIN, { event: 'checkout.completed' });

    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves on checkout.failed from an allowed origin', async () => {
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    const promise = messenger.waitForCompletion(controller.signal);
    dispatch(ORIGIN, { event: 'checkout.failed' });

    await expect(promise).resolves.toBeUndefined();
  });

  it('remains pending on a disallowed origin (no throw)', async () => {
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    let settled = false;
    const promise = messenger
      .waitForCompletion(controller.signal)
      .finally(() => {
        settled = true;
      });

    dispatch('https://evil.example.com', { event: 'checkout.completed' });
    await flush();

    expect(settled).toBe(false);
    controller.abort();
    await promise.catch(() => undefined);
  });

  it('remains pending on an unrecognized event type from an allowed origin', async () => {
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    let settled = false;
    const promise = messenger
      .waitForCompletion(controller.signal)
      .finally(() => {
        settled = true;
      });

    dispatch(ORIGIN, { event: 'checkout.redirected' });
    await flush();

    expect(settled).toBe(false);
    controller.abort();
    await promise.catch(() => undefined);
  });

  it('pre-aborted signal rejects with REQUEST_ABORTED and attaches no listener', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();
    controller.abort();

    const err = await messenger
      .waitForCompletion(controller.signal)
      .catch((e) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorKeyEnum.REQUEST_ABORTED);
    expect(addSpy.mock.calls.some(([type]) => type === 'message')).toBe(false);
  });

  it('post-attach abort rejects with REQUEST_ABORTED and removes the message listener', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    const promise = messenger.waitForCompletion(controller.signal);
    controller.abort();

    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorKeyEnum.REQUEST_ABORTED);
    expect(removeSpy.mock.calls.some(([type]) => type === 'message')).toBe(
      true,
    );
  });

  it('does not double-resolve when a second completion message arrives', async () => {
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();

    const promise = messenger.waitForCompletion(controller.signal);
    dispatch(ORIGIN, { event: 'checkout.completed' });
    await expect(promise).resolves.toBeUndefined();

    // Listener must be gone — a second dispatch must not throw or re-settle.
    expect(() =>
      dispatch(ORIGIN, { event: 'checkout.completed' }),
    ).not.toThrow();
  });

  it('removes both the message and abort listeners after an abort rejection', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const messenger = new BrowserCheckoutMessenger(ALLOWED);
    const controller = new AbortController();
    const abortRemoveSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const promise = messenger.waitForCompletion(controller.signal);
    controller.abort();
    await promise.catch(() => undefined);

    expect(removeSpy.mock.calls.some(([type]) => type === 'message')).toBe(
      true,
    );
    expect(abortRemoveSpy.mock.calls.some(([type]) => type === 'abort')).toBe(
      true,
    );
  });
});
