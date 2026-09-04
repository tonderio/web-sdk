import { describe, it, expect } from 'vitest';
import { toPublicPaymentMethods } from './payment-method.model';
import type { BackendPaymentMethod } from './payment-method.model';
import { resolveEnv } from '../shared/config/env';

const PRODUCTION_ASSETS = resolveEnv('production').assets;
const SANDBOX_ASSETS = resolveEnv('sandbox').assets;

function method(
  overrides: Partial<BackendPaymentMethod> & { payment_method: string },
): BackendPaymentMethod {
  return {
    pk: 7,
    priority: 10,
    category: 'cash',
    ...overrides,
  };
}

const OXXO = method({
  payment_method: 'oxxopay',
  acquirer: 'safetypay',
  status: 'active',
  unavailable_countries: ['US'],
});

const OXXO_PUBLIC = {
  id: 7,
  payment_method: 'oxxopay',
  label: 'Oxxo Pay',
  logo: `${PRODUCTION_ASSETS}/payment_methods/oxxopay.png`,
  category: 'cash',
};

describe('toPublicPaymentMethods', () => {
  it('projects snake_case backend records into the merchant-facing shape', () => {
    expect(toPublicPaymentMethods([OXXO], PRODUCTION_ASSETS)).toEqual([
      OXXO_PUBLIC,
    ]);
  });

  it('falls back to the code catalog for label and logo when the backend omits them', () => {
    const [projected] = toPublicPaymentMethods(
      [method({ pk: 3, payment_method: 'spei', category: 'transfer' })],
      PRODUCTION_ASSETS,
    );

    expect(projected).toEqual({
      id: 3,
      payment_method: 'spei',
      label: 'SPEI',
      logo: `${PRODUCTION_ASSETS}/payment_methods/spei.png`,
      category: 'transfer',
    });
  });

  it('prefers the backend label and logo over the code catalog', () => {
    const [projected] = toPublicPaymentMethods(
      [
        method({
          payment_method: 'oxxopay',
          label: 'Pagar en tienda',
          logo: 'https://cdn.example/custom.png',
        }),
      ],
      PRODUCTION_ASSETS,
    );

    expect(projected?.label).toBe('Pagar en tienda');
    expect(projected?.logo).toBe('https://cdn.example/custom.png');
  });

  it('drops every apple_pay_* entry — they are not selectable payment methods', () => {
    // Apple Pay needs the button component and the user gesture. A leaked row
    // would be rendered as a generic APM and then charged via pay(), which
    // cannot work. See isApplePayCatalogMethod for why the match is a prefix.
    const result = toPublicPaymentMethods(
      [
        method({ pk: 41, payment_method: 'apple_pay_debit_card' }),
        OXXO,
        method({ pk: 42, payment_method: 'apple_pay_credit_card' }),
      ],
      PRODUCTION_ASSETS,
    );

    expect(result).toEqual([OXXO_PUBLIC]);
    expect(JSON.stringify(result)).not.toContain('apple_pay');
  });

  it('is total over an empty catalog', () => {
    expect(toPublicPaymentMethods([], PRODUCTION_ASSETS)).toEqual([]);
  });

  it('builds the fallback logo from the asset host it is given', () => {
    const [projected] = toPublicPaymentMethods([OXXO], SANDBOX_ASSETS);

    expect(projected?.logo).toBe(
      `${SANDBOX_ASSETS}/payment_methods/oxxopay.png`,
    );
  });
});
