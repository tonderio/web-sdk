# Design: Apple Pay availability moves to the business config

Apple Pay's availability source moves from the payment-method catalog to the root-level
`apple_pay` block on the business config `init()` already fetches. One request, one cache
and three helpers disappear. Nothing about how Apple Pay _pays_ changes.

This is a deletion change, and a deletion change is reviewed by reading what disappeared.
The failure mode is not a wrong line — it is a **right line that vanished and nobody
noticed**. So §7 is built around the survivors, not the removals, and every check there
produces output a human must read.

Decisions are labelled `DD1…DD9`. The proposal's own numbering (`D1…D9`, from the archived
phases) is unrelated; cross-references to it are spelled out explicitly.

---

## Quick path

1. **DD1** — `init()` drops `Promise.all` and returns to a plain `await`. All non-fatal
   machinery goes with it.
2. **DD2** — the three helpers fold into `src/core/strategies/apple-pay.strategy.ts`, retyped
   over `ApplePayConfig | undefined`. `apple-pay-catalog.strategy.ts` is deleted.
3. **DD3** — the enabled check gets **no helper**: it is a field read in the facade.
4. **DD4** — `TonderState.paymentMethodCatalog` is removed; it had exactly three readers.
5. **DD5** — `ApplePayCheckoutContext.catalog` becomes `applePay`, keeping the live-read rule.
6. **DD6–DD8** — network / capability / mutation semantics under a single-source input.
7. **§6** — six work units, each green, commits only.
8. **§7** — survivor verification. Read the output; do not assume it.

---

## 1. `init()` after the catalog leg (DD1)

### DD1 — `init()` returns to a plain `await`; the non-fatal machinery is deleted entirely

The archived design built `Promise.all` over a **pre-caught** promise for one reason: two
legs, only one of them fatal, and an unattached rejection on the non-fatal leg would have
become an unhandled rejection if the fatal leg rejected first. With one leg, every part of
that construction is answering a question that no longer exists.

Removed: the `Promise.all`, the pre-catch (`.catch(() => null)`), the destructuring, the
`paymentMethodCatalog` state write, the three comments explaining concurrency and catch
placement, and the `catch` block's "Reachable ONLY via the business leg" line.

**Kept**: the surrounding `try/catch` and the `INIT_ERROR` wrapping. That predates the
catalog leg and is the business leg's own failure semantics — it is not non-fatal machinery.
Also kept: the `lifecycle === 'ready'` idempotence guard and the `lifecycle: 'initializing'`
transition.

Resulting body (`src/tonder.ts`, replacing lines 476–521):

```ts
  public async init(): Promise<void> {
    if (this.core.getState().lifecycle === 'ready') {
      return;
    }
    try {
      this.core.setState({ lifecycle: 'initializing' });
      const config = this.core.getConfig();

      const business = await this.businessService.fetchBusinessConfig(
        config.api_key,
      );

      this.core.setState({ lifecycle: 'ready', business });
    } catch (error) {
      this.core.setState({
        lifecycle: 'error',
        lastErrorCode: ErrorKeyEnum.INIT_ERROR,
      });
      throw new AppError({
        errorCode: ErrorKeyEnum.INIT_ERROR,
        originalError: error,
      });
    }
  }
```

The JSDoc paragraph at `src/tonder.ts:470-474` ("Two requests are issued concurrently…") is a
false statement the moment the leg goes, so it is corrected in the same commit — same rule as
the four code comments in §5.

**Rejected — keep `Promise.all` with a single element.** It reads as a placeholder inviting a
second leg back, and it is a slower path to the same value.

**Rejected — keep the `.catch(() => null)` on the business request "for safety".** It would
convert the one fatal failure into a silent `lifecycle: 'ready'` with `business: null`, which
every ready-gated method would then dereference. The business leg has always been fatal and
stays fatal.

**Consequence to test, not to assume**: `init()` now issues **exactly one** request. The
assertion is a **count** on the fake `HttpPort`'s recorded requests plus the path of the one
that remains — never "no request to `/api/v1/payment_methods` was made", which would stay
green if the business request also disappeared.

---

## 2. Where availability resolution lives (DD2, DD3)

### DD2 — the derivations fold into `apple-pay.strategy.ts`, retyped over the block

`src/core/strategies/apple-pay-catalog.strategy.ts` is **deleted**, together with
`apple-pay-catalog.strategy.test.ts`. `DEFAULT_APPLE_PAY_NETWORKS`,
`resolveApplePayNetworks` and `resolveApplePayMerchantCapabilities` move into
`src/core/strategies/apple-pay.strategy.ts` with their names unchanged; the `supports3DS`
comment (EMV cryptogram, _not_ 3-D Secure) moves verbatim with the function it documents.

Not inlined into the facade: the resolution stays **pure and independently testable** —
absent field, empty array, and the asymmetric debit-only case each deserve a direct test — and
`buildApplePayPaymentRequest`, their only consumer, already lives in that module. Not a
renamed module either: a file named for a catalog it no longer reads is a name that lies.

Signatures after the fold:

```ts
/** Networks assumed when the business config carries none. */
export const DEFAULT_APPLE_PAY_NETWORKS = ['visa', 'masterCard'] as const;

export function resolveApplePayNetworks(
  applePay: ApplePayConfig | undefined,
): string[];

export function resolveApplePayMerchantCapabilities(
  applePay: ApplePayConfig | undefined,
): string[];
```

`ApplePayConfig` is imported **type-only** from `../../models/business.model`, matching how
the module already imports `BackendPaymentMethod` today — `core/` stays runtime-pure because
the import is erased.

Input type parameter is `| undefined` rather than `| null`: the block arrives as an absent
object key, not as a nulled cache. Nothing produces `null` for it, so accepting `null` would
be a case with no producer.

`BuildApplePayPaymentRequestInput` loses `catalog` and gains:

```ts
/**
 * The business config's `apple_pay` block. Networks and capabilities are
 * derived HERE, so a caller cannot forget them or recompute them differently.
 * `undefined` is valid input for a pure function — the `mount()` gate decides
 * whether production ever gets here with it.
 */
applePay: ApplePayConfig | undefined;
```

### DD3 — the enabled check gets no helper

`hasActiveApplePayMethod` existed because deciding "is Apple Pay on" meant **scanning an
array with a prefix predicate**. That is a derivation and deserved a named, tested function.
`apple_pay.enabled` is a boolean field. Wrapping a field read in a function adds a name, an
import, an export and a test file entry, and buys no behavior.

The facade therefore reads it directly:

```ts
Boolean(state.business?.apple_pay?.enabled);
```

Both `?.` are load-bearing and neither is defensive padding: `business` is `null` before
`init()` (the method must not throw then — see `apple-pay/spec.md`, "Never throws, including
before `init()`"), and `apple_pay` is an optional key the backend may omit for a merchant who
has never been enabled.

**Rejected — `isApplePayEnabled(business: BusinessConfig | null): boolean`.** It is
indirection over `?.` and it would need its own test file to justify its existence.

**Note on the naming trap**: `enabled` is `boolean`, not `boolean | undefined`, in the
declared interface (the backend always sends it when the block is present), but the _block_
is optional. `Boolean(...)` over the optional chain, not `state.business?.apple_pay?.enabled
=== true`, so an absent block and `false` collapse to the same `false` without a third state.

### The resulting public method and gate

```ts
  public isApplePayAvailable(): boolean {
    const state = this.core.getState();
    return (
      this.applePay.canUseApplePay() &&
      Boolean(state.business?.apple_pay?.enabled) &&
      Boolean(state.business?.business.country_code)
    );
  }
```

`mount()` gate 3 (`src/tonder.ts:345-354`) changes its first operand identically:

```ts
const state = this.core.getState();
const countryCode = state.business?.business.country_code;
if (!state.business?.apple_pay?.enabled || !countryCode) {
  throw new AppError({ errorCode: ErrorKeyEnum.APPLE_PAY_NOT_ENABLED });
}
```

The four-gate order, the distinct codes, and the deliberate fact that `mount()` does **not**
call `isApplePayAvailable()` (a merchant debugging at 2 AM needs to know _which_ check
failed) are all unchanged. `APPLE_PAY_NOT_ENABLED`'s copy is unchanged — verified at
`src/shared/errors/messages.ts:67-68`: "Apple Pay is not enabled for this business. Contact
Tonder to enable it and to confirm the business country." It never mentioned the catalog and
is strictly _more_ accurate now, since "not enabled for this business" is literally
`apple_pay.enabled === false`.

---

## 3. The core state slot (DD4)

### DD4 — `TonderState.paymentMethodCatalog` is removed, with its type import

Removed from `src/core/TonderCore.ts`: the field declaration (line 21), its nine-line comment
(13–20, which describes a cache and a gate that will not exist), and the `null` initializer
(line 51). The now-unreferenced `import type { BackendPaymentMethod }` at line 2 goes with
them — leaving it is an unused import that either trips the build or, worse, does not, and
keeps a dead dependency edge from `core/` to `models/`.

**Every reader, enumerated** (`rg 'paymentMethodCatalog' src/`, run before designing):

| Site                                                  | Role                               | Disposition      |
| ----------------------------------------------------- | ---------------------------------- | ---------------- |
| `src/core/TonderCore.ts:21`, `:51`                    | declaration, initializer           | removed          |
| `src/tonder.ts:259`                                   | `isApplePayAvailable()`            | replaced per DD3 |
| `src/tonder.ts:323`                                   | checkout `getContext()`            | replaced per DD5 |
| `src/tonder.ts:348`                                   | `mount()` gate 3                   | replaced per DD3 |
| `src/tonder.ts:500`, `:508`                           | `init()` destructure + state write | removed per DD1  |
| `src/tonder.init.catalog.test.ts:193`, `:288`, `:306` | tests of the removed leg           | file deleted     |

No other module reads it. Nothing subscribes to state for it, and no listener filters on it.

The remaining `TonderState` fields — `lifecycle`, `business`, `customerAuthToken`,
`customerInput`, `lastErrorCode` — are untouched, as is the Observer contract
(`setState`/`emit`/`subscribe`).

---

## 4. Consumers of the removed helpers (DD5)

Complete call-site inventory, from `rg 'hasActiveApplePayMethod|resolveApplePayNetworks|resolveApplePayMerchantCapabilities' src/`:

| Call site                                                        | Helper                                | Disposition                                               |
| ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `src/tonder.ts:36`                                               | `import { hasActiveApplePayMethod }`  | import deleted                                            |
| `src/tonder.ts:259`                                              | `hasActiveApplePayMethod`             | → `apple_pay.enabled` (DD3)                               |
| `src/tonder.ts:348`                                              | `hasActiveApplePayMethod`             | → `apple_pay.enabled` (DD3)                               |
| `src/core/strategies/apple-pay.strategy.ts:17-20`                | cross-module import of both resolvers | import deleted; functions now local                       |
| `src/core/strategies/apple-pay.strategy.ts:106`, `:111`          | both resolvers                        | argument changes from `input.catalog` to `input.applePay` |
| `src/core/strategies/apple-pay.strategy.test.ts:14-16, 163, 166` | both resolvers                        | see the tautology trap, §8                                |
| `src/core/strategies/apple-pay-catalog.strategy.test.ts`         | all three                             | file deleted                                              |

**`apple-pay-checkout.service.ts` does not call any of the three.** It carries the value
through: `ApplePayCheckoutContext.catalog` (line 43) → `ctx.catalog` (line 110) →
`buildApplePayPaymentRequest`. That is a data-flow consumer, not a call site, and it is why
DD5 exists.

### DD5 — the checkout context swaps the field and keeps the live-read rule

```ts
/** Values read LIVE, at click or authorization time. Never snapshotted. */
export interface ApplePayCheckoutContext {
  /** The business config's `apple_pay` block, read live from state. */
  applePay: ApplePayConfig | undefined;
  customer: Customer | undefined;
  presentationMode: 'redirect' | 'embedded';
  businessPk: number | undefined;
}
```

`ApplePayCheckoutService.start()` passes `applePay: ctx.applePay` where it passed
`catalog: ctx.catalog`. Its `import type { BackendPaymentMethod }` (line 30) is replaced by
`import type { ApplePayConfig } from '../../models/business.model'`.

The facade's `getContext()` (`src/tonder.ts:320-330`) reads
`applePay: state.business?.apple_pay`.

**Rejected — pass `countryCode`-style, as a `start()` argument.** The existing rule in that
service is explicit and worth preserving: values the `mount()` gate proved present are
**arguments** (`countryCode`, `merchantName`); values that may be consulted long after mount
are **deps reads**. The `apple_pay` block is consulted at click time, after mount, so it stays
a deps read. One rule, no exceptions.

**Rejected — pass the whole `BusinessConfig`.** It widens what a pure builder can reach for no
gain and would let a future edit source `countryCode` from two places.

---

## 5. Types, transport, and the comments the deletion falsifies

### The new type (`src/models/business.model.ts`)

```ts
/**
 * Root-level Apple Pay block on the business config, sibling of `mercado_pago`.
 * Optional: the backend omits it for a business that was never enabled.
 */
export interface ApplePayConfig {
  enabled: boolean;
  /**
   * DECLARED, NEVER READ. It is not a field of `ApplePayPaymentRequest`, and the
   * only three Apple APIs that take it — `applePayCapabilities()`, the
   * deprecated `canMakePaymentsWithActiveCard()`, and `openPaymentSetup()` — are
   * all out of scope. The backend uses it server-side when it requests the
   * merchant session. Typed so the response shape is honest. Do NOT wire it in.
   */
  merchant_identifier?: string;
  /** PENDING: backend field name unconfirmed. Absent ⇒ SDK default. */
  supported_networks?: string[];
  /** PENDING: backend field name unconfirmed. Absent ⇒ capability omitted. */
  supports_debit?: boolean;
  /** PENDING: backend field name unconfirmed. Absent ⇒ capability omitted. */
  supports_credit?: boolean;
}
```

`BusinessConfig` gains `apple_pay?: ApplePayConfig;` next to `mercado_pago`. Every field
except `enabled` is optional, so an unconfirmed name degrades to the SDK default instead of
failing — the proposal's open item, expressed in the type.

### Transport field removal

`BackendPaymentMethod.configuration?: { supported_networks?: string[] }`
(`src/models/payment-method.model.ts:36`) loses its last reader and is removed. Fixtures
carrying it must go in the same commit or `npm run typecheck` fails on excess properties:
`src/tonder.getPaymentMethods.test.ts:108,115`,
`src/core/services/direct-api.service.test.ts:184`,
`src/models/payment-method.model.test.ts:77-86` (a test whose entire subject is the removed
field — it goes with it).

### DD9 — comments that become false are corrected in the deletion commit

A comment describing code that no longer exists is a **false statement in the source**, not a
style preference, so it is not deferrable. Known sites, all named in the proposal:

| Site                             | What it asserts that becomes false                                    |
| -------------------------------- | --------------------------------------------------------------------- |
| `TonderCore.ts:13-20`            | the removed slot's raw/unfiltered semantics and its gate reader       |
| `direct-api.service.ts:156-167`  | "cached by `init()` for the Apple Pay availability gate"              |
| `payment-method.model.ts:31-35`  | `configuration` "read by the Apple Pay derivation helpers"            |
| `payment-method.model.ts:71-72`  | "the cached raw catalog never reaches this function"                  |
| `tonder.ts:470-474` (added here) | `init()`'s "two requests issued concurrently" JSDoc                   |
| `tonder.ts:247-249` (added here) | `isApplePayAvailable()`'s "the catalog and business config are unset" |

`payment-method.model.ts:59-70` — the paragraph explaining **why the filter exists** — is
_not_ falsified and must be preserved almost intact: the `apple_pay_*` entries keep arriving.
Only its final sentence (the cached-catalog one) changes.

`direct-api.service.getPaymentMethodCatalog()` keeps its body byte-for-byte: it is still the
transport for `getPaymentMethods()`. Only its JSDoc changes.

The **general** comment sweep — comments that are merely unnecessary, or that leak internals
onto a public surface — stays with phase 7. Do not start it here.

---

## 6. Work units

Commits only, no PR. Each unit is a work-unit commit and each ends **green** on
`npm run test` + `npm run typecheck`. Strict TDD is active: every unit below has a runtime
behavior with a red test available first, because `HttpPort` is injected and every response is
faked.

| #       | Ships                                                                                                                                                                                  | Red-first test                                                                                                        | Green at the end because                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WU1** | `ApplePayConfig`; `BusinessConfig.apple_pay?`; business fixtures extended                                                                                                              | `business.model.test.ts`: a fixture with and one without `apple_pay` both assign                                      | Purely additive; no reader yet                                                                                                                            |
| **WU2** | The fold: both resolvers move into `apple-pay.strategy.ts` retyped over the block; `BuildApplePayPaymentRequestInput.applePay`; checkout context field; facade `getContext()`          | `apple-pay.strategy.test.ts`: absent block, empty array, debit-only, credit-only, both-absent                         | Old module keeps only `hasActiveApplePayMethod`; its resolver tests are deleted in this same commit, so **no duplicate export name exists at any commit** |
| **WU3** | `isApplePayAvailable()` and `mount()` gate 3 read `apple_pay.enabled`; delete `apple-pay-catalog.strategy.ts` **and** its test file                                                    | `tonder.applePay.test.ts` / `tonder.applePayButton.test.ts`: block-driven fixtures, one failing factor per false case | `hasActiveApplePayMethod`'s last two call sites went in the same commit                                                                                   |
| **WU4** | `init()` per DD1; `TonderState.paymentMethodCatalog` + its type import; delete `src/tonder.init.catalog.test.ts`; comments in `TonderCore.ts`, `direct-api.service.ts`, `tonder.ts` ×2 | An init test asserting the fake recorded **exactly one** request, and its path                                        | The slot's only writer and its three readers all left in WU3/WU4                                                                                          |
| **WU5** | `BackendPaymentMethod.configuration` removed; the three fixtures and the one dedicated test updated/deleted; `payment-method.model.ts` comments                                        | `getPaymentMethods.test.ts`'s Apple-Pay-exclusion test, re-run with the key gone                                      | The field had no reader after WU2                                                                                                                         |
| **WU6** | Spec rewrites: `apple-pay` (≥10 requirements), `public-api` (the concurrent-init requirement), `payment-method-discovery` (cache references only)                                      | n/a — docs                                                                                                            | No source change                                                                                                                                          |

**Why this order.** Every deletion lands only after its last consumer is gone, so no commit
is green by accident and no commit is red in transit. WU2 before WU3 means the resolvers are
proven against the new input shape _before_ the gate they share a module with changes. WU4
before WU5 keeps the two removals reviewable apart. WU6 last so the specs describe code that
already exists.

**WU6 scope guard.** `payment-method-discovery/spec.md` keeps its filter requirement, its
constraints and its scenarios. Exactly two things change there: the constraint "MUST NOT read
from the raw catalog `init()` caches" (lines 45–50) and the scenario "issues its own request
even when `init()`'s catalog leg failed" (lines 78–86), both of which describe a cache that
will not exist. The requirement is **modified in place**, never appended alongside, and the
canonical text carries no change-scoped wording ("this change", "previously") in the
requirement body itself.

---

## 7. Verification, built around the survivors

The removals are the visible part of the diff and will be reviewed by anyone reading it. The
survivors are the invisible part. Each check below prints something a human must **read** —
none of them is a boolean anyone can glance past.

### 7.1 The four survivors

| Survivor                                         | Mechanical check                                                     | Output that must be read                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `apple_pay_*` filter                         | `rg -n 'isApplePayCatalogMethod' src/models/payment-method.model.ts` | **Two** hits: the import, and one use inside `toPublicPaymentMethods`'s `.filter(...)`. Confirm the second is in the filter chain, not merely present in the file                                  |
| `toPublicPaymentMethods()` as single producer    | `rg -n 'PaymentMethodInfo\[\]' src/ \| rg -v '\.test\.ts'`           | Read every hit and classify it. Exactly one is a **producer** (`toPublicPaymentMethods`'s return); all others are consumer/type positions (`getPaymentMethods()`'s return, the public type export) |
| `mapPaymentMethod` module-private, one call site | `rg -n 'mapPaymentMethod' src/`                                      | Exactly **two** hits: the `function` declaration (with no `export`) and the `.map(mapPaymentMethod)` call. Three hits, or an `export` prefix, is a failure                                         |
| `isApplePayCatalogMethod` untouched              | `git diff --stat -- src/shared/payment-method-catalog.ts`            | **Empty output.** Any line count at all is a failure, including a whitespace or comment edit                                                                                                       |

### 7.2 Behavior of the survivors, not just their presence

Presence checks prove the code is there. These prove it still runs:

- `getPaymentMethods()` excludes **both** `apple_pay_debit_card` and `apple_pay_credit_card`
  from a catalog containing them plus `card` and `spei`, with the `configuration` key gone
  from the fixture and **no cache anywhere in the SDK**. The assertion names both codes
  explicitly and asserts the surviving entries positively — an assertion that the array
  merely "has length 2" would pass if the wrong two survived.
- The same test's fake `HttpPort` records the `getPaymentMethods()` request, proving the
  method still issues its own fetch rather than reading state.

### 7.3 The removals

| Check                                                                        | Expected                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n 'paymentMethodCatalog\|hasActiveApplePayMethod' src/ openspec/specs/` | zero hits                                                                                                                                                                                                                                    |
| `rg -n 'resolveApplePayNetworks\|resolveApplePayMerchantCapabilities' src/`  | only `apple-pay.strategy.ts` and `apple-pay.strategy.test.ts`                                                                                                                                                                                |
| `rg -n 'apple-pay-catalog' src/`                                             | zero hits                                                                                                                                                                                                                                    |
| `rg -n 'catalog' src/ -g '!*.test.ts'`                                       | every remaining hit is `getPaymentMethodCatalog`, `payment-method-catalog`, or `getPaymentMethodCatalogDetails` — **no hit describes a cache**. This is the check for the proposal's "no comment in `src/` still describes a cached catalog" |
| `rg -n 'merchant_identifier' src/`                                           | exactly one hit: the declaration in `business.model.ts`, with its never-read comment                                                                                                                                                         |
| `init()` request count                                                       | the fake records `1`, asserted as a count                                                                                                                                                                                                    |

### 7.4 Commands and the lint baseline

`npm run test` · `npm run typecheck` · `npm run build` — all must pass.

`npm run lint` is **red before this change with exactly two pre-existing, unrelated errors**
(`src/tonder.handleRequiresAction.test.ts:184`, `src/tonder.pay.test.ts:483`). Do not fix
them. **Count the errors before starting and after finishing**: the number must be 2 both
times, and the two file:line pairs must be the same pairs. A third error hiding behind an
already-red command is the exact failure this baseline exists to catch.

---

## 8. Traps this project has already hit, and their analogues here

### 8.1 A test that passes for the wrong reason

The precedent: a CSS assertion that would have gone green asserting `''`.

**The analogue here** is live in the codebase right now —
`src/core/strategies/apple-pay.strategy.test.ts:157-169` asserts

```ts
expect(request.merchantCapabilities).toEqual(
  resolveApplePayMerchantCapabilities(catalog),
);
expect(request.supportedNetworks).toEqual(resolveApplePayNetworks(catalog));
```

That is a **tautology**: the builder calls those exact functions, so the test passes for any
behavior the helpers have, correct or not. It proves wiring and nothing else.

**Required in WU2**: keep one wiring test (the builder does not re-derive), but assert the
Apple Pay request's `merchantCapabilities` and `supportedNetworks` against **literal expected
values** for each case. The helpers' own tests then own the derivation.

Second analogue: an `isApplePayAvailable()` false-case test whose fixture omits `apple_pay`
entirely would return `false` even if the production code read a **misspelled path** such as
`state.business?.business.apple_pay`. Guard: every false case isolates **exactly one** failing
factor, and each `describe` contains an all-passing case asserting `true` — that positive
case is what proves the path is readable at all.

### 8.2 `expect.objectContaining` passing with extra keys present

**The analogue here** is `merchantCapabilities` when `supports_debit` and `supports_credit`
are both absent. `expect(caps).toContain('supports3DS')` passes even if `supportsDebit`
leaked in. Every capability assertion uses **exact array equality**:
`expect(caps).toEqual(['supports3DS'])`. The existing catalog tests already used `toEqual` —
that discipline carries over, it does not restart.

Same rule for the built `ApplePayPaymentRequest`: assert the whole object with `toEqual`, not
`objectContaining`, so a field silently added by the fold is caught.

### 8.3 A criterion asserting something unsatisfiable

**Grepped before asserting.** The proposal's criterion
`rg 'paymentMethodCatalog|hasActiveApplePayMethod' src/ openspec/specs/` **is** satisfiable as
scoped:

- `docs/apple-pay-integration-plan.md:844` names `hasActiveApplePayMethod` as historical
  record — **outside the grep scope**, and it must stay: it is the record of the superseded
  design.
- The archived `2026-08-03-apple-pay-catalog-gate` artifacts and this change's own
  `openspec/changes/` directory also name it — **outside the scope**, and also must stay.
- `e2e/` was grepped for `apple_pay` and `country_code`: **no matches**. No e2e fixture
  breaks, and no criterion may claim an e2e change.

The scope is exactly `src/` and `openspec/specs/`. Widening it to the repo root would make
the criterion unsatisfiable, and narrowing it further would let a stale spec through.

---

## 9. Constraints held

| Constraint                       | How                                                                                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ports & Adapters; `core/` pure   | The fold keeps the resolution in `core/strategies/` with a type-only import from `models/`, erased at build. No DOM, no HTTP, no globals added                                               |
| No duplicated interfaces         | `ApplePayConfig` is declared once in `models/business.model.ts` and imported by both the strategy and the checkout service. `ApplePayCheckoutContext` is edited, not forked                  |
| No unnecessary validation        | No shape checks on the `apple_pay` block; absence degrades to a default. Optional chaining where a value is genuinely optional, nowhere else. Dedup of `supported_networks` is dropped (DD6) |
| Test doubles live in `*.test.ts` | No fixture module is added under `src/`. Business fixtures stay local to each test file, as they already are                                                                                 |
| Strict TDD                       | Every WU1–WU5 row has a runtime behavior with a failing test available first                                                                                                                 |
| Backward compatibility           | No public export changes. `isApplePayAvailable()` keeps its signature; only what it reads changes                                                                                            |

### DD6 — `supported_networks` passes through, de-duplication is dropped

The old dedup existed because the value was a **union across multiple catalog entries** and
the same network legitimately appeared twice. With one array from one source, deduplicating
would be the SDK guessing that the backend contradicts itself in a single field.

```ts
export function resolveApplePayNetworks(
  applePay: ApplePayConfig | undefined,
): string[] {
  const networks = applePay?.supported_networks ?? [];
  return networks.length > 0 ? [...networks] : [...DEFAULT_APPLE_PAY_NETWORKS];
}
```

The spread on the configured branch is **not** cosmetic (DD7): returning the array by
reference would hand a caller a live handle into the cached `BusinessConfig`, and one
`.push()` anywhere would mutate every later payment request. The fallback branch spreads for
the same reason the old code did — a caller must not be able to mutate the shared
`DEFAULT_APPLE_PAY_NETWORKS` constant. Both properties are asserted directly.

Case-normalization stays **out**, for the reason the old module recorded: Apple's tokens are
case-sensitive (`masterCard`, not `mastercard`), so lowercasing a valid token would corrupt
it. Return type stays `string[]`, not Apple's literal union — the value arrives off the wire
untyped, and the module owning `ApplePayJS.*` does the narrowing.

### DD8 — absent card-type flags mean "do not filter", not "not supported"

Under the catalog design, a missing `apple_pay_credit_card` entry meant credit was genuinely
unavailable, so omitting `supportsCredit` was a positive statement. Under the block design,
`supports_debit` / `supports_credit` are **optional fields with unconfirmed names**, so
absence means "unknown".

```ts
export function resolveApplePayMerchantCapabilities(
  applePay: ApplePayConfig | undefined,
): string[] {
  const capabilities = ['supports3DS'];
  if (applePay?.supports_debit) capabilities.push('supportsDebit');
  if (applePay?.supports_credit) capabilities.push('supportsCredit');
  return capabilities;
}
```

Both absent ⇒ `['supports3DS']` ⇒ Apple filters by **neither** card type, which is the
permissive outcome and the correct degradation for an unconfirmed field name. That is the
inverse of the old behavior and must be said out loud, because it looks like a regression to
anyone reading only the diff: the asymmetric case still earns its keep (a debit-only business
that _does_ send `supports_debit: true` still gets credit cards greyed out in the sheet
rather than declined by the acquirer after Face ID), but the SDK no longer infers a
restriction from silence.

`supports3DS` is unconditional and its comment moves verbatim: it denotes **EMV cryptogram**
support, not 3-D Secure. Omitting it makes the request invalid and Apple's constructor throws.
Do not remove it as contradictory with "Apple Pay bypasses 3DS" — that statement is about
3-D Secure; this token is not.

---

## 10. Open item, recorded not resolved

Backend field names for `supported_networks`, `supports_debit` and `supports_credit` are
**unconfirmed**. All three are optional with SDK defaults, so a wrong name degrades rather
than fails, and `HttpPort` is faked so nothing here is blocked. If the names differ, **only
the two `resolveApplePay*` functions change** — no consumer, no type outside `ApplePayConfig`,
and no test outside `apple-pay.strategy.test.ts`. That containment is the point of the fold.

---

## 11. Checklist

- [ ] `init()` issues exactly one request, asserted as a **count**
- [ ] `isApplePayAvailable()` returns `false` independently for each of: browser unsupported,
      `apple_pay.enabled` false or absent, `country_code` absent — and `true` when all pass
- [ ] `isApplePayAvailable()` does not throw before `init()`
- [ ] `getPaymentMethods()` still excludes both `apple_pay_*` entries, with no cache anywhere
- [ ] §7.1 walked item by item, output read: filter present in the chain, single producer,
      `mapPaymentMethod` at exactly two hits and unexported,
      `src/shared/payment-method-catalog.ts` at a **zero-line diff**
- [ ] §7.3 removal greps all return their expected result
- [ ] No comment in `src/` describes a cached catalog (§7.3, row 4)
- [ ] `merchant_identifier` typed, zero read sites, reason in a comment
- [ ] The tautological assertion at `apple-pay.strategy.test.ts:157-169` is replaced with
      literal expected values
- [ ] `npm run test`, `npm run typecheck`, `npm run build` pass
- [ ] `npm run lint` shows the **same two** pre-existing errors at the same file:line pairs,
      and no third

## Next step

`sdd-tasks` — break WU1–WU6 into ordered task steps once the spec deltas are written.
