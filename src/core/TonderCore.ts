import { createConfigSnapshot } from '../shared/config/snapshot';
import type { BusinessConfig } from '../models/business.model';
import type { Customer, TonderConfig } from '../shared/types';

/** Lifecycle phase of the SDK instance. */
export type TonderLifecycle = 'created' | 'initializing' | 'ready' | 'error';

/** Snapshot of core state shared across layers (Observer subject). */
export interface TonderState {
  lifecycle: TonderLifecycle;
  /** Business/vault config fetched during `init()`. Null until ready. */
  business: BusinessConfig | null;
  /** Customer auth token cached after transparent registration. Null until set. */
  customerAuthToken: string | null;
  /** Customer input cached after transparent registration. Null until set. */
  customerInput: Customer | null;
  /** Last error code observed, if any. */
  lastErrorCode: string | null;
}

/** Listener invoked on every state change with the new snapshot. */
export type StateListener = (state: Readonly<TonderState>) => void;

/** Unsubscribe handle returned by {@link TonderCore.subscribe}. */
export type Unsubscribe = () => void;

/**
 * Notified once per instance with the name of a config field that was changed
 * after construction and therefore has no effect.
 *
 * Injected rather than called directly so this layer never learns how a message
 * reaches a developer, which is what keeps it free of browser globals.
 */
export type ConfigDriftSink = (field: string) => void;

/**
 * Domain core. Holds shared state and lifecycle flags and notifies subscribers
 * on change (Observer). PURE: no DOM, HTTP, or external-SDK imports — only
 * config/types. All side-effecting work lives behind ports/adapters/services.
 */
export class TonderCore {
  /** The construction-time copy. This is what every read goes through. */
  readonly #config: TonderConfig;
  /**
   * The object the merchant handed in. Compared against, never read for a
   * value — reading it for a value would defeat the copy above.
   */
  readonly #original: TonderConfig;
  readonly #onDrift?: ConfigDriftSink;
  #driftReported = false;
  private state: TonderState;
  private readonly listeners = new Set<StateListener>();

  constructor(config: TonderConfig, onDrift?: ConfigDriftSink) {
    this.#original = config;
    this.#onDrift = onDrift;
    this.#config = createConfigSnapshot(config, (field) => {
      this.#report(field);
    });
    this.state = {
      lifecycle: 'created',
      business: null,
      customerAuthToken: null,
      customerInput: null,
      lastErrorCode: null,
    };
  }

  /**
   * Returns the construction-time config copy.
   *
   * The same object every call: `events` is an accessor on it, so rebuilding
   * the object per call would invoke that accessor and freeze the merchant's
   * handlers into a value.
   */
  public getConfig(): Readonly<TonderConfig> {
    if (!this.#driftReported) this.#detectDrift();
    return this.#config;
  }

  /**
   * Compares the two fields the published type documents as fixed.
   *
   * Deliberately shallow and deliberately narrow. Deep equality would be
   * unbounded and would walk merchant objects that were copied by reference on
   * purpose. `secure_token` is the widest window — re-read on every saved-card
   * call and never cached. `customer` is compared key by key rather than by
   * object identity, because rewriting one field in place is the shape that
   * actually gets reported and identity alone would not see it.
   *
   * The whole body is guarded: the merchant's object may expose `session` as an
   * accessor that throws. A config that cannot even be inspected is not
   * inspected again.
   */
  #detectDrift(): void {
    try {
      const snapshotSession = this.#config.session;
      const originalSession = this.#original.session;

      if (snapshotSession?.secure_token !== originalSession?.secure_token) {
        this.#report('session.secure_token');
        return;
      }

      const snapshotCustomer = snapshotSession?.customer;
      const originalCustomer = originalSession?.customer;
      if (!snapshotCustomer) return;
      if (!originalCustomer) {
        this.#report('session.customer');
        return;
      }
      for (const key of Object.keys(snapshotCustomer) as (keyof Customer)[]) {
        if (snapshotCustomer[key] !== originalCustomer[key]) {
          this.#report('session.customer');
          return;
        }
      }
    } catch {
      this.#driftReported = true;
    }
  }

  /**
   * Latches FIRST, then notifies.
   *
   * A sink that throws must not be able to reopen the gate and warn again on
   * the next call, so the flag is set before the call rather than after it. The
   * sink is foreign code and its failure is not this SDK's failure, so its
   * throw is swallowed here — nothing in this path may change what happens to a
   * payment in flight.
   */
  #report(field: string): void {
    this.#driftReported = true;
    try {
      this.#onDrift?.(field);
    } catch {
      // Intentionally empty: see above.
    }
  }

  /** Returns a read-only snapshot of the current state. */
  public getState(): Readonly<TonderState> {
    return this.state;
  }

  /** Subscribe to state changes. Returns an unsubscribe handle. */
  public subscribe(listener: StateListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Merge a partial patch into state and notify all subscribers. */
  public setState(patch: Partial<TonderState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /** Notify all current subscribers with the latest state snapshot. */
  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
