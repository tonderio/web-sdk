# Tasks: Apple Pay Browser Core (Phase 3)

Delivery is **commits only — no pull requests**. Order: WU1 (port + pure
strategy) -> WU2 (adapter session half) -> WU3 (adapter button half), per
design §8. Green after every unit: `npm run test`, `npm run typecheck`,
`npm run build`, with the lint error set unchanged from baseline.

**Refinement of the proposal's unit list (binding, design §8):** the port
lands in WU1, not WU2. `apple-pay.strategy.ts`'s `buildApplePayPaymentRequest`
return type IS `apple-pay.port.ts`'s `ApplePayPaymentRequest` alias (DD1), so
the strategy cannot compile without the port existing first. Same three
commits as the proposal, one type-only file moved earlier.

**Requirement legend** (spec `openspec/changes/apple-pay-browser-core/specs/apple-pay/spec.md`):

| ID  | Requirement                                                                   |
| --- | ----------------------------------------------------------------------------- |
| R1  | ApplePayPort reports browser capability without throwing                      |
| R2  | ApplePayPort.createSession takes handlers as constructor arguments            |
| R3  | Session handlers are normalized so Apple's event objects never cross the port |
| R4  | The adapter surfaces construction and container failures as AppError          |
| R5  | ApplePayButtonPort renders the WebKit button and owns its click lifecycle     |
| R6  | buildApplePayPaymentRequest is a pure builder of Apple's request shape        |
| R7  | buildApplePayPaymentMethod returns a local, non-public payment-method shape   |
| R8  | ApplePaySessionHandle.completePayment uses the version-3 object form          |
| R9  | Nothing added by the browser core is exported or reachable from merchant code |

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | WU1 ~410-450 (port ~140 + strategy ~90 + strategy test ~180-220) · WU2 ~330-370 (adapter session ~110 + fake global ~40 + test ~180-220 + messages ~3) · WU3 ~270-300 (adapter button ~90 + test ~180 + messages ~3)       |
| 400-line budget risk    | High for WU1 taken as one commit                                                                                                                                                                                           |
| Chained PRs recommended | No — delivery is commits-only, not PR-based                                                                                                                                                                                |
| Suggested split         | If WU1's single-commit diff is uncomfortable to review, split the **commit** into `1a` (`apple-pay.port.ts`, type-only, no test — verified by `tsc`) and `1b` (`apple-pay.strategy.ts` + its test). Never open a PR chain. |
| Delivery strategy       | commits-only (no PR splitting)                                                                                                                                                                                             |
| Chain strategy          | size-exception (no chaining mechanism available)                                                                                                                                                                           |

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High (WU1 only, mitigated by optional commit split above)
```

## What this phase cannot prove (design §7 — read before writing any test)

Ten statements are about **Apple's** behavior, not ours, and no fake in this
change proves them. No task below attaches a verification command claiming
otherwise; where a functional test doubles as a proxy for one of these (T1's
synchrony pattern, S3), the task says so explicitly. Full table: design §7
(S1-S10). All ten are owned by Phase 7, on real Safari hardware — nothing to
schedule here.

## Phase 0: Baseline

- [x] 0.1 Run `npm run lint`; record the current error set (two pre-existing
      failures at `tonder.handleRequiresAction.test.ts:184` and
      `tonder.pay.test.ts:483`) as the baseline for Phase 4's diff.
- [x] 0.2 Confirm no existing file imports `apple-pay.port.ts`,
      `apple-pay.strategy.ts`, or `apple-pay.adapter.ts` — they do not exist
      yet, so this is a placeholder check that becomes meaningful in Phase 4
      (nothing may start importing them from outside their own tests).

## Phase 1: WU1 — port module + pure strategy

- [x] 1.1 Create `src/ports/apple-pay.port.ts` (type-only, zero runtime
      output — no test file; verified by `tsc`, not `vitest`). Per design §2: - DD1 — `ApplePayPaymentRequest`, `ApplePayMerchantCapability`,
      `ApplePayPaymentToken` aliases. This is the ONLY module in `src/`
      allowed to write the identifier `ApplePayJS`. - DD2 — `ApplePaySessionHandlers` with `onValidateMerchant(): void |
Promise<void>`, `onPaymentAuthorized(token): void | Promise<void>`,
      `onCancel(): void | Promise<void>`. - DD3/DD4 — `ApplePayCompletion`, `ApplePayCompletionError`,
      `ApplePaySessionHandle` (`begin`, `completeMerchantValidation`,
      `completePayment`, `abort`). - `ApplePayPort` (`canUseApplePay(): boolean`; `createSession(request,
handlers): ApplePaySessionHandle`, synchronous). - `ApplePayButtonDisposer`, `ApplePayButtonRenderOptions` (`containerId`,
      `customization?`, `onClick()`), `ApplePayButtonPort.render(...)`.
- [x] 1.2 RED: create `src/core/strategies/apple-pay.strategy.test.ts` —
      `buildApplePayPaymentMethod` cases: [R7] returns `{ type: 'APPLE_PAY',
token }` with the token passed through by reference (not cloned); the
      local `ApplePayPaymentMethod` interface is not assignable from the
      public `PaymentMethod` union import (a same-file `// @ts-expect-error`
      or a separate `.test-d.ts`-style assertion is out of scope — the
      union-unchanged proof belongs to 1.4 below).
- [x] 1.3 GREEN: implement `buildApplePayPaymentMethod` + the local
      `ApplePayPaymentMethod` interface in
      `src/core/strategies/apple-pay.strategy.ts`, per design §6.1. No
      mocks — pure input/output.
- [x] 1.4 RED (same test file): `buildApplePayPaymentRequest`, no mocks —
      call the real Phase 2 helpers (`resolveApplePayNetworks`,
      `resolveApplePayMerchantCapabilities`) against real catalog fixtures,
      never a stub: - [R6] amount `10` -> `total.amount === '10.00'`; `10.5` ->
      `'10.50'`. - [R6] amount `0` and `-5` throw `AppError(INVALID_PAYMENT_REQUEST)`
      before any `ApplePaySession` type is touched (`NaN` and `Infinity`
      too, same code path). - [R6/DD10] `10.005` throws `AppError(INVALID_PAYMENT_REQUEST)`;
      `10.5` and `10` are accepted. **Carry a comment in the test** noting
      `toFixed(2)` presumes a two-decimal-minor-unit currency — JPY has
      zero, KWD has three — so this constraint is discoverable from the
      test file itself, not only from design DD10. - [R6] `merchantCapabilities` and `supportedNetworks` exactly equal
      what `resolveApplePayMerchantCapabilities` / `resolveApplePayNetworks`
      return for the same catalog fixture (both-active / debit-only /
      credit-only / empty catalog cases). - [R6] `countryCode` sourced from the input's `countryCode`
      (`business.country_code` in the caller), sheet label from
      `merchantName` (`business.name` in the caller).
- [x] 1.5 GREEN: implement `buildApplePayPaymentRequest` per design §6.2 and
      DD10 (both throw branches, the narrowing assertion comment on
      `merchantCapabilities`, and the `supports3DS` != 3-D-Secure comment
      carried over from Phase 2).
- [x] 1.6 Mechanical check: `rg -n 'ApplePayJS' src/` — confirm the only
      match is inside `src/ports/apple-pay.port.ts`. This is DD1's grep
      check; read the output, do not assume it.
      **Result:** the only TYPE REFERENCE is `src/ports/apple-pay.port.ts`
      (3 aliases). One additional match is PROSE in a pre-existing doc comment,
      `apple-pay-catalog.strategy.ts:59` ("the module that owns `ApplePayJS.*`
      does the narrowing"), landed in Phase 2 and left untouched.
- [x] 1.7 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
      Nothing imports the strategy or the port yet; `src/index.ts` untouched.
- [x] 1.8 Commit 1 (optionally split into `1a`/`1b` per the workload
      forecast): `feat: add Apple Pay port and pure payment-request/method builders`.
      **Done as the `1a`/`1b` split:** `feat: add Apple Pay port contracts`
      (11f1584) and `feat: add pure Apple Pay payment-request and
payment-method builders` (864f356). Both green.

## Phase 2: WU2 — session half of the adapter

- [x] 2.1 RED: create `src/adapters/browser/apple-pay.adapter.test.ts` with
      the local `FakeApplePaySession` class from design §4 (static
      `STATUS_SUCCESS = 0` / `STATUS_FAILURE = 1`, `static supportsVersion`,
      `static canMakePayments`, instance `onvalidatemerchant` /
      `onpaymentauthorized` / `oncancel`, `begin`/`completeMerchantValidation`/
      `completePayment`/`abort` as `vi.fn()`), installed per test via
      `vi.stubGlobal('ApplePaySession', FakeApplePaySession)`. First cases: - [R1] `canUseApplePay()` returns `false`, no throw, when
      `globalThis.ApplePaySession` is undefined (no stub installed). - [R1] `canUseApplePay()` returns `false`, no throw, when a stubbed
      `supportsVersion` throws (boundary against a foreign global, not
      re-validation of our own data — has its own test per design §5.2).
- [x] 2.2 RED (same file): [R1] `canUseApplePay()` returns `true` when both
      `supportsVersion(3)` and `canMakePayments()` return `true`; returns
      `false` when `supportsVersion(3)` returns `false` and
      `canMakePayments()` returns `true` (independent-check scenario); add
      the symmetric case (`supportsVersion` true, `canMakePayments` false)
      for full `&&` coverage.
- [x] 2.3 GREEN: implement `getApplePaySessionCtor()` (DD6 — `globalThis`
      only, never the bare `ApplePaySession` identifier or `window`) and
      `canUseApplePay()` per design §5.2, including the `try/catch`.
- [x] 2.4 RED (same file): `createSession(request, handlers)`: - [R2] constructs `new Ctor(3, request)` — assert the fake
      constructor received version `3` and the exact request object. - [R2] the handle is returned directly, not wrapped in a `Promise`
      (`createSession` has no `async`/`await` anywhere in its body — this
      is a **proxy** for Apple's real user-gesture requirement, not proof
      of it; real enforcement is Safari-only, design §7 row S3, verified
      only in Phase 7 on a device. Label the test comment this way.) - [R3] firing the fake's `onvalidatemerchant` with a `validationURL`
      field present invokes the registered `onValidateMerchant` handler
      with **zero arguments**, and the adapter never reads
      `event.validationURL`. - [R3] firing `onpaymentauthorized` with `{ payment: { token, extra }
}` invokes `onPaymentAuthorized` with **only** the token value. - [R3] firing `oncancel` invokes `onCancel` with **zero arguments**.
- [x] 2.5 RED (same file): the returned `ApplePaySessionHandle`: - [R2] `begin`/`completeMerchantValidation`/`abort` delegate to the
      underlying session's same-named methods with the same arguments. - [R8] `completePayment({ status: 'success' })` calls
      `session.completePayment` with `{ status: Ctor.STATUS_SUCCESS }` —
      the object form, never a bare number; `{ status: 'failure', errors:
[...] }` maps to `{ status: Ctor.STATUS_FAILURE, errors: [...] }`;
      `errors` is present in the call only when supplied.
- [x] 2.6 RED (same file): [R4] a throwing `Ctor` constructor surfaces as
      `AppError` with code `APPLE_PAY_SESSION_ERROR` and `originalError`
      set to the thrown value; a missing `Ctor` (no global stubbed) at
      `createSession` call time surfaces the same code (this branch is
      unreachable behind Phase 5's `mount()` gate but is still handled and
      still tested, per design §5.3).
- [x] 2.7 GREEN: implement `createSession()` per design §5.3.
- [x] 2.8 Add exactly one new entry:
      `MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_SESSION_ERROR]` in
      `src/shared/errors/messages.ts`, copy per design §5.7. Do NOT add
      `APPLE_PAY_UNSUPPORTED_BROWSER` — it is not thrown by this port or
      adapter (spec requirement R4, explicit MUST NOT).
- [x] 2.9 RED+GREEN (same file): [R4] `MESSAGES_EN[APPLE_PAY_SESSION_ERROR]`
      resolves to the new code-specific string, not the `UNKNOWN_ERROR`
      fallback (single-code check; the combined two-code scenario is
      finished in WU3 once `APPLE_PAY_CONTAINER_NOT_FOUND` also exists).
- [x] 2.10 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
      A session can be created and driven against the fake global; no button
      exists yet.
- [x] 2.11 Commit 2: `feat: add Apple Pay adapter session lifecycle`.

## Phase 3: WU3 — button half of the adapter

- [x] 3.1 RED (same test file, jsdom): [R5] `render({ containerId, onClick
})` with no `customization`, against a matched container: - a `<style>` element and a `<button type="button">` element are both
      appended to the container. - **DD7 CSS trap guard**: assert against the `<style>` node's
      `textContent`, never `button.style.getPropertyValue(...)` or
      `style.setProperty(...)`. jsdom silently drops declarations for
      properties it does not recognize, and `-apple-pay-button-type` /
      `-apple-pay-button-style` are exactly that — an inline-style
      implementation would produce a test asserting `''` that looks green
      and proves nothing. Carry this as a comment in the test file, not
      only in the design doc. - the `textContent` contains `-webkit-appearance: -apple-pay-button`
      unconditionally, plus the default `-apple-pay-button-type: buy` and
      `-apple-pay-button-style: black` when no `customization` is passed. - the button carries `aria-label="Apple Pay"` and class
      `tonder-apple-pay-button`.
- [x] 3.2 RED (same file): [R5] customization mapping — a customization
      object with `type: 'donate'`, `style: 'white-outline'`, `locale:
'es-MX'` produces those three values in the emitted CSS text; a
      customization object that omits `height`/`border_radius` leaves those
      two WebKit properties **absent** from the CSS text (Apple's own
      default applies, not overridden) — this is the "omitted field is left
      at Apple's own default" scenario. Each test states in its name or a
      comment what it does and does not prove (design §7 row S2: this
      proves the CSS text we emit, not that WebKit renders it).
- [x] 3.3 RED (same file): [R4] `render()` with a `containerId` matching no
      element throws `AppError` with code `APPLE_PAY_CONTAINER_NOT_FOUND`.
- [x] 3.4 RED (same file): [R5] a `click` event dispatched on the rendered
      button invokes the caller-supplied `onClick`; the listener is
      attached via `addEventListener('click', ...)`, not an inline `onclick`
      property.
- [x] 3.5 RED (same file): [R5] the disposer returned by `render()` removes
      both the button node and the style node from the DOM, and a
      subsequent `click` dispatch no longer invokes `onClick`; calling the
      disposer a second time throws nothing and changes nothing further.
- [x] 3.6 GREEN: implement `render()` and the private `buildButtonCss()` in
      `src/adapters/browser/apple-pay.adapter.ts` per design §5.4
      (`<button type="button">` per DD8, not Apple's `<div>` sample markup —
      keyboard-activatable without breaking the gesture chain).
- [x] 3.7 Add exactly one new entry:
      `MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_CONTAINER_NOT_FOUND]` in
      `src/shared/errors/messages.ts`, copy per design §5.7. Confirms the
      change's total is exactly two new `MESSAGES_EN` entries.
- [x] 3.8 RED+GREEN (same file): [R4] combined scenario — both
      `MESSAGES_EN[APPLE_PAY_SESSION_ERROR]` and
      `MESSAGES_EN[APPLE_PAY_CONTAINER_NOT_FOUND]` resolve to their own
      code-specific string, neither to `UNKNOWN_ERROR`.
- [x] 3.9 Mechanical check: `rg -n 'apple_pay_button'
src/types/customization.ts` — confirm `ApplePayButtonCustomization`
      stays declared-only, with no new `apple_pay_button?` member added to
      `TonderCustomization` in the same file (DD9 — customization is a real
      `render()` argument today; its source stays deferred to Phase 5).
- [x] 3.10 Verify green: `npm run test`, `npm run typecheck`, `npm run build`.
      Both ports are fully implemented and unreachable — feature-complete
      for Phase 3.
- [x] 3.11 Commit 3: `feat: add Apple Pay adapter button rendering and customization`.

## Phase 4: Final verification (absence checks — read the output, do not assume it)

- [x] 4.1 Re-run `npm run lint`; diff the error set against the Phase 0.1
      baseline — must be exactly the same two pre-existing errors
      (`tonder.handleRequiresAction.test.ts:184`,
      `tonder.pay.test.ts:483`), zero new ones. Do not fix the two.
- [x] 4.2 [R9] `rg -n 'ApplePay' src/index.ts` — confirm zero matches. No
      new export as a result of the port, the adapter, or either strategy
      builder.
- [x] 4.3 [R9] `rg -n 'apple_pay_button' src/index.ts` and confirm
      `TonderCustomization` (in `src/types/customization.ts`) still has no
      `apple_pay_button` key — re-check after all three commits, not just
      after WU3, in case a later edit reintroduced it.
- [x] 4.4 `rg -n 'ApplePayJS' src/` (whole tree, including test files) —
      confirm the only match is `src/ports/apple-pay.port.ts`. Re-run after
      WU2/WU3 in case the adapter or its tests accidentally named the
      ambient namespace directly instead of using the port's aliases.
      **Result:** re-run after WU3. Unchanged from 1.6 — the port plus the one
      pre-existing prose match. Neither the adapter nor either test file names
      the ambient namespace.
- [x] 4.5 `rg -rn 'MockApplePaySessionAdapter' src/` and
      `rg -n 'class Fake' src/adapters src/core src/ports` (excluding
      `*.test.ts`) — confirm zero matches outside test files. No test
      double for Apple Pay exists under `src/` outside `*.test.ts` (DD5).
- [x] 4.6 `npm run build`, then `rg -i 'applepay' dist/` — confirm zero
      occurrences. Verifies `@types/applepayjs` (a devDependency, ambient
      `.d.ts` only) produces no runtime output in `dist/`; do not assume
      this from the package.json classification alone.
      **Result — the literal check does NOT return zero, and the task as
      written was over-specified.** Three matches, none of them Apple's types:
      `isApplePayCatalogMethod`, a Phase 2 helper that is genuinely reachable
      (it filters Apple Pay entries out of `getPaymentMethods`) and predates
      this change. The check the task actually intends passes:
      `rg -n 'ApplePaySession|ApplePayJS' dist/` returns **zero**, as does a
      search for `BrowserApplePay`, `buildApplePayPaymentRequest`,
      `buildApplePayPaymentMethod`, `tonder-apple-pay-button` and
      `-apple-pay-button-type`. `dist/index.d.ts` references no Apple type.
      The two new `MESSAGES_EN` strings DO appear in the bundle, which is
      correct — `messages.ts` is reachable shipped code.
- [x] 4.7 `rg -n 'apple-pay\.(port|strategy|adapter)' src --glob '!*.test.ts' --glob '!src/ports/apple-pay.port.ts' --glob '!src/core/strategies/apple-pay.strategy.ts' --glob '!src/adapters/browser/apple-pay.adapter.ts'` — confirm no importer of the three new files exists outside their own test files and each other (strategy imports the port; adapter imports the port). This is what makes WU2 and WU3 independently revertable and WU1 revertable as a pure module, per design §8 rollback.
- [x] 4.8 Confirm rollback readiness: reverting commit 3 alone removes only
      the button half (adapter keeps its session half); reverting 3+2
      removes the whole adapter; reverting all three removes the port and
      strategy too. No public surface, no persisted data, no backend
      contract, no migration — nothing else in the repo references these
      files (confirmed by 4.7), so this is a structural guarantee, not a
      claim to re-verify by actually running `git revert` in this task.

## Spec drift found during apply — RESOLVED in `5b8a1d2`

Requirement **R7** asserted that `pay({ payment_method: { type: 'apple_pay' } })`
"MUST remain a compile-time type error", with a scenario expecting
`npm run typecheck` to report one. That was **unsatisfiable**: `PaymentMethod`'s
third member is `{ type: string; config?: Record<string, unknown> }`
(`src/shared/types/index.ts:121-124`), which swallows any string literal, so the
call type-checks and always has.

Apply correctly refused to write a test asserting it, and reported it as spec
drift rather than bending the code to an impossible requirement. The **spec** was
amended in `5b8a1d2`: the public union gains no `apple_pay` member, and rejection
is a runtime `AppError` owned by the change that ships the component — because
without that guard the call is treated as a generic APM and reaches `/process` as
`{ type: 'apple_pay' }`.

Nothing outstanding. This section is kept as the record of why the requirement
changed, not as open work.
