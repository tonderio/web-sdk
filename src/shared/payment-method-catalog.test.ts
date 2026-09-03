import { describe, it, expect } from 'vitest';
import {
  isApplePayCatalogMethod,
  getPaymentMethodCatalogDetails,
} from './payment-method-catalog';
import { resolveEnv } from './config/env';

const PRODUCTION_ASSETS = resolveEnv('production').assets;
const SANDBOX_ASSETS = resolveEnv('sandbox').assets;

const STORE_LOGO = `${PRODUCTION_ASSETS}/payment_methods/store.png`;

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

describe('getPaymentMethodCatalogDetails', () => {
  it.each([
    ['SORIANA', 'Soriana'],
    ['7ELEVEN', '7 Eleven'],
    ['CAJATRUJILLO', 'Caja Trujillo'],
    ['SFDEASIS', 'Pago en Farmacias San Francisco de Asís'],
  ])(
    'names %s, which used to render as an unlabelled option',
    (code, label) => {
      expect(
        getPaymentMethodCatalogDetails(code, PRODUCTION_ASSETS).label,
      ).toBe(label);
    },
  );

  it('normalizes case and whitespace before the lookup', () => {
    expect(
      getPaymentMethodCatalogDetails('Oxxo Pay', PRODUCTION_ASSETS).label,
    ).toBe('Oxxo Pay');
    expect(
      getPaymentMethodCatalogDetails('  SPEI ', PRODUCTION_ASSETS).label,
    ).toBe('SPEI');
  });

  it('serves the store logo for a known method that has no artwork', () => {
    expect(getPaymentMethodCatalogDetails('KASNET', PRODUCTION_ASSETS)).toEqual(
      {
        label: 'KasNet',
        logo: STORE_LOGO,
      },
    );
  });

  it('serves an empty label and the store logo for a method it does not know', () => {
    expect(
      getPaymentMethodCatalogDetails('SOMETHING_NEW', PRODUCTION_ASSETS),
    ).toEqual({
      label: '',
      logo: STORE_LOGO,
    });
  });

  it('hangs the logo off the asset host the environment resolves to', () => {
    // Production keeps serving from the legacy CloudFront distribution for
    // merchants running pinned copies of this SDK; every other mode moves.
    expect(
      getPaymentMethodCatalogDetails('OXXOPAY', PRODUCTION_ASSETS).logo,
    ).toBe(`${PRODUCTION_ASSETS}/payment_methods/oxxopay.png`);
    expect(getPaymentMethodCatalogDetails('OXXOPAY', SANDBOX_ASSETS).logo).toBe(
      `${SANDBOX_ASSETS}/payment_methods/oxxopay.png`,
    );
  });
});
