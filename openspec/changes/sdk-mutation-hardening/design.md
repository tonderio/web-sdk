# Design: config snapshot + instance sealing

The merchant's config object is deep-copied once at construction, `events` is carved out behind a live accessor, all 18 instance fields become `#private`, and one non-throwing `console.warn` fires at most once per instance when a snapshotted field is mutated late. Nothing throws that does not throw today.

## Quick path

| Decision | Answer                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DD1      | Snapshot lives in a new pure module `src/shared/config/snapshot.ts`, called from `TonderCore`'s constructor.                                                                   |
| DD2      | `clonePlainDeep` recurses plain objects and arrays only; everything else copied by reference; per-property read guard; depth cap instead of a cycle set.                       |
| DD3      | `events` is excluded from the clone and re-installed as an accessor pair reading/writing `original.events`. Covers `payment` and `presentation`.                               |
| DD4      | All 18 fields → `#private`. Nothing breaks. Published `.d.ts` collapses 17 declarations into one `#private;` line.                                                             |
| DD5      | Drift detection moves from three call sites to a single gate inside `getConfig()`, behind a `#driftReported` latch, with the sink injected so `core/` never imports `console`. |
| DD6      | AC-2 asserts on recorded outgoing requests through a fake `HttpPort`; the built-artifact probe stubs `globalThis.fetch`.                                                       |
| DD7      | Snapshot lands **before** `#private`.                                                                                                                                          |

## Corrections to the proposal

Three things in `proposal.md` do not survive contact with the tree. They are corrected here and this document wins.

| #   | Proposal says                                                                                                                              | Reality                                                                                                                                                            | Consequence                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | AC-10 asserts `getConfig() !== myConfig` on `dist/index.mjs`.                                                                              | After DD4, `tonder.core` is `undefined`, so `getConfig()` is **unreachable from outside the bundle**. The assertion cannot be written.                             | AC-10 is restated in [Verification](#verification). The unreachability _is_ the proof; the identity check moves to a unit test that holds a `TonderCore` directly.             |
| C2  | AC-10 asserts "late `events` assignment still visible" on the built artifact.                                                              | `emitPayment` is only reachable through `pay()` or the Apple Pay button; both need DOM and a remote tokenizer/acquirer script. A bare Node probe cannot drive one. | The built-artifact probe asserts _no throw_ on late assignment only. Liveness stays a unit-level guarantee (AC-4/AC-5 in jsdom). Stated as a known seam gap, not papered over. |
| C3  | The label `AC-11` is used for two different things — QA's ticket criterion (the mutability defect) and the proposal's own gates criterion. | Collision.                                                                                                                                                         | Below, **AC-11** always means the proposal's gates row. QA's criterion is written **QA-AC-11**.                                                                                |

One more, not an error but an omission: `Tonder`'s constructor reads `config.customization?.card_fields` from the **original** object at `src/tonder.ts:200` and hands that live sub-object to `SkyflowAdapter`. The proposal declares `customization` snapshotted; that one line would leave it aliased. See DD1.

## DD1 — Where the snapshot lives

**Decision: a new module `src/shared/config/snapshot.ts`, invoked from `TonderCore`'s constructor.**

Three candidate placements, and why the other two lose:

| Placement                                                   | Verdict                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline in `TonderCore`                                      | Rejected. `TonderCore`'s contract (`src/core/TonderCore.ts:26-30`) is "PURE: no DOM, HTTP, or external-SDK imports — only config/types". A recursive cloner with a plain-object predicate, a depth cap, and a getter carve-out is 60+ lines of config policy. It is pure, but it is not _core state_, and burying it there makes the highest-risk logic in this change untestable in isolation. |
| `Tonder`'s constructor                                      | Rejected. `TonderCore.getConfig()` (`:48`) is the single read gate — every one of the 15 `getConfig()` call sites in `src/tonder.ts` goes through it. Snapshotting one level up leaves `new TonderCore(rawConfig)` as a live path that any future caller can take. Put the guarantee where the gate is.                                                                                         |
| **`src/shared/config/snapshot.ts`, called by `TonderCore`** | **Chosen.** Sits beside `src/shared/config/env.ts`, which is the existing home for pure config policy. The `events` carve-out — the single highest-risk piece — becomes directly unit-testable without constructing a `Tonder`. `TonderCore` gains one import and one line, and stays pure: this is data-in/data-out, no DOM, no HTTP.                                                          |

Signature:

```ts
// src/shared/config/snapshot.ts
export function createConfigSnapshot(original: TonderConfig): TonderConfig;
```

One function owns the whole contract: deep-copy every key except `events`, then install the `events` accessor. A reader who wants to know what is frozen-in-time and what stays live reads one file.

`TonderCore` changes to:

```ts
readonly #original: TonderConfig;      // detection + events source ONLY
readonly #config: TonderConfig;        // the snapshot; what getConfig() returns
#driftReported = false;

constructor(config: TonderConfig, onDrift?: ConfigDriftSink) { ... }
public getConfig(): Readonly<TonderConfig> { /* DD5 gate */ return this.#config; }
```

`onDrift` is optional so the 12 existing direct `new TonderCore(...)` usages in tests (if any) keep compiling.

**Also required by this decision:** `src/tonder.ts:200` must change from `config.customization?.card_fields` to read off `this.core.getConfig()`. Ordering permits it — `this.core` is assigned at `:185`, fifteen lines earlier. Without this line the `customization` snapshot claim is false for the one sub-object a merchant is most likely to hold a reference to.

## DD2 — Clone semantics

```ts
function clonePlainDeep<T>(value: T, depth: number): T;
const MAX_DEPTH = 8;
```

**Plain-object test** — exactly this, nothing looser:

```ts
const proto = Object.getPrototypeOf(value);
const isPlain = proto === Object.prototype || proto === null;
```

`structuredClone` is rejected: it throws on functions and drops prototypes. A merchant putting a callback anywhere in `customization` would get a `TypeError` out of `createTonder()`.

### Behavior table — binding

| Input                                                   | Result                                    | Why                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Plain object                                            | New object, recursed                      | The `TonderConfig` shape                                                                                                  |
| Array                                                   | New array, each element recursed          | `customization` sub-lists                                                                                                 |
| Prototype-less object (`Object.create(null)`)           | New object, recursed                      | `proto === null` is explicitly plain; it is a bag of data, and treating it as opaque would silently leave a mutation hole |
| Class instance (`Date`, `Map`, `URL`, a merchant class) | **By reference**                          | Prototype is neither `Object.prototype` nor `null`. Copying it correctly requires knowing its invariants; we do not.      |
| Array of class instances                                | New array, elements by reference          | The array is plain-shaped, its contents are not                                                                           |
| Function                                                | By reference                              | Same rule; functions have `Function.prototype`                                                                            |
| DOM node                                                | By reference                              | Same rule                                                                                                                 |
| Primitive, `null`, `undefined`                          | By value                                  | —                                                                                                                         |
| Getter that returns normally                            | **Invoked once**, its return value cloned | The snapshot must be a value, not a live wire                                                                             |
| Getter that throws                                      | **Key skipped**, clone continues          | See below                                                                                                                 |

### The throwing getter

Reading a property invokes its getter. Three options were on the table:

1. Let it propagate — `createTonder()` gains a new throw mode. Rejected: this change exists to _remove_ a runtime failure mode from the merchant's browser, not add one.
2. Copy the accessor descriptor with `Object.defineProperty` instead of invoking it — never throws, but the property stays **live**. Rejected outright: it makes mutability depend on whether the merchant declared the field as a value or an accessor. That is exactly the integration-style-dependent behavior fork we rejected `Object.freeze` for.
3. **Chosen — per-property `try`/`catch`, skip on throw.** Each property read is individually guarded. A throwing key is omitted from the snapshot, so the SDK sees it as absent — a state every optional key in `TonderConfig` already handles. When the drift sink is present, report the skipped key through it (same non-throwing channel as DD5) so the merchant is not debugging blind.

`api_key` and `environment` are unaffected: `assertValidConfig` (`src/tonder.ts:110-130`) reads both **before** `new TonderCore(...)` at `:185`, so a throwing getter on either already throws at today's location, from today's code. No new behavior.

Enumeration uses `Object.keys` (own enumerable), not `for...in`. Inherited properties are not part of `TonderConfig`.

### Cycles

**Decision: bounded depth (`MAX_DEPTH = 8`), no `WeakMap` seen-set. Beyond the cap, copy by reference.**

Can a merchant config contain a cycle? Only deliberately, inside `customization`. `TonderConfig` (`src/shared/types/index.ts:112-149`) is a closed interface whose deepest real path is 3 (`customization.card_fields.error_messages`). Nothing in it is self-referential.

Why the cap beats a `WeakMap`:

- A `WeakMap` preserves shared references _and_ cycles faithfully — which means a shared node stays **aliased between two snapshot paths**. Correct cloning, wrong goal: this change exists to destroy aliasing.
- The cap is three lines, allocation-free, and cannot stack-overflow by construction. A `WeakMap` costs an allocation on every `createTonder()` to defend against a config nobody writes.
- Degradation at depth 9 is aliasing-by-reference — the status quo — not a crash and not silence about a shape that matters. Nothing in the real config shape reaches it.

Letting it stack-overflow was considered and rejected: a `RangeError` out of `createTonder()` is the same new-throw-mode problem as the getter.

## DD3 — The `events` carve-out

This is the highest-risk piece in the change and its failure mode is silent: handlers stop firing, so a payment that succeeded looks to the merchant like it vanished. Design it explicitly, test it twice.

**Placement: on the snapshot object, installed by `createConfigSnapshot`. Not in `getConfig()`.**

```ts
// inside createConfigSnapshot, after cloning every key EXCEPT `events`
Object.defineProperty(snapshot, 'events', {
  get: () => original.events,
  set: (next: TonderEvents | undefined) => {
    original.events = next;
  },
  enumerable: true,
  configurable: true,
});
```

`getConfig()` returns the **same object** every call. Rejected alternative: building `{ ...snapshot, get events() {...} }` per call — spreading invokes the getter, drops the accessor into a frozen value, allocates on a payment path, and breaks reference identity of the returned config. Three defects, no benefit.

### Why the accessor is on `events`, not on `events.payment`

`createConfigSnapshot` **omits the `events` key from the clone entirely** and installs the accessor in its place. Consequence: the case with no `events` at construction works, because there is no key to alias — the getter reads `original.events` and finds whatever the merchant assigned afterwards. This is the case `README.md:640-655` documents and `README.md:697` promises. A design that "keeps the `events` sub-object by reference" fails it outright.

### Call sites — verified, all unchanged

| Site                    | Code                                                 | After                                                                                             |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/tonder.ts:436`     | `this.core.getConfig().events?.payment`              | Live. Accessor fires on every `emitPayment`.                                                      |
| `src/tonder.ts:680`     | `config.events?.presentation?.on_open`               | Live. `config` is `getConfig()` from `:674`, resolved inside `handleRequiresAction` at fire time. |
| `src/tonder.ts:737-738` | `config.events?.presentation?.on_open` / `.on_close` | Live. Same, from `:728`.                                                                          |

`presentation` is covered by construction, not by accident: the accessor is on `events`, so the entire object graph beneath it stays live and mutable. That matches the published type doc, which already states both branches are "read at FIRE time" (`src/shared/types/index.ts:141-148`). **Zero call-site edits for the carve-out.**

The setter exists for one reason: an accessor without a setter throws `TypeError` on assignment in strict mode, and bundled ESM is always strict. Nothing in `src/` assigns `config.events`, but a one-line setter removes a throw mode that would otherwise be reachable from any merchant holding the returned config.

`enumerable: true` keeps `events` visible to `Object.keys(config)` and devtools. Cost: when the merchant passed no `events`, `'events' in config` is now `true` where it was `false`. Nothing in `src/` uses `in` on config; `JSON.stringify` still drops the key because the getter returns `undefined`.

### Intentionally inert

`presentation_mode` (`:329`, `:675`, `:729`) and `customization.apple_pay_button` (`:362`) are live today only as a side effect of the aliasing. Neither is documented as fire-time; only `events` is. Both become snapshot values. This is an observable behavior change and gets a README line in the same commit.

## DD4 — `#private` conversion

**18 fields**: `src/tonder.ts:141-157` (17) plus `paymentEvents` at `:418`. Confirmed by reading, not assumed.

### Does anything break?

All 97 `this.<field>` references live inside the `Tonder` class body (`rg` over `src/tonder.ts`) — a mechanical rename. Everything else checked and clean:

| Hazard                                                                 | Finding                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bracket/dynamic access `this['core']` etc.                             | None in `src/` or `e2e/`.                                                                                                                                                                                   |
| `as any` casts reaching a field                                        | None.                                                                                                                                                                                                       |
| `@ts-expect-error` touching a field                                    | 9 hits, all on public API shapes (`src/tonder.create.test.ts:118`, `src/tonder.pay.test.ts:317`, `src/tonder.handleRequiresAction.test.ts:250,262`, `src/types/*.test.ts`). None reaches an instance field. |
| Spreading `...tonder`, `Object.keys(tonder)`, `JSON.stringify(tonder)` | None in the repo. All three are _intended_ to change — AC-7 pins the new behavior.                                                                                                                          |
| Field-initializer ordering                                             | `#paymentEvents` (`:418`) initializes before the constructor body, but its three arrow functions capture `this` and dereference `this.#core` lazily at fire time. Safe.                                     |
| `#paymentEvents` consumed at `:334` (`emit: this.paymentEvents`)       | Inside a class method. Safe.                                                                                                                                                                                |
| Brand checks / `instanceof`                                            | None.                                                                                                                                                                                                       |

**Nothing breaks. Zero test-file edits — that is AC-9, and it is also the falsifier: any test needing an edit means the seam broke and this approach is wrong.**

Caveat on the gate: `tsconfig.json` `exclude` lists `**/*.test.ts`, so `npm run typecheck` does **not** compile test files. AC-9's real guard is the runtime suite, not the compiler.

### `_createTonderWithDeps`

Verified at `src/tonder.ts:1245-1263`: it constructs `new Tonder(deps.config, deps.http, ...)` and returns. It passes **constructor parameters only** and never reads a field back off the instance. `#private` is invisible to it and to all 9 test files that use it. Untouched by this change.

### Published `.d.ts`

Today, `dist/index.d.ts:837-853` publishes 17 lines naming every internal collaborator:

```
private readonly core;
private readonly services;
...
```

Plus `private readonly paymentEvents;` at `:891`.

After the change, TypeScript emits a single `#private;` marker for the class instead. Those 18 names disappear from the published artifact.

**This is an improvement, and a small one.** Nominal typing of `Tonder` is unchanged — a class with `private` members is already non-structurally-assignable, so no merchant could implement or duck-type `Tonder` today either. What changes is that the published type no longer advertises the SDK's internal composition to every editor tooltip, which is the same goal `scripts/check-dist-vocabulary.mjs` serves for comments. No merchant-visible regression.

**Verify at apply time, do not assume:** `rollup-plugin-dts@6` must preserve the `#private;` marker through its bundling pass. If it drops it and produces a bare class, the type stays nominally distinct via other members but the emit should be inspected. The `postbuild` vocabulary check will still run either way.

Private **methods** (`runPay`, `emitPayment`, `handleRequiresAction`, ... — `dist/index.d.ts:882-1113`) stay TypeScript-`private` and therefore stay reachable on the prototype at runtime. `Object.keys(tonder)` is unaffected (prototype methods are not own properties), so AC-7 holds. But `tonder.runPay(...)` remains callable, which is a residual of the same class as `directApiService.processPayment`. Out of scope per the proposal; recorded as a forward finding rather than silently implied fixed.

## DD5 — The drift warning

**Decision: keep it, but move it and shrink it. One gate inside `getConfig()`, latched, with the sink injected.**

The proposal put the comparison on three call sites (`ensureCustomerRegistered`, `resolveCardAuth`, `runPay`). That is worse than a single gate on three counts: it triples the code, it covers only 3 of the 15 read paths, and it puts diagnostic logic in the payment orchestration where it will rot.

### Is it worth its complexity at all?

Yes — narrowly. The honest case for cutting it: it is ~40 lines and one AC, guarding a scenario the published type doc (`src/shared/types/index.ts:119-124`) already warns about. The case for keeping it is stronger: this change deliberately breaks code that **works in production today** on `@tonder.io/web-sdk@0.1.5`. The merchant who wrote `cfg.session.customer.email = x` gets no error, no failed request, and a payment attributed to the wrong shopper. Without a signal, the first person to notice is support. Forty lines to convert a silent semantic change into a named console line is a good trade, and it is the mitigation that makes "snapshot, never throw" defensible against `Object.freeze` in the first place.

It is kept on the condition that it is _cheap and bounded_, which is what the rest of this section enforces.

### Where and how

```ts
public getConfig(): Readonly<TonderConfig> {
  if (!this.#driftReported) this.#detectDrift();
  return this.#config;
}
```

- **Latched.** After the first report, `#driftReported` is `true` and `getConfig()` is a bare field read forever. Zero steady-state cost.
- **Before the first report**, the cost is a bounded set of string comparisons — see below. Against a network round-trip this is unmeasurable; it is also unmeasurable against the non-network `getConfig()` calls.
- **Coverage is strictly better than the proposal's**: every read path, including `init()` (`:480`), the Apple Pay context (`:327-329`), and `pay()` (`:561`).

### What is compared

Deep equality is rejected — expensive, unbounded, and it would walk merchant objects we deliberately copied by reference. Compare exactly the fields the published doc calls fixed:

| Field                  | Comparison                                                   | Why this and not less                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.secure_token` | String `!==`                                                 | The widest window: read live on every saved-card call, never memoized (`:1164`).                                                                                                                                                                                                                             |
| `session.customer`     | Shallow scan of the snapshot's own keys, value `!==` per key | **Reference identity is not enough.** `cfg.session.customer = {...}` (replacement) would be caught by identity, but QA's actual reported case is `cfg.session.customer.email = x` — in-place, same reference. `Customer` is a flat bag of strings, so a shallow key scan is ~6 comparisons and catches both. |

Bounded by construction: no recursion, no key count that grows with merchant input beyond `Customer`'s own shape.

### It can never throw

Two independent failure sources, two guards:

1. **The comparison itself.** `this.#original.session` may be a merchant getter that throws. The whole `#detectDrift()` body is wrapped in `try`/`catch`. On catch: set `#driftReported = true` and return. A config that cannot even be _inspected_ will not be inspected again.
2. **The sink.** AC-8 requires that a stubbed throwing `console.warn` does not fail the payment. Set `#driftReported = true` **before** invoking the sink, then invoke it inside its own `try`/`catch` with an empty handler. Latching first guarantees at-most-once even when the sink throws.

Nothing in this path can change control flow, return value, or request content. It is observation only.

### Keeping `core/` pure

`TonderCore` does not import `console`. The sink is injected:

```ts
export type ConfigDriftSink = (field: string) => void;
constructor(config: TonderConfig, onDrift?: ConfigDriftSink)
```

`Tonder` supplies it at `src/tonder.ts:185`:

```ts
this.core = new TonderCore(config, (field) => {
  console.warn(
    `[tonder] config.${field} was changed after createTonder() and has no effect. ...`,
  );
});
```

This matches the codebase's existing port/adapter discipline, keeps `console` out of the pure layer, and makes AC-8 testable by passing a spy sink instead of monkey-patching a global. The DD2 skipped-getter report uses the same sink.

## DD6 — The in-repo test that replaces the unreachable QA probe

QA's probe lives in `tonder-qa`, folder `SDK 2.0`, field `cardsC_firstCallAfterPreMutation`. That repo was unreachable and remains unverified. This test reproduces it in-repo and is the gate; re-running QA's probe is a nice-to-have.

**AC-2 — mutate BEFORE the first call.**

```
GIVEN  _createTonderWithDeps({ config, http: recordingHttp })
       config.session.customer = A, config.session.secure_token = T1
       recordingHttp is a fake HttpPort capturing { method, url, headers, body }
WHEN   await tonder.init()
       config.session.customer.email = B.email        // in place, no call yet
       config.session.customer = { ...B }             // replacement, no call yet
       await tonder.getCustomerCards()
THEN   the recorded POST /api/v1/customer/ body carries A's email
AND    the recorded cards request carries the User-Token resolved from A
AND    the recorded cards request carries secure_token T1
AND    no recorded request anywhere carries B's email
```

**What it asserts on, and why:** the **outgoing request**, captured at the `HttpPort` seam. That boundary is entirely within this SDK's control. Whether the backend answers with A's cards, an empty list, or a 403 is a backend authorization decision and an explicit non-goal — asserting on the response would make this test a test of someone else's service, and it would go red for reasons this change cannot fix.

Both mutation shapes are exercised in one test because they exercise different code: in-place mutation defeats reference identity, replacement defeats value memoization. A test covering only one is a test that passes against half a fix.

The recording fake also gives AC-1 and AC-3 for free — same harness, different timing.

## Verification

### Capture the baseline BEFORE the first edit

Do not trust a remembered number. On a clean tree, run and record verbatim:

```bash
npm run lint 2>&1 | tail -3           # eslint baseline: current error/warning count
npm run format:check 2>&1 | tail -3   # prettier baseline
npm run test 2>&1 | tail -5           # suite baseline: file/test counts
npm run typecheck                     # must already be green
```

Any post-change delta against these four is attributable to this change. A remembered baseline proves nothing.

### Per-commit gates

```bash
npm run test        # AC-1..AC-9
npm run typecheck   # tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json
npm run build       # rollup + postbuild check-dist-vocabulary.mjs
```

`npm run build` is not optional per commit: `postbuild` runs `scripts/check-dist-vocabulary.mjs`, which fails on published or `src/` comments — see the trap below.

### Built-artifact probe

`scripts/probe-mutation-hardening.mjs`, run as `npm run build && node scripts/probe-mutation-hardening.mjs`. Exits 0 or 1.

It imports `createTonder` from `../dist/index.mjs` — note `_createTonderWithDeps` is **not** exported from `src/index.ts`, so it is not in the bundle. The probe therefore stubs `globalThis.fetch` to record requests and return canned responses. That is enough for the fetch-only paths (`init`, `ensureCustomerRegistered`, `getCustomerCards`); it is not enough for `pay()`, which needs DOM and remote tokenizer/acquirer scripts.

| Assertion                                                                                                                                                                  | Proves                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Object.keys(tonder).length === 0`                                                                                                                                         | Enumeration sealed. This is QA's enumeration probe, reproduced.                                                  |
| `JSON.stringify(tonder) === '{}'`                                                                                                                                          | The instance no longer leaks config to a merchant's logger.                                                      |
| `tonder.core === undefined && tonder.http === undefined && tonder.paymentEvents === undefined`                                                                             | The three highest-ranked reach-ins are gone. Also _why_ C1's `getConfig() !== myConfig` is unwritable from here. |
| Mutate `cfg.session.customer.email` and `cfg.session.secure_token` before any call, then `getCustomerCards()`; every recorded `fetch` carries the construction-time values | QA-AC-11 fixed on the **shipped** artifact, not just in source.                                                  |
| Late `cfg.events = { payment: { on_success } }` completes without throwing                                                                                                 | No `TypeError` in a shopper's browser.                                                                           |
| Every mutation above completed without throwing                                                                                                                            | The no-freeze guarantee, on the real bundle in real strict-mode ESM.                                             |

**Known seam gap (C2):** the probe cannot prove `events` _fires_, only that assigning it does not throw. `events` liveness is proven by AC-4 and AC-5 in jsdom under vitest, where `emitPayment` is reachable. This gap is stated rather than hidden; closing it would need a headless-browser e2e, which is out of scope.

### Trap that will bite the apply phase

`scripts/check-dist-vocabulary.mjs` runs on `postbuild` and scans `src/**/*.ts` **including line comments**. Its `FORBIDDEN_VOCABULARY` bans, among others:

- `/\bDD\d+\b/` — **`DD1`..`DD7` from this document must never appear in a `src/` comment.**
- `/\bD\d+\b/` — same for short design labels.
- `/\bDEV-\d+\b/` — no `DEV-2277`.
- `/\bINTERNAL\b/` (all-caps), `/\bphase \d+\b/`.

Write the _reasoning_ into source comments; leave the labels in `openspec/`. A comment citing `DD3` fails the build.

## Commit plan

Snapshot **before** `#private`. This is the load-bearing ordering decision.

The two fixes are independent, but they are not equal. `#private` makes QA's enumeration probe go green and makes the instance look sealed, while QA-AC-11 — the reported defect, the merchant mutating their own retained `config` reference — stays **fully intact**. Landing it first opens a window in which the change reads as done to anyone glancing at commit titles or re-running the QA probe, and is not. That window is exactly how a hide-only fix ships. Landing the snapshot first inverts it: after commit 2 the reported defect is gone and the remainder is hardening.

| #   | Commit                                                             | Contains                                                                                                                                                                                                                                          | Green when                    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | `test(events): pin the post-createTonder events contract`          | AC-4, AC-5 as characterization tests. They pass against **today's** code — that is the point. They are the tripwire under commits 2 and 3.                                                                                                        | Suite green, no source change |
| 2   | `fix(config): snapshot merchant config at construction`            | `src/shared/config/snapshot.ts`, `TonderCore` wiring, the `:200` `card_fields` source switch, AC-1/2/3/6 red→green, AC-4/5 still green, README lines for snapshot semantics + `events` still live + `presentation_mode`/`customization` now inert | QA-AC-11 fixed                |
| 3   | `fix(sdk): make instance fields unreachable`                       | 18 fields → `#private`, AC-7 red→green, AC-9 (zero test edits), README note on `JSON.stringify(tonder)`                                                                                                                                           | Enumeration sealed            |
| 4   | `feat(config): warn once when a snapshotted field is mutated late` | `ConfigDriftSink`, `#detectDrift`, the `Tonder` wiring, AC-8                                                                                                                                                                                      | Silence becomes a signal      |
| 5   | `test(build): assert the guarantees on the built artifact`         | `scripts/probe-mutation-hardening.mjs`, AC-10                                                                                                                                                                                                     | Guarantees hold on `dist/`    |

Each commit stands alone: the repo makes sense after applying only it, tests ship with the behavior they verify, docs ship with the user-visible change they explain, and each is individually revertible without disturbing the others. Commit 1 is deliberately test-only — it is the safety net, and it has to exist before the thing it catches.

**Delivery: commits only, no PR.** Estimated 250–350 changed lines, majority tests — under the 400-line budget, so no chaining and no `size:exception`.

## Risks carried into apply

| Risk                                                                 | Watch for                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `events` carve-out wrong → handlers silently never fire              | AC-4 (absent at construction) and AC-5 (replaced late) are the only guards. If either is weakened, stop. |
| `rollup-plugin-dts@6` mishandles the `#private;` marker              | Inspect `dist/index.d.ts` after commit 3's build. Unverified — no build was run in this phase.           |
| Built-artifact probe cannot prove `events` liveness (C2)             | Do not let the probe's green be read as covering AC-4/AC-5.                                              |
| Drift comparison reads a merchant getter                             | The `try`/`catch` in `#detectDrift` is load-bearing. Do not "simplify" it away.                          |
| Vocabulary scanner rejects `DD`/`D`/`DEV-` labels in `src/` comments | Fails at `postbuild`, after tests pass — easy to misread as a build regression.                          |
| Private _methods_ stay prototype-reachable                           | Out of scope, but do not claim the instance surface is fully closed.                                     |
