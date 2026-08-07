/**
 * Detaches charge data from the object the merchant handed in.
 *
 * Both charge paths read their input twice with a gap in between, and a write
 * landing in that gap is the defect: `pay()` would charge a value that never
 * passed validation, and the Apple Pay button would charge a price other than
 * the one on the sheet the shopper approved.
 *
 * Shallow-plus-one on purpose. Nothing below the copied level takes part in
 * validation or the amount, and a deep clone would have to reason about class
 * instances, `Date`, and cycles inside merchant `metadata`.
 */
export function snapshotPaymentInput<
  T extends {
    metadata?: Record<string, unknown>;
    billing_address?: Record<string, unknown>;
    payment_method?: unknown;
  },
>(input: T): T {
  const copy: T = { ...input };

  if (input.metadata) {
    copy.metadata = { ...input.metadata };
  }
  if (input.billing_address) {
    copy.billing_address = { ...input.billing_address };
  }
  if (input.payment_method && typeof input.payment_method === 'object') {
    const method = input.payment_method as {
      config?: Record<string, unknown>;
    };
    copy.payment_method = {
      ...method,
      ...(method.config ? { config: { ...method.config } } : {}),
    };
  }

  return copy;
}
