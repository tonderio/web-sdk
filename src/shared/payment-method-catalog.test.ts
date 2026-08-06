import { describe, it, expect } from 'vitest';
import { isApplePayCatalogMethod } from './payment-method-catalog';

const DEBIT = 'apple_pay_debit_card';
const CREDIT = 'apple_pay_credit_card';

describe('isApplePayCatalogMethod', () => {
  it.each([DEBIT, CREDIT, 'apple_pay_prepaid_card'])(
    'matches the apple_pay_ prefix: %s',
    (paymentMethod) => {
      expect(isApplePayCatalogMethod(paymentMethod)).toBe(true);
    },
  );

  it.each(['card', 'oxxo', 'spei'])(
    'does not match a non-Apple method: %s',
    (paymentMethod) => {
      expect(isApplePayCatalogMethod(paymentMethod)).toBe(false);
    },
  );

  it('does NOT match a bare apple_pay entry — documented non-match', () => {
    // No such entry exists in the backend contract, and widening the prefix to
    // `apple_pay` would start matching an unrelated `apple_payment_*` namespace.
    // If the backend ever ships one, extend the predicate here.
    expect(isApplePayCatalogMethod('apple_pay')).toBe(false);
  });
});
