# Proposal: SDK Public Return Contracts

## Intent

Redefine the SDK's public return contract before first release, while breaking
changes cost nothing. Today `pay()` leaks internal plumbing (`nextAction`,
`transactionId`, wrapper-specific fields) and remaps the backend body into a
divergent camelCase `Transaction`. A merchant using both the raw Direct API and
the SDK sees two different shapes for the same transaction. The redesign makes
`transaction` a RAW passthrough of the backend body and exposes the operation
outcome as a separate signal.

## Scope

### In Scope

- **`transaction` = raw backend body** (snake_case, as-is) for all
  Direct-API-fed methods: `pay`, `getTransaction`, `pollTransaction`,
  `getPaymentMethods`, `getApmBanks`. No remap, no camelCase, no flatten.
- **Drop `Transaction` camelCase model** and `mapToTransaction` for the Direct
  API group.
- **Remove `mapPendingResult`** and all wrapper-specific fields: `nextAction`,
  `transactionId`, `declineCode`, `declineReason`, `paymentInstructions`,
  `voucher`, `clabe`, `bankName`, and the `requires_action`/`pending`/`declined`
  wrapper shapes. These now live INSIDE the raw `transaction` when (and only
  when) the backend includes them (`next_action`, `clabe`, `bank_name`,
  `decline_code`, `decline_reason`).
- **`amount` coerced to `number`** everywhere (the ONLY normalization). Live
  evidence: `/process` returns `amount` as a JSON number; `/transactions/{id}`
  returns a string, coerced to number for consistency.
- **Strip `psp_response`** from the returned transaction if present (the one
  field removed).
- **Operation-outcome axis** exposed as a separate, clearly-named signal (final
  shape deferred to design — see Open Decision).
- **COF group stays camelCase** (`enrollCard`→`EnrollResult`,
  `getCustomerCards`→`Card[]`, `removeCustomerCard`→`void`) — confirmed
  vault-fed, not Direct API.

### Out of Scope

- 3DS presentation mechanics (redirect/embedded) — unchanged; the SDK drives
  presentation in both modes.
- COF endpoint behavior — only the return-shape policy is confirmed.
- Backend changes — none.
- README/public-API docs rewrite — a follow-up task.

## Capabilities

### New Capabilities

- `sdk-return-contracts`: the public return shape of every SDK method —
  raw-transaction passthrough, amount coercion, `psp_response` stripping, and the
  operation-outcome signal.

### Modified Capabilities

- None (single new capability owns the full public contract).

## Approach

Replace `PayResult` and the camelCase `Transaction` with a raw-transaction-based
shape: `{ <outcome-signal>, transaction: RawTransaction }`, where
`RawTransaction` is the backend body verbatim minus `psp_response`, with `amount`
coerced to `number`. Reads (`getTransaction`, `pollTransaction`) return the raw
transaction directly. Because it is passthrough, APM/SPEI settlement data
(`next_action` with the payflow URL, `clabe`, `bank_name`) naturally rides inside
`transaction` — no extraction code. Anchored in Adyen (`resultCode`+`action`) and
MercadoPago (`status`+`status_detail`) splits from the exploration.

## Open Design Decision (deferred to sdd-design)

**The operation-outcome axis.** `transaction.status` stays the single source of
backend truth ("Success"/"Pending"). The OPERATION outcome must be a separate,
clearly-named signal. The SDK drives 3DS presentation in BOTH modes, so
`requires_action` never surfaces to the caller (embedded resolves via polling;
redirect navigates away). Caller-facing outcomes are effectively
**paid / declined / pending** (async APM). Options to finalize in design:

- **A.** `{ outcome: 'paid' | 'declined' | 'pending', transaction }`
- **B.** `{ requiresAction: boolean, transaction }` (+ derive from status)

Recommendation leans toward A (explicit outcome enum, matches Adyen/MercadoPago).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/models/transaction.model.ts` | Modified | Drop camelCase `Transaction`, `mapToTransaction`, `mapPendingResult`; redefine `PayResult`; add raw type + amount coercion + `psp_response` strip |
| `src/tonder.ts` | Modified | Return shapes of `pay`, `getTransaction`, `pollTransaction`, `getPaymentMethods`, `getApmBanks` |
| `src/shared/types/index.ts`, `src/index.ts` | Modified | Public type exports |
| COF methods | Confirmed only | camelCase policy verified, no behavior change |
| `*.test.ts` (~55 assertions) | Rewrite | `transaction.model.test.ts`, `tonder.pay.test.ts`, `tonder.handleRequiresAction.test.ts`, `tonder.getTransaction.test.ts` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Amount as `number` loses float precision for money | Med | Maintainer-accepted; amounts bounded in practice; document tradeoff |
| Exploration (static serializer) said amount is string-on-both | Resolved | Live capture shows `/process` returns a number — live evidence wins |
| Merchants lose promoted `clabe`/`voucher` fields | Low | They remain inside raw `transaction` (`next_action`, `clabe`, `bank_name`) when backend sends them |
| ~55 test assertions break | High | Expected; full rewrite under strict TDD (vitest) at apply time |

## Rollback Plan

Pure type/mapper redesign in an unreleased SDK on a feature branch. Revert the
commit(s); no released consumers, no data migration, no backend coupling.

## Dependencies

- Live-response confirmation that `/process` returns `amount` as a number
  (captured by maintainer: `"amount": 200`, `"amount": 150`).

## Success Criteria

- [ ] `pay`, `getTransaction`, `pollTransaction`, `getPaymentMethods`,
      `getApmBanks` return the raw backend body as-is (snake_case, no remap).
- [ ] Raw and SDK-fed shapes are byte-identical except `amount` (number) and
      omitted `psp_response`.
- [ ] `amount` is a `number` in every returned transaction.
- [ ] `psp_response` is stripped when present.
- [ ] `nextAction`, `transactionId`, `declineCode`, `declineReason`,
      `paymentInstructions`, `voucher`, `clabe`, `bankName` no longer exist as
      SDK-owned wrapper fields; `mapPendingResult` is removed.
- [ ] Operation outcome is a separate, clearly-named signal (not `status`).
- [ ] COF methods (`enrollCard`, `getCustomerCards`, `removeCustomerCard`) keep
      camelCase, unchanged behavior.
