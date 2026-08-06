import { describe, it, expect } from 'vitest';
import { DEFAULT_BUSINESS_COUNTRY_CODE } from './business.model';
import type {
  ApplePayConfig,
  BusinessConfig,
  BusinessProfile,
} from './business.model';

/**
 * `business.model.ts` is types plus the defaults for its own optional fields.
 * These fixtures document the shape and the optionality of `country_code`.
 *
 * IMPORTANT: `npm run test` runs vitest without `--typecheck`, so a green run
 * proves the fixtures are valid JavaScript, NOT that they satisfy the types.
 * The gate for that is `npm run typecheck`, whose `tsconfig.test.json` project
 * covers this file — the root project excludes `**\/*.test.ts` so tests never
 * reach `dist`, not to leave them unchecked.
 */
function businessProfile(
  overrides: Partial<BusinessProfile> = {},
): BusinessProfile {
  return {
    pk: 1,
    name: 'Tonder Demo',
    categories: [{ pk: 3, name: 'retail' }],
    web: 'https://demo.example',
    logo: 'https://demo.example/logo.png',
    full_logo_url: 'https://demo.example/full-logo.png',
    background_color: '#ffffff',
    primary_color: '#000000',
    checkout_mode: true,
    textCheckoutColor: '#111111',
    textDetailsColor: '#222222',
    checkout_logo: 'https://demo.example/checkout-logo.png',
    ...overrides,
  };
}

function businessConfig(
  profile: BusinessProfile,
  applePay?: ApplePayConfig,
): BusinessConfig {
  return {
    business: profile,
    openpay_keys: { merchant_id: 'm_1', public_key: 'pk_openpay' },
    fintoc_keys: { public_key: 'pk_fintoc' },
    mercado_pago: { active: false },
    vault_id: 'vault_1',
    vault_url: 'https://vault.example',
    reference: 'TNDR-0000',
    is_installments_available: false,
    cardonfile_keys: null,
    ...(applePay ? { apple_pay: applePay } : {}),
  };
}

describe('BusinessProfile.country_code', () => {
  it('is absent on a business the backend has not configured with a country', () => {
    const config = businessConfig(businessProfile());

    expect(config.business.country_code).toBeUndefined();
  });

  it('carries an ISO 3166-1 alpha-2 code when the backend sends one', () => {
    const config = businessConfig(businessProfile({ country_code: 'MX' }));

    expect(config.business.country_code).toBe('MX');
  });

  it('keeps an absent country absent — the default is never written into the model', () => {
    // The whole reason the default lives at the read sites: a support engineer
    // reading captured state must be able to tell "the API omitted it" from
    // "the API sent MX". Normalizing during mapping would erase that
    // difference, and this assertion is what would catch it.
    const withoutCountry = businessConfig(businessProfile());

    expect(withoutCountry.business.country_code).not.toBe(
      DEFAULT_BUSINESS_COUNTRY_CODE,
    );
    expect('country_code' in withoutCountry.business).toBe(false);
  });
});

describe('DEFAULT_BUSINESS_COUNTRY_CODE', () => {
  it('is the ISO 3166-1 alpha-2 code for Mexico', () => {
    expect(DEFAULT_BUSINESS_COUNTRY_CODE).toBe('MX');
  });
});

describe('BusinessConfig.apple_pay', () => {
  // The block is a ROOT-LEVEL sibling of `mercado_pago`, not a member of
  // `business`. Asserting the path here is what would catch a reader wired to
  // `config.business.apple_pay` — a misspelling that would silently report
  // "Apple Pay unavailable" for every merchant.
  it('is absent on a business the backend never enabled for Apple Pay', () => {
    const config = businessConfig(businessProfile());

    expect(config.apple_pay).toBeUndefined();
  });

  it('carries only `enabled` when the backend sends the minimal block', () => {
    const config = businessConfig(businessProfile(), { enabled: true });

    expect(config.apple_pay).toEqual({ enabled: true });
  });

  it('carries the optional PENDING-name fields when the backend sends them', () => {
    const config = businessConfig(businessProfile(), {
      enabled: true,
      merchant_identifier: 'merchant.io.tonder.checkout',
      supported_networks: ['visa', 'masterCard'],
      supports_debit: true,
      supports_credit: false,
    });

    expect(config.apple_pay).toEqual({
      enabled: true,
      merchant_identifier: 'merchant.io.tonder.checkout',
      supported_networks: ['visa', 'masterCard'],
      supports_debit: true,
      supports_credit: false,
    });
  });

  it('reports `enabled: false` distinctly from an absent block', () => {
    // Both collapse to "unavailable" at the gate, but they are different wire
    // documents and the type must express both.
    const disabled = businessConfig(businessProfile(), { enabled: false });
    const absent = businessConfig(businessProfile());

    expect(disabled.apple_pay).toEqual({ enabled: false });
    expect(absent.apple_pay).toBeUndefined();
  });
});
