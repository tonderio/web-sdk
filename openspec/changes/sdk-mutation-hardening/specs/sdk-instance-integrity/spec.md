# SDK Instance Integrity Specification

## Purpose

Defines two guarantees a constructed `Tonder` instance must uphold: its
internal state is not reachable from merchant code, and post-construction
mutation of the merchant's own config object does not change SDK behavior —
except `config.events`, which is documented as live. `session` is already
published (`TonderSession` JSDoc) as "fixed for the SDK instance lifetime";
this spec makes that enforced, not aspirational.

Honest scope: these guarantees stop accidental and casual mutation through
the merchant's own config reference. They are not a security boundary
against same-realm code that already has another path to instance
internals (its own closures, a monkey-patched prototype, etc.) — that class
of access is out of scope.

## Requirements

### Requirement: Instance internal state is not reachable from merchant code

A constructed `Tonder` instance MUST NOT expose any internal field as an own
enumerable property, for every field the instance holds now or gains in the
future — this is a property of the class, not an enumeration of its current
members. `Object.keys()`, `for...in`, object spread, and `JSON.stringify()`
on the instance MUST each observe no internal field. Internal collaborators
(transport clients, services, the core state object, event-dispatch
wrappers) MUST NOT be reachable through the instance by name.

#### Scenario: Instance surface is empty [FAILS TODAY]

- GIVEN a `Tonder` instance created via `createTonder()`
- WHEN a merchant runs `Object.keys(tonder)`
- THEN the result is empty, and `JSON.stringify(tonder)` is `'{}'`

#### Scenario: Internal collaborators are unreachable [FAILS TODAY]

- GIVEN a constructed `Tonder` instance
- WHEN a merchant accesses `tonder.core`, `tonder.http`, or `tonder.paymentEvents`
- THEN each access yields `undefined`

#### Scenario: A newly added internal field stays unreachable

- GIVEN a future change adds a new internal field to `Tonder`
- WHEN the same enumeration checks run
- THEN the new field is absent from `Object.keys()` and inaccessible by
  name, with no new allow-list entry required to keep this true

### Requirement: Config is read from a construction-time snapshot, not the merchant's live object

At construction, the SDK MUST copy the merchant-supplied config into an
internal snapshot and MUST read every guarded value from that snapshot for
the instance's lifetime, except `events` (see the dedicated requirement
below). Mutating the merchant's config object, or anything reachable from
it, after `createTonder()` returns MUST NOT change any later SDK-issued
request or computed value. This holds for `session.customer` and
`session.secure_token` specifically. Mutation MUST NOT throw — the snapshot
makes late writes inert, not rejected.

#### Scenario: Mutating secure_token after construction has no effect [FAILS TODAY]

- GIVEN `createTonder()` with `session.secure_token = 'T1'`
- WHEN the merchant sets `cfg.session.secure_token = 'T2'`, then calls
  `getCustomerCards()` twice
- THEN both requests carry `T1`, never `T2`

#### Scenario: Mutating customer after a successful pay() has no effect [FAILS TODAY]

- GIVEN a successful `pay()` for customer A
- WHEN the merchant mutates `cfg.session.customer` to customer B
- THEN the next `/process` request still carries A's customer block

#### Scenario: Mutation never throws

- GIVEN either mutation above
- WHEN it is performed
- THEN no exception is raised, at the mutation or at the next SDK call

### Requirement: Mutating config before the first SDK call is inert

The snapshot MUST be taken at construction, before any SDK call — not
lazily on first use. A merchant who mutates `session.customer` or
`session.secure_token` between `createTonder()` and their first SDK call
MUST still have every subsequent request use the value present at
construction, never the mutated value. This is the hardest case: today
`session.customer` is read live until the SDK's first internal
registration of it, so a naive "memoize on first read" implementation
still leaks the pre-first-call mutation.

#### Scenario: Pre-first-call mutation of customer does not leak into the first request [FAILS TODAY]

- GIVEN `createTonder()` with `session.customer` = customer A, no SDK call
  made yet
- WHEN the merchant mutates `cfg.session.customer` to customer B, then
  calls `getCustomerCards()`
- THEN the customer-registration and cards requests carry A's data
- AND the merchant never receives B's data as a result

### Requirement: config.events stays live in both its present-and-replaced and absent-and-added forms

`events` MUST be excluded from the snapshot. The SDK MUST read `events`
from the merchant's original config object at the moment each event fires
— never from the snapshot, never captured at construction or mount time.
This MUST hold whether `events` existed at construction and is later
replaced, or did not exist at construction and is assigned afterwards. This
is the documented public contract, not an exception to the snapshot rule.
Its failure mode is silent: a payment succeeds but the merchant's handler
never fires, indistinguishable from a vanished result.

#### Scenario: events present at construction, later replaced — regression guard [PASSES TODAY, MUST KEEP PASSING]

- GIVEN `createTonder()` with `events.payment.on_success = h1`
- WHEN the merchant sets `cfg.events.payment.on_success = h2` before a
  payment resolves
- THEN `h2` fires and `h1` does not

#### Scenario: events absent at construction, added afterwards — regression guard [PASSES TODAY, MUST KEEP PASSING]

- GIVEN `createTonder()` with no `events` key at all
- WHEN the merchant assigns `cfg.events = { payment: { on_success: h1 } }`
  before a payment resolves
- THEN `h1` fires

### Requirement: The config clone recurses only plain objects and arrays

The snapshot clone MUST recurse into plain objects and arrays only.
Functions, class instances, getters, `Date`, `Map`, and DOM nodes MUST be
copied by reference, never cloned or dropped. `structuredClone` MUST NOT be
used for the snapshot: it throws on functions and does not preserve
prototypes, both of which the config's closed shape can legitimately
contain (an event handler function, a `Date`, a caller-supplied instance).

#### Scenario: A function value in config survives the clone unchanged

- GIVEN a config field holds a function
- WHEN the snapshot is produced
- THEN the same function reference is present in the snapshot, not a clone
  and not an error

#### Scenario: A plain nested object is deep-copied, not aliased

- GIVEN `session.customer` is a plain object
- WHEN the snapshot is produced and the merchant later mutates the
  original object's fields
- THEN the snapshot's copy is unaffected — the two are distinct objects

### Requirement: The constructor-injection seam is unaffected

`_createTonderWithDeps` MUST continue to accept the same constructor
parameters it accepts today, and MUST NOT require any caller or test to
read a field back off the returned instance.

A test MUST NOT need new setup, new mocking, or a new seam to reach the
same behavioral guarantee. Changes to test assertions ARE permitted when
they adapt to intentional behavior changes introduced by this spec —
specifically when a test previously held a reference identity that is now
deliberately a snapshot copy (assertion updates to compare content instead
of identity), or when a test removed an explicit reach-in to an instance
field that runtime encapsulation now prevents (direct reach-in removal
rather than scaffolding to recover access). The distinction that matters:
adding new scaffolding to work around a broken seam means the seam broke;
removing or updating an assertion to align with intended new behavior means
the seam held.

#### Scenario: Reaching existing behavior needs no new scaffolding

- GIVEN a test that exercises the SDK through `_createTonderWithDeps` and
  the public facade
- WHEN instance fields become unreachable and config becomes snapshotted
- THEN that test reaches the same behavioral guarantees through the same
  seam, with no new mock, stub, or accessor introduced to restore access
  (removal of reach-ins or updates to assertions are not scaffolding)

#### Scenario: An assertion on a now-copied value is updated, not worked around

- GIVEN a test asserting reference identity on a config value that is
  deliberately snapshotted by this change
- WHEN the value becomes a snapshot copy
- THEN the test's assertion is updated to compare content instead of
  identity, reflecting the new intended behavior
- AND no additional scaffolding is added to provide the original reference
  to the test

### Requirement: A single non-throwing warning signals config drift, without changing behavior

When a guarded snapshot value diverges from the current value on the
merchant's original config object, the SDK MUST emit exactly one
`console.warn` per instance naming the diverged field, regardless of how
many times the divergence is subsequently observed. The warning MUST be
wrapped so a throwing or misbehaving `console.warn` cannot interrupt or
fail the call in progress. The warning MUST NOT alter any request,
response, or return value.

#### Scenario: Divergence warns once, not per call

- GIVEN a config field diverges from its snapshot
- WHEN two subsequent SDK calls each observe the same divergence
- THEN exactly one `console.warn` is emitted across both calls

#### Scenario: A throwing console.warn does not fail the call

- GIVEN `console.warn` is stubbed to throw
- WHEN a divergence is detected during a payment call
- THEN the payment call completes normally, unaffected by the stub
