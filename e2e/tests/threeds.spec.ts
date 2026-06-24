import { test, expect } from '../support/fixtures';
import { skipIfNoStageCreds } from '../support/skip';
import { env } from '../support/env';

// Slice 3 — 3DS. @full: real charges with a 3DS-triggering test PAN. Only
// frictionless test PANs are used (no real ACS OTP entry is automated).
const CUSTOMER = { name: 'Ada Lovelace', email: 'ada@e2e.test' };
// Customer is config-only now — sourced from config.session.customer.
const CUSTOMER_CONFIG = {
  email: 'ada@e2e.test',
  first_name: 'Ada',
  last_name: 'Lovelace',
};
const EXP_MONTH = '12';
const EXP_YEAR = '30';
const CVV = '123';

test.describe('@full 3ds', () => {
  test.beforeEach(() => {
    skipIfNoStageCreds();
  });

  test('3DS redirect (frictionless)', async ({ tonder }) => {
    const page = tonder.rawPage;
    await tonder.initInstance({
      presentation_mode: 'redirect',
      customer: CUSTOMER_CONFIG,
    });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: CUSTOMER.name,
      pan: env.panThreeDsChallenge(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });

    // Register the redirect wait BEFORE pay() triggers navigation, otherwise the
    // navigation can race ahead of the listener.
    const redirectToPayflow = page.waitForURL('**/stage-payflow.tonder.io/**', {
      timeout: 30_000,
    });

    // pay() navigates the top frame in redirect mode; it never resolves here
    // because the page is torn down. Fire-and-forget, then await the navigation.
    await page.evaluate(() => {
      const t = window.__tonderBridge.instance;
      if (!t) throw new Error('no instance');
      void t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'card' },
      });
    });

    await redirectToPayflow;

    // Frictionless: payflow auto-completes and returns to the fixture return_url
    // carrying a transaction id, which the merchant reads with getTransaction.
    await page.waitForURL(/\/checkout\.html.*txId=/, { timeout: 60_000 });
    const txId = new URL(page.url()).searchParams.get('txId');
    expect(txId).toBeTruthy();

    // The redirect tore down the original instance. getTransaction needs only
    // the api_key (no init/ready guard), so build a fresh instance on the
    // returned page and read the transaction by id.
    await page.waitForFunction(() => typeof window.Tonder !== 'undefined');
    const tx = await page.evaluate(
      async ({ id, api_key }) => {
        const t = window.Tonder.createTonder({
          api_key,
          environment: 'stage',
        });
        return t.getTransaction(id);
      },
      { id: txId as string, api_key: env.api_key() },
    );
    expect(['success', 'requires_action']).toContain(tx.status as string);
  });

  // Embedded 3DS depends on the DEV-2245 `embedded_completion` postMessage path
  // being deployed on stage-payflow. When unconfirmed, fixme: the embedded
  // messenger never fires and the path is unverifiable (the SDK would fall back
  // to a multi-minute poll). Set TONDER_DEVS_2245_ON_STAGE to enable.
  test('3DS embedded', async ({ tonder }) => {
    test.fixme(
      !env.devs2245OnStage(),
      'DEV-2245 not confirmed on stage-payflow — embedded path unverifiable',
    );
    await tonder.initInstance({
      presentation_mode: 'embedded',
      customer: CUSTOMER_CONFIG,
    });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: CUSTOMER.name,
      pan: env.panThreeDsChallenge(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });

    // In embedded mode pay() itself races the messenger and poll internally and
    // resolves with the final result, so we await it directly. While it runs,
    // the SDK-owned modal (host node appended to document.body) must be present.
    const payPromise = tonder.eval((t) =>
      t.pay({
        amount: 10,
        return_url: window.location.href,
        payment_method: { type: 'card' },
      }),
    );

    await tonder.rawPage.waitForSelector('[data-tonder-modal]', {
      timeout: 20_000,
    });

    const result = await payPromise;

    expect(['success', 'declined']).toContain(result.status as string);
  });
});
