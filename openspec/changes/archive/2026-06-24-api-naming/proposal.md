# Change: api-naming — normalize the public surface to one convention

## Intent
Make the public SDK surface follow ONE consistent naming convention before more API lands. Today it
mixes camelCase (`TonderConfig`) with snake_case (`card_id`, `'saved_card'`, `CardField: 'card_number'`,
`BusinessConfig`) and mixes `I`-prefixed types with non-prefixed ones. Pre-1.0, nothing published — fix
it now so it never becomes a breaking change.

## Convention (applies to all future slices too)
1. **camelCase** for all public object keys, option names, and string-union identifier/discriminator
   values.
2. **No `I` prefix** on exported types.
3. **kebab-case** for default HTML container ids (different domain — HTML id attributes).
4. Backend snake_case stays **internal** (mapped at the adapter/service boundary); never exported.

## Scope (in)
- **Drop `I` prefix** on every exported type: `IMountCardFieldsRequest→MountCardFieldsRequest`,
  `IRevealCardField→RevealCardField`, `IRevealCardFieldsRequest→RevealCardFieldsRequest`,
  `ICardCustomization→CardCustomization`, `ICardStyles→CardStyles`, `ICardLabels→CardLabels`,
  `ICardPlaceholders→CardPlaceholders`, `IFieldStyles→FieldStyles`, `IPublicError→PublicError`,
  `IPublicSuccess→PublicSuccess`, `IAppErrorInput→AppErrorInput`,
  `IBuildPublicAppErrorInput→BuildPublicAppErrorInput`.
- **camelCase keys/values**:
  - `MountCardFieldsRequest`: `card_id→cardId`, `unmount_context→unmountContext`.
  - `MountCardFieldEntry` + `RevealCardField`: `container_id→containerId`.
  - `CardField` values → `'cardNumber' | 'cvv' | 'expirationMonth' | 'expirationYear' | 'cardholderName'`.
  - `PaymentMethod`: `'saved_card'→'savedCard'`.
- **Resolve the `CardStyles` collision**: remove the placeholder `CardStyles` stub in `shared/types`;
  `TonderConfig.customization` becomes `CardCustomization` (the real type from `types/customization.ts`).
- **Un-export `BusinessConfig`** from `index.ts` (keep the type internal; it mirrors the backend
  snake_case response and is internal state — not public API). The model file keeps snake_case.
- **SkyflowAdapter**: introduce a `CARD_FIELD_META` map `camelCaseField → { column (snake, Skyflow),
  defaultContainerId (kebab) }`. Defaults: `#collect-card-number`, `#collect-cvv` (saved card:
  `#collect-cvv-<cardId>`), `#collect-expiration-month`, `#collect-expiration-year`,
  `#collect-cardholder-name`; reveal `#reveal-card-number`, etc. The internal Skyflow `column` and the
  `collect()` token map remain snake (internal only).
- Update all tests to the new names/values (keep the suite green). Update JSDoc that references old
  ids/values.

## Scope (out)
- No behavior change — pure rename/normalization. No new endpoints/flows. README quickstart waits for
  the card-payment slice (no usable end-to-end example yet).

## Approach
Mechanical rename across `src/`, done with tests updated alongside (the suite must stay green — strict
TDD here means the renamed tests assert the renamed API). `core/` stays pure. The public→backend/Skyflow
mapping lives only in adapters.

## Acceptance criteria
- `grep` for snake_case keys in PUBLIC types (`card_id`, `container_id`, `unmount_context`,
  `'saved_card'`, `'card_number'` as a CardField value) returns nothing in `src/types`, `src/shared/types`,
  `src/ports`, and `src/index.ts`.
- No `I`-prefixed type is exported from `src/index.ts`.
- `BusinessConfig` not exported from `src/index.ts`.
- `dist/index.d.ts` reflects the camelCase, non-`I` names; `CardField` is the camelCase union.
- All gates green: typecheck, lint, build (4 artifacts), `vitest run` (same test count, all pass),
  `npm audit` 0.
- SkyflowAdapter still mounts using the kebab default container ids and maps fields to the correct
  Skyflow snake columns (assert in tests).

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR).
