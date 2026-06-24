# Tasks: public-api-consistency

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~900-1300 (7 unit rewrites, 1 new suite, 2 e2e, facade+adapter+types+index+README+demos) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (Customer+pay) -> PR2 (create() component) -> PR3 (events) -> PR4 (types/exports/docs) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Customer unification + pay() config-only customer | PR 1 | Base=main (or tracker). Groups 1+2 are compile-coupled (Customer type feeds pay's customer source). ~250-350 lines. |
| 2 | Component factory `create()`/handle, delete verb methods | PR 2 | Base=PR1 branch. Largest unit (~350-450 lines): new TonderComponent, adapter context wiring, tonder.create.test.ts. |
| 3 | Events re-home (input events in options, presentation.events namespace) | PR 3 | Base=PR2 branch. Can ride with PR2 if reviewer prefers fewer hops; kept separate here to bound diff size (~150-200 lines). |
| 4 | Type hygiene, exports, README/demos | PR 4 | Base=PR3 branch. Suffix renames, dead-type deletion, index.ts delta, docs (~150-250 lines). |

Groups 1+2 (spec) map to work units 1 (Customer+pay) here; group "component model" is its own unit (2); "events" is its own unit (3); "type hygiene + docs" closes as unit (4). This keeps each PR under budget and each has independent compile boundaries except unit 1 -> unit 2 (component pay-collection reads config.customer indirectly via existing pay path, not a hard type dependency, but tests in unit 2 assume unit 1's MISSING_CUSTOMER pre-flight exists).

## Phase 1: Customer Unification (Unit 1a)

- [x] 1.1 RED: `src/core/services/customer.service.test.ts` — add test asserting `Customer` type (not `CustomerInput`) is accepted by customer.service functions; run to confirm failure.
- [x] 1.2 GREEN: Rename `CustomerInput` -> `Customer` in `src/shared/types/index.ts`; delete old `CustomerInput` export.
- [x] 1.3 GREEN: Update `src/core/services/customer.service.ts` to use `Customer` type.
- [x] 1.4 GREEN: Update `src/core/TonderCore.ts`, `src/tonder.ts`, `src/adapters/skyflow/skyflow.adapter.ts`, `src/types/card.ts` references from `CustomerInput` to `Customer`. (Note: adapter/card.ts had zero `CustomerInput` refs; index.ts export renamed.)
- [x] 1.5 RED: `src/tonder.test.ts` — add test: enrollCard contact mapping uses canonical `Customer` shape end-to-end; run to confirm failure if mapping still references old shape. (Existing `src/tonder.enrollCard.test.ts` already asserts contact mapping from the canonical `config.customer` shape end-to-end; passes under the rename.)
- [x] 1.6 GREEN: Fix enrollCard contact-mapping code path in `src/tonder.ts` to consume `Customer`. (Mapping already reads `state.customerInput` — now typed `Customer`; shape identical, no code change needed.)
- [x] 1.7 REFACTOR: grep-proof — `grep -r "CustomerInput" src/` returns zero matches.

## Phase 2: pay() Customer Config-Only (Unit 1b)

- [x] 2.1 RED: `src/tonder.pay.test.ts` — add test "pay() without config.customer throws MISSING_CUSTOMER before any network call" for all 4 pay method types (card, savedCard, apm, spei); assert fetch/network mock NOT called.
- [x] 2.2 RED: `src/tonder.pay.test.ts` — add test "MISSING_CUSTOMER precedes INVALID_PAYMENT_REQUEST (amount) when both invalid".
- [x] 2.3 RED: `src/tonder.pay.test.ts` — add test "pay() derives name from firstName+lastName via `[firstName, lastName].filter(Boolean).join(' ')`, sends {name, email} only (no phone) in /process body" — 4 cases: both present, firstName only, lastName only, neither (name empty string per design).
- [x] 2.4 GREEN: Remove `customer` field from `PayInput` type in `src/shared/types/index.ts`.
- [x] 2.5 GREEN: Add MISSING_CUSTOMER pre-flight check in `src/tonder.ts` `pay()` — before `assertValidPayInput`, after NOT_INITIALIZED check, reusing existing `ErrorKeyEnum.MISSING_CUSTOMER`.
- [x] 2.6 GREEN: Update `buildProcessBody` in `src/tonder.ts` to derive `name` from `config.customer.firstName`/`lastName` via `[firstName, lastName].filter(Boolean).join(' ')`, send `{name, email}` only (drop phone from /process payload).
- [x] 2.7 REFACTOR: Confirm `createTonder` without customer stays legal (read-only usage) — added explicit test in `src/tonder.test.ts`.
- [x] 2.8 REFACTOR: Type-level check — attempting `pay({ ...input, customer })` fails to compile (`// @ts-expect-error` assertion in `src/tonder.pay.test.ts`).

## Phase 3: Component Model — create()/handle (Unit 2)

- [x] 3.1 RED: New `src/tonder.create.test.ts` — test `tonder.create('cardFields', options)` returns handle with `mount(container?)`, `unmount()`, `reveal()`; run to confirm failure (function doesn't exist yet).
- [x] 3.2 RED: `src/tonder.create.test.ts` — test mount-before-init throws (matches existing NOT_INITIALIZED pattern).
- [x] 3.3 RED: `src/tonder.create.test.ts` — test `create('cardFields')` invalid type throws NEW `ErrorKeyEnum.INVALID_COMPONENT_TYPE`.
- [x] 3.4 RED: `src/tonder.create.test.ts` — test new-card component (no cardId) resolves to `'create'` tokenizer context; saved-card component (cardId) resolves to `'update:<cardId>'` context.
- [x] 3.5 RED: `src/tonder.create.test.ts` — test two components coexist independently (new-card 'create' context + saved-card 'update:<cardId>' context) without cross-contamination.
- [x] 3.6 RED: `src/tonder.pay.test.ts` — test `pay({type:'card'})`/`enrollCard()` collect from the `'create'` context component via `this.tokenizer.collect()` (implicit, no component arg passed).
- [x] 3.7 RED: `src/tonder.create.test.ts` — test `reveal(req)` delegates to `TokenizerPort.reveal`.
- [x] 3.8 GREEN: Add `TonderComponentType = 'cardFields'` union and `TonderComponent`/`CardFieldsComponent` interfaces to `src/shared/types/index.ts`.
- [x] 3.9 GREEN: Implement `create(type, options)` factory method in `src/tonder.ts` calling internal `createCardFieldsComponent`; handle wraps existing `TokenizerPort` mount/unmount/collect/reveal, `mount(container?)` ignores container arg for multi-field cardFields per design decision (b).
- [x] 3.10 GREEN: Add `ErrorKeyEnum.INVALID_COMPONENT_TYPE` to error enum file (locate via `src/shared/` error definitions).
- [x] 3.11 GREEN: Delete `mountCardFields`, `unmountCardFields`, `revealCardFields` public methods from `src/tonder.ts`.
- [x] 3.12 REFACTOR: grep-proof — `grep -rE "mountCardFields|unmountCardFields|revealCardFields" src/` returns zero matches outside CHANGELOG/history.
- [x] 3.13 REFACTOR: Update `src/adapters/skyflow/skyflow.adapter.ts` mechanical renames (see Phase 5) if not already covered; confirm context-key mechanism (`'create'`/`'update:<cardId>'`) unchanged.

## Phase 4: Events Re-home (Unit 3)

- [x] 4.1 RED: `src/tonder.create.test.ts` — test `onReady`/`onChange`/`onFocus`/`onBlur` fire from `CardFieldsOptions.events` (component options), not from old mount config location.
- [x] 4.2 RED: `src/tonder.create.test.ts` — test events resolve per-component-instance: two mounted components with independent `events` maps do not cross-fire.
- [x] 4.3 RED: existing `src/adapters/skyflow/skyflow.adapter.ts` tests — verify `wireFieldEvents` still reads `request.events?.[field]` (should be unaffected; confirm via test run, not new test).
- [x] 4.4 GREEN: Move input-event wiring from old `mountCardFields` config path to `CardFieldsOptions.events` in `src/tonder.ts`/adapter call sites.
- [x] 4.5 RED: `src/tonder.test.ts` or new presentation test file — test `config.events.presentation.onOpen` fires on APM overlay open, read at fire time from `getConfig()`.
- [x] 4.6 RED: same file — test `config.events.presentation.onClose` fires on overlay close (replaces flat `TonderConfig.onClose`).
- [x] 4.7 RED: same file — test `config.events.presentation.onComplete` fires from namespaced location.
- [x] 4.8 RED: type-level test — flat `onOpen`/`onClose`/`onComplete` fields do not exist on `TonderConfig` (compile-time absence check).
- [x] 4.9 GREEN: Add `TonderEvents`/`PresentationEvents` types to `src/shared/types/index.ts`; add `events.presentation` to `TonderConfig`.
- [x] 4.10 GREEN: Rewire presentation callback call sites in `src/tonder.ts` (and browser-3ds-host adapter if it reads config callbacks) to read `getConfig().events?.presentation?.{onOpen,onClose,onComplete}` at fire time.
- [x] 4.11 GREEN: Delete flat `onOpen`/`onClose`/`onComplete` fields from `TonderConfig`.
- [x] 4.12 REFACTOR: grep-proof — no remaining flat callback field reads in `src/tonder.ts`, `src/adapters/browser/browser-3ds-host.adapter.ts`.

## Phase 5: Type Hygiene + Exports (Unit 4a)

- [x] 5.1 GREEN: Rename `MountCardFieldsRequest` -> `CardFieldsOptions` across `src/shared/types/index.ts`, `src/tonder.ts`, `src/adapters/skyflow/skyflow.adapter.ts`.
- [x] 5.2 GREEN: Rename `MountCardFieldEntry` -> `CardFieldEntry`.
- [x] 5.3 GREEN: Rename `RevealCardFieldsRequest` -> `RevealCardFieldsInput`.
- [x] 5.4 GREEN: Confirm `PayInput`, `EnrollResult`, `ApmBank`, `RevealCardField`, `PaymentMethodInfo` names kept as-is (no action, verification only).
- [x] 5.5 GREEN: Delete `PublicSuccess`/`PublicError` type exports from `src/shared/types/index.ts` and `src/index.ts`.
- [x] 5.6 RED: `src/tonder.getApmBanks.test.ts` — test `getApmBanks()` returns named `ApmBanks` type (not anonymous/`ApmBanksResult`); assert type shape `{ cash: ApmBank[]; transfer: ApmBank[] }`.
- [x] 5.7 GREEN: Add `ApmBanks` interface to `src/shared/types/index.ts`; update `getApmBanks()` return type in `src/tonder.ts`.
- [x] 5.8 GREEN: Update `src/index.ts` exports — ADD `Customer`, `ApmBanks`, `TonderComponentType`, `TonderComponent`, `CardFieldsComponent`, `CardFieldsOptions`, `CardFieldEntry`, `RevealCardFieldsInput`, `TonderEvents`, `PresentationEvents`; RENAME the 3 from 5.1-5.3; DELETE `PublicError`/`PublicSuccess`.
- [x] 5.9 REFACTOR: grep-proof — `grep -rE "PublicSuccess|PublicError|MountCardFieldsRequest|MountCardFieldEntry|RevealCardFieldsRequest|CustomerInput" src/` returns zero matches.
- [x] 5.10 REFACTOR: Run `npx tsc --noEmit` to confirm no orphaned type references.

## Phase 6: Docs, Demos, Final Verification (Unit 4b)

- [x] 6.1 Update `README.md` — rewrite public API section: `Customer` config, `pay()` without customer arg, `create('cardFields', options)` lifecycle, `events.presentation` callbacks, remove all `mountCardFields`/`unmountCardFields`/`revealCardFields`/flat-callback references.
- [x] 6.2 Update sibling demos at `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/pay.html` — replace `mountCardFields` with `tonder.create('cardFields', options).mount()`; move customer into config.
- [x] 6.3 Update `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/apms.html` — replace flat presentation callbacks with `events.presentation.*`.
- [x] 6.4 Update `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/enroll.html` — update to `create().mount()` + config-only customer.
- [x] 6.5 Grep `docs/` (if present) for stale references to removed verbs/types; update or flag for follow-up.
- [x] 6.6 Run full suite: `npm test` (all RED tests now GREEN, zero regressions).
- [x] 6.7 Run `npx tsc --noEmit` (typecheck clean).
- [x] 6.8 Run lint (project's configured lint command).
- [x] 6.9 Run `npm run build` (build succeeds, bundle emits expected public exports).
