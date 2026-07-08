# Design: Standardize Public Payloads to snake_case

## Technical Approach

Use the SDK facade as the public contract boundary. Rename merchant-authored object fields to `snake_case`, keep methods/classes camelCase, and map only where the SDK owns a public projection. Do not remap `RawTransaction`: `pay()` and `getTransaction()` continue returning the raw Direct API body through `toRawTransaction` with only `amount` coercion and `psp_response` removal.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Public naming boundary | Public object fields become `snake_case`; method names stay camelCase. | Rename methods too; support aliases. | Matches Direct API payloads without making JS method names unnatural; no aliases avoids a second public contract. |
| Config shape | `createTonder({ api_key, environment, presentation_mode, session })`; `return_url` moves to `pay({ return_url })`. | Keep `mode`/`returnUrl` on config. | `environment` is clearer than `mode`; return URL is transaction-specific and must travel with each `/process` request. |
| Presentation config location | Keep `presentation_mode` at root config, not `customization`. | Move under `customization`. | It controls redirect vs embedded payment flow, not styling. |
| Presentation events | If public, use `events.presentation.on_open` and `on_close`; keep `onComplete` removed. | Keep camelCase callback fields. | Callback field names are public object fields and must follow the same rule; completion is represented by `pay()` result. |
| Embedded checkout redirect | Pass `presentation_mode` to backend and mint checkout JWT with `extra_data.needs_redirect=false` for embedded. | Query-param flag only. | Token-backed state survives 3DS callback URLs and avoids relying on mutable query propagation. |

## Data Flow

    createTonder(config)
      └─ stores api_key, environment, presentation_mode, session

    pay({ amount, return_url, payment_method })
      └─ Tonder.buildProcessBody
          ├─ Direct API body: return_url + payment_method + presentation_mode
          └─ POST /api/v1/process/ with X-App-Origin: sdk/web
              └─ zplit-back checkout JWT extra_data.needs_redirect=false when embedded
                  └─ spa-midd-checkout /process and ThreeDSPayment skip merchant redirect
                      └─ iframe posts { event: 'checkout.completed'|'checkout.failed' }

## File Changes

| File | Action | Description |
|---|---|---|
| `src/shared/types/index.ts` | Modify | Rename config/session/customer/pay/payment-method/event fields to `snake_case`; add `PayInput.return_url`; rename `mode` to `environment`; keep methods exported camelCase. |
| `src/tonder.ts` | Modify | Validate snake_case config/input, resolve env from `environment`, read `presentation_mode`, build `/process` from `input.return_url`, map saved-card `card_id`, and wire `on_open`/`on_close`. |
| `src/models/card.model.ts` | Modify | Public `Card` and `EnrollResult` become `card_id`, `card_number`, `expiration_month`, `expiration_year`, `card_scheme`, `subscription_id`. |
| `src/models/transaction.model.ts` | Keep | Preserve `RawTransaction` raw Direct API shape. |
| `src/core/services/direct-api.service.ts` | Modify | Return `PaymentMethodInfo.payment_method`; keep backend internals private. |
| `src/shared/errors/AppError.ts`, `src/shared/errors/messages.ts` | Modify | Public error fields become `status_code` and `details.system_error`; messages reference snake_case inputs. |
| `README.md`, `e2e/`, tests | Modify | Replace public examples/types/assertions with snake_case and remove stale camelCase expectations. |
| `/Volumes/MacDev/Tonder/zplit-back/zplit_back/apps/payments/...` | External modify | Accept SDK `presentation_mode`, carry it in checkout data, and mint checkout tokens with `extra_data.needs_redirect=false` for embedded. |
| `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout/src/modules/process/components/ProcessCheckout.tsx` | External verify/modify | Already checks `extra_data.needs_redirect`; keep that guard for Kushki/native 3DS. |
| `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout/src/modules/tonder/components/ThreeDSPayment.tsx` | External modify | Add the same `needs_redirect` guard so Tonder 3DS callback pages do not navigate the SDK iframe to the merchant return URL. |

## Interfaces / Contracts

Public SDK inputs use this shape:

```ts
createTonder({ api_key, environment, presentation_mode, session: { secure_token, customer: { first_name, last_name } } })
tonder.pay({ amount, return_url, payment_method: { type: 'saved_card', card_id } })
```

Direct API request bodies and raw transaction responses stay `snake_case`; `postMessage({ event })` is an external bridge control field and remains unchanged.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Public type/runtime contract, mapping, errors, RawTransaction passthrough | Vitest plus `@ts-expect-error` stale camelCase checks. |
| Integration | `/process` body uses `return_url` from `pay()` and sends `presentation_mode` | Service/facade tests with mocked `HttpPort`. |
| External | Embedded 3DS does not redirect iframe for embedded mode | zplit-back token tests and spa ProcessCheckout/ThreeDSPayment tests. |

## Migration / Rollout

Breaking SDK change before release; no data migration. Coordinate backend/checkout changes before enabling embedded checkout in demos.

## Open Questions

None.
