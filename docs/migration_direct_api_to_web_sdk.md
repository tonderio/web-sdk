# Migrating from Direct API to the Web SDK

For merchants already charging through Tonder Direct API server-to-server, who want to move some or all of their checkout to the browser SDK.

## The one thing to know first

**Your backend contract does not change.** The SDK posts to the same `/api/v1/process/` with the same body shape, returns the same transaction, and fires the same webhooks. Your reconciliation, your `client_reference` correlation, your webhook handler, and your `GET /api/v1/transactions/{id}/` polling all keep working untouched.

What changes is only this:

| Today                                      | With the SDK                                                 |
| ------------------------------------------ | ------------------------------------------------------------ |
| You call the vault to tokenize card data   | The SDK's secure fields tokenize it — you never see the card |
| You build the `/process/` body and POST it | `pay()` builds and posts it                                  |
| You handle the 3DS redirect yourself       | The SDK presents it, redirect or embedded                    |

Everything after `/process/` responds is unchanged.

## Pick your path

Two migrations live in this document. They share nothing but the setup step, so read only yours.

| If you want to                                                       | Go to                                           | Server changes              |
| -------------------------------------------------------------------- | ----------------------------------------------- | --------------------------- |
| Ship **Apple Pay first**, without touching your current checkout yet | [Path A](#path-a-start-with-apple-pay)          | None                        |
| Move **cards and APMs** into the browser, and add Apple Pay          | [Path B](#path-b-move-your-checkout-to-the-sdk) | Only if you use saved cards |

They are sequential, not alternatives. Path A puts the SDK on your page without changing what you have; Path B then moves the rest of the checkout into it, one flow at a time. See [Where Path A leads](#where-path-a-leads).

---

## Setup — both paths

### Load the SDK [Client-side]

Both options work in every framework, React and Next.js included.

|                                                         | Updates reach you                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| **CDN `<script>`** — the SDK arrives as `window.Tonder` | Automatically; the URL tracks a major-version channel (`/web-sdk/v1/`) |
| **npm** — `npm install @tonder.io/web-sdk`              | When you bump the version and deploy                                   |

A TypeScript app can install the npm package as a `devDependency` for types only and keep the CDN runtime.

Snippets: [Install](https://github.com/tonderio/web-sdk/blob/main/README.md#install), [CDN build](https://github.com/tonderio/web-sdk/blob/main/README.md#cdn-build).

### Create the instance [Client-side]

You already hold a **secret** API key on your server for Direct API. The SDK needs your **public** key instead, and it goes in browser code. They are different keys; do not reuse the secret one.

```ts
const tonder = createTonder({
  api_key: tonderPublicConfig.api_key,
  environment: 'stage', // switch to 'production' when you go live
  session: { customer: { email: 'ada@example.com' } },
});
await tonder.init();
```

`session.customer` carries the same identity you send today as `customer` in the `/process/` body. Full configuration reference: [Configuration](https://github.com/tonderio/web-sdk/blob/main/README.md#configuration).

---

## Path A: start with Apple Pay

The smallest possible first release: your tokenization, your `/process/` calls and your reconciliation stay exactly where they are, and the SDK renders one button whose charge lands on the endpoint you already read from.

### 1. Ask Tonder to enable Apple Pay and register your domains [Setup]

Not a code step, and the most common reason a correct integration fails in production. Send Tonder every domain that will show the button — subdomains count separately — and host the verification file Tonder sends you. Steps and the failure modes: [Ask Tonder to register your domain first](https://github.com/tonderio/web-sdk/blob/main/README.md#ask-tonder-to-register-your-domain-first).

### 2. Render the button [Client-side]

Apple Pay is the one flow that does not end in a `pay()` call. Apple requires the payment sheet to open in the same tick as the tap, so the SDK owns the click, and the result comes back on `events.payment` instead of as a returned promise.

Those callbacks are not an Apple Pay mechanism — they fire for every method the SDK charges. When you later move cards and APMs across, `pay()` returns a promise **and** fires the same callbacks, so one set of handlers keeps covering everything. See [Events](https://github.com/tonderio/web-sdk/blob/main/README.md#events).

That is the whole conceptual difference from your current code:

**Before** — you control the submit

```ts
const token = await tokenize(cardData);
const tx = await fetch('/your-backend/charge', { method: 'POST', body: ... });
handleResult(tx);
```

**After** — the SDK controls the tap, you receive the result

The SDK renders the button into an element you provide, so your page needs one. It has to exist before `mount()` runs, and it stays empty — do not put a button, a label, or an icon inside it.

```html
<div id="tonder-apple-pay-button"></div>
```

```ts
const tonder = createTonder({
  api_key: tonderPublicConfig.api_key,
  environment: 'stage', // switch to 'production' when you go live
  session: { customer: { email: 'ada@example.com' } },
  // Fires for EVERY payment method, not just Apple Pay. With pay() these run
  // alongside the promise it returns; Apple Pay has no promise, so for it
  // these callbacks are the only channel.
  events: {
    payment: {
      on_completed: (transaction) => handleResult(transaction),
      on_error: (error) => showError(error.code),
      on_cancel: () => {
        /* shopper dismissed the sheet — not an error */
      },
    },
  },
});

await tonder.init();

// Never render the container unconditionally: availability depends on the
// browser AND on Apple Pay being enabled for your business.
if (tonder.isApplePayAvailable().available) {
  const button = tonder.create('apple_pay_button', {
    payment: {
      amount: 250,
      currency: 'MXN',
      return_url: 'https://merchant.example.com/return',
      client_reference: 'order-12345',
    },
  });
  await button.mount();
}
```

That is the whole flow. What it leaves out — a custom container id, the three reasons availability can be false, a cart whose total changes after mount, and releasing the button on a route change — is in [Apple Pay](https://github.com/tonderio/web-sdk/blob/main/README.md#apple-pay).

### 3. Keep your reconciliation as it is [Server-side]

Nothing to do. The Apple Pay charge lands on `/api/v1/process/` like your card charges, produces a transaction with the same shape, and fires the same webhook. Your existing handler already covers it.

Send `client_reference` in the button's payment data exactly as you do today and your correlation keeps working.

### What you must not do

`pay({ payment_method: { type: 'apple_pay' } })` is rejected on purpose. Apple Pay cannot be charged through `pay()` — the gesture requirement above is why. Use the button component.

### Where Path A leads

The SDK is now loaded and initialized on your page, so the remaining steps are smaller than the one you just did.

1. **Card collection** — raw PAN and CVV stop touching your JavaScript, which removes your code from that part of PCI scope, and your vault tokenization call disappears. [Path B, step 1](#1-replace-tokenization-with-secure-fields-client-side).
2. **APMs** — same method codes, one call instead of a request you assemble. [Path B, step 3](#3-map-your-apm-calls-client-side).

Each is a separate release. There is no cutover.

---

## Path B: move your checkout to the SDK

### 1. Replace tokenization with secure fields [Client-side]

This is the step that removes code rather than adding it. Today you collect card data and call the vault yourself; that disappears.

**Before**

```ts
const tokens = await vault.tokenize({
  card_number,
  cvv,
  expiration_month,
  expiration_year,
  cardholder_name,
});
```

**After** — your `<input>`s become empty containers, and the SDK mounts a secure iframe into each one

```html
<div id="collect-cardholder-name" class="card-field"></div>
<div id="collect-card-number" class="card-field"></div>
<div id="collect-expiration-month" class="card-field"></div>
<div id="collect-expiration-year" class="card-field"></div>
<div id="collect-cvv" class="card-field"></div>
```

```ts
const card_fields = tonder.create('card_fields');
await card_fields.mount();
```

Those are the default ids; every configured field needs its container present before `mount()` runs, or the call rejects with `MOUNT_COLLECT_ERROR`. Give them a `max-height` in your own CSS so the iframe does not grow before it settles.

Two different places configure these, which is worth getting right the first time:

| What you want                                                       | Where it goes                                                                                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom container ids, mounting a subset of fields, per-field events | `tonder.create('card_fields', options)` — see [create('card_fields')](https://github.com/tonderio/web-sdk/blob/main/README.md#tondercreatecard_fields-options)     |
| Labels, placeholders, styles, validation messages                   | `customization.card_fields` on `createTonder()` — see [Card field customization](https://github.com/tonderio/web-sdk/blob/main/README.md#card-field-customization) |

**This is the PCI-relevant change.** Raw PAN and CVV stop touching your JavaScript entirely — they go straight from the shopper into Tonder's secure iframe.

### 2. Replace the `/process/` POST with `pay()` [Client-side]

The fields you send are the same ones you send today. Only the caller changes.

**Before** — your server builds the envelope

```json
{
  "operation_type": "payment",
  "amount": 250.00,
  "currency": "MXN",
  "client_reference": "order-12345",
  "customer": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "payment_method": { "type": "CARD", "card_number": "<tokenized>", ... },
  "return_url": "https://merchant.example.com/return"
}
```

**After** — the browser does, from the same values

```ts
const transaction = await tonder.pay({
  amount: 250,
  currency: 'MXN',
  client_reference: 'order-12345',
  return_url: 'https://merchant.example.com/return',
  payment_method: { type: 'card' },
});
```

Three differences worth noting, all of them simplifications:

- **`operation_type` is gone.** The SDK only creates payments; refunds and withdrawals stay on your server.
- **`customer` moved to `createTonder()`.** It belongs to the session, not to each charge.
- **The card fields are gone from the body.** The SDK collects them from the mounted fields.

Field-by-field reference, including `idempotency_key` and `metadata`: [`tonder.pay(input)`](https://github.com/tonderio/web-sdk/blob/main/README.md#tonderpayinput).

### 3. Map your APM calls [Client-side]

Same call, different `payment_method.type`. Your APM codes carry over unchanged.

| Today, in `/process/`                    | With the SDK                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| `"type": "SPEI"`                         | `payment_method: { type: 'spei' }`                         |
| `"type": "oxxopay"`                      | `payment_method: { type: 'oxxopay' }`                      |
| `"type": "safetypaycash"` + `apm_config` | `payment_method: { type: 'safetypaycash', config: { … } }` |

SafetyPay still needs `country`, `channel`, and `bank_ids`; the SDK can list the banks for you with `getPaymentMethodBanks()` instead of you hardcoding them. See [Alternative payment methods](https://github.com/tonderio/web-sdk/blob/main/README.md#alternative-payment-methods).

APMs return `Pending` and settle later, exactly as they do today. Your webhook handling does not change.

### 4. Optional: Move 3DS presentation to the SDK [Client-side]

If you currently redirect the shopper to the hosted page yourself, you can hand that to the SDK and choose how it appears:

- `presentation_mode: 'redirect'` — the browser navigates, as it does today. Your `return_url` still lands where it does now.
- `presentation_mode: 'embedded'` — the SDK opens a modal and the shopper never leaves your page.

See [Presentation mode](https://github.com/tonderio/web-sdk/blob/main/README.md#presentation-mode).

### 5. Optional: Saved cards [Server-side + Client-side]

Only if you want stored cards. This is the one part of Path B that needs a server change: saved-card operations require a short-lived `secure_token` minted by **your** backend with your existing Tonder secret key.

**One trap.** With Card on File enabled, even a one-time card payment needs the token, because the SDK stores the card as part of the charge. It is an account setting, so the same code works for one business and throws `SECURE_TOKEN_REQUIRED` for another.

The endpoint to build, and which operations need the token: [Backend secure token endpoint](https://github.com/tonderio/web-sdk/blob/main/README.md#backend-secure-token-endpoint).

### 6. Add Apple Pay [Client-side]

Follow [Path A](#path-a-start-with-apple-pay) from step 1. It is the same work whether or not you migrated the rest.

---

## Reconciliation — do not change this

The most common mistake when moving checkout into the browser is starting to trust the browser.

You already fulfil from webhooks, because server-to-server left you no other option. **Keep doing exactly that.** The SDK returns a transaction so you can update the screen, not so you can release goods — a browser can be closed or lose signal, and neither changes what happened to the money.

- `client_reference` — keep sending it, keep correlating on it
- `idempotency_key` — keep sending it, so a retried charge cannot become two
- Webhooks — same payload, same handler, no wrapper. See [Webhooks](https://github.com/tonderio/web-sdk/blob/main/README.md#webhooks)
- `getTransaction()` — the browser-side equivalent of your `GET /api/v1/transactions/{id}/`, for return pages and one-off checks

## Test the migration

Run these in stage before switching production traffic.

| Check                 | What proves it worked                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| A card payment        | Same transaction shape in your existing handler as before the migration    |
| A declined card       | Arrives as a transaction with a declined status, not as a thrown error     |
| A 3DS card            | Returns to your `return_url`, or resolves in the modal if embedded         |
| An APM                | Returns `Pending`, then settles by webhook as it does today                |
| Your webhook handler  | Untouched code still processes SDK-created payments                        |
| Apple Pay, if adopted | Sheet opens on a real device — the iOS Simulator cannot test web Apple Pay |
| Apple Pay decline     | Arrives on `on_completed` with a declined status, **not** on `on_error`    |

That last row is the one that surprises people: `on_completed` means the charge reached a final answer, not that the answer was yes.

## What stays on your server

The SDK does not replace these. They remain Direct API calls:

- Refunds — `operation_type: "refund"`
- Withdrawals — `operation_type: "withdrawal"`
- Any charge you create without a browser present
