import type { EnginePinPort, PaymentEngine } from '../../ports/engine-pin.port';

const KEY_PREFIX = 'tonder:engine:';

/**
 * {@link EnginePinPort} backed by `sessionStorage`, so a redirect that returns
 * to the same tab still finds the pin, with an in-memory copy for the instance.
 *
 * Storage can be missing, full or blocked (private windows, embedded
 * contexts): every access is guarded and the in-memory copy keeps working.
 */
export class SessionEnginePin implements EnginePinPort {
  private readonly memory = new Map<string, PaymentEngine>();

  public remember(transactionId: string, engine: PaymentEngine): void {
    this.memory.set(transactionId, engine);
    try {
      globalThis.sessionStorage?.setItem(KEY_PREFIX + transactionId, engine);
    } catch {
      // Storage unavailable: the in-memory pin still covers this instance.
    }
  }

  public recall(transactionId: string): PaymentEngine | undefined {
    const known = this.memory.get(transactionId);
    if (known) return known;
    try {
      const stored = globalThis.sessionStorage?.getItem(
        KEY_PREFIX + transactionId,
      );
      return stored === 'core' || stored === 'legacy' ? stored : undefined;
    } catch {
      return undefined;
    }
  }
}
