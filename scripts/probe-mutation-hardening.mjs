/**
 * Asserts the instance-integrity guarantees on the SHIPPED bundle, not on the
 * source. Run as `npm run build && node scripts/probe-mutation-hardening.mjs`.
 * Exits 0 when every check holds, 1 on the first failure.
 *
 * It imports `createTonder` from `dist/index.mjs` and stubs `globalThis.fetch`
 * to record every outgoing request. That reaches `init()`, customer
 * registration, and `getCustomerCards()`.
 *
 * Two things this probe deliberately does NOT check, because it cannot:
 *
 *   1. That the config object returned internally is not the merchant's own
 *      object. The instance exposes nothing readable by name — which is itself
 *      one of the guarantees below — so there is no call path to reach it from
 *      out here. That identity check lives in the core's own unit tests, which
 *      hold the object directly.
 *
 *   2. That a late `events` assignment actually FIRES. Payment callbacks are
 *      only reachable through `pay()` or the Apple Pay button, and both need a
 *      DOM plus remotely-loaded tokenizer and acquirer scripts that a bare Node
 *      process cannot provide. This probe only proves the assignment does not
 *      throw. Liveness is proven by the browser-environment unit tests, and
 *      this is a stated gap rather than a silent one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST_ENTRY = join(HERE, '..', 'dist', 'index.mjs');
const DIST_TYPES = join(HERE, '..', 'dist', 'index.d.ts');

const CUSTOMER_A = { email: 'ada@example.com', first_name: 'Ada' };
const CUSTOMER_B = { email: 'mallory@example.com', first_name: 'Mallory' };
const TOKEN_A = 'T1';
const TOKEN_B = 'T2';

const failures = [];

function check(description, condition) {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  console.log(`  FAIL ${description}`);
  failures.push(description);
}

const BUSINESS_CONFIG = {
  business: {
    pk: 7,
    name: 'Acme',
    categories: [],
    web: 'https://acme.test',
    logo: 'logo.png',
    full_logo_url: 'https://acme.test/logo.png',
    background_color: '#fff',
    primary_color: '#000',
    checkout_mode: true,
    textCheckoutColor: '#111',
    textDetailsColor: '#222',
    checkout_logo: 'checkout.png',
  },
  openpay_keys: { merchant_id: 'm1', public_key: 'pk_op' },
  fintoc_keys: { public_key: 'pk_fi' },
  mercado_pago: { active: false },
  vault_id: 'vault-1',
  vault_url: 'https://vault.test',
  reference: 'TNDR-abc',
  is_installments_available: true,
  cardonfile_keys: null,
};

/** Records every request and derives the customer token from the posted email. */
function installFetchStub() {
  const recorded = [];
  globalThis.fetch = (url, init = {}) => {
    const entry = {
      url: String(url),
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    recorded.push(entry);

    let payload = BUSINESS_CONFIG;
    if (entry.url.includes('/api/v1/customer/')) {
      payload = { id: 1, auth_token: `tok_${entry.body.email}` };
    } else if (entry.url.includes('/cards/')) {
      payload = { user_id: 'u_1', cards: [] };
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
    });
  };
  return recorded;
}

async function main() {
  const { createTonder } = await import(DIST_ENTRY);
  const recorded = installFetchStub();

  const config = {
    api_key: 'pk_test_123',
    environment: 'sandbox',
    session: { customer: { ...CUSTOMER_A }, secure_token: TOKEN_A },
  };

  console.log('Instance surface');
  const tonder = createTonder(config);
  check('Object.keys(tonder) is empty', Object.keys(tonder).length === 0);
  check('JSON.stringify(tonder) is {}', JSON.stringify(tonder) === '{}');
  check(
    'the API key does not appear in the serialized instance',
    !JSON.stringify(tonder).includes('pk_test_123'),
  );
  check('tonder.core is undefined', tonder.core === undefined);
  check('tonder.http is undefined', tonder.http === undefined);
  check(
    'tonder.paymentEvents is undefined',
    tonder.paymentEvents === undefined,
  );

  console.log('Published types');
  const types = readFileSync(DIST_TYPES, 'utf8');
  check(
    'no internal field name is published as a private declaration',
    !/^\s*private readonly /m.test(types),
  );

  console.log('Late mutation');
  let threw = null;
  try {
    config.session.customer.email = CUSTOMER_B.email;
    config.session.customer = { ...CUSTOMER_B };
    config.session.secure_token = TOKEN_B;
    config.presentation_mode = 'embedded';
    config.events = { payment: { on_success: () => undefined } };
  } catch (error) {
    threw = error;
  }
  check('no mutation throws in real strict-mode ESM', threw === null);

  console.log('Outgoing requests after the mutation');
  await tonder.init();
  await tonder.getCustomerCards();

  const serialized = JSON.stringify(recorded);
  const registrations = recorded.filter((entry) =>
    entry.url.includes('/api/v1/customer/'),
  );
  const cards = recorded.filter((entry) => entry.url.includes('/cards/'));

  check(
    'exactly one customer registration went out',
    registrations.length === 1,
  );
  check(
    'the registration carries the construction-time email',
    registrations[0]?.body?.email === CUSTOMER_A.email,
  );
  check('exactly one cards request went out', cards.length === 1);
  check(
    'the cards request carries the token derived from the original customer',
    cards[0]?.headers?.['User-Token'] === `tok_${CUSTOMER_A.email}`,
  );
  check(
    'the cards request carries the construction-time secure token',
    cards[0]?.headers?.Authorization === `Bearer ${TOKEN_A}`,
  );
  check(
    'no recorded request mentions the mutated email',
    !serialized.includes(CUSTOMER_B.email),
  );
  check(
    'no recorded request mentions the mutated secure token',
    !serialized.includes(TOKEN_B),
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((error) => {
  console.error('Probe crashed:', error);
  process.exit(1);
});
