# Proposal: a card field that fails to mount must be detectable

**Change:** `card-field-mount-visibility`
**Status:** proposed
**Branch:** `feature/DEV-2277`
**Delivery:** commits only, no pull requests

`card_fields.mount()` resolves successfully even when it mounted nothing. A shopper gets an empty box where a card input should be, and the merchant's `await mount()` returned normally, so there is nothing to catch and nothing to observe. This change makes that failure throw the error code the README already promises for it, and changes nothing else.

---

## 1. Corrections to the brief

Two stated facts were wrong when checked. Neither changes the conclusion, but building on them silently would be worse than saying so.

| Stated                                                           | Actual                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tryMountElement` is at `skyflow.adapter.ts:696-714`             | It is at `src/adapters/skyflow/skyflow.adapter.ts:704-723`. Lines 696-702 are `resolveRevealStyles`. The constants are unchanged: `MOUNT_RETRIES = 2` (`:75`), `MOUNT_RETRY_DELAY_MS = 30` (`:76`).                                                                    |
| Throwing is a breaking change whose audience must be established | Throwing is **conformance to the published contract**, not a new one. `README.md:1011` already documents `card_fields.mount()` as throwing `MOUNT_COLLECT_ERROR` when "A configured field cannot be mounted." The code does not honor its own documented Throws table. |

There is also no `CHANGELOG.md` in this repository, so "add a changelog entry" is not an available action. Section 6 states what replaces it.

---

## 2. What the defect actually is

**Name it precisely: `mount()` reports success for a form it did not build.**

The retry budget is not the defect. A 60 ms window is a _trigger_ — it is why the miss happens on an SPA route change. It is not why nobody finds out.

Two properties of `tryMountElement` (`:704-723`) produce the silence:

1. It returns normally after exhausting its attempts. `console.warn` at `:720-722` is the only signal, and a console line is not a programmatic outcome.
2. Its caller pushes the element into `elements` regardless (`:315`, unconditional after `await this.tryMountElement(...)` at `:314`), so an unmounted element is recorded as if it were mounted.

`mount()` then resolves `void` (`:281`). Nothing distinguishes "mounted five fields" from "mounted three fields and gave up on two."

This matters because it decides the fix. Widening the budget makes the trigger rarer while leaving the defect fully intact — the merchant whose route paints at 200 ms instead of 70 ms is in exactly the same undetectable position. Any fix that does not remove the silence is not a fix.

---

## 3. Is there a supported pattern of deliberately absent containers?

**No. The public API offers no way to request a field you do not intend to render.**

Evidence, all of it:

| Source                      | What it establishes                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/card.ts:87-89`   | `CardFieldEntry` is `CardField \| { field: CardField; container_id?: string }`. The only knob is _renaming_ the container. There is no "no container" form.                         |
| `src/types/card.ts:103-108` | Omitting `fields` mounts "the full new-card form using default containers: cardholder name, card number, expiration month, expiration year, and CVV." Five fields, five containers. |
| `README.md:176-186`         | The Quick Start markup renders exactly those five containers.                                                                                                                       |
| `README.md:631-636`         | The saved-card CVV flow passes `fields: ['cvv']` explicitly, with one container.                                                                                                    |
| `README.md:893-901`         | The default-container table gives every field a required container id.                                                                                                              |
| `README.md:1011`            | `MOUNT_COLLECT_ERROR` — "A configured field cannot be mounted." Already documented.                                                                                                 |

Every documented usage pairs one requested field with one container. The hypothetical in the brief — "pass all five default fields while rendering only three" — is not a supported pattern; it is an integration that has requested two fields it cannot render.

**And that integration is already broken, further downstream.** Because `:315` pushes the unmounted element into `elements`, it belongs to the Skyflow collect container and participates in `container.collect()` (`:353`). Its `validationsByField` rules (`:507-526`) require a non-empty value, which an unmounted element cannot have. That surfaces as a rejected `collect()` → `AppError(MOUNT_COLLECT_ERROR)` at `:357-361` → normalized to `PAYMENT_PROCESS_ERROR` at `src/tonder.ts:817-819`. The merchant already fails; they just fail at payment time, unnamed, on the shopper's checkout attempt.

So throwing does not break working integrations. It relocates an existing failure from payment time to mount time and gives it a name. That is a materially different proposition from the one the brief was worried about.

**Honesty about this claim's strength:** the container-id and API evidence above is direct. The collect-time-failure chain is traced from the SDK's own validation rules and Skyflow's documented element semantics, not from an executed repro against a real vault. It strengthens the recommendation; it is not load-bearing for it. The spec phase should treat it as a claim to verify, not as settled.

---

## 4. The decision

**Recommendation: throw when a configured collect container is still absent after the existing retry budget. Change nothing about the timing.**

### Why not the other three

| Option                                   | Rejected because                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Widen the retry budget**               | Trades one guess for a larger guess. Leaves the actual defect — an unobservable outcome — completely untouched. A merchant who loses a field at 200 ms is no better off than one who lost it at 70 ms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **`MutationObserver` / rAF polling**     | Solves the trigger, not the defect: a field that arrives late still mounts silently, and a field that never arrives still needs an answer. It therefore _requires_ the throw anyway as its bounded fallback, which means it is strictly additive work on top of the recommendation. It also introduces a hang as a new failure mode. Genuinely useful only if merchants report that the current budget is too tight _after_ failures become visible — and today we cannot know that, because failures are invisible. Revisit with evidence.                                                                                                                                                                 |
| **Report mounted fields from `mount()`** | The tempting fourth option, and it is worse here. It changes `mount(): Promise<void>` (`README.md:907`) for every merchant, and delivers zero benefit until each one writes new code to read the report. Merchants who ignore it stay exactly as broken as today — the silence becomes opt-out instead of removed. Meanwhile the SDK already has an error channel (`AppError` + `ErrorKeyEnum`), `mount()` already has a documented Throws table, and every merchant already has the `try`/`catch` that table implies. Adding a second parallel outcome mechanism for one component, to re-solve a problem the existing one solves, is precisely the unnecessary machinery this change is forbidden to add. |

### Why the throw is cheap

`mount()` already wraps its whole field loop in a `try`/`catch` that converts anything thrown into `AppError(MOUNT_COLLECT_ERROR)` with `originalError` preserved (`:317-322`). A throw from inside `tryMountElement` lands there for free.

**No new error code.** `MOUNT_COLLECT_ERROR` is already the documented code for this exact case (`README.md:1011`). A new `CARD_FIELD_CONTAINER_NOT_FOUND` would mean a new enum member, new copy, a new `messages.test.ts` entry, a new README row, and a change to what merchants catch — all to describe a case the existing code already names.

The design phase does own one loose end: `MOUNT_COLLECT_ERROR`'s message is "Mount failed. Make sure all inputs are complete and valid." (`src/shared/errors/messages.ts:54-55`), which misdirects for a missing container. The container id must reach the merchant through `originalError`. Whether the shared copy also changes is a design call, and it is not free — that copy is shared with the collect-rejection path.

### Precedent inside this SDK

`apple_pay_button.mount()` already throws `APPLE_PAY_CONTAINER_NOT_FOUND` when its selector matches nothing (`src/adapters/browser/apple-pay.adapter.ts:156-161`, tested at `apple-pay.adapter.test.ts:455-468`). Two mountable components, the same situation, opposite behavior. Card fields is the inconsistent one, and it is the one handling the PAN.

### The retry budget stays exactly as it is

`MOUNT_RETRIES = 2` and `MOUNT_RETRY_DELAY_MS = 30` are not touched. Not widened, not removed. Changing them is a guess, and the throw makes the current value's adequacy an _observable_ question for the first time. Decide it later with data.

---

## 5. Scope

### In scope

1. **Collect mount only.** `tryMountElement` throws when invoked for a `mount()` field whose container is absent after the budget.
2. **Partial-mount teardown before throwing** — see the risk in Section 7. This is the one piece of genuinely new logic, and it is necessary rather than nice.
3. **README** — `card_fields.mount()` gains an explicit statement that a missing container throws, and the `MOUNT_COLLECT_ERROR` row is made specific. The Throws table (`:1005-1011`) already lists the code; the change is making the missing-container case unambiguous.
4. **The test at `src/adapters/skyflow/skyflow.adapter.test.ts:469-476`** — `it('does NOT throw and does NOT mount when the container node is missing')` asserts the current silent behavior verbatim. It is inverted, not deleted. Its inversion is the evidence the contract changed.

### Out of scope, with reasons

**`reveal()` — deliberately excluded, not overlooked.** It calls the same `tryMountElement` (`:415`) and has the same silent shape. It is still out, because reveal's contract is _deliberately_ partial-success and has been from the start:

- CVV is skipped with a warn by design, per PCI DSS req. 3.2.1 (`:387-392`).
- A field with no token is skipped with a warn (`:397-402`).
- `container.reveal()` swallows its own errors with an explicit comment: "reveal() returns partial success/error — warn, do not throw" (`:418-423`).

Making reveal throw means reversing three deliberate decisions, in a path that displays already-tokenized data. A missing reveal box is a display defect. A missing collect box is a card number the shopper cannot enter. Different severity, different contract, different change.

The mechanical consequence is that `tryMountElement` needs two behaviors — required for collect, best-effort for reveal. A `required` flag or two call sites; design phase picks. Not a reason to widen scope.

### Non-goals

- Widening or removing `MOUNT_RETRIES` / `MOUNT_RETRY_DELAY_MS`.
- `MutationObserver`, `requestAnimationFrame`, or any new wait mechanism.
- Changing `mount()`'s return type or adding an outcome-report API.
- A new `ErrorKeyEnum` member.
- Making `reveal()` throw.
- The container-id convention and default ids.
- `unmount_context` semantics.
- Anything Apple Pay.
- Network-call retry behavior.
- Pull requests. Commits only.

---

## 6. Backward compatibility

**What changes for a merchant on npm `0.1.5`:** `await card_fields.mount()` now rejects with `AppError(MOUNT_COLLECT_ERROR)` if a configured field's container is not in the DOM within ~60 ms. Previously it resolved and logged a warning.

Who is affected:

| Merchant                                   | Before                                                           | After                                                       |
| ------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| Renders every configured field's container | No change                                                        | No change                                                   |
| Configures a field they never render       | Silent missing field, then a `PAYMENT_PROCESS_ERROR` at pay time | Named failure at `mount()`, at the line that caused it      |
| Loses the race on an SPA route change      | Silent missing field                                             | A throw they can catch and retry after their router commits |

The third row is the honest cost: a marginal race that today degrades quietly now fails loudly. That is the intent — a shopper cannot pay through a form missing its card number either way — but it will produce support contacts that today are invisible, and the release note must say so rather than let merchants discover it.

There is **no `CHANGELOG.md` in this repository**, so release communication rides on the README's Throws table plus the version bump. Given `0.1.5` and semver's 0.x convention that the minor is the breaking position, a **`0.2.0`** bump is the defensible call. Recommended, not decided here — the tasks phase owns it.

---

## 7. Risks

| Risk                                                                                                                                                                                                                                                                                                                                                                                       | Response                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Throwing orphans already-mounted secure iframes.** `mount()` sets `this.contexts` at `:324`, _after_ the `try`/`catch` — and the catch rethrows. So on any throw, fields already mounted in that call are never registered, and no handle exists to unmount them. This is a live latent bug on the existing `container.create` throw path; the change makes it reachable far more often. | The one piece of new logic this change accepts: unmount the elements mounted so far in this call before throwing. Without it, a throwing `mount()` is strictly worse than the silent failure — an orphaned iframe beats an empty box for damage. |
| **A wait mechanism that never fires is a hang.**                                                                                                                                                                                                                                                                                                                                           | Not applicable. No wait mechanism is added. Rejected in Section 4 partly for this reason.                                                                                                                                                        |
| **A merchant on a genuinely slow route flips from degraded to broken.**                                                                                                                                                                                                                                                                                                                    | Accepted and stated in Section 6. The recommended remedy in the README is to mount after the router commits the DOM — the `cancelled`-flag pattern at `README.md:552-586` is already the documented shape.                                       |
| **`MOUNT_COLLECT_ERROR`'s shared copy misdirects for this case.**                                                                                                                                                                                                                                                                                                                          | Container id carried via `originalError`. Whether to alter the shared copy is a design decision with a blast radius onto the collect-rejection path.                                                                                             |
| **The collect-time-failure chain in Section 3 is traced, not reproduced.**                                                                                                                                                                                                                                                                                                                 | Flagged for the spec phase to verify. It supports the recommendation; it does not carry it.                                                                                                                                                      |

---

## 8. Acceptance criteria

Falsifiable. Strict TDD is active, so each is a failing test first.

1. **The core criterion.** `mount({ fields: ['card_number'] })` with no `#collect-card-number` in the DOM rejects with an `AppError` whose `code` is `ErrorKeyEnum.MOUNT_COLLECT_ERROR`. Shape: the inversion of `skyflow.adapter.test.ts:469-476`, asserting `await adapter.mount({ fields: ['card_number'] }).catch(e => e)` is an `AppError` with that code — a programmatic outcome, not a `console.warn` spy.
2. **The container id is recoverable.** The thrown error's `originalError` carries the absent selector, so a merchant can tell _which_ container is missing without reading the console.
3. **Timing is unchanged.** A container inserted into the DOM after the first attempt but within the existing ~60 ms budget still mounts and still resolves. Shape: a fake timer test inserting the node between retries; `element.mount` called, promise resolves.
4. **No orphans.** When field 2 of 3 fails, field 1's `element.unmount()` has been called before the rejection surfaces, and `contexts` holds no entry for that context. Shape: two containers present, one absent; assert `__elements[0].unmount` was called and `adapter.collect()` then rejects with `MOUNT_COLLECT_ERROR` (no context registered).
5. **`reveal()` is untouched.** A reveal field with an absent container still warns, still does not throw, and `reveal()` still resolves. Shape: existing reveal tests continue to pass unmodified — a regression fence around the scope boundary.
6. **The happy path is untouched.** The full five-field mount with all five containers present (`skyflow.adapter.test.ts:376-380`) passes unmodified.

---

## 9. Open questions for design

1. `tryMountElement` gains a `required` parameter, or splits into two methods? Cheapest correct shape wins.
2. Does `MOUNT_COLLECT_ERROR`'s shared message copy change, given it is shared with the collect-rejection path?
3. Is the partial-mount teardown restricted to this change's throw path, or applied to the whole `catch` at `:317-322` — where the same orphaning bug already exists on the `container.create` path?
