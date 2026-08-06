# Tasks: Apple Pay Foundation (Phase 1)

> Revision note: re-cut from 3 units/24 tasks to **2 units** after proposal
> revision 4 (decisions D1–D5) and the design rewrite (decisions DD1–DD7).
> `ApplePayConfig` is gone; nothing declared in this phase is wired into a
> reachable public surface (D3/DD2). Engram `sdd/apple-pay-foundation/tasks`
> is STALE (Engram MCP is down at write time) — this file is authoritative.

Delivery: **commits only, no pull requests.** Two work units = two commits.
Split line: **inert (nothing references it) vs. signature-touching**.

## Review Workload Forecast

| Field                   | Value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| Estimated changed lines | ~35 (commit 1) / ~110 (commit 2) — ~145 total                                |
| 400-line budget risk    | Low                                                                          |
| Chained PRs recommended | No — commits-only; split a commit further if it grows, never open a PR chain |
| Suggested split         | Not applicable (no PRs). Commit 1 → Commit 2, each independently revertible  |
| Delivery strategy       | commits-only                                                                 |
| Chain strategy          | not applicable — no PRs this change                                          |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Work Units (commits)

| Unit | Goal                                                                 | Commit message                                             | Depends on |
| ---- | -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| 1    | Inert declarations — nothing references, reads, or exports any of it | `feat: declare Apple Pay foundation types and error codes` | none       |
| 2    | Component types — the only unit touching existing signatures         | `refactor: narrow create() return type per component`      | Unit 1     |

`src/types/apple-pay.ts` sits in Unit 2 (forced ordering): `ApplePayButtonComponent` aliasing `TonderMountableComponent`, which doesn't exist until Unit 2.

**Verification caveat (binding, unchanged):** `expectTypeOf` in `*.test.ts` is erased at runtime and never type-checked (`tsconfig.json:20` excludes `**/*.test.ts`; `npm run test` has no `--typecheck`). Never treat a passing `expectTypeOf` assertion as an acceptance criterion — it is documentation only. The real gate is `npm run typecheck`, pass 2 of which (`-p e2e/tsconfig.json`) covers the genuine call site `e2e/support/fixtures.ts:123-135`. Fixing the type-test tooling gap is an approved, separate change — out of scope here.

## Phase 1: Inert declarations (Unit 1)

- [x] 1.1 `package.json` — add `@types/applepayjs` to `devDependencies`.
- [x] 1.2 `src/models/business.model.ts` — add `country_code?: string` to `BusinessProfile`. Do NOT add `ApplePayConfig` or `apple_pay` anywhere (D5/DD5 — that interface no longer exists in the design).
- [x] 1.3 `src/core/services/direct-api.service.ts` (~L17-30) — add `configuration?: { supported_networks?: string[] }` to the module-private `BackendPaymentMethod` interface. No `export` keyword change; no consumer reads the field.
- [x] 1.4 `src/shared/errors/ErrorKeyEnum.ts` — add six members: `APPLE_PAY_NOT_ENABLED`, `APPLE_PAY_UNSUPPORTED_BROWSER`, `APPLE_PAY_CONTAINER_NOT_FOUND`, `APPLE_PAY_SESSION_ERROR`, `APPLE_PAY_VALIDATION_ERROR`, `APPLE_PAY_UNSUPPORTED_ACTION`. Document `APPLE_PAY_NOT_ENABLED` per plan §5.2 meaning ("no active `apple_pay_*` method in the catalog, or no `country_code` on the business"). No existing member changes.
- [x] 1.5 `src/shared/types/index.ts` — add `PaymentEvents { on_success?, on_error?, on_cancel? }` with `import type { RawTransaction } from '../../models/transaction.model'` and `import type { AppError } from '../errors/AppError'`. Keep `export` on the interface (internal modules must be able to import it later). Do **NOT** add `payment?` to `TonderEvents` and do NOT touch the `TonderConfig.events` JSDoc — nothing describes a key that doesn't exist yet.
- [x] 1.6 `src/types/customization.ts` — add `ApplePayButtonCustomization { type?, style?, locale?, height?, border_radius? }` (proposal D4 verbatim shape, no icon/image field). Keep `export`. Do **NOT** add `apple_pay_button?` to `TonderCustomization`.
- [x] 1.7 Create `src/models/business.model.test.ts` — fixtures with/without `country_code`; comment noting compile-time-only, not runtime-enforced.
- [x] 1.8 Create test coverage for `BackendPaymentMethod.configuration?` (fixtures with/without) and confirm existing `getPaymentMethods()` fixtures/assertions are untouched (byte-identical output requirement).
- [x] 1.9 Verify:
  - `npm run test` — runtime pass only; does not prove any type claim.
  - `npm run typecheck` — real gate: proves both interfaces accept optional/present forms and every existing consumer (incl. `getPaymentMethods()` mapping layer) still compiles.
  - `npm run build && rg -c applepayjs dist/index.d.ts` (expect `0`) `&& rg -c 'ApplePayJS|applepayjs' dist/tonder-web-sdk.js dist/index.mjs dist/index.cjs` (expect `0` each) — proves `@types/applepayjs` absent from every artifact.
- [x] 1.10 Mechanical absence checks (DD2 — verifiable only by absence, run and read the output; do not judgment-call this):
  - `rg -n ApplePayConfig src` — expect **no output**.
  - `rg -A3 "interface TonderEvents" src/shared/types/index.ts` — read the output; confirm no `payment` key present.
  - `rg -A6 "interface TonderCustomization" src/types/customization.ts` — read the output; confirm no `apple_pay_button` key present.
  - `rg -n "PaymentEvents|ApplePayButtonCustomization" src --glob '!*.test.ts'` — expect matches only inside `src/shared/types/index.ts` and `src/types/customization.ts` (their declaring files); no other production file references them.
- [x] 1.11 Commit: `feat: declare Apple Pay foundation types and error codes`.

**Green after Unit 1:** test + typecheck + build pass; `getPaymentMethods()` output byte-identical; all 1.10 absence checks hold; `@types/applepayjs` absent from `dist/`. Unreachable by construction — safe to leave in place indefinitely if Unit 2 stalls.

## Phase 2: Component types (Unit 2)

- [x] 2.1 Create `src/types/component.ts` — `TonderMountableComponent { mount(): Promise<void>; unmount(): void }` (DD3).
- [x] 2.2 `src/types/card.ts` — `CardFieldsComponent extends TonderMountableComponent` (drop redeclared `mount`/`unmount`, keep `reveal()`); replace `ComponentOptionsByType` (currently `Record<...>`, line 200) with the explicit single-key interface; add sibling `ComponentByType { card_fields: CardFieldsComponent }`; `TonderComponent = ComponentByType[TonderComponentType]` (derived, DD1). `TonderComponentType` stays exactly `'card_fields'` — no widening.
- [x] 2.3 Create `src/types/apple-pay.ts` — `import type { PayInput } from '../shared/types'`, `import type { TonderMountableComponent } from './component'`; `ApplePayPaymentInput = Omit<PayInput, 'payment_method'>`; `ApplePayButtonOptions { container_id?: string; payment: ApplePayPaymentInput | (() => ApplePayPaymentInput) }`; `ApplePayButtonComponent = TonderMountableComponent` (alias, not an empty interface — see spec). Keep `export` on all three (internal modules may import them). Do **NOT** add `'apple_pay_button'` to `TonderComponentType`/`ComponentOptionsByType`/`ComponentByType`.
- [x] 2.4 `src/tonder.ts` — `create<T extends TonderComponentType>(type: T, options?: ComponentOptionsByType[T]): ComponentByType[T]` (line 204-207 today); add `ComponentByType` to the `./types/card` import; keep the single `type === 'card_fields'` branch with its documented `as ComponentByType[T]` cast.
- [x] 2.5 `src/index.ts` — add **exactly one** new named export: `TonderMountableComponent` from `./types/component`. Do NOT add `PaymentEvents`, `ApplePayButtonCustomization`, `ApplePayButtonOptions`, `ApplePayPaymentInput`, or `ApplePayButtonComponent` — none of these are exported from the barrel this phase, even though they keep `export` in their own modules.
- [x] 2.6 `src/types/card.test.ts` — confirm `TonderComponent` ≡ `CardFieldsComponent` assertion (`:123`) still holds against the derived type; add a `CardFieldsComponent` → `TonderMountableComponent` assignability scenario.
- [x] 2.7 Create `src/types/apple-pay.test.ts` — `payment_method` not assignable on `ApplePayPaymentInput`; `payment` accepts object or zero-arg-function form; `ApplePayPaymentInput` inherits new `PayInput` fields with no edit to `apple-pay.ts`.
- [x] 2.8 Verify:
  - `npm run test` — full-suite runtime pass, including every `tonder.*.test.ts` calling `.create('card_fields', …)`.
  - `npm run typecheck` — **the real acceptance gate**, both passes: pass 1 (`tsc --noEmit` over `src/**`) proves `create<T>()`, the barrel, and every `TonderComponent`/`BusinessConfig`/`BackendPaymentMethod` consumer compile; pass 2 (`-p e2e/tsconfig.json`) proves `e2e/support/fixtures.ts:123-135`'s `t.create('card_fields', {...})` → `component.mount()` still compiles untouched — not the `expectTypeOf` assertions in 2.6/2.7, which prove nothing on their own.
  - `npm run build` + the same `rg` check from 1.9 — `src/types/apple-pay.ts` is a new leak vector for D6/DD6; confirm still absent.
- [x] 2.9 Mechanical absence/diff checks (DD2/DD7 — run and read the output):
  - `rg -n "TonderComponentType" src/types/card.ts` — confirm the union is still exactly `'card_fields'`.
  - Before this unit's changes (i.e., right after the Unit 1 commit — baseline unaffected by Unit 1), run `npm run build && cp dist/index.d.ts /tmp/index.d.ts.before`. After this unit's commit, run `npm run build && diff /tmp/index.d.ts.before dist/index.d.ts` — expect the diff to show exactly one addition, `TonderMountableComponent`, and nothing else added or removed.
- [x] 2.10 Human-only check (no command proves this): re-read the diff against plan §3.2 — `ApplePayPaymentInput` redeclares no `PayInput` field, both component handles extend `TonderMountableComponent` without redeclaring its signature, no new error class introduced.
- [x] 2.11 Human-only check (no command proves this): `git diff --stat` across both commits — confirm no existing test file's assertion changed beyond a type-signature update.
- [x] 2.12 Commit: `refactor: narrow create() return type per component`.

**Green after Unit 2:** all of Unit 1's green state, plus the acceptance gate (2.8) and every 2.9 check hold.

## Next step

Complete. `sdd-verify` confirmed 23/23 tasks done, 0 CRITICAL findings (PASS WITH WARNINGS). Archived on 2026-08-03.
