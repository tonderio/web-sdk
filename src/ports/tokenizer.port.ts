import type { CardFieldsOptions, RevealCardFieldsInput } from '../types/card';

/** Secure card-field contract used by the SDK runtime. */
export interface TokenizerPort {
  /** Mount secure card fields into the merchant-provided containers. */
  mount(request: CardFieldsOptions): Promise<void>;
  /** Unmount previously-mounted secure fields. */
  unmount(context?: string): void;
  /** Collect secure field tokens for a mounted context. */
  collect(context?: string): Promise<Record<string, string>>;
  /** Reveal safe display values into the merchant-provided containers. */
  reveal(request: RevealCardFieldsInput): Promise<void>;
}
