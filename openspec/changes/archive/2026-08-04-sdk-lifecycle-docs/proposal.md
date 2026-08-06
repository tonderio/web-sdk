# Proposal: make the component lifecycle contract explicit

**Change:** `sdk-lifecycle-docs`
**Status:** proposed
**Delivery:** commits only, no pull requests

Merchants building single-page apps can leave a Tonder component mounted forever, and nothing in our documentation tells them what that costs. This change makes `unmount()` a documented contract instead of an undocumented courtesy, adds the missing Apple Pay chapter to the internal onboarding guide, and records one real code defect that this change deliberately does not fix.

---

## 1. Retraction (read this first)

A previous statement in this project claimed that skipping `unmount()` causes a React application to freeze on back-navigation. **That claim is retracted. It was wrong.**

Eight executable repros were run against the real `BrowserApplePay` adapter, the real `SkyflowAdapter`, and the real `Tonder` facade. No code path in `src/` freezes a page or a UI. Neither mountable component attaches a `document`- or `window`-level listener. The only global listener in the entire SDK is a `keydown` handler on the 3DS modal host (`src/adapters/browser-3ds-host.adapter.ts:127`), which is unrelated to both mountable components and is already removed by its own `close()`. React 18 StrictMode's mount to unmount to mount cycle is safe for both components — reproduced, with no duplication and no leak.

This retraction is stated here rather than quietly dropped, because a document that silently abandons a claim teaches the next reader nothing. The real problem is different, narrower, and more dangerous.

---

## 2. Why now

Skipping `unmount()` has three real consequences, ranked by severity. All three were established by executed repros against real adapter code, not by reading.

| #   | Severity   | What actually happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                  |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **HIGH**   | **Orphaned Apple Pay session with a stale-charge risk.** `create()` builds a new `ApplePayCheckoutService` per call. A second `mount()` self-heals the DOM button but deliberately does **not** abort a session already in flight (`src/tonder.ts:370-372`). Only `unmount()` calls `checkout.abort()` (`src/tonder.ts:387`). An SPA route change without `unmount()` therefore leaves the previous service and its live session orphaned and unreachable — no handle exists that can abort them. If that orphaned sheet is later authorized, it still calls `processPayment()` with stale payment data. | Repro proved two live sessions coexisting; a control case proved `unmount()` prevents it. |
| 2   | **MEDIUM** | **Card-fields remount race.** `tryMountElement` (`src/adapters/skyflow/skyflow.adapter.ts:696-714`) polls for the container `MOUNT_RETRIES = 2` extra times at `MOUNT_RETRY_DELAY_MS = 30`, i.e. three attempts across ~60 ms. If the new route's container is not in the DOM by then, the field fails **silently** — `console.warn` only, no throw.                                                                                                                                                                                                                                                     | Reproduced with a fake Skyflow loader.                                                    |
| 3   | **LOW**    | **`#mountedCardFields` growth.** One entry accumulates per distinct `update:<card_id>` context mounted without a matching `unmount()`. The common `create` context overwrites its key rather than appending, so this only affects the many-saved-cards-CVV pattern.                                                                                                                                                                                                                                                                                                                                      | Code trace, `src/tonder.ts:405-417`.                                                      |

**One constraint remains UNVERIFIED.** Apple is believed to allow only one active `ApplePaySession` per browser at a time. This is untestable in jsdom and no real Safari device was available. If true, an orphaned session would **block** the next one, which is the most plausible origin of an integrator reporting a "stuck" Apple Pay button. It goes on a real-Safari validation list. **The documentation must not assert it.**

### The documentation gaps that let this happen

All nine `unmount` mentions in the README were read.

- **None** of them says when `unmount()` is mandatory or what breaks if it is skipped. `README.md:690` and `:908-910` both describe the mechanics ("removes the button and dismisses the payment sheet") and neither describes the consequence of omission.
- The Apple Pay runnable sample (`README.md:656-688`) ends at `await button.mount()`. `unmount()` appears only in a prose sentence afterwards (`:690`). A copy-pasted snippet therefore ships the leak.
- The Quick Start `card_fields` sample (`README.md:171-237`) never calls `unmount()` at all.
- The `unmount_context` type block (`README.md:805`) shows the bare union and drops the explanatory JSDoc from `src/types/card.ts:111-115` ("Defaults to `'all'`…"). A reader of the README cannot learn what the default is.
- **The README contains zero React code examples.** Its three "React" mentions are a link to an external repo, a Vite env-var label, and a CDN typing note. `ApplePayDemo.tsx` in the demo portal is the only React lifecycle example in either repository, and it covers `apple_pay_button` only. **No `card_fields` React example exists anywhere.**

---

## 3. Decisions

### Decision 1 — Docs-only. No code change to the lifecycle.

**Recommendation: docs-only.** Three code-level safety nets were considered and are rejected.

| Option                                                                                    | Rejected because                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `pagehide` / `visibilitychange` safety net that aborts live sessions                    | Fires on tab switch, on iOS app backgrounding, and on bfcache eviction — none of which mean the shopper abandoned checkout. Aborting a sheet the shopper is actively authorizing on their watch or phone would convert a working payment into a cancellation. It trades a rare stale charge for a common broken checkout. Strictly worse.                                                                                                            |
| A registry of live sessions on the `Tonder` instance, auto-aborted on the next `create()` | Directly contradicts the existing design decision: one service per button, so that a second button's `unmount()` cannot abort the first button's live sheet. A registry reintroduces exactly that cross-talk. It also does not solve the stated problem, because an SPA route change does not call `create()` again until the merchant returns to checkout — by which time the orphaned session has already had its whole lifetime to be authorized. |
| Widening `mount()` to abort an in-flight session                                          | The comment at `src/tonder.ts:370-372` is not an oversight; it is the contract. `mount()` is idempotent-by-disposal for the DOM, and re-mounting a button must not cancel a sheet the shopper already opened.                                                                                                                                                                                                                                        |

The SDK cannot detect that a merchant navigated away. Only the merchant's router knows that. This is genuinely the merchant's call to make, which is exactly why the documentation must make the call visible.

**Residual risk the merchant carries after this change:** an SPA that unmounts a checkout route without calling `apple_pay_button.unmount()` can leave an authorized-but-stale charge in flight. The documentation must state this consequence in plain language at the point of use — inside the runnable sample, not in prose after it — so the risk is accepted knowingly rather than inherited silently.

### Decision 2 — One canonical React lifecycle section, not per-flow examples.

**Recommendation: a single "Component lifecycle" subsection under the existing `Core concepts` heading,** covering both `card_fields` and `apple_pay_button`, referenced by short cross-links from the Apple Pay flow section and from `card_fields.unmount()` in the API reference.

Defended against the alternatives:

- _Full React sections per flow_ would repeat the same effect-cleanup pattern five or more times in a 1,672-line document. The README's problem is not that it lacks React content; it is that it is already long enough that additions must earn their lines. Repetition spends lines without adding information.
- _A link to the demo portal only_ fails the integrator who is reading offline, reading on npm, or evaluating the SDK before cloning anything. It also makes the most important safety rule in the SDK the one piece of information that is not in the SDK's own documentation.

One canonical section is the smallest form that closes the gap. The cross-links cost one line each.

**The section must distinguish two cases, and this is the sharpest editorial constraint in this change.** Calling `unmount()` "recommended" understates a stale-charge risk. Calling it a hard requirement is false for a classic server-rendered checkout page that never navigates away without a full page load — there, the browser tears everything down anyway. The guidance is therefore conditional on navigation, not on framework:

> If your page unloads to change checkout state, the browser cleans up for you. If your app changes routes without a page load, you own the cleanup.

That framing is correct for React, Vue, Angular, Astro islands, and htmx alike, and it stays correct for a vanilla page that never navigates.

### Decision 3 — The card-fields retry race is OUT OF SCOPE, and recorded as such.

`MOUNT_RETRIES = 2` at 30 ms with a `console.warn`-only failure is a genuine code defect, not a documentation gap. A merchant whose container paints at 70 ms gets a checkout form silently missing a field, with no error to catch and no event to observe.

It does not belong in a documentation change. Fixing it well means choosing between a longer retry budget, a `MutationObserver`, and a thrown `MOUNT_COLLECT_ERROR` — each with a different backwards-compatibility profile, and the "throw" option is a breaking behavioral change for anyone currently relying on the silent-warn path. That is its own change with its own spec.

**Recorded explicitly here so it is not buried:** silent card-field mount failure after ~60 ms is an open defect at `src/adapters/skyflow/skyflow.adapter.ts:696-714`, deferred to a follow-up change. This proposal does not fix it and does not document it as acceptable behavior.

### Decision 4 — The internal guide gets a flow, a diagram, an ownership row, and durable links.

`docs/internal_onboarding_notion.md` (233 lines) states its own maintenance rule at line 228: _"Keep this guide stable and conceptual. Do not paste full public API tables here."_ That rule is the user's point 2 already written down by the document itself, and every addition below respects it.

**The single highest-value addition is one row in the Support ownership model.** The most common production Apple Pay failure will not be an SDK bug. It will be a merchant whose domain is not registered with Apple, which surfaces as a `validate-merchant` failure and arrives at Tonder as a ticket filed against the SDK. Today's ownership table (lines 218-224) has no row that routes it, so it will land on the SDK team by default and stay there while the actual fix is a merchant-side Apple Developer registration. That row is worth more to Tonder's support cost than every other change in this document.

Planned additions:

| Where                             | What                                                                                                                                                                | Why it respects "conceptual, no API tables"                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supported flows                   | A new flow **6. Apple Pay**, in the same numbered high-level-steps prose as flows 1-5                                                                               | Describes the mental model — the SDK owns the button and the click, there is no `pay()` call, the result arrives via `events.payment`. No signatures, no options tables. |
| Core mental model mermaid diagram | An Apple Pay branch off the `{Payment flow}` decision node into `/process`                                                                                          | The diagram already omits Apple Pay entirely, which teaches the wrong model. One node and two edges.                                                                     |
| Main public concepts              | Two rows: `isApplePayAvailable()` and `apple_pay_button`                                                                                                            | The table is a pointer index, not an API table — each row is a one-line meaning plus a link.                                                                             |
| Demos                             | An Apple Pay row                                                                                                                                                    | The table lists what each demo validates.                                                                                                                                |
| Support ownership model           | **A `validate-merchant` / merchant domain-registration row**, first owner Integrations, escalate when the domain is confirmed registered and validation still fails | Ownership routing, which the maintenance rule explicitly names as a reason to update this guide.                                                                         |
| Lifecycle awareness               | One or two sentences in the Apple Pay flow noting that SPA merchants must unmount, **linking to the README** rather than restating it                               | Direct application of "do not duplicate the README."                                                                                                                     |

**Link shape, so references do not rot.** The guide currently points at `README.md → tonder.init()`, which is unresolvable from Notion, where this document actually lives. Replace with absolute GitHub links against the default branch:

```
https://github.com/tonderio/web-sdk/blob/main/README.md#tonderinit
```

`main` rather than a tag or a commit SHA, deliberately: a pinned ref rots into describing an old SDK, whereas `main` always describes the SDK the merchant is installing. The tradeoff is that an anchor breaks if a heading is renamed. That is accepted, and the maintenance rule gains a fourth step making anchor verification part of any README heading rename. Repository confirmed as `github.com/tonderio/web-sdk` from `package.json:46`.

### Decision 5 — The demo is correct. Document it; do not rewrite it.

`ApplePayDemo.tsx` lines 92-192 implement the `cancelled`-flag plus `buttonRef` pattern correctly and survive simulated StrictMode double-invocation with zero leaks — reproduced faithfully. It is the reference implementation, and the README's new canonical section should teach the pattern this demo already demonstrates.

One open question, deliberately left to the design phase rather than decided here: `buttonRef.current?.unmount()` at line 108 is redundant, because React always runs an effect's cleanup before re-firing that effect, and the cleanup at line 189 already unmounts. It is harmless. It is also defensive and self-documenting in a file whose entire purpose is to be read by integrators. **Recommendation: keep it, and add a one-line comment explaining that it is belt-and-braces rather than load-bearing** — an unexplained redundant line in a teaching artifact invites a reader to copy it as necessary, which is a worse outcome than either keeping or deleting it silently.

---

## 4. Scope

### In scope

1. **README** — for integrators.
   - A `Component lifecycle` subsection under `Core concepts`: what `unmount()` releases, the navigation-based rule for when it is required, the consequence of skipping it for Apple Pay, and one React `useEffect` cleanup example covering both components.
   - `unmount()` added inside the Apple Pay runnable sample (`~:656-688`), not only in prose after it.
   - `unmount()` and its lifecycle cross-link added to the Quick Start `card_fields` sample (`:171-237`).
   - The `unmount_context` JSDoc from `src/types/card.ts:111-115` restored into the type block at `:805`, so the `'all'` default is discoverable.
   - `apple_pay_button.unmount()` (`:908`) and `card_fields.unmount()` (`:938`) gain a one-line consequence statement and a cross-link.
   - Contents list updated.

2. **`docs/internal_onboarding_notion.md`** — for Tonder.
   - Flow 6 Apple Pay; Apple Pay in the mermaid diagram; two concept rows; a demos row; the `validate-merchant` ownership row; GitHub `main` links replacing `README.md → section` references; maintenance rule step 4 for anchor verification.

3. **`spa-docs-demos`** — exhaustive unmount review, already performed. No defects found. Expected output is a comment on `ApplePayDemo.tsx:108` and, if the design phase agrees it earns its keep, a `card_fields` React lifecycle example to close the "no `card_fields` React example anywhere" gap.

4. **Recording the deferred `tryMountElement` defect** as a follow-up change.

### Out of scope (non-goals)

- **Any change to lifecycle behavior in `src/`.** Argued and rejected in Decision 1.
- **Fixing `tryMountElement`.** Deferred to its own change, Decision 3.
- **Rewriting `ApplePayDemo.tsx`.** It is correct. At most it gains one clarifying comment.
- **Changing the `create()`-per-component design.** It is a deliberate isolation guarantee.
- **Asserting Apple's one-active-session constraint** anywhere in either document. Unverified.
- **Anything relating to the MCP work.**
- **Pull requests.** Commits only.
- **Restructuring the README.** Additions are surgical and anchored to existing sections.

---

## 5. What success looks like

- An integrator reading only the README's Apple Pay section can copy a runnable snippet that does not leak.
- An integrator reading only the Quick Start can answer "do I need to unmount?" without guessing, for both an SPA and a classic page.
- A Tonder support engineer reading only the internal guide can route an Apple Pay `validate-merchant` ticket without opening any source file.
- The internal guide adds no public API table and no duplicated README content — every public detail is one durable link away.
- The retracted freeze claim is not repeated anywhere.
- The deferred `tryMountElement` defect is on record with a location and a reason, not lost.

## 6. Risks

| Risk                                                                                                                              | Mitigation                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A README that grows without bound stops being read.                                                                               | One canonical section plus one-line cross-links, rather than per-flow React sections. Every addition is justified against an identified reader gap.                                  |
| Calling `unmount()` "recommended" understates a stale-charge risk; calling it mandatory is false for a page that never navigates. | Guidance is conditional on navigation, not on framework. Decision 2.                                                                                                                 |
| Apple's one-session constraint is unverified and tempting to state.                                                               | Explicit non-goal. It belongs on a real-Safari validation list, not in either document.                                                                                              |
| GitHub anchor links break if a README heading is renamed.                                                                         | Accepted, in exchange for links that never describe a stale SDK. Mitigated by maintenance rule step 4.                                                                               |
| The internal guide is committed to a public repository while naming internal services and a stage demo URL.                       | Flagged for the design phase. Not decided here; it is a separate confidentiality question from this change's documentation goals, but it should not be discovered later by accident. |
| The deferred retry-race defect is forgotten.                                                                                      | Recorded in Decision 3 with file, line range, and constant values.                                                                                                                   |

## 7. Open questions for design

1. Does the README get a `card_fields` React example, or does the canonical lifecycle section's single example cover both components adequately?
2. Should the new `card_fields` React example, if any, live in the README, in the demo portal, or in both?
3. Keep or remove `ApplePayDemo.tsx:108`? Recommendation is keep plus comment.
4. Does `docs/internal_onboarding_notion.md` belong in the public repository at all, given its contents?
