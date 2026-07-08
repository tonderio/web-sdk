# Verify Report: public-api-consistency

**Verdict: PASS**

Fresh-context adversarial verification of the whole change (Slices A + B) on `feature/DEV-2245`. All 59/59 tasks checked and confirmed against actual source, dist build, README, e2e, and sibling demos repo.

## Test / Build Evidence (run live, not trusted from prior reports)

| Command | Result |
|---|---|
| `npm test` | 279 passed, 0 failed (30 test files) |
| `npm run typecheck` (src + e2e tsconfig) | Clean, 0 errors |
| `npm run lint` | 0 errors, 1 pre-existing warning (`e2e/support/fixtures.ts:222`, unused eslint-disable for `no-new-func`, unrelated to this change) |
| tasks.md | 59/59 `[x]`, 0 unchecked |

## Requirement-by-requirement verification

### 1. One Customer shape — PASS
- `grep -rn "CustomerInput" src/ dist/index.d.ts` → zero hits.
- `src/shared/types/index.ts:176` defines exactly `Customer { email: string; firstName?; lastName?; phone? }`.
- Exported once from `src/index.ts:28`. No alternate customer shape found anywhere in public surface.

### 2. pay() config-only, MISSING_CUSTOMER pre-flight — PASS
- `PayInput` (`src/shared/types/index.ts:202`) has no `customer` field.
- `src/tonder.ts:303-314`: guard order confirmed as NOT_INITIALIZED (304-306) → MISSING_CUSTOMER (312-314) → `assertValidPayInput` (316). Comment at line 311 explicitly states this precedence and it matches runtime behavior.
- Runtime-tested for all 4 `PaymentMethod` types (`card`, `savedCard`, `apm`, `spei`) via `it.each` in `src/tonder.pay.test.ts:186-211`, asserting `processSpy` never called (zero network).
- Precedence test at `src/tonder.pay.test.ts:214-229` proves MISSING_CUSTOMER wins over invalid amount.
- `buildProcessBody` (`src/tonder.ts:875-901`): sends `customer: { name, email }` only; `name = [firstName, lastName].filter(Boolean).join(' ')`; `phone` never referenced — confirmed absent from the body.

### 3. Component model (create/handle) — PASS
- `src/tonder.ts:196-231`: `create<T>(type, options)` throws `AppError(INVALID_COMPONENT_TYPE)` for unknown types (line 203); `'cardFields'` builds a handle exposing `mount(container?)`, `unmount()`, `reveal()`.
- `contextKey = options.cardId ? 'update:<cardId>' : 'create'` (line 217) — matches spec's create/update context split.
- `pay()`/`enrollCard()` signatures unchanged; both still collect from the `'create'` tokenizer context (shared with the new-card component).
- Old verb methods `mountCardFields`/`unmountCardFields`/`revealCardFields` absent from `src/tonder.ts` and `src/index.ts` (grep zero hits); confirmed absent at runtime in `src/tonder.create.test.ts:200-207`; confirmed absent from `dist/index.d.ts` (only a JSDoc migration-note mention of the old name remains, not a live symbol).

### 4. Events — PASS
- Input field events remain per-component on `CardFieldsOptions.events` (unchanged wiring in the Skyflow adapter).
- Presentation callbacks read ONLY at fire time from `config.events?.presentation?.{onOpen,onClose,onComplete}` — 3 call sites confirmed: `src/tonder.ts:393`, `:429`, `:479-480`.
- `TonderConfig` (`src/shared/types/index.ts:48-90`) has no flat `onOpen`/`onClose`/`onComplete` fields — only `presentationMode` and a namespaced `events` field; the flat callback fields that exist in the file (lines 20/26/31) belong to the separate `PresentationEvents` interface, not `TonderConfig`.

### 5. Type hygiene — PASS
- `PublicSuccess`/`PublicError`: zero hits in `src/index.ts`, `src/shared/types/index.ts`, and `dist/index.d.ts`.
- `getApmBanks()` returns named `ApmBanks { cash: ApmBank[]; transfer: ApmBank[] }` (`src/shared/types/index.ts:164-169`), exported from `src/index.ts:32`.
- Renames confirmed consistent: `CardFieldsOptions`, `CardFieldEntry`, `RevealCardFieldsInput` all present and exported from `src/index.ts:36-45`; old names (`MountCardFieldsRequest`, `MountCardFieldEntry`, `RevealCardFieldsRequest`) absent from `src/` (grep zero hits).
- `src/index.ts` export surface is coherent: named exports only, grouped by domain (core, config/events, card-fields/component, customization), no barrel re-exports.

### 6. Prior invariants NOT regressed — PASS
- Bare `RawTransaction` return contract unchanged (`pay`/`getTransaction`/`pollTransaction` all return the raw shape per `src/tonder.ts` docblocks and unchanged test suite).
- SDK-owned modal behavior unchanged except callback rehoming: 3DS non-closable auto-poll path and APM closable-X path both wired to `events.presentation.onClose`/`onOpen`/`onComplete` at the confirmed call sites above.
- Skyflow-native error-label ordering intact: `src/adapters/skyflow/skyflow.adapter.ts:437-438` confirms `element.setError?.(message)` runs strictly before any `update()` call, with an explicit load-bearing-order comment at line 405.
- Still-Pending never returned as final: `FINAL_STATUSES` set (`src/shared/utils/poll.ts:28`) still gates poll resolution (`poll.ts:163`); APM/SPEI raw-Pending path is a deliberate non-poll return, per spec, not a regression.

### 7. Demos consistency (sibling repo, uncommitted) — PASS
- `/Volumes/MacDev/Tonder/SDKs/demos/web-sdk-v3/{pay,apms,enroll}.html` all use `config.customer`, `tonder.create('cardFields', ...)`, and `config.events.presentation.*`.
- Zero grep hits for `mountCardFields`/`unmountCardFields`/`revealCardFields`/`CustomerInput`/flat `config.onOpen|onClose|onComplete` across the three demo files.

### 8. Straggler sweep — PASS (all findings benign)
- `README.md`: zero hits for any old name.
- `e2e/tests/card-pay.spec.ts:86`: comment noting a verb was replaced — not a live reference.
- `src/adapters/skyflow/skyflow.adapter.ts:264,272,292`: internal `console.warn('[revealCardFields] ...')` log tags — pre-existing internal logging identifiers, not public API surface.
- `src/types/card.ts:181`: JSDoc historical note ("the removed top-level `revealCardFields`") — intentional migration context, not a live symbol.
- `src/tonder.create.test.ts:200-207`: test asserting the old verbs are `undefined` — this is the actual regression guard, correctly named after what it disproves.
- `docs/` planning artifacts (PRD.md, proposal history, etc.) still reference old names — explicitly out of scope per apply-progress (historical record, not rewritten), correctly flagged as a follow-up, not a defect of this change.

## Issues

None found at CRITICAL or WARNING level.

**SUGGESTION** (non-blocking):
- Consider a follow-up doc-refresh task for `docs/` planning artifacts (PRD.md, 04-proposal.md, 02-current-sdks.md, 06-readme-guidelines.md, 07-implementation-status.md) if the team wants historical planning docs to reflect the new API — currently correctly left untouched as history, per apply-progress notes.
- The pre-existing lint warning in `e2e/support/fixtures.ts:222` (unused eslint-disable) is unrelated to this change but could be cleaned up opportunistically.

## Final Verdict

**PASS** — All 6 spec requirement domains verified with source + runtime evidence, no regressions, demos and README consistent, only pre-existing/out-of-scope items remain (correctly flagged, not defects). Ready for `sdd-archive`.
