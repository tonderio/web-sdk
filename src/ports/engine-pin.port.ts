/** Which API a payment runs on. Chosen once when the payment starts. */
export type PaymentEngine = 'core' | 'legacy';

/**
 * Remembers the engine of a payment by its transaction id, so every later read
 * of that payment follows the engine that created it even when the business
 * configuration changes or the page is reloaded after a redirect.
 */
export interface EnginePinPort {
  remember(transactionId: string, engine: PaymentEngine): void;
  recall(transactionId: string): PaymentEngine | undefined;
}
