import { test, expect } from '../support/fixtures';
import { skipIfNoStageCreds } from '../support/skip';
import { env } from '../support/env';

// Slice 4 — Card-on-File lifecycle. @full: enrolls a real card, charges a saved
// card, then removes it. Ordered (serial): each step depends on the previous.
// Requires a secure-token endpoint (TONDER_STAGE_SECURE_TOKEN_ENDPOINT).
const EXP_MONTH = '12';
const EXP_YEAR = '30';
const CVV = '123';

test.describe.serial('@full COF lifecycle', () => {
  // Shared across the ordered steps; afterAll uses it for best-effort cleanup.
  let enrolledCardId: string | null = null;
  let customer: { name: string; email: string };

  test.beforeEach(() => {
    skipIfNoStageCreds();
  });

  test.beforeAll(() => {
    customer = { name: 'Ada Lovelace', email: 'ada@e2e.test' };
  });

  test('getCustomerCards resolves with configured session customer', async ({
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

  test('enrollCard', async ({ tonder }) => {
    await tonder.initInstance({
      withSecureToken: true,
      customer: {
        email: env.customerEmail(),
        first_name: 'E2E',
        last_name: 'Test',
      },
    });
    await tonder.mountAllCardFields();
    await tonder.fillCardFields({
      name: customer.name,
      pan: env.panFrictionless(),
      month: EXP_MONTH,
      year: EXP_YEAR,
      cvv: CVV,
    });

    const result = await tonder.eval((t) => t.enrollCard());
    expect(typeof result.card_id).toBe('string');
    enrolledCardId = result.card_id as string;
  });

  test('getCustomerCards includes the enrolled card', async ({ tonder }) => {
    test.skip(enrolledCardId === null, 'enrollCard did not produce a card id');
    await tonder.initInstance({
      withSecureToken: true,
      customer: { email: env.customerEmail() },
    });
    const cards = await tonder.eval((t) => t.getCustomerCards());
    const ids = cards.map((c) => c.card_id as string);
    expect(ids).toContain(enrolledCardId);
  });

  test('pay with the saved card', async ({ tonder }) => {
    test.skip(enrolledCardId === null, 'no enrolled card to charge');
    // Customer is session-only now — set it once on config.session, not on pay().
    await tonder.initInstance({
      withSecureToken: true,
      customer: {
        email: env.customerEmail(),
        first_name: customer.name.split(' ')[0],
        last_name: customer.name.split(' ').slice(1).join(' '),
      },
    });
    const result = await tonder.eval(
      async (t, card_id) =>
        t.pay({
          amount: 10,
          return_url: window.location.href,
          payment_method: { type: 'saved_card', card_id },
        }),
      enrolledCardId as string,
    );
    expect(['success', 'requires_action']).toContain(result.status as string);
  });

  test('removeCustomerCard', async ({ tonder }) => {
    test.skip(enrolledCardId === null, 'no enrolled card to remove');
    await tonder.initInstance({
      withSecureToken: true,
      customer: { email: env.customerEmail() },
    });
    const remainingIds = await tonder.eval(async (t, card_id) => {
      await t.removeCustomerCard(card_id);
      const cards = await t.getCustomerCards();
      return cards.map((c) => c.card_id as string);
    }, enrolledCardId as string);
    expect(remainingIds).not.toContain(enrolledCardId);
    enrolledCardId = null;
  });

  // Best-effort cleanup: if a mid-flow failure left the card enrolled, remove it
  // so reruns start clean. Swallows errors — cleanup must never fail the suite.
  test.afterAll(async ({ browser }) => {
    if (enrolledCardId === null) return;
    try {
      const page = await browser.newPage();
      await page.goto('/checkout.html');
      await page.waitForFunction(() => typeof window.Tonder !== 'undefined');
      await page.exposeFunction('__e2eGetSecureToken', async () => {
        const res = await fetch(env.secure_tokenEndpoint(), { method: 'POST' });
        const data = (await res.json()) as { token?: string };
        return data.token ?? '';
      });
      await page.evaluate(
        async ({ api_key, email, card_id }) => {
          const t = window.Tonder.createTonder({
            api_key,
            environment: 'stage',
            session: {
              secure_token: await (
                window as unknown as {
                  __e2eGetSecureToken: () => Promise<string>;
                }
              ).__e2eGetSecureToken(),
              customer: { email },
            },
          });
          await t.init();
          await t.removeCustomerCard(card_id);
        },
        {
          api_key: env.api_key(),
          email: env.customerEmail(),
          card_id: enrolledCardId,
        },
      );
      await page.close();
    } catch {
      // Cleanup is best-effort.
    }
  });
});
