# Tasks: api-naming (mechanical rename; keep the suite green at every step)

## 1. Errors + shared types
- [x] 1.1 `src/shared/errors/AppError.ts` — rename exported `IAppErrorInput→AppErrorInput`,
  `IBuildPublicAppErrorInput→BuildPublicAppErrorInput`. Update usages + tests.
- [x] 1.2 `src/shared/types/index.ts` — `IPublicError→PublicError`, `IPublicSuccess→PublicSuccess`;
  `PaymentMethod` `'saved_card'→'savedCard'`; remove the placeholder `CardStyles` stub;
  `TonderConfig.customization?: CardCustomization` (import from types/customization). Update usages.

## 2. Card + customization types
- [x] 2.1 `src/types/customization.ts` — drop `I` prefix: `ICardCustomization→CardCustomization`,
  `ICardStyles→CardStyles`, `ICardLabels→CardLabels`, `ICardPlaceholders→CardPlaceholders`,
  `IFieldStyles→FieldStyles`. Update internal refs.
- [x] 2.2 `src/types/card.ts` — `CardField` values → camelCase
  (`'cardNumber'|'cvv'|'expirationMonth'|'expirationYear'|'cardholderName'`); drop `I` prefix
  (`IMountCardFieldsRequest→MountCardFieldsRequest`, `IRevealCardField→RevealCardField`,
  `IRevealCardFieldsRequest→RevealCardFieldsRequest`); keys `card_id→cardId`,
  `unmount_context→unmountContext`, `container_id→containerId`. Update JSDoc (kebab default ids).

## 3. Ports
- [x] 3.1 `src/ports/tokenizer.port.ts` — update imports/usages to the renamed types.

## 4. SkyflowAdapter (TDD — behavior preserved, names changed)
- [x] 4.1 Update `src/adapters/skyflow/skyflow.adapter.test.ts` FIRST: use camelCase `CardField` values,
  `cardId`/`containerId`/`unmountContext`, and assert kebab default container ids
  (`#collect-card-number`, `#collect-cvv`, `#collect-cvv-<cardId>`, `#reveal-card-number`) AND that the
  field maps to the correct Skyflow `column` (snake) in `container.create({ column })`.
- [x] 4.2 `src/adapters/skyflow/skyflow.adapter.ts` — add `CARD_FIELD_META` map
  `camelField → { column, defaultContainerId }`; use it in `create()` (column) + `tryMountElement`
  (default id) + reveal. Keep `collect()` returning the raw Skyflow snake field map (internal). Make 4.1
  green.

## 5. Facade + exports
- [x] 5.1 `src/tonder.ts` — update to renamed types (mountCardFields/revealCardFields signatures). Update
  `src/tonder.test.ts` to the new names/values.
- [x] 5.2 `src/index.ts` — export the renamed types; REMOVE the `BusinessConfig` export; remove
  `CardStyles` stub export (now `CardCustomization` covers it). No `I`-prefixed export remains.

## 6. Verify
- [x] 6.1 `grep -rnE "card_id|container_id|unmount_context|'saved_card'|'card_number'" src/types src/shared/types src/ports src/index.ts` → no public matches. `grep "export .* I[A-Z]" src/index.ts` → none.
- [x] 6.2 `npm run typecheck`, `npm run lint`, `npm run build` (dist d.ts shows camelCase + non-I names;
  `BusinessConfig` absent from index.d.ts), `vitest run` (all pass, same count), `npm audit` (0).
- [x] 6.3 Work-unit commits on `feature/DEV-2245` (e.g. `refactor: drop I-prefix on public types`,
  `refactor: camelCase public keys and card field values`, `refactor: kebab default container ids + field map`).
