# @tonder.io/web-sdk

Browser TypeScript SDK for accepting payments with Tonder. It provides secure card fields, new-card and saved-card payments, hosted/3DS presentation, payment-method discovery, transaction lookup, and webhook-friendly transaction responses.

## Contents

- [Install](#install)
- [Before you start](#before-you-start)
- [Quick start: card payment](#quick-start-card-payment)
- [Configuration](#configuration)
- [Core concepts](#core-concepts)
- [Payment flows](#payment-flows)
- [API reference](#api-reference)
  - [`createTonder(config)`](#createtonderconfig)
  - [`tonder.init()`](#tonderinit)
  - [`tonder.create('card_fields', options?)`](#tondercreatecard_fields-options)
  - [`card_fields.mount()`](#card_fieldsmount)
  - [`card_fields.unmount()`](#card_fieldsunmount)
  - [`card_fields.reveal(input)`](#card_fieldsrevealinput)
  - [`tonder.pay(input)`](#tonderpayinput)
  - [`tonder.getTransaction(id)`](#tondergettransactionid)
  - [`tonder.enrollCard()`](#tonderenrollcard)
  - [`tonder.getCustomerCards()`](#tondergetcustomercards)
  - [`tonder.removeCustomerCard(card_id)`](#tonderremovecustomercardcard_id)
  - [`tonder.getPaymentMethods()`](#tondergetpaymentmethods)
  - [`tonder.getPaymentMethodBanks()`](#tondergetpaymentmethodbanks)
- [Types](#types)
- [Errors](#errors)
- [Payment statuses](#payment-statuses)
- [Webhooks](#webhooks)
- [CDN build](#cdn-build)

## Install

```bash
npm install @tonder.io/web-sdk
```

```ts
import { createTonder, AppError, ErrorKeyEnum } from '@tonder.io/web-sdk';
```

No bundler? Use the browser global build. See [CDN build](#cdn-build).

## Before you start

You need:

- A Tonder public `api_key`. Never put secret keys in browser code.
- A modern browser: Chrome, Safari, Firefox, or Edge.
- A server endpoint that can create a short-lived `secure_token` when using saved cards/Card on File.
- A webhook endpoint for reliable payment fulfillment.

## Quick start: card payment

### 1. Add containers for card fields

```html
<form id="checkout-form">
  <div id="collect-cardholder-name"></div>
  <div id="collect-card-number"></div>
  <div id="collect-expiration-month"></div>
  <div id="collect-expiration-year"></div>
  <div id="collect-cvv"></div>

  <button type="submit">Pay</button>
</form>
```

### 2. Initialize, mount, and pay

```ts
import { createTonder } from '@tonder.io/web-sdk';

const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  },
});

await tonder.init();

const card_fields = tonder.create('card_fields');

await card_fields.mount();

const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  metadata: { cart_id: 'cart_789' },
  payment_method: { type: 'card' },
});

if (transaction.status === 'Success' || transaction.status === 'Authorized') {
  // Show confirmation.
} else if (transaction.status === 'Pending') {
  // The customer may need to complete 3DS or an asynchronous payment method.
  // Confirm final state with webhooks or getTransaction().
} else {
  // Show a recoverable payment message.
  console.warn(transaction.decline_code, transaction.decline_reason);
}
```

## Configuration

`createTonder(config)` creates one SDK instance for one shopper/session. Recreate the SDK if the customer, `secure_token`, or environment changes.

```ts
const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
  presentation_mode: 'embedded',
  session: {
    customer: {
      email: 'ada@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+525500000000',
    },
    secure_token: 'server_minted_secure_token',
  },
  events: {
    presentation: {
      on_open: () => console.log('Hosted payment view opened'),
      on_close: () => console.log('Shopper closed the hosted payment view'),
    },
  },
  customization: {
    card_fields: {
      labels: {
        card_number: 'Card number',
        cvv: 'Security code',
      },
      placeholders: {
        card_number: '4111 1111 1111 1111',
        expiration_month: 'MM',
        expiration_year: 'YY',
      },
      error_messages: {
        required: 'Complete this field.',
        invalid: 'Check this field.',
        card_number: 'Enter a valid card number.',
        cvv: 'Enter the security code.',
      },
    },
  },
});
```

| Field                          | Required                              | Description                                                                            |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `api_key`                      | Yes                                   | Public Tonder key for browser integrations.                                            |
| `environment`                  | Yes                                   | `'sandbox'`, `'stage'`, or `'production'`.                                             |
| `session.customer`             | For `pay()` and saved-card operations | Customer identity. Omit for read-only return pages that only call `getTransaction()`.  |
| `session.secure_token`         | For saved-card operations             | Short-lived token minted by your backend.                                              |
| `presentation_mode`            | No                                    | `'redirect'` by default, or `'embedded'` for SDK-owned modal presentation.             |
| `events.presentation.on_open`  | No                                    | Called when an embedded hosted-payment view opens.                                     |
| `events.presentation.on_close` | No                                    | Called when the shopper closes a closable embedded hosted-payment view.                |
| `customization.card_fields`    | No                                    | Labels, placeholders, styles, and validation-message overrides for secure card fields. |

### Card field customization

Configure secure card-field copy and styles through `customization.card_fields` in `createTonder()`. All fields are optional; omitted values use the SDK defaults.

#### `customization.card_fields`

| Field            | Type                     | Required | Description                                                                            |
| ---------------- | ------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `labels`         | `CardLabels`             | No       | Text shown above each secure field.                                                    |
| `placeholders`   | `CardPlaceholders`       | No       | Placeholder text shown inside each secure field.                                       |
| `styles`         | `CardStyles`             | No       | Global and per-field style overrides for secure fields, labels, errors, and card icon. |
| `error_messages` | `CardFieldErrorMessages` | No       | Validation-message overrides for empty or invalid fields.                              |

#### Labels

| Field              | Type     | Description                                            |
| ------------------ | -------- | ------------------------------------------------------ |
| `cardholder_name`  | `string` | Label for the cardholder-name field.                   |
| `card_number`      | `string` | Label for the card-number field.                       |
| `cvv`              | `string` | Label for the CVV field.                               |
| `expiry_date`      | `string` | Label for a combined expiry-date field when supported. |
| `expiration_month` | `string` | Label for the expiration-month field.                  |
| `expiration_year`  | `string` | Label for the expiration-year field.                   |

#### Placeholders

| Field              | Type     | Description                                 |
| ------------------ | -------- | ------------------------------------------- |
| `cardholder_name`  | `string` | Placeholder for the cardholder-name field.  |
| `card_number`      | `string` | Placeholder for the card-number field.      |
| `cvv`              | `string` | Placeholder for the CVV field.              |
| `expiration_month` | `string` | Placeholder for the expiration-month field. |
| `expiration_year`  | `string` | Placeholder for the expiration-year field.  |

#### Styles

`styles.card_form` defines defaults for every secure field. Per-field style entries override those defaults only for that field.

| Field              | Type          | Description                                                                   |
| ------------------ | ------------- | ----------------------------------------------------------------------------- |
| `card_form`        | `FieldStyles` | Default styles applied to every field.                                        |
| `cardholder_name`  | `FieldStyles` | Overrides for the cardholder-name field.                                      |
| `card_number`      | `FieldStyles` | Overrides for the card-number field.                                          |
| `cvv`              | `FieldStyles` | Overrides for the CVV field.                                                  |
| `expiration_month` | `FieldStyles` | Overrides for the expiration-month field.                                     |
| `expiration_year`  | `FieldStyles` | Overrides for the expiration-year field.                                      |
| `enable_card_icon` | `boolean`     | Shows the card-network icon inside the card-number field. Defaults to `true`. |

`FieldStyles` accepts these groups:

| Field          | Type                 | Description                         |
| -------------- | -------------------- | ----------------------------------- |
| `input_styles` | `CollectInputStyles` | Styles applied to the secure input. |
| `label_styles` | `LabelStyles`        | Styles applied to the field label.  |
| `error_styles` | `ErrorTextStyles`    | Styles applied to validation text.  |

`CollectInputStyles` variants:

| Variant    | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `base`     | Default input style.                                           |
| `focus`    | Style applied while the field is focused.                      |
| `complete` | Style applied when the field is complete.                      |
| `invalid`  | Style applied when the field is invalid.                       |
| `empty`    | Style applied when the field is empty.                         |
| `global`   | Global input style overrides supported by the secure renderer. |
| `cardIcon` | Style overrides for the card-network icon when supported.      |

`LabelStyles` variants:

| Variant            | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| `base`             | Default label style.                                            |
| `global`           | Global label style overrides supported by the secure renderer.  |
| `requiredAsterisk` | Style overrides for the required-field asterisk when supported. |

`ErrorTextStyles` variants:

| Variant  | Description                                                                 |
| -------- | --------------------------------------------------------------------------- |
| `base`   | Default validation-message style.                                           |
| `global` | Global validation-message style overrides supported by the secure renderer. |

Style values use CSS-in-JS keys supported by the secure card-field renderer, for example `font_size`, `font_family`, `color`, `border_color`, or `letter_spacing`.

#### Error messages

| Field              | Type     | Description                       |
| ------------------ | -------- | --------------------------------- |
| `required`         | `string` | Generic empty-field message.      |
| `invalid`          | `string` | Generic invalid-field fallback.   |
| `cardholder_name`  | `string` | Invalid cardholder-name message.  |
| `card_number`      | `string` | Invalid card-number message.      |
| `expiration_month` | `string` | Invalid expiration-month message. |
| `expiration_year`  | `string` | Invalid expiration-year message.  |
| `cvv`              | `string` | Invalid CVV message.              |

#### Example

```ts
const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
  customization: {
    card_fields: {
      labels: {
        card_number: 'Card number',
        cvv: 'Security code',
      },
      placeholders: {
        cardholder_name: 'Ada Lovelace',
        card_number: '4111 1111 1111 1111',
        expiration_month: 'MM',
        expiration_year: 'YY',
      },
      styles: {
        card_form: {
          input_styles: {
            base: {
              color: '#111827',
              font_family: 'Inter, sans-serif',
              font_size: '16px',
            },
            focus: { border_color: '#2563eb' },
            invalid: { color: '#b91c1c' },
          },
          label_styles: {
            base: { color: '#374151', font_weight: '600' },
          },
          error_styles: {
            base: { color: '#b91c1c' },
          },
        },
        card_number: {
          input_styles: {
            base: { letter_spacing: '0.03em' },
          },
        },
        enable_card_icon: true,
      },
      error_messages: {
        required: 'Complete this field.',
        invalid: 'Check this field.',
        card_number: 'Enter a valid card number.',
        cvv: 'Enter the security code.',
      },
    },
  },
});
```

## Core concepts

### Initialization

Call `await tonder.init()` before mounting card fields, creating payments, or using saved-card operations. `getTransaction()`, `getPaymentMethods()`, and `getPaymentMethodBanks()` are read-only and can be used without `init()`.

### Customer context

`session.customer` is optional at `createTonder()` time. It is required when the SDK creates a payment or manages saved cards.

```ts
// Return page / read-only reconciliation.
const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
});

const transaction = await tonder.getTransaction('txn_123');
```

### Presentation mode

When a payment requires a hosted step, the SDK uses `presentation_mode`:

| Mode       | Behavior                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect` | Browser navigates to the hosted page. Use `return_url`, `getTransaction()`, and webhooks to confirm final status.                     |
| `embedded` | SDK opens a full-screen modal. Card 3DS waits for a final transaction; APM/SPEI hosted instructions may return `Pending` immediately. |

```ts
const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
  presentation_mode: 'embedded',
  events: {
    presentation: {
      on_open: () => showLoadingOverlay(false),
      on_close: () => console.log('Customer closed the hosted view'),
    },
  },
});
```

## Payment flows

### New card

```ts
await tonder.init();

const card_fields = tonder.create('card_fields');

await card_fields.mount();

const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'card' },
});
```

### Saved card

Saved-card operations require both `session.customer` and `session.secure_token`.

```ts
const tonder = createTonder({
  api_key: 'pk_test_...',
  environment: 'sandbox',
  session: {
    customer: { email: 'ada@example.com' },
    secure_token: await getSecureTokenFromYourBackend(),
  },
});

await tonder.init();

const cards = await tonder.getCustomerCards();
const selected_card = cards[0];

// Mount saved-card CVV only when the card cannot be charged through an
// existing Card-on-File subscription. The SDK collects this update context
// automatically during pay().
if (!selected_card.subscription_id) {
  const cvv = tonder.create('card_fields', {
    card_id: selected_card.card_id,
    fields: ['cvv'],
  });

  await cvv.mount();
}

const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'saved_card', card_id: selected_card.card_id },
});
```

### Save a new card

```ts
const card_fields = tonder.create('card_fields');

await card_fields.mount();

const enrollment = await tonder.enrollCard();
// { card_id: 'card_123', subscription_id: 'sub_123' }
```

### Alternative payment methods

Use `getPaymentMethods()` when you want to render the methods enabled for your business. This call is optional: if your checkout already knows which method it wants to offer, pass the method code directly to `pay()` (`{ type: 'spei' }`, `{ type: 'oxxopay' }`, etc.).

For bank-backed SafetyPay methods, use `getPaymentMethodBanks()` and build `payment_method.config` from the selected bank:

| Field      | Value                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| `country`  | `bank.country` from `getPaymentMethodBanks()` (for example, `Mexico`).            |
| `channel`  | `bank.channel` from `getPaymentMethodBanks()` (`WP` for cash, `OL` for transfer). |
| `bank_ids` | `[{ id: bank.code }]` using the bank routing code, not the internal `bank.id`.    |

```ts
const methods = await tonder.getPaymentMethods();
const banks = await tonder.getPaymentMethodBanks();
```

```ts
const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'oxxopay' },
});
```

```ts
const banks = await tonder.getPaymentMethodBanks();
const bank = banks.cash[0];

const transaction = await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: {
    type: 'safetypayCash',
    config: {
      country: bank.country, // e.g. 'Mexico'
      channel: bank.channel, // 'WP' for cash, 'OL' for transfer
      bank_ids: [{ id: bank.code }], // e.g. [{ id: '8186' }]
    },
  },
});
```

APM/SPEI methods often settle asynchronously. Use webhooks for fulfillment.

## API reference

### `createTonder(config)`

Creates an SDK instance.

#### Request

```ts
interface TonderConfig {
  api_key: string;
  environment: 'sandbox' | 'stage' | 'production';
  session?: {
    customer?: {
      email: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
    };
    secure_token?: string;
  };
  presentation_mode?: 'redirect' | 'embedded';
  events?: {
    presentation?: {
      on_open?(): void;
      on_close?(): void;
    };
  };
  customization?: TonderCustomization;
}
```

#### Response

Returns a `Tonder` SDK instance.

#### Throws

| Code         | When                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| `INIT_ERROR` | `config` is missing, `api_key` is missing, or `environment` is invalid. |

### `tonder.init()`

Fetches merchant configuration and prepares the SDK for card fields and payments. Safe to call more than once.

#### Request

No arguments.

#### Response

```ts
Promise<void>;
```

#### Throws

| Code         | When                                            |
| ------------ | ----------------------------------------------- |
| `INIT_ERROR` | Merchant configuration or initialization fails. |

### `tonder.create('card_fields', options?)`

Creates a secure card-fields component. Call `mount()` on the returned component to render fields. If `options` is omitted, the SDK mounts the full new-card form using the default container IDs.

#### Request

```ts
type CardField =
  | 'cardholder_name'
  | 'card_number'
  | 'expiration_month'
  | 'expiration_year'
  | 'cvv';

interface CardFieldsOptions {
  fields?: (CardField | { field: CardField; container_id?: string })[];
  card_id?: string;
  unmount_context?: 'all' | 'none' | 'current' | 'create' | string;
  events?: Partial<
    Record<
      CardField,
      {
        on_change?(state: CardFieldState): void;
        on_blur?(state: CardFieldState): void;
        on_focus?(state: CardFieldState): void;
        on_ready?(state: CardFieldState): void;
      }
    >
  >;
}
```

Default container IDs:

| Field              | Default container                                          |
| ------------------ | ---------------------------------------------------------- |
| `cardholder_name`  | `#collect-cardholder-name`                                 |
| `card_number`      | `#collect-card-number`                                     |
| `expiration_month` | `#collect-expiration-month`                                |
| `expiration_year`  | `#collect-expiration-year`                                 |
| `cvv`              | `#collect-cvv` or `#collect-cvv-<card_id>` for saved cards |

#### Response

```ts
interface CardFieldsComponent {
  mount(): Promise<void>;
  unmount(): void;
  reveal(input: RevealCardFieldsInput): Promise<void>;
}
```

#### Throws

| Code                     | When                                       |
| ------------------------ | ------------------------------------------ |
| `INVALID_COMPONENT_TYPE` | The first argument is not `'card_fields'`. |

### `card_fields.mount()`

Mounts secure card fields into the configured containers.

#### Request

No arguments. Containers are configured in `tonder.create('card_fields', options?)`. If no options are provided, the SDK uses the default full-card containers.

#### Response

```ts
Promise<void>;
```

#### Throws

| Code                       | When                                                     |
| -------------------------- | -------------------------------------------------------- |
| `NOT_INITIALIZED`          | `tonder.init()` has not completed.                       |
| `SECURE_FIELDS_LOAD_ERROR` | Secure card fields could not load in the browser.        |
| `VAULT_TOKEN_ERROR`        | Tonder could not prepare the secure card fields session. |
| `INVALID_VAULT_TOKEN`      | Tonder returned an invalid secure card fields session.   |
| `MOUNT_COLLECT_ERROR`      | A configured field cannot be mounted.                    |

### `card_fields.unmount()`

Unmounts this component's secure card fields.

#### Request

No arguments.

#### Response

```ts
void
```

### `card_fields.reveal(input)`

Reveals display-safe saved-card values into merchant containers. CVV cannot be revealed.

#### Request

```ts
type RevealableCardField =
  | 'cardholder_name'
  | 'card_number'
  | 'expiration_month'
  | 'expiration_year';

interface RevealCardFieldsInput {
  fields: (
    | RevealableCardField
    | {
        field: RevealableCardField;
        container_id?: string;
        alt_text?: string;
        label?: string;
        styles?: CardFieldsCustomization['styles'];
      }
  )[];
  styles?: CardFieldsCustomization['styles'];
}
```

#### Response

```ts
Promise<void>;
```

#### Throws

| Code                       | When                                                                         |
| -------------------------- | ---------------------------------------------------------------------------- |
| `NOT_INITIALIZED`          | `tonder.init()` has not completed or no card tokens are available to reveal. |
| `SECURE_FIELDS_LOAD_ERROR` | Secure card fields could not load in the browser.                            |
| `VAULT_TOKEN_ERROR`        | Tonder could not prepare the secure card fields session.                     |
| `INVALID_VAULT_TOKEN`      | Tonder returned an invalid secure card fields session.                       |

### `tonder.pay(input)`

Creates a payment.

#### Request

```ts
interface PayInput {
  amount: number;
  currency?: string; // defaults to 'MXN'
  return_url: string;
  payment_method:
    | { type: 'card' }
    | { type: 'saved_card'; card_id: string }
    | { type: string; config?: Record<string, unknown> };
  metadata?: Record<string, unknown>;
  client_reference: string; // required business reference for dashboards, exports, webhooks
  idempotency_key?: string; // optional retry-safe key for this payment attempt
}
```

Examples:

```ts
await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'card' },
});
```

```ts
await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'saved_card', card_id: 'card_123' },
});
```

```ts
await tonder.pay({
  amount: 150,
  currency: 'MXN',
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  payment_method: { type: 'spei' },
});
```

`client_reference` is the required merchant/business reference that remains in the payment payload and appears in dashboards, exports, webhooks, and transaction records. Use `idempotency_key` only when you want retries of the same payment attempt to be recognized as duplicates. It is handled internally as a business-scoped request key, is not included in the payment body, and does not replace `client_reference`.

```ts
await tonder.pay({
  amount: 150,
  return_url: 'https://yourstore.example/checkout/return',
  client_reference: 'order_1001',
  idempotency_key: 'checkout-attempt-1001-1',
  payment_method: { type: 'card' },
});
```

#### Response

Returns `Promise<RawTransaction>`.

```json
{
  "id": "txn_123",
  "operation_type": "payment",
  "status": "Authorized",
  "amount": 150,
  "currency": "MXN",
  "client_reference": "order_1001",
  "metadata": { "cart_id": "cart_789" },
  "created_at": "2026-07-06T18:00:00Z"
}
```

A transaction that needs 3DS or hosted instructions can include `next_action`:

```json
{
  "id": "txn_123",
  "operation_type": "payment",
  "status": "Pending",
  "amount": 150,
  "currency": "MXN",
  "next_action": {
    "redirect_to_url": {
      "url": "https://hosted-payment.example/checkout/..."
    }
  }
}
```

APM/SPEI responses may include settlement fields:

```json
{
  "id": "txn_123",
  "operation_type": "payment",
  "status": "Pending",
  "amount": 150,
  "currency": "MXN",
  "clabe": "646180123400000001",
  "bank_name": "STP",
  "payment_instructions": { "reference": "1234567890" },
  "voucher_pdf": "https://..."
}
```

#### Throws

| Code                                                            | When                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `NOT_INITIALIZED`                                               | `tonder.init()` has not completed.                                                                          |
| `MISSING_CUSTOMER`                                              | `session.customer` was not configured.                                                                      |
| `INVALID_PAYMENT_REQUEST`                                       | `amount`, `return_url`, or `payment_method` is invalid.                                                     |
| `INVALID_APM_CONFIG`                                            | `safetypayCash` or `safetypayTransfer` is missing `config.country`, `config.channel`, or `config.bank_ids`. |
| `MOUNT_COLLECT_ERROR`                                           | Card fields cannot be collected.                                                                            |
| `PAYMENT_PROCESS_ERROR`                                         | The payment request fails.                                                                                  |
| `FETCH_TRANSACTION_ERROR`                                       | Hosted/3DS resolution cannot retrieve the transaction.                                                      |
| `POLL_TIMEOUT_ERROR`                                            | Embedded card 3DS signaled completion, but reconciliation did not reach a final status in time.             |
| `REQUEST_ABORTED`                                               | The embedded hosted-payment wait was canceled.                                                              |
| `SAVE_CARD_ERROR`, `REMOVE_CARD_ERROR`, `CARD_ON_FILE_DECLINED` | Card-on-file setup or rollback fails.                                                                       |

### `tonder.getTransaction(id)`

Reads the current transaction state. Useful on `return_url` pages and admin/reconciliation views. Does not require `session.customer` or `init()`.

#### Request

```ts
tonder.getTransaction(id: string): Promise<RawTransaction>
```

#### Response

Same `RawTransaction` shape as `pay()`.

#### Throws

| Code                      | When                                 |
| ------------------------- | ------------------------------------ |
| `FETCH_TRANSACTION_ERROR` | The transaction cannot be retrieved. |
| `REQUEST_ABORTED`         | The browser request was canceled.    |

### `tonder.enrollCard()`

Saves the currently mounted new card for `session.customer`.

#### Request

No arguments. Requires a mounted new-card `card_fields` component.

#### Response

```ts
interface EnrollResult {
  card_id: string;
  subscription_id?: string;
}
```

#### Throws

| Code                       | When                                        |
| -------------------------- | ------------------------------------------- |
| `NOT_INITIALIZED`          | `tonder.init()` has not completed.          |
| `MISSING_CUSTOMER`         | `session.customer` was not configured.      |
| `SECURE_TOKEN_REQUIRED`    | `session.secure_token` was not configured.  |
| `MOUNT_COLLECT_ERROR`      | Card fields cannot be collected.            |
| `CUSTOMER_OPERATION_ERROR` | Customer registration/fetch fails.          |
| `SAVE_CARD_ERROR`          | Card save fails.                            |
| `CARD_ON_FILE_DECLINED`    | Card-on-file enrollment is declined.        |
| `ACQUIRER_LOAD_ERROR`      | Card-on-file processor library cannot load. |

### `tonder.getCustomerCards()`

Lists saved cards for `session.customer`. `subscription_id` is returned only when Card-on-File is enabled for the business. When it is `null`, mount the saved-card CVV field before calling `pay()` with that card.

#### Request

No arguments.

#### Response

```ts
interface Card {
  card_id: string;
  card_number: string; // masked
  expiration_month: string;
  expiration_year: string;
  card_scheme: string;
  subscription_id: string | null;
}
```

Example:

```json
[
  {
    "card_id": "card_123",
    "card_number": "XXXX-XXXX-XXXX-4242",
    "expiration_month": "12",
    "expiration_year": "29",
    "card_scheme": "visa",
    "subscription_id": "sub_123"
  }
]
```

#### Throws

| Code                       | When                                       |
| -------------------------- | ------------------------------------------ |
| `NOT_INITIALIZED`          | `tonder.init()` has not completed.         |
| `MISSING_CUSTOMER`         | `session.customer` was not configured.     |
| `SECURE_TOKEN_REQUIRED`    | `session.secure_token` was not configured. |
| `CUSTOMER_OPERATION_ERROR` | Customer registration/fetch fails.         |
| `FETCH_CARDS_ERROR`        | Saved cards cannot be retrieved.           |

### `tonder.removeCustomerCard(card_id)`

Removes a saved card for `session.customer`.

#### Request

```ts
tonder.removeCustomerCard(card_id: string): Promise<void>
```

#### Response

```ts
Promise<void>;
```

#### Throws

| Code                       | When                                       |
| -------------------------- | ------------------------------------------ |
| `NOT_INITIALIZED`          | `tonder.init()` has not completed.         |
| `MISSING_CUSTOMER`         | `session.customer` was not configured.     |
| `SECURE_TOKEN_REQUIRED`    | `session.secure_token` was not configured. |
| `CUSTOMER_OPERATION_ERROR` | Customer registration/fetch fails.         |
| `REMOVE_CARD_ERROR`        | Saved card cannot be removed.              |

### `tonder.getPaymentMethods()`

Lists active payment methods configured for your business. Can be called before `init()`.

This method is for discovery/rendering only. It is not required before `pay()`: you may pass a known enabled method code directly, such as `payment_method: { type: 'spei' }` or `payment_method: { type: 'oxxopay' }`.

#### Request

No arguments.

#### Response

```ts
interface PaymentMethodInfo {
  id: number;
  payment_method: string;
  label: string;
  logo: string;
  category: string;
}
```

Example:

```json
[
  {
    "id": 7,
    "payment_method": "oxxopay",
    "label": "Oxxo Pay",
    "logo": "https://...",
    "category": "cash"
  }
]
```

#### Throws

| Code                          | When                                 |
| ----------------------------- | ------------------------------------ |
| `FETCH_PAYMENT_METHODS_ERROR` | Payment methods cannot be retrieved. |

### `tonder.getPaymentMethodBanks()`

Lists SafetyPay bank options grouped by channel. Can be called before `init()`.

#### Request

No arguments.

#### Response

```ts
interface PaymentMethodBank {
  id: number;
  name: string;
  code: string;
  country: string;
  channel: 'WP' | 'OL';
  logo?: string;
}

interface PaymentMethodBanks {
  cash: PaymentMethodBank[];
  transfer: PaymentMethodBank[];
}
```

Example:

```json
{
  "cash": [
    {
      "id": 47,
      "name": "Banco Azteca",
      "code": "8186",
      "country": "Mexico",
      "channel": "WP",
      "logo": "https://..."
    }
  ],
  "transfer": []
}
```

#### Throws

| Code                               | When                              |
| ---------------------------------- | --------------------------------- |
| `FETCH_PAYMENT_METHOD_BANKS_ERROR` | Bank options cannot be retrieved. |

## Types

Useful exports:

```ts
import type {
  TonderConfig,
  PayInput,
  RawTransaction,
  Customer,
  Card,
  EnrollResult,
  PaymentMethodInfo,
  PaymentMethodBank,
  PaymentMethodBanks,
  CardFieldsOptions,
  CardFieldsComponent,
  TonderEvents,
  PresentationEvents,
} from '@tonder.io/web-sdk';
```

If you load the SDK runtime from the CDN in a TypeScript app, you can still install `@tonder.io/web-sdk` as a devDependency for types only. See [CDN with TypeScript types](#cdn-with-typescript-types).

### `RawTransaction`

`pay()` and `getTransaction()` return transaction fields in `snake_case`, matching Tonder API and webhook payloads.

```ts
interface RawTransaction {
  id: string;
  operation_type: string;
  status: string;
  amount: number;
  currency: string;
  client_reference?: string;
  metadata?: Record<string, unknown>;
  provider?: string;
  created_at?: string;
  status_code?: number;
  next_action?: {
    redirect_to_url?: {
      url: string;
      verify_transaction_status_url?: string;
    };
  };
  decline_code?: string;
  decline_reason?: string;
  payment_instructions?: Record<string, unknown>;
  voucher_pdf?: string;
  clabe?: string;
  bank_name?: string;
  [key: string]: unknown;
}
```

## Errors

SDK failures are thrown as `AppError`. Payment declines are returned as transactions; read `transaction.status` and use the [Payment statuses](#payment-statuses) table to decide the next action.

```ts
import { AppError, ErrorKeyEnum } from '@tonder.io/web-sdk';

try {
  const transaction = await tonder.pay({
    amount: 150,
    currency: 'MXN',
    return_url: 'https://yourstore.example/checkout/return',
    client_reference: 'order_1001',
    payment_method: { type: 'card' },
  });
} catch (error) {
  if (error instanceof AppError) {
    console.error(error.code, error.status_code, error.details.system_error);

    if (error.code === ErrorKeyEnum.MISSING_CUSTOMER) {
      // Recreate the SDK with session.customer.
    }
  } else {
    throw error;
  }
}
```

Example error shape:

```json
{
  "name": "TonderError",
  "status": "error",
  "code": "INVALID_PAYMENT_REQUEST",
  "status_code": 500,
  "details": {
    "code": "INVALID_PAYMENT_REQUEST",
    "status_code": 500,
    "system_error": "input.amount must be greater than 0."
  }
}
```

Common error codes:

Use `error.code` for branching. Do not parse `error.message`; messages are for display/logging and may change.

### Configuration and SDK lifecycle

| Code                       | When it happens                                                      | Returned by                                                                                              | How to fix                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INIT_ERROR`               | SDK initialization failed after the instance was created.            | `tonder.init()`                                                                                          | Check the publishable `api_key`, `environment`, and network access to Tonder services.                                                                 |
| `FETCH_BUSINESS_ERROR`     | Merchant/business configuration could not be loaded.                 | `tonder.init()`, operations that require initialization                                                  | Verify the publishable key and environment.                                                                                                            |
| `NOT_INITIALIZED`          | A method needs initialized SDK state but `init()` has not completed. | `card_fields.mount()`, `card_fields.reveal()`, `tonder.pay()`, `tonder.enrollCard()`, saved-card methods | Call `await tonder.init()` before the operation. Read-only methods such as `getTransaction()` and payment-method catalog methods do not need `init()`. |
| `INVALID_COMPONENT_TYPE`   | The requested UI component is not supported.                         | `tonder.create()`                                                                                        | Use `tonder.create('card_fields', options)`.                                                                                                           |
| `SECURE_FIELDS_LOAD_ERROR` | The browser could not load the secure card-fields library.           | `card_fields.mount()`, `card_fields.reveal()`                                                            | Check CSP, ad blockers, network access, and the page environment.                                                                                      |
| `ACQUIRER_LOAD_ERROR`      | The Card-on-File acquirer library could not load.                    | `tonder.enrollCard()`, `tonder.pay()` when COF is needed                                                 | Check network/CSP and retry.                                                                                                                           |

### Customer and saved-card credentials

| Code                       | When it happens                                                      | Returned by                                                                                                                                | How to fix                                                                                        |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `MISSING_CUSTOMER`         | `session.customer` is required but was not provided.                 | `tonder.pay()`, `tonder.enrollCard()`, `tonder.getCustomerCards()`, `tonder.removeCustomerCard()`                                          | Create the SDK with `session.customer.email` and optional customer fields.                        |
| `SECURE_TOKEN_REQUIRED`    | Saved-card operations require `session.secure_token`.                | `tonder.enrollCard()`, `tonder.getCustomerCards()`, `tonder.removeCustomerCard()`, `tonder.pay()` with `payment_method.type: 'saved_card'` | Mint a secure token on your backend and pass it in `createTonder({ session: { secure_token } })`. |
| `CUSTOMER_OPERATION_ERROR` | Customer registration/fetch failed.                                  | Saved-card operations and card enrollment                                                                                                  | Verify customer data and backend availability.                                                    |
| `FETCH_CARDS_ERROR`        | Saved cards could not be retrieved.                                  | `tonder.getCustomerCards()`, saved-card `pay()` lookup                                                                                     | Verify `session.customer`, `session.secure_token`, and customer ownership.                        |
| `SAVE_CARD_ERROR`          | A new or existing card could not be saved.                           | `tonder.enrollCard()`, `tonder.pay()` when a card must be saved for COF                                                                    | Ask the shopper to verify card data or retry; inspect `error.details` for backend context.        |
| `REMOVE_CARD_ERROR`        | A saved card could not be removed.                                   | `tonder.removeCustomerCard()`, rollback after failed auto-enrollment                                                                       | Retry the removal or reconcile from your backend/admin tools.                                     |
| `CARD_ON_FILE_DECLINED`    | Card-on-File enrollment/authorization was declined by the processor. | `tonder.enrollCard()`, COF/saved-card `tonder.pay()` flows                                                                                 | Ask for another card or corrected card details.                                                   |

### Payment request and processing

| Code                              | When it happens                                                                                                                                              | Returned by                                                              | How to fix                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_PAYMENT_REQUEST`         | Required payment fields are missing or invalid (`amount`, `return_url`, `client_reference`, `payment_method`, saved-card `card_id`, etc.).                   | `tonder.pay()`                                                           | Validate the request before calling `pay()`.                                                                                                        |
| `INVALID_PAYMENT_REQUEST_CARD_PM` | A card payment path received a non-card method.                                                                                                              | `tonder.pay()`                                                           | Use `{ type: 'card' }` for new-card payments or a supported APM code for alternative methods.                                                       |
| `INVALID_APM_CONFIG`              | `safetypayCash` or `safetypayTransfer` is missing required config.                                                                                           | `tonder.pay()`                                                           | Pass `payment_method.config.country`, `payment_method.config.channel`, and `payment_method.config.bank_ids` using the selected `PaymentMethodBank`. |
| `MOUNT_COLLECT_ERROR`             | Secure fields could not mount or collect valid card data.                                                                                                    | `card_fields.mount()`, `tonder.pay()`, `tonder.enrollCard()`             | Ensure all field containers exist and the shopper completed valid card fields.                                                                      |
| `PAYMENT_PROCESS_ERROR`           | Tonder could not create/process the payment or the transport failed. Declined payments returned by Tonder are not thrown; they are returned as transactions. | `tonder.pay()`                                                           | Inspect `error.details` and reconcile with your backend logs. Retry only when safe/idempotent.                                                      |
| `FETCH_TRANSACTION_ERROR`         | Transaction lookup failed.                                                                                                                                   | `tonder.getTransaction()`, embedded 3DS reconciliation in `tonder.pay()` | Verify the transaction id and retry from backend/webhook records.                                                                                   |
| `REQUEST_ABORTED`                 | A request or embedded hosted-payment wait was canceled.                                                                                                      | `tonder.pay()`, `tonder.getTransaction()`                                | Treat as an interrupted client flow and reconcile from backend/webhooks.                                                                            |
| `REQUEST_FAILED`                  | A low-level network/HTTP request failed before it could be mapped to a more specific operation.                                                              | Browser/network-dependent operations                                     | Check connectivity, CORS/CSP, and API availability.                                                                                                 |
| `POLL_TIMEOUT_ERROR`              | Embedded card 3DS signaled completion, but reconciliation did not reach a final status in time.                                                              | `tonder.pay()` for embedded card 3DS                                     | Do not fulfill from the client result alone; reconcile with `getTransaction()` or webhooks.                                                         |

### Payment method discovery

| Code                               | When it happens                                | Returned by                      | How to fix                                                                                                            |
| ---------------------------------- | ---------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `FETCH_PAYMENT_METHODS_ERROR`      | Active payment methods could not be retrieved. | `tonder.getPaymentMethods()`     | Retry or offer known method codes directly through `pay()`. `getPaymentMethods()` is optional for checkout rendering. |
| `FETCH_PAYMENT_METHOD_BANKS_ERROR` | SafetyPay bank options could not be retrieved. | `tonder.getPaymentMethodBanks()` | Retry later or hide SafetyPay bank-backed options until banks are available.                                          |

### Secure-field session errors

| Code                  | When it happens                                                 | Returned by                                   | How to fix                                     |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `VAULT_TOKEN_ERROR`   | The SDK could not prepare a secure card-fields session.         | `card_fields.mount()`, `card_fields.reveal()` | Verify merchant vault configuration and retry. |
| `INVALID_VAULT_TOKEN` | Tonder returned an invalid secure card-fields session response. | `card_fields.mount()`, `card_fields.reveal()` | Retry and contact Tonder if it persists.       |

### Rare or compatibility codes

These codes are part of the stable enum for compatibility, but they are not expected in normal Web SDK integrations unless a lower-level adapter or legacy path surfaces them.

| Code                            | Meaning                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| `CREATE_ERROR`                  | SDK creation failed before a usable instance was returned.            |
| `INVALID_TYPE`                  | Legacy/compat SDK type validation failed.                             |
| `STATE_ERROR`                   | Internal SDK state update failed.                                     |
| `INVALID_CONFIG`                | Required configuration is missing or malformed.                       |
| `MERCHANT_CREDENTIAL_REQUIRED`  | Merchant credential is missing for a lower-level operation.           |
| `ENVIRONMENT_REQUIRED`          | Environment was not provided.                                         |
| `CUSTOMER_AUTH_TOKEN_NOT_VALID` | Customer auth token was rejected by a lower-level saved-card request. |
| `INVALID_CARD_DATA`             | Card data failed lower-level validation.                              |
| `SAVE_CARD_PROCESS_ERROR`       | Lower-level save-card processing failed.                              |
| `SECURE_TOKEN_INVALID`          | Secure token was rejected by a lower-level operation.                 |
| `INVALID_EMAIL`                 | Customer email failed validation.                                     |
| `THREEDS_REDIRECTION_ERROR`     | 3DS redirection failed in a lower-level hosted flow.                  |
| `UNKNOWN_ERROR`                 | Unexpected SDK error fallback.                                        |

## Payment statuses

Read payment state from `transaction.status`.

| Status       | Meaning                                                                            | What to do                                                           |
| ------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Success`    | Payment completed.                                                                 | Confirm the order.                                                   |
| `Authorized` | Payment was authorized by the processor path.                                      | Continue according to your Tonder setup and reconcile with webhooks. |
| `Pending`    | Payment is not final yet. Common for redirect 3DS and asynchronous APM/SPEI flows. | Wait for webhook confirmation or read later with `getTransaction()`. |
| `Processing` | Payment is still being processed by the provider.                                  | Do not fulfill yet; wait for webhook or query again later.           |
| `Declined`   | Issuer/processor declined the payment.                                             | Show a recoverable payment message.                                  |
| `Failed`     | Payment failed.                                                                    | Show a recoverable payment message or ask for another method.        |
| `Cancelled`  | Payment was cancelled or voided.                                                   | Do not fulfill; let the shopper start a new payment if needed.       |
| `Expired`    | Payment was not completed in time.                                                 | Ask the customer to start a new payment.                             |

## Webhooks

Webhooks are server-to-server notifications from Tonder to your backend. Use them as the source of truth for post-payment events and fulfillment, especially when the shopper leaves the browser flow or the payment completes asynchronously.

Use webhooks when:

- A payment can complete after the shopper leaves your page.
- You use asynchronous methods such as SPEI, OXXO, SafetyPay, or Mercado Pago.
- You need reliable order fulfillment, inventory release, receipts, or ledger updates.
- You need to reconcile `Pending` transactions after redirect/hosted-payment flows.

Tonder webhooks use a flat payload: fields are at the top level, not wrapped in a nested `data` object. Common payment fields include:

| Field                 | Type   | Description                                                            |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| `id`                  | string | Unique webhook event identifier.                                       |
| `operation_type`      | string | Operation type, usually `payment` for this SDK.                        |
| `amount`              | string | Transaction amount as sent by the webhook event.                       |
| `currency`            | string | ISO currency code, for example `MXN`.                                  |
| `client_reference`    | string | Your own order/reference identifier.                                   |
| `status`              | string | Current transaction status. See [Payment statuses](#payment-statuses). |
| `provider`            | string | Payment provider/acquirer that processed the transaction.              |
| `transaction_id`      | string | Tonder transaction identifier.                                         |
| `payment_method_type` | string | Payment method used, for example `CARD`, `SPEI`, or `OXXO`.            |
| `created`             | string | ISO timestamp for the event.                                           |
| `metadata`            | object | Metadata you passed when creating the payment.                         |
| `event_type`          | string | Event name, for example `payment_Success` or `payment_Pending`.        |
| `action`              | string | Event action, for example `MODIFY`.                                    |

Example `payment_Success` event:

```json
{
  "id": "fc38522e-3e5d-45b8-ba6a-ece72caee71f",
  "operation_type": "payment",
  "amount": "70",
  "currency": "MXN",
  "client_reference": "order_1001",
  "status": "Success",
  "provider": "tonder",
  "transaction_id": "e9340a04-6d68-4afc-86c5-79f8b7c87de4",
  "payment_method_type": "SPEI",
  "created": "2026-05-21T19:15:32.029134Z",
  "metadata": {
    "cart_id": "cart_789"
  },
  "event_type": "payment_Success",
  "action": "MODIFY"
}
```

Webhook endpoint checklist:

- Use a publicly reachable HTTPS URL.
- Verify the request comes from Tonder according to your account configuration.
- Respond within 30 seconds.
- Return any `2xx` status to acknowledge receipt.
- Make processing idempotent by storing processed event IDs.

For setup, retry behavior, and delivery details, see [How webhooks work](https://docs.tonder.io/direct-integration/webhooks/how-webhooks-works).

## CDN build

For browser `<script>` usage, load the SDK from the environment CDN:

| Environment | CDN URL                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| Stage       | `https://zplit-stage.s3.us-east-1.amazonaws.com/web-sdk/v1/tonder-web-sdk.min.js` |
| Production  | `https://zplit-prod.s3.us-east-1.amazonaws.com/web-sdk/v1/tonder-web-sdk.min.js`  |

```html
<script src="https://zplit-stage.s3.us-east-1.amazonaws.com/web-sdk/v1/tonder-web-sdk.min.js"></script>
<script>
  const { createTonder } = window.Tonder;
</script>
```

### CDN with TypeScript types

The CDN build exposes the SDK at `window.Tonder`. If a React, Angular, or TypeScript app loads the runtime from the CDN, TypeScript does not automatically know the global SDK shape.

You can install the npm package as a development dependency only for types while still using the CDN runtime:

```bash
npm install -D @tonder.io/web-sdk
```

```ts
import type * as TonderWebSdk from '@tonder.io/web-sdk';

declare global {
  interface Window {
    Tonder: typeof TonderWebSdk;
  }
}
```

Keep the CDN script in your HTML entry point and use the browser global at runtime:

```ts
const { createTonder } = window.Tonder;
```

Do not import runtime code from `@tonder.io/web-sdk` when using the CDN setup. The package is installed only as a devDependency for TypeScript types.
