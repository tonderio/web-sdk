import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ApplePayPaymentInput,
  ApplePayButtonOptions,
  ApplePayButtonComponent,
} from './apple-pay';
import type { PayInput } from '../shared/types';
import type { TonderMountableComponent } from './component';

/**
 * Shape documentation for the declared-only Apple Pay surface.
 *
 * IMPORTANT: `tsconfig.json` excludes `**\/*.test.ts` and `npm run test` runs
 * vitest without `--typecheck`, so every `expectTypeOf` and `@ts-expect-error`
 * below is erased and never verified. A green run does NOT prove any type claim
 * here. These assertions record intent; the compiler-enforced gate is
 * `npm run typecheck` over the non-test sources.
 */

function applePayPaymentInput(): ApplePayPaymentInput {
  return {
    amount: 100,
    currency: 'MXN',
    return_url: 'https://merchant.example/return',
    client_reference: 'order-1',
  };
}

describe('ApplePayPaymentInput', () => {
  it('is PayInput without payment_method — the component implies the method', () => {
    const input = applePayPaymentInput();

    expect(Object.keys(input)).not.toContain('payment_method');
    expectTypeOf<ApplePayPaymentInput>().toEqualTypeOf<
      Omit<PayInput, 'payment_method'>
    >();
  });

  it('rejects payment_method', () => {
    const input: ApplePayPaymentInput = {
      ...applePayPaymentInput(),
      // @ts-expect-error — payment_method is omitted; the component implies it.
      payment_method: { type: 'card' },
    };
    void input;
  });

  it('inherits every other PayInput field, including optional ones, with no edit to apple-pay.ts', () => {
    // Derived via Omit, so a field added to PayInput (other than payment_method)
    // appears here automatically. These are PayInput fields, never redeclared.
    const input: ApplePayPaymentInput = {
      ...applePayPaymentInput(),
      metadata: { order_id: 'abc' },
      billing_address: { street: 'Reforma 1' },
      idempotency_key: 'idem-1',
    };

    expect(input.idempotency_key).toBe('idem-1');
    expectTypeOf<ApplePayPaymentInput['metadata']>().toEqualTypeOf<
      PayInput['metadata']
    >();
    expectTypeOf<ApplePayPaymentInput['billing_address']>().toEqualTypeOf<
      PayInput['billing_address']
    >();
  });
});

describe('ApplePayButtonOptions', () => {
  it('accepts payment as a fixed object', () => {
    const options: ApplePayButtonOptions = {
      container_id: '#checkout-apple-pay',
      payment: applePayPaymentInput(),
    };

    expect(typeof options.payment).toBe('object');
  });

  it('accepts payment as a zero-arg function for carts that change after mount', () => {
    const options: ApplePayButtonOptions = {
      payment: () => applePayPaymentInput(),
    };

    expect(typeof options.payment).toBe('function');
    expect(
      typeof options.payment === 'function'
        ? options.payment()
        : options.payment,
    ).toEqual(applePayPaymentInput());
  });

  it('leaves container_id optional so the default container can apply', () => {
    const options: ApplePayButtonOptions = { payment: applePayPaymentInput() };

    expect(options.container_id).toBeUndefined();
  });
});

describe('ApplePayButtonComponent', () => {
  it('extends TonderMountableComponent and adds nothing of its own', () => {
    const component: ApplePayButtonComponent = {
      mount: () => Promise.resolve(),
      unmount: () => undefined,
    };
    const mountable: TonderMountableComponent = component;

    expect(typeof mountable.mount).toBe('function');
    expectTypeOf<ApplePayButtonComponent>().toEqualTypeOf<TonderMountableComponent>();
  });
});
