# Exploration: public-api-consistency

Pre-release public API audit, `@tonder.io/web-sdk` v3, UNRELEASED.

Scalability lens: last chance before merchants integrate. Yardstick = the future "full" version (SDK renders entire checkout UI: card form, card list, saved-cards, APM selector, checkout) — see PRD §4/§13 and 04-proposal.md §2 Layer 2 widgets.

## A. Docs findings (patterns + roadmap + already-decided API shapes current code violates)

**Design patterns committed:**
- Backbone **Facade + Strategy**; supporting **Factory Method (`createTonder`), Adapter, Observer, Composite, Mediator**; ServiceManager = Service Locator. Sources: docs/README.md TL;DR + Decision status; PRD.md §7; 04-proposal.md §2.
- **Pragmatic Ports & Adapters (hexagonal-lite), NOT full Clean** — 04-proposal.md §5. `core/` is PURE (no DOM/HTTP/external-SDK). 4 ports only.
- **One unified SDK, NO lite/full** — PRD §1/§8; 04-proposal.md §1. Mounting a widget NEVER disables headless methods (LEGO). THE architectural yardstick.

**Future roadmap (the "full" version = yardstick for API decisions today):**
- 04-proposal.md §2 diagram LITERALLY sketches `tonder.mount('saved-cards'|'card-form'|'apm-selector'|'checkout', '#div')` — a SINGLE generic mount keyed by a type string. PRD §13 lists SavedCardsWidget/CardFormWidget/ApmSelectorWidget/CheckoutWidget as additive on the same core, "no breaking change, no mode".
- Today's code ships `mountCardFields(request)` (a specific verb) — a docs-vs-code divergence on concern #4.

**API-shape decisions ALREADY documented that current code violates:**
1. "**Single `customer` object** … no flat `name`/`email_client`/`phone_number` duplication" — PRD §7 + §6 E3-S1 AC4 + 04-proposal.md §3. → VIOLATED: two customer shapes exist.
2. Docs referred to `threeDsMode`/`threeDsContainerId` (07-implementation-status.md) but code evolved to `presentationMode` + SDK-owned modal (presentation-modal-events change, 2026-07-04). Docs stale vs code — doc-drift note.
3. Naming policy (locked): public surface camelCase, no `I` prefix, kebab container ids, backend snake_case internal-only. Direct-API responses raw snake_case passthrough (`RawTransaction`), COF group camelCase.

## B. Public surface inventory (method → request → response → inconsistencies)

Exports: `src/index.ts`. Facade methods: `src/tonder.ts`. Types: `src/shared/types/index.ts`, `src/types/card.ts`.

| Method | Request type | Response type | Inconsistencies |
|---|---|---|---|
| `createTonder(config)` | `TonderConfig` | `Tonder` | config mixes concerns: flat `onOpen/onClose/onComplete` (index.ts:63-70), `customer?` (41), `errorMessages?` (76), `presentationMode?` (57). No `events` namespace. |
| `init()` | — | `Promise<void>` | ok |
| `mountCardFields(request)` | `MountCardFieldsRequest` (card.ts:91) | `Promise<void>` | suffix `Request` (only method using it). `events` per-field lives HERE (card.ts:105). Verb-specific vs future generic mount. |
| `unmountCardFields(context?)` | `string?` | `void` | context loosely-typed `string` |
| `revealCardFields(request)` | `RevealCardFieldsRequest` (card.ts:140) | `Promise<void>` | `Request` suffix |
| `pay(input)` | `PayInput` (index.ts:179) | `RawTransaction` | `Input` suffix; **`customer` REQUIRED inline `{name,email,phone?}` (185-189)** — duplicate shape + contradicts config-only decision |
| `getTransaction(id)` | `string` | `RawTransaction` | ok (raw passthrough by design) |
| `pollTransaction(id, options?)` | `string`, `PollOptions` | `RawTransaction` | ok |
| `getPaymentMethods()` | — | `PaymentMethodInfo[]` (index.ts:92) | suffix `Info` (unique). camelCase COF-style projection ✓ |
| `getApmBanks()` | — | `{cash:ApmBank[]; transfer:ApmBank[]}` | inline anonymous return shape (no named type) |
| `enrollCard()` | — (reads config.customer) | `EnrollResult` (index.ts:155) | suffix `Result` (unique). No args — customer transparent ✓ |
| `getCustomerCards()` | — | `Card[]` | ok |
| `removeCustomerCard(cardId)` | `string` | `Promise<void>` | ok |

**Suffix inconsistency:** `PayInput` / `MountCardFieldsRequest`+`RevealCardFieldsRequest` / `EnrollResult` / `PaymentMethodInfo` — FOUR conventions (Input, Request, Result, Info). No single policy.

**Dead exports:** `PublicError`/`PublicSuccess<T>` (index.ts:161-173) exported but NOT used by any method signature — methods return bare types / throw `AppError`.

**Backend contract match:** `/process` customer payload is ONLY `{name,email}` (direct-api.service.ts:86; buildProcessBody tonder.ts:850) — **`phone` in PayInput.customer is accepted but DROPPED, never sent.**

## C. Customer shape inventory

1. `TonderConfig.customer?: CustomerInput` — index.ts:41. `CustomerInput = {email(req), firstName?, lastName?, phone?}` (index.ts:142-148).
2. `PayInput.customer: {name, email, phone?}` REQUIRED inline — index.ts:185-189. **Different shape: `name` vs `firstName`/`lastName`; required vs optional.**
3. `/process` payload `customer:{name,email}` — direct-api.service.ts:86; built at tonder.ts:850 (drops phone).
4. `/customer/` payload `{email, first_name?, last_name?, phone?}` — customer.service.ts:7-12 (maps from `CustomerInput`).
5. `enrollCard` subscription contact `{firstName,lastName,email}` from `config.customer` — tonder.ts:672-676.

COF/enroll ALREADY resolve customer transparently from `config.customer` (never per-call). Only `pay()` still takes an inline, differently-shaped, required customer.

## D. Backend evidence (zplit-back direct_serializers.py)

- CustomerSerializer accepts only `{name, email}` (direct_serializers.py:7).
- Customer is REQUIRED for ALL payment operations — direct_serializers.py:213-217 raises "Customer information is required". There is NO guest pay.

## E. Breaking-change surface + test impact

- Concern #1 (unify Customer): PayInput, buildProcessBody, customer.service map — tonder.pay.test.ts, tonder.customer.test.ts.
- Concern #2 (remove PayInput.customer): BREAKING PayInput; `assertValidPayInput` (tonder.ts:863-876), buildProcessBody; tonder.pay.test.ts (10+ occ), README §pay, demos.
- Concern #3 (events namespace): TonderConfig, MountCardFieldsRequest.events; handleRequiresAction/handleApmResult wiring; skyflow adapter; multiple tests; README.
- Concern #4 (`create`/`mount` shape): index.ts export, tonder.ts rename/add, mountCardFields.* tests, skyflow adapter, e2e fixtures, README, demos. Largest blast radius.
- All BREAKING accepted: package UNRELEASED (v0.x, no external consumers).
- Est. test impact: HIGH (strict TDD, 243 tests).

## Open questions (all RESOLVED by maintainer locked decisions)

1. One-shot pay with no customer? → NO. Backend requires customer; `config.customer` required to pay.
2. Unify on firstName/lastName + derive name? → YES, one `Customer` interface; adapter derives `name`.
3. Events: presentation-only namespace + inputs per-component? → inputs move INTO the component (per-component scope).
4. Commit to `create(type).mount()`? → YES.
5. Sequencing? → umbrella proposal, sliced tasks.
6. Drop PublicSuccess/PublicError + name getApmBanks return? → DROP dead exports; add named `ApmBanks`.
