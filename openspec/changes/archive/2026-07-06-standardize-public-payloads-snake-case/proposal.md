# Proposal: Standardize public payload fields to snake_case

## Intent

Eliminate mixed `camelCase`/`snake_case` payload fields in the Web SDK public
contract. Merchants may use Direct API and SDK together; SDK object fields should
match Direct API naming to reduce integration confusion.

## Scope

### In Scope
- Change public object fields to `snake_case` across config, session, customer,
  `pay()` input, card/payment method payloads, enrollment, and public errors.
- Keep `RawTransaction` unchanged because it already passes through Direct API
  `snake_case` fields.
- Preserve embedded payflow bridge protocol fields: `postMessage({ event })`
  stays `event`, and SDK continues reading `next_action.redirect_to_url.url`.
- Keep JavaScript method/class names camelCase (`createTonder`,
  `getTransaction`, `getPaymentMethods`, etc.).
- Update tests, README/docs examples, e2e typings, and OpenSpec specs.

### Out of Scope
- Renaming public methods to snake_case.
- Changing backend request/response semantics.
- Changing `RawTransaction` field names or raw passthrough behavior.
- Adding backward-compatible aliases for old camelCase fields in this initial SDK.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `public-api`: public object payload field naming changes to `snake_case`.
- `sdk-return-contracts`: explicitly preserves `RawTransaction` passthrough while
  aligning non-transaction SDK payloads.
- `payment-method-discovery`: public payment method/bank fields use `snake_case`.
- `cof-payment-flow`: saved-card/customer/enrollment fields use `snake_case`.

## Approach

Define a strict boundary: method names stay idiomatic JS; every public object
field accepted or returned by the SDK uses `snake_case`. Internally, the SDK may
keep implementation helpers as needed, but public exported types, runtime
validation messages, examples, and e2e contract must expose only `snake_case`
payload fields. `RawTransaction` remains unchanged.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/types/` | Modified | Public config/request/response types |
| `src/models/` | Modified | Card/enrollment public models except raw transaction |
| `src/tonder.ts` | Modified | Facade input validation and mapping |
| `src/shared/errors/` | Modified | Public error object field names |
| `README.md`, `docs/`, `e2e/` | Modified | Examples and contract typing |
| `openspec/specs/` | Modified | Capability requirements |
| `/Volumes/MacDev/Tonder/hosted-checkout/spa-midd-checkout/src/app/process` | Read-only | Embedded payflow compatibility review |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Large public breaking change | High | SDK is new; update all docs/demos before release |
| Missing stale camelCase field | Medium | Add targeted type/runtime tests and grep checks |
| Confusing method vs field naming | Low | Document rule clearly: methods camelCase, fields snake_case |
| Breaking embedded payflow bridge | Low | Do not rename `postMessage({ event })` or `RawTransaction.next_action` |

## Rollback Plan

Revert the change folder and implementation commits before release. Because this
SDK is not finalized, no runtime migration is required unless demos already
consume the changed fields.

## Success Criteria

- [ ] Public exported object types expose `snake_case` fields only.
- [ ] `RawTransaction` remains unchanged.
- [ ] Embedded payflow completion still listens for `postMessage({ event })`.
- [ ] Tests/typecheck pass.
- [ ] README/docs/e2e examples use the new `snake_case` payload contract.
