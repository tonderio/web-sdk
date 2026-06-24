import type { CardFieldsOptions, RevealCardFieldsInput } from '../types/card';

/**
 * Driven port: vault/Skyflow tokenizer. Mounts secure inputs, collects them
 * into per-field tokens, and reveals stored values. Implemented by the Skyflow
 * adapter (runtime-loaded script). The domain depends on this interface only —
 * never on DOM or the Skyflow SDK directly.
 */
export interface TokenizerPort {
  /** Mount Skyflow Collect Elements into the merchant-provided containers. */
  mount(request: CardFieldsOptions): Promise<void>;
  /**
   * Unmount previously-mounted elements. With no argument, unmounts everything;
   * with a context key (`'create'` or `'update:<cardId>'`) only that context.
   */
  unmount(context?: string): void;
  /** Collect mounted fields for a context (`'create'` by default, or `update:<cardId>` for saved-card CVV). */
  collect(context?: string): Promise<Record<string, string>>;
  /** Reveal the last-collected tokens into the merchant-provided containers. */
  reveal(request: RevealCardFieldsInput): Promise<void>;
}
