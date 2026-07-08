import { test, expect } from '../support/fixtures';
import { skipIfNoStageCreds } from '../support/skip';
import { env } from '../support/env';

// Slice 2 — real card pay against STAGE. @full: these complete real charges and
// drive the Skyflow cross-origin iframes via frameLocator (see fillCardFields).
const CUSTOMER = { name: 'Ada Lovelace', email: 'ada@e2e.test' };
// Customer is config-only now: pay() sources it from config.session.customer.
const CUSTOMER_CONFIG = {
  email: 'ada@e2e.test',
  first_name: 'Ada',
  last_name: 'Lovelace',
};
const EXP_MONTH = '12';
const EXP_YEAR = '30';
const CVV = '123';

test.describe.serial('@full card pay', () => {
  // Shared across the success -> reveal chain so reveal reuses the collected card.
  let successTxId: string | null = null;

  test.beforeEach(() => {
    skipIfNoStageCreds();
  });

  test('pay card success (frictionless)', async ({ tonder }) => {
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: CUSTOMER.name,
      pan: env.panFrictionless(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });

    const result = await tonder.eval((t) =>
      t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'card' },
      }),
    );

    expect(result.status).toBe('success');
    const transaction = result.transaction as { id: string } | undefined;
    expect(typeof transaction?.id).toBe('string');
    successTxId = transaction?.id ?? null;
  });

  test('pay card declined', async ({ tonder }) => {
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: CUSTOMER.name,
      pan: env.panDecline(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });

    const result = await tonder.eval((t) =>
      t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'card' },
      }),
    );

    expect(result.status).toBe('declined');
    expect(result.decline_code).toBeDefined();
    expect(result.decline_reason).toBeDefined();
    expect('declineCode' in result).toBe(false);
    expect('declineReason' in result).toBe(false);
  });

  test('component.reveal() after a collect', async ({ tonder }) => {
    test.skip(
      successTxId === null,
      'no successful collect available — reveal depends on the success test',
    );
    await tonder.initInstance({ customer: CUSTOMER_CONFIG });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: CUSTOMER.name,
      pan: env.panFrictionless(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });
    // Collect once so the tokenizer holds tokens to reveal.
    await tonder.eval((t) =>
      t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'card' },
      }),
    );

    // Reveal via the card-fields component handle (replaces revealCardFields).
    await tonder.eval(async () => {
      const component = (
        window as unknown as {
          __card_fields?: { reveal(req: unknown): Promise<void> };
        }
      ).__card_fields;
      await component?.reveal({ fields: ['card_number', 'cardholder_name'] });
    });

    await expect(
      tonder.rawPage.locator('#reveal-card-number iframe'),
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      tonder.rawPage.locator('#reveal-cardholder-name iframe'),
    ).toBeAttached({ timeout: 15_000 });
  });
});
