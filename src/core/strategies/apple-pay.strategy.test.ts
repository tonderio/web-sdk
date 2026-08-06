/**
 * Pure builders and the resolvers they consume — NO MOCKS anywhere in this file.
 * The resolvers are the real functions called against real `apple_pay` fixtures,
 * because "capabilities and networks come from the resolvers, not a
 * re-derivation" is the property under test; stubbing them would assert nothing.
 */
import { describe, it, expect } from 'vitest';
import {
  buildApplePayPaymentMethod,
  buildApplePayPaymentRequest,
  resolveApplePayMerchantCapabilities,
  resolveApplePayNetworks,
  DEFAULT_APPLE_PAY_NETWORKS,
} from './apple-pay.strategy';
import type { BuildApplePayPaymentRequestInput } from './apple-pay.strategy';
import type { ApplePayConfig } from '../../models/business.model';
import type { ApplePayPaymentToken } from '../../ports/apple-pay.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';

function applePay(overrides: Partial<ApplePayConfig> = {}): ApplePayConfig {
  return { enabled: true, ...overrides };
}

function input(
  overrides: Partial<BuildApplePayPaymentRequestInput> = {},
): BuildApplePayPaymentRequestInput {
  return {
    amount: 10,
    currencyCode: 'MXN',
    countryCode: 'MX',
    merchantName: 'Ada Store',
    applePay: applePay({ supported_networks: ['visa', 'masterCard'] }),
    ...overrides,
  };
}

/** The code every rejected amount must carry. */
function expectInvalidPaymentRequest(build: () => unknown): void {
  expect(build).toThrow(AppError);
  expect(build).toThrow(
    expect.objectContaining({ code: ErrorKeyEnum.INVALID_PAYMENT_REQUEST }),
  );
}

function token(): ApplePayPaymentToken {
  // Apple's ambient type declares `paymentMethod.paymentPass` as required, and
  // building one here would add a large fixture the SDK never touches: the
  // token is forwarded to the backend BY REFERENCE and `paymentMethod` is
  // never read. The cast keeps the fixture to what the code under test uses.
  return {
    paymentData: { version: 'EC_v1', data: 'opaque' },
    paymentMethod: { displayName: 'Visa 1234', network: 'Visa', type: 'debit' },
    transactionIdentifier: 'txn_1',
  } as unknown as ApplePayPaymentToken;
}

describe('buildApplePayPaymentMethod', () => {
  it('returns the APPLE_PAY wire block', () => {
    expect(buildApplePayPaymentMethod(token())).toEqual({
      type: 'APPLE_PAY',
      token: token(),
    });
  });

  it('passes the token through BY REFERENCE, never cloned or stringified', () => {
    // The SDK is a courier: `/process` decides which parts of the PKPaymentToken
    // it needs, so the whole object must arrive untouched.
    const source = token();
    expect(buildApplePayPaymentMethod(source).token).toBe(source);
  });
});

describe('buildApplePayPaymentRequest', () => {
  describe('total.amount', () => {
    it('serializes a whole amount as a two-decimal string', () => {
      expect(
        buildApplePayPaymentRequest(input({ amount: 10 })).total.amount,
      ).toBe('10.00');
    });

    it('serializes a one-decimal amount as a two-decimal string', () => {
      expect(
        buildApplePayPaymentRequest(input({ amount: 10.5 })).total.amount,
      ).toBe('10.50');
    });
  });

  describe('rejected amounts', () => {
    // These throw BEFORE any `ApplePaySession` type is touched: this module
    // imports no global and no Apple class, only erased types. Letting a zero
    // total reach Apple's constructor would surface as APPLE_PAY_SESSION_ERROR
    // — "the session failed" when the truth is "your amount is zero".
    it.each([
      ['zero', 0],
      ['negative', -5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects a %s total with INVALID_PAYMENT_REQUEST', (_label, amount) => {
      expectInvalidPaymentRequest(() =>
        buildApplePayPaymentRequest(input({ amount })),
      );
    });

    // ROUNDING. `total.amount` is `toFixed(2)` while `/process` carries the raw
    // number, so `10.005` would show '10.01' on the sheet and charge 10.005:
    // the shopper authorizes one price with Face ID and is charged another.
    // Refusing to build is the only option that neither lies nor alters.
    //
    // CURRENCY ASSUMPTION: `toFixed(2)` presumes a two-decimal minor unit. JPY
    // has ZERO minor units and KWD has THREE — for those, both this check and
    // the string it guards are wrong. Holds today because DEFAULT_CURRENCY is
    // MXN. Whoever adds a zero- or three-decimal currency must revisit this
    // function, not just the currency list.
    it('rejects an amount toFixed(2) would round', () => {
      expectInvalidPaymentRequest(() =>
        buildApplePayPaymentRequest(input({ amount: 10.005 })),
      );
    });

    it.each([10.5, 10])(
      'accepts %p, exactly representable in two decimals',
      (amount) => {
        expect(() =>
          buildApplePayPaymentRequest(input({ amount })),
        ).not.toThrow();
      },
    );
  });

  describe('capabilities and networks are derived from the apple_pay block', () => {
    // ASSERTED AGAINST LITERAL VALUES, NOT AGAINST THE RESOLVERS.
    //
    // The previous version of this suite asserted
    // `expect(request.merchantCapabilities).toEqual(
    //    resolveApplePayMerchantCapabilities(block))`
    // while the builder calls that exact function — `f(x) === f(x)`, green for
    // ANY resolver behavior, correct or garbage. It proved wiring and nothing
    // else. Literals are what make a wrong resolver output fail HERE.
    //
    // Do not "simplify" these back to a resolver call.
    const cases: ReadonlyArray<
      [string, ApplePayConfig | undefined, string[], string[]]
    > = [
      [
        'both card types and explicit networks',
        applePay({
          supported_networks: ['visa', 'amex'],
          supports_debit: true,
          supports_credit: true,
        }),
        ['supports3DS', 'supportsDebit', 'supportsCredit'],
        ['visa', 'amex'],
      ],
      [
        'debit only',
        applePay({ supported_networks: ['visa'], supports_debit: true }),
        ['supports3DS', 'supportsDebit'],
        ['visa'],
      ],
      [
        'credit only, no networks configured',
        applePay({ supports_credit: true }),
        ['supports3DS', 'supportsCredit'],
        ['visa', 'masterCard'],
      ],
      [
        'empty networks array',
        applePay({ supported_networks: [] }),
        ['supports3DS'],
        ['visa', 'masterCard'],
      ],
      ['absent block', undefined, ['supports3DS'], ['visa', 'masterCard']],
    ];

    it.each(cases)(
      'builds the literal capabilities and networks — %s',
      (_label, block, expectedCapabilities, expectedNetworks) => {
        const request = buildApplePayPaymentRequest(input({ applePay: block }));

        expect(request.merchantCapabilities).toEqual(expectedCapabilities);
        expect(request.supportedNetworks).toEqual(expectedNetworks);
      },
    );

    // The ONE wiring-only test: the builder must not re-derive its own values.
    // Kept deliberately singular — the literal cases above own the derivation.
    it('does not re-derive: the built request equals the resolver output', () => {
      const block = applePay({
        supported_networks: ['discover'],
        supports_debit: true,
      });
      const request = buildApplePayPaymentRequest(input({ applePay: block }));

      expect(request.merchantCapabilities).toEqual(
        resolveApplePayMerchantCapabilities(block),
      );
      expect(request.supportedNetworks).toEqual(resolveApplePayNetworks(block));
    });

    it('assembles the WHOLE request, so a field added by mistake is caught', () => {
      // `toEqual` over the whole object, never `objectContaining`: an extra key
      // silently introduced by a refactor would pass a partial match.
      expect(
        buildApplePayPaymentRequest(
          input({
            amount: 42.5,
            applePay: applePay({
              supported_networks: ['visa'],
              supports_debit: true,
            }),
          }),
        ),
      ).toEqual({
        countryCode: 'MX',
        currencyCode: 'MXN',
        supportedNetworks: ['visa'],
        merchantCapabilities: ['supports3DS', 'supportsDebit'],
        total: { label: 'Ada Store', amount: '42.50', type: 'final' },
      });
    });
  });

  describe('fields sourced from the caller', () => {
    it('takes countryCode from the input and the sheet label from merchantName', () => {
      const request = buildApplePayPaymentRequest(
        input({ countryCode: 'MX', merchantName: 'Ada Store' }),
      );

      expect(request.countryCode).toBe('MX');
      expect(request.total.label).toBe('Ada Store');
    });

    it('takes currencyCode from the input, already resolved by the caller', () => {
      expect(
        buildApplePayPaymentRequest(input({ currencyCode: 'USD' }))
          .currencyCode,
      ).toBe('USD');
    });

    it('marks the total as final', () => {
      expect(buildApplePayPaymentRequest(input()).total.type).toBe('final');
    });
  });
});

describe('resolveApplePayNetworks', () => {
  it('passes the configured networks through in order', () => {
    expect(
      resolveApplePayNetworks(
        applePay({ supported_networks: ['visa', 'amex', 'discover'] }),
      ),
    ).toEqual(['visa', 'amex', 'discover']);
  });

  it('does NOT deduplicate — one array from one source is taken at its word', () => {
    // The old dedup existed because the value was a union across several
    // catalog entries, where a repeat was legitimate. With a single field,
    // deduplicating would be the SDK guessing the backend contradicts itself.
    expect(
      resolveApplePayNetworks(
        applePay({ supported_networks: ['visa', 'visa'] }),
      ),
    ).toEqual(['visa', 'visa']);
  });

  it('does NOT normalize case — Apple network tokens are case-sensitive', () => {
    // `masterCard` is Apple's spelling; lowercasing would corrupt a valid token.
    expect(
      resolveApplePayNetworks(
        applePay({ supported_networks: ['masterCard', 'Visa'] }),
      ),
    ).toEqual(['masterCard', 'Visa']);
  });

  it('falls back to the SDK default when the field is absent', () => {
    expect(resolveApplePayNetworks(applePay())).toEqual(['visa', 'masterCard']);
  });

  it('falls back to the SDK default for an empty array', () => {
    expect(
      resolveApplePayNetworks(applePay({ supported_networks: [] })),
    ).toEqual(['visa', 'masterCard']);
  });

  it('falls back to the SDK default for an absent block', () => {
    expect(resolveApplePayNetworks(undefined)).toEqual(['visa', 'masterCard']);
  });

  it('returns a FRESH array so a caller cannot mutate the shared constant', () => {
    const first = resolveApplePayNetworks(undefined);
    first.push('mutated');

    expect(resolveApplePayNetworks(undefined)).toEqual(['visa', 'masterCard']);
    expect([...DEFAULT_APPLE_PAY_NETWORKS]).toEqual(['visa', 'masterCard']);
  });

  it('COPIES the configured array, never handing back a live reference', () => {
    // Returning by reference would hand the caller a handle into the cached
    // BusinessConfig; one `.push()` would mutate every later payment request.
    const block = applePay({ supported_networks: ['visa'] });
    const resolved = resolveApplePayNetworks(block);
    resolved.push('amex');

    expect(block.supported_networks).toEqual(['visa']);
  });
});

describe('resolveApplePayMerchantCapabilities', () => {
  it('both card types declared', () => {
    expect(
      resolveApplePayMerchantCapabilities(
        applePay({ supports_debit: true, supports_credit: true }),
      ),
    ).toEqual(['supports3DS', 'supportsDebit', 'supportsCredit']);
  });

  it('debit only', () => {
    expect(
      resolveApplePayMerchantCapabilities(applePay({ supports_debit: true })),
    ).toEqual(['supports3DS', 'supportsDebit']);
  });

  it('credit only', () => {
    expect(
      resolveApplePayMerchantCapabilities(applePay({ supports_credit: true })),
    ).toEqual(['supports3DS', 'supportsCredit']);
  });

  it('absent card-type flags mean DO NOT FILTER, not "not supported"', () => {
    // The inverse of the catalog behavior, and intentional (DD8): the field
    // names are unconfirmed, so absence means "unknown", not "unavailable".
    // `['supports3DS']` alone tells Apple to filter by NEITHER card type, which
    // is the permissive degradation. This looks like lost functionality in the
    // diff and is not.
    expect(resolveApplePayMerchantCapabilities(applePay())).toEqual([
      'supports3DS',
    ]);
    expect(resolveApplePayMerchantCapabilities(undefined)).toEqual([
      'supports3DS',
    ]);
  });

  it('treats an explicit false the same as an absent flag', () => {
    expect(
      resolveApplePayMerchantCapabilities(
        applePay({ supports_debit: false, supports_credit: false }),
      ),
    ).toEqual(['supports3DS']);
  });

  it('order is fixed: debit before credit, regardless of declaration', () => {
    expect(
      resolveApplePayMerchantCapabilities(
        applePay({ supports_credit: true, supports_debit: true }),
      ),
    ).toEqual(['supports3DS', 'supportsDebit', 'supportsCredit']);
  });

  it('supports3DS is present in every case', () => {
    const blocks: ReadonlyArray<ApplePayConfig | undefined> = [
      undefined,
      applePay(),
      applePay({ supports_debit: true }),
      applePay({ supports_credit: true }),
      applePay({ supports_debit: true, supports_credit: true }),
    ];

    for (const block of blocks) {
      // Exact equality is used above; this one asserts the invariant across all
      // shapes, which is the only thing `toContain` is right for here.
      expect(resolveApplePayMerchantCapabilities(block)).toContain(
        'supports3DS',
      );
    }
  });
});
