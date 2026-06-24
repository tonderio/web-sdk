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
 * Domain core. Holds shared state and lifecycle flags and notifies subscribers
 * on change (Observer). PURE: no DOM, HTTP, or external-SDK imports — only
 * config/types. All side-effecting work lives behind ports/adapters/services.
 */
export class TonderCore {
  private readonly config: TonderConfig;
  private state: TonderState;
  private readonly listeners = new Set<StateListener>();

  constructor(config: TonderConfig) {
    this.config = config;
    this.state = {
      lifecycle: 'created',
      business: null,
      customerAuthToken: null,
      customerInput: null,
      lastErrorCode: null,
    };
  }

  /** Returns the immutable current config. */
  public getConfig(): Readonly<TonderConfig> {
    return this.config;
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
