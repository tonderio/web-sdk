import { test, expect } from '../support/fixtures';
import { skipIfNoStageCreds, skipIfMissing } from '../support/skip';
import { env, ENV_KEYS } from '../support/env';

// Slice 1 — harness smoke. Validates the scaffold + SDK init against STAGE
// without any real charge. Every test self-skips without credentials.
test.describe('@smoke smoke', () => {
  test.beforeEach(() => {
    skipIfNoStageCreds();
  });

  test('init resolves successfully', async ({ tonder }) => {
    await expect(tonder.initInstance()).resolves.toBeUndefined();
  });

  test('create("card_fields").mount() renders Skyflow iframes', async ({
    tonder,
  }) => {
    await tonder.initInstance();
    await tonder.mountAllCardFields();
    for (const selector of [
      '#collect-cardholder-name',
      '#collect-card-number',
      '#collect-expiration-month',
      '#collect-expiration-year',
      '#collect-cvv',
    ]) {
      await expect(tonder.rawPage.locator(`${selector} iframe`)).toBeAttached();
    }
  });

  test('component.unmount() removes the iframes', async ({ tonder }) => {
    await tonder.initInstance();
    await tonder.mountAllCardFields();
    await tonder.eval(() => {
      const component = (
        window as unknown as {
          __card_fields?: { unmount(): void };
        }
      ).__card_fields;
      component?.unmount();
    });
    await expect(
      tonder.rawPage.locator('#collect-card-number iframe'),
    ).not.toBeAttached();
  });

  test('getPaymentMethods returns the catalog', async ({ tonder }) => {
    await tonder.createInstance();
    const methods = await tonder.eval((t) => t.getPaymentMethods());
    expect(Array.isArray(methods)).toBe(true);
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) {
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('payment_method');
      expect(m).toHaveProperty('label');
      expect(m).toHaveProperty('logo');
      expect(m).toHaveProperty('category');
    }
  });

  test('getPaymentMethodBanks returns cash and transfer arrays', async ({
    tonder,
  }) => {
    await tonder.createInstance();
    const banks = await tonder.eval((t) => t.getPaymentMethodBanks());
    expect(Array.isArray(banks.cash)).toBe(true);
    expect(Array.isArray(banks.transfer)).toBe(true);
    expect(banks.cash.length + banks.transfer.length).toBeGreaterThan(0);
  });

  test('getCustomerCards uses the configured session customer', async ({
    tonder,
  }) => {
    await tonder.initInstance({
      withSecureToken: true,
      customer: {
        email: env.customerEmail(),
        first_name: 'E2E',
        last_name: 'Test',
      },
    });
    const cards = await tonder.eval((t) => t.getCustomerCards());
    expect(Array.isArray(cards)).toBe(true);
  });

  test('getTransaction reads a known transaction', async ({ tonder }) => {
    skipIfMissing(
      ENV_KEYS.existingTxId,
      `${ENV_KEYS.existingTxId} not set — skipping getTransaction smoke`,
    );
    const id = env.existingTxId() as string;
    await tonder.createInstance();
    const tx = await tonder.eval((t, txId) => t.getTransaction(txId), id);
    expect(tx.id).toBe(id);
  });
});

// Skyflow iframe-fill SPIKE: a go/no-go probe for Slice 2. It NEVER fails the
// suite — it logs whether `.fill()` works on the cross-origin Skyflow input and
// skips itself either way, so the result is an observable data point only.
test.describe('@spike skyflow', () => {
  test('skyflow iframe fill probe', async ({ tonder }) => {
    skipIfNoStageCreds();
    await tonder.initInstance();
    await tonder.mountAllCardFields();
    let filled = false;
    try {
      // Sourced from env (no hardcoded PANs). If the var is unset this throws
      // and is caught below as "fill not viable" — the spike still self-skips.
      const pan = env.panFrictionless();
      const input = tonder.rawPage
        .frameLocator('#collect-card-number iframe')
        .locator('input')
        .first();
      await input.fill(pan, { timeout: 10_000 });
      filled = true;
    } catch (error) {
      console.log('[spike] Skyflow .fill() threw:', (error as Error).message);
    }
    console.log(`[spike] Skyflow iframe .fill() viable: ${filled}`);
    test.skip(true, `spike result recorded (fill viable: ${filled})`);
  });
});
