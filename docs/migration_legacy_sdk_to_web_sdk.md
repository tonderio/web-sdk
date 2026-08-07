# Migrating from the legacy SDK to the Web SDK

For merchants on `tonder-web-sdk` v2 — `InlineCheckout` or `LiteInlineCheckout` — moving to `@tonder.io/web-sdk`.

## Read this before you plan the work

This is not only a front-end change. **Your webhook handler has to change too**, and that is the part merchants underestimate when they plan the work.

The new SDK charges through a different Tonder payment API than the legacy one did, so the events your server receives have a different payload. It is not a rename of a few fields: some fields disappear, some are new, and if you accept APMs your two current handlers collapse into one. Budget backend time for it — see [Webhooks](#webhooks-server-side).

Everything else is a feature-for-feature move. Saved cards, Card on File, enrollment, CVV re-collection, APMs, SafetyPay, 3DS and secure fields all exist in the new SDK.

## Which class did you import?

| You used             | Your migration is                                  | Go to                                     |
| -------------------- | -------------------------------------------------- | ----------------------------------------- |
| `LiteInlineCheckout` | Mostly method renames — you already own your UI    | [Path A](#path-a-from-liteinlinecheckout) |
| `InlineCheckout`     | You build the checkout UI the old SDK used to draw | [Path B](#path-b-from-inlinecheckout)     |

Both paths then share [Webhooks](#webhooks-server-side), which is the same work either way.

---

## Setup — both paths

### Load the SDK [Client-side]

The legacy SDK shipped as an npm package and as a script tag. So does this one, and you are not tied to the one you used before — both options work in every framework, React and Next.js included.

|                                                         | Updates reach you                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| **CDN `<script>`** — the SDK arrives as `window.Tonder` | Automatically; the URL tracks a major-version channel (`/web-sdk/v1/`) |
| **npm** — `npm install @tonder.io/web-sdk`              | When you bump the version and deploy                                   |

If you were on npm, remove the old package so the two cannot both be loaded:

```bash
npm uninstall tonder-web-sdk
```

A TypeScript app can install the npm package as a `devDependency` for types only and keep the CDN runtime.

Snippets: [Install](https://github.com/tonderio/web-sdk/blob/main/README.md#install), [CDN build](https://github.com/tonderio/web-sdk/blob/main/README.md#cdn-build).

### Create the instance [Client-side]

**Before** — a class you construct, then configure, then pay with

```ts
const checkout = new LiteInlineCheckout({
  mode: 'stage',
  apiKey: 'YOUR_KEY',
  returnUrl: 'https://merchant.example.com/return',
  callBack: (result) => handleResult(result),
});
await checkout.injectCheckout();

checkout.configureCheckout({
  customer: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
  },
  order_reference: 'ORD-001',
});
```

**After** — one factory, and the customer belongs to the session

```ts
const tonder = createTonder({
  api_key: tonderPublicConfig.api_key,
  environment: 'stage', // switch to 'production' when you go live
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
});
await tonder.init();
```

| Legacy                            | New                                               | Note                                                                                |
| --------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `mode: 'stage' \| 'production'`   | `environment: 'stage' \| 'production'`            | Same two values, renamed key                                                        |
| `apiKey`                          | `api_key`                                         | Same public key                                                                     |
| `injectCheckout()`                | `init()`                                          |                                                                                     |
| `configureCheckout({ customer })` | `session.customer` at creation                    | No longer a separate call                                                           |
| `returnUrl` on the constructor    | `return_url` per `pay()` call                     | Lets you build per-transaction return URLs                                          |
| `callBack`                        | `events.payment` — or the promise `pay()` returns | See below                                                                           |
| `order_reference`                 | `client_reference`                                | Renamed; your correlation carries over. See [Correlation](#correlation-server-side) |

Full reference: [Configuration](https://github.com/tonderio/web-sdk/blob/main/README.md#configuration).

### Results: callback or promise [Client-side]

The legacy `callBack` fired for everything. The new SDK gives you both channels, and they are not alternatives:

- `pay()` **returns a promise** with the transaction — use it to update the screen.
- `events.payment` **fires for every method**, including flows with no promise. One set of handlers covers the whole checkout.

A decline is not an error in either: it arrives as a transaction with a declined status, on `on_completed`. `on_error` means no transaction exists at all. See [Events](https://github.com/tonderio/web-sdk/blob/main/README.md#events).

---

## Path A: from LiteInlineCheckout

You already build your own UI, so this is a rename pass plus one behavioural change.

### 1. Map the methods [Client-side]

| Legacy                          | New                                             |
| ------------------------------- | ----------------------------------------------- |
| `injectCheckout()`              | `init()`                                        |
| `mountCardFields(request)`      | `tonder.create('card_fields', options).mount()` |
| `unmountCardFields(context)`    | `card_fields.unmount()`                         |
| `revealCardFields(request)`     | `card_fields.reveal(input)`                     |
| `getCustomerCards()`            | `getCustomerCards()`                            |
| `saveCustomerCard()`            | `enrollCard()`                                  |
| `removeCustomerCard(skyflowId)` | `removeCustomerCard(card_id)`                   |
| `getCustomerPaymentMethods()`   | `getPaymentMethods()`                           |
| `payment(data)`                 | `pay(input)`                                    |
| `verify3dsTransaction()`        | — the SDK resolves 3DS itself                   |

`card_id` and `unmount_context` keep the same meaning they had in `mountCardFields`, including the `all` / `none` / `current` values.

### 2. Mount card fields [Client-side]

**Before**

```ts
await checkout.mountCardFields({
  /* field config */
});
```

**After** — the container ids are the same defaults the legacy SDK used

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

Every configured field needs its container in the DOM before `mount()`, or the call rejects with `MOUNT_COLLECT_ERROR`.

Styles, labels and placeholders move to `customization.card_fields` on `createTonder()` — they are no longer passed to the mount call. See [Card field customization](https://github.com/tonderio/web-sdk/blob/main/README.md#card-field-customization).

### 3. Charge [Client-side]

**Before**

```ts
checkout.configureCheckout({ customer, order_reference: 'ORD-001' });
const result = await checkout.payment({
  /* cart */
});
```

**After**

```ts
const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://merchant.example.com/return',
  client_reference: 'ORD-001',
  payment_method: { type: 'card' },
});
```

Saved cards use `{ type: 'saved_card', card_id }`; APMs use their method code. Full field list: [`tonder.pay(input)`](https://github.com/tonderio/web-sdk/blob/main/README.md#tonderpayinput).

### 4. Drop `verify3dsTransaction()` [Client-side]

The legacy flow required you to call it on the return page. The new SDK resolves 3DS itself and gives you a choice of presentation:

- `presentation_mode: 'redirect'` — the browser navigates, as it does today
- `presentation_mode: 'embedded'` — a modal, and the shopper never leaves your page

See [Presentation mode](https://github.com/tonderio/web-sdk/blob/main/README.md#presentation-mode).

### 5. Optional: add Apple Pay [Client-side]

Not available in the legacy SDK at all, so this is new capability rather than a migration.

One thing is worth starting now rather than at the end: **ask Tonder to enable Apple Pay and register your domains.** Tonder handles Apple — you never contact them and you do not need an Apple developer account. Your part is sending the list of domains and hosting one file Tonder gives you. It is not a code step, but it gates everything, and it is the most common reason a finished integration does not work in production.

Then see [Apple Pay](https://github.com/tonderio/web-sdk/blob/main/README.md#apple-pay).

---

## Path B: from InlineCheckout

`InlineCheckout` drew the entire checkout: the card form, the saved-card list, the APM picker, and the styling around them. **The new SDK does not draw a checkout.** You build the UI; the SDK gives you secure inputs for card data and the data to render everything else.

That is the whole of this migration. Every capability you had is still there — what changes is who renders it.

### 1. Inventory what the old UI gave your shoppers [Planning]

Before writing code, list which of these your checkout actually showed. You rebuild only those.

| The old UI drew          | You now render             | The SDK gives you                                                      |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| Card form                | Your own layout            | Secure inputs via `create('card_fields')` — you never touch raw PAN    |
| Saved-card list          | Your own list and selector | `getCustomerCards()` — masked number, brand, expiry, `subscription_id` |
| Save-card checkbox       | Your own checkbox          | `enrollCard()`                                                         |
| APM picker               | Your own list              | `getPaymentMethods()` — includes each method's `label` and `logo` URL  |
| SafetyPay bank picker    | Your own selector          | `getPaymentMethodBanks()` — grouped into `cash` and `transfer`         |
| Pay button, copy, colors | Yours                      | —                                                                      |
| Loading and error states | Yours                      | Error codes to branch on                                               |

**You do not have to design payment-method icons.** `getPaymentMethods()` returns a `logo` URL per method, which is what the old UI rendered.

### 2. Replace the three lifecycle methods [Client-side]

**Before** — the SDK owned the screen

```ts
const checkout = new InlineCheckout({ mode, apiKey, returnUrl, callBack });
await checkout.injectCheckout(); // draws everything into your container
checkout.setCallback(handleResult);
checkout.removeCheckout();
```

**After** — you own the screen; the SDK owns card security and the charge

You had one container and the SDK filled it with an entire checkout. Now you lay out your own form, and the SDK mounts a secure iframe into each card input. Everything around them — labels, the pay button, the saved-card list, the APM picker — is your markup.

```html
<!-- your form, your layout; only these five are the SDK's -->
<div id="collect-cardholder-name" class="card-field"></div>
<div id="collect-card-number" class="card-field"></div>
<div id="collect-expiration-month" class="card-field"></div>
<div id="collect-expiration-year" class="card-field"></div>
<div id="collect-cvv" class="card-field"></div>

<button id="pay">Pay</button>
```

```ts
const tonder = createTonder({
  /* …see Setup… */
});
await tonder.init();

const card_fields = tonder.create('card_fields');
await card_fields.mount(); // into the containers above

const transaction = await tonder.pay({
  /* …see Path A step 3… */
});

card_fields.unmount(); // your teardown, in place of removeCheckout()
```

Those five ids are the defaults; every configured field needs its container in the DOM before `mount()`, or the call rejects with `MOUNT_COLLECT_ERROR`. Give them a `max-height` in your CSS so the iframes do not grow before they settle.

### 3. Build the flows you inventoried [Client-side]

Each is documented as a recipe in the README. They are the same flows the old UI walked your shopper through:

| Flow                                   | README                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| New card                               | [New card](https://github.com/tonderio/web-sdk/blob/main/README.md#new-card)                                       |
| Saved card                             | [Saved card](https://github.com/tonderio/web-sdk/blob/main/README.md#saved-card)                                   |
| Save a card                            | [Save a new card](https://github.com/tonderio/web-sdk/blob/main/README.md#save-a-new-card)                         |
| APMs and SafetyPay                     | [Alternative payment methods](https://github.com/tonderio/web-sdk/blob/main/README.md#alternative-payment-methods) |
| Apple Pay — new, not in the legacy SDK | [Apple Pay](https://github.com/tonderio/web-sdk/blob/main/README.md#apple-pay)                                     |

One rule worth carrying into your own UI: **`subscription_id` on a saved card decides whether you need a CVV.** Present means charge it directly; `null` means mount the saved-card CVV field first.

### 4. Styling [Client-side]

The old `customization` had two halves. Only one has a counterpart:

| Legacy customization                                    | Now                                             |
| ------------------------------------------------------- | ----------------------------------------------- |
| Secure field styles, labels, placeholders               | `customization.card_fields` on `createTonder()` |
| Checkout UI: sections shown/hidden, colors, button copy | Your own CSS — there is no SDK equivalent       |

See [Card field customization](https://github.com/tonderio/web-sdk/blob/main/README.md#card-field-customization).

---

## Webhooks [Server-side]

Both paths need this, and it is the part that is not a rename.

Today you receive **two different payload shapes** — one for card payments, another for APMs. You will now receive **one**, the same for every payment method.

### Card webhooks

| Legacy field                           | New field             | Note                                                                                                                                  |
| -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction_reference`                | —                     | Gone. Nothing in the new payload replaces it                                                                                          |
| `payment_id`                           | —                     | Gone                                                                                                                                  |
| `checkout_id`                          | —                     | Gone. There is no checkout object on the new path                                                                                     |
| —                                      | `id`                  | **New, and the one that matters.** Tonder's identifier for the transaction — what you pass to `getTransaction()` and quote to support |
| —                                      | `transaction_id`      | **New.** A Tonder-internal id for the processing record. Not what you correlate on                                                    |
| —                                      | `client_reference`    | **New.** Your own order reference, in the webhook itself. This is what you correlate your order on                                    |
| `status` **and** `transaction_status`  | `status`              | The legacy pair was duplicated; there is one now                                                                                      |
| `amount`, `currency`, `metadata`       | same names            | Carry over                                                                                                                            |
| `provider`                             | `provider`            | Carries over                                                                                                                          |
| `transaction_type`                     | `operation_type`      |                                                                                                                                       |
| `operation_date`                       | `created`             | ISO 8601 now                                                                                                                          |
| `number_of_payment_attempts`           | —                     | Gone                                                                                                                                  |
| `response` (nested, provider-specific) | —                     | Gone. Read `status` and the decline fields instead                                                                                    |
| —                                      | `event_type`          | e.g. `payment_Success`                                                                                                                |
| —                                      | `payment_method_type` | e.g. `CARD`, `SPEI`, `OXXO`                                                                                                           |
| —                                      | `action`              | e.g. `MODIFY`                                                                                                                         |

### APM webhooks

**Before** — wrapped, and a different shape from card webhooks

```json
{
  "action": "payment",
  "type": "apm",
  "data": {
    "transaction_status": "Success",
    "payment_id": 41714,
    "checkout_id": "…"
  }
}
```

**After** — identical in shape to a card webhook

```json
{
  "id": "fc38522e-…",
  "operation_type": "payment",
  "status": "Success",
  "payment_method_type": "SPEI",
  "client_reference": "ORD-001",
  "transaction_id": "e9340a04-…",
  "event_type": "payment_Success"
}
```

**If you branch on `type === 'apm'` or unwrap `data`, delete that code.** One handler now covers every method.

### What to do

1. Read the current payload spec: [How webhooks work](https://docs.tonder.io/direct-integration/webhooks/how-webhooks-works) and [Webhooks](https://github.com/tonderio/web-sdk/blob/main/README.md#webhooks).
2. Correlate on `client_reference` instead of `checkout_id` or `payment_id`.
3. Keep the handler idempotent by storing processed event ids — delivery is retried up to three times, then dead-lettered.
4. Run both old and new endpoints during the cutover if you are migrating gradually; the payloads are distinguishable by the presence of `event_type`.

## Correlation [Server-side]

Your order reference keeps working. It is renamed, and it still identifies the same thing on Tonder's side — reconciliation you already have does not need rethinking, only the field name changes.

|        | Field                                    |
| ------ | ---------------------------------------- |
| Legacy | `configureCheckout({ order_reference })` |
| New    | `pay({ client_reference })`              |

`metadata` is supported by both, unchanged.

**One thing to check before you migrate.** Neither SDK merges these fields — the order reference and `metadata` are sent separately, and always have been. But in exported transactions reports, the **Business Transaction ID** column prefers `metadata.order_id` and falls back to the order reference only when it is absent.

So if you have been sending both with different values, your webhooks correlate on one identifier and your reports on the other. Decide which one your reconciliation actually reads before mapping it, and send the same value in both from now on. The full metadata table is in [`tonder.pay(input)`](https://github.com/tonderio/web-sdk/blob/main/README.md#tonderpayinput).

## Test the migration

Run in stage before switching production traffic.

| Check                                | What proves it worked                                               |
| ------------------------------------ | ------------------------------------------------------------------- |
| New card payment                     | Transaction created through `/process/`, not the router             |
| Declined card                        | Arrives as a transaction with a declined status, not a thrown error |
| 3DS                                  | Resolves without you calling `verify3dsTransaction()`               |
| Saved card with `subscription_id`    | Charges without a CVV prompt                                        |
| Saved card without `subscription_id` | Prompts for CVV, then charges                                       |
| Enrollment                           | Card appears in `getCustomerCards()` afterwards                     |
| An APM                               | Returns `Pending`, settles by webhook                               |
| **Webhook handler**                  | Processes the new flat payload for both a card and an APM           |
| **Correlation**                      | `client_reference` from your order appears in the webhook           |

The last two are the ones worth writing an explicit test for. Everything above them fails loudly; a webhook mismatch fails silently, and you find out when an order is not fulfilled.
