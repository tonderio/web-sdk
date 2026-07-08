import { test, expect } from '../support/fixtures';
import { skipIfNoStageCreds } from '../support/skip';

// Slice 5 — alternative payment methods. @smoke: no real charge ever completes
// (APMs settle async via webhook, out of band), so we assert the PENDING shape
// only — never a final settled status.
// Customer is config-only now — sourced from config.session.customer, never the pay input.
const CUSTOMER_CONFIG = {
  email: 'ada@e2e.test',
  first_name: 'Ada',
  last_name: 'Lovelace',
};

test.describe('@smoke apms', () => {
  test.beforeEach(() => {
    skipIfNoStageCreds();
  });

  test('pay oxxopay returns pending with payment_instructions', async ({
    tonder,
  }) => {
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });
    const result = await tonder.eval((t) =>
      t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'oxxopay' },
      }),
    );
    expect(result.status).toBe('pending');
    const transaction = result.transaction as { id: string } | undefined;
    expect(typeof transaction?.id).toBe('string');
    expect(result.payment_instructions).toBeTruthy();
    expect('paymentInstructions' in result).toBe(false);
  });

  test('pay spei returns pending with clabe and bank_name', async ({
    tonder,
  }) => {
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });
    const result = await tonder.eval((t) =>
      t.pay({
        amount: 100,
        payment_method: { type: 'spei' },
      }),
    );
    expect(result.status).toBe('pending');
    expect(typeof result.clabe).toBe('string');
    expect((result.clabe as string).length).toBeGreaterThanOrEqual(18);
    expect(typeof result.bank_name).toBe('string');
    expect((result.bank_name as string).length).toBeGreaterThan(0);
    expect('bankName' in result).toBe(false);
  });

  test('pay safetypaycash returns pending with a redirect url', async ({
    tonder,
  }) => {
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });

    // SafetyPay cash requires a valid bank id from the payment method bank catalog.
    const banks = await tonder.eval((t) => t.getPaymentMethodBanks());
    test.skip(
      banks.cash.length === 0,
      'no SafetyPay cash banks available on stage',
    );
    const firstBank = banks.cash[0] as { id: number };
    const bankId = firstBank.id;

    // bank id must cross the evaluate boundary as an argument — the eval() helper
    // serializes the callback source and cannot capture closures, so this uses
    // page.evaluate directly with explicit args.
    const result = await tonder.rawPage.evaluate(
      async ({ bankId }) => {
        const t = window.__tonderBridge.instance;
        if (!t) throw new Error('no instance');
        return t.pay({
          amount: 10,
          return_url: window.location.href,
          payment_method: {
            type: 'safetypaycash',
            config: { country: 'MX', channel: 'cash', bank_ids: [bankId] },
          },
        });
      },
      { bankId },
    );
    expect(result.status).toBe('pending');
    const next_action = result.next_action as
      | { url?: string; redirect_to_url?: { url?: string } }
      | undefined;
    const redirectUrl = next_action?.redirect_to_url?.url ?? next_action?.url;
    expect(typeof redirectUrl).toBe('string');
    expect((redirectUrl as string).length).toBeGreaterThan(0);
    expect('nextAction' in result).toBe(false);
  });
});
