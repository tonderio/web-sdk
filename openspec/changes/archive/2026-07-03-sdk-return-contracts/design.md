# Design: SDK Public Return Contracts (v2 — simplified)

## Technical Approach

Replace the camelCase `Transaction` model and the multi-arm `PayResult` union with
a SINGLE raw-passthrough transaction type. Every transaction-returning method —
reads AND `pay()` — returns the bare `RawTransaction` (the raw backend body).
There is NO wrapper, NO `outcome`, NO `PayResult`. The one field of truth is
`transaction.status` (the raw backend status string).

The only normalizations are `amount → number` and stripping `psp_response`, both
applied in the single `toRawTransaction` choke point. The SDK still classifies
status INTERNALLY for flow control only (poll until a `FINAL_STATUSES` status in
`pollUntilFinal`), but it never returns a classification. See proposal Option A
(LOCKED), simplified: outcome axis dropped.

### What changed from v1 (why this is simpler)

The v1 design had `pay()` return `{ outcome: 'paid'|'declined'|'pending', transaction }`.
The maintainer determined `outcome` is REDUNDANT with `transaction.status` and
creates a confusing two-status-field surface (consumers had to reconcile `outcome`
vs `status`). v2 REMOVES the wrapper entirely: one status field, one type shared by
`pay()`/`getTransaction()`/`pollTransaction()`. Status semantics (which `status`
values mean paid/declined/pending) move to DOCUMENTATION — no helper ships in this
change.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Return shape | `pay()` and reads all return bare `RawTransaction` | `{ outcome, transaction }` wrapper (v1) | `outcome` duplicated `transaction.status`; two status fields confused consumers. One field of truth. |
| Classification surface | Internal only (flow control in `pollUntilFinal`); never returned | Public `Outcome` enum / `PayResult` | Consumers read `transaction.status` directly; SDK does not editorialize the backend truth. |
| Raw type openness | Open type: required known fields + `[k: string]: unknown` index signature | Closed exact interface | Backend may add fields; passthrough must not drop unknowns. Known fields stay typed for DX. |
| Read return shape | `getTransaction`/`pollTransaction` return bare `RawTransaction` | (unchanged from v1) | Reads never had an outcome; now `pay()` matches them exactly. |
| Amount coercion site | In `toRawTransaction`, `Number(raw.amount)` | Coerce per-call-site | Single choke point; `/transactions` sends string, `/process` sends number. |
| Redirect-mode `pay()` | Returns raw `/process` transaction (`status:"Pending"`, carries `next_action`) before unload | Return a settled status | Page navigates away; final status unknown pre-unload. Merchant reconciles via `getTransaction` on `returnUrl`. |
| Status normalization | Documented in README (status→meaning table); NO helper | Ship a `classify()`/`isPaid()` helper | Out of scope for this change; keeps public surface minimal. |

## Interfaces / Contracts

```ts
// Open, forward-compatible raw backend body (snake_case), psp_response stripped,
// amount coerced to number. Known fields typed; unknowns preserved.
// This is the ONLY public transaction type. It is returned by pay(),
// getTransaction() and pollTransaction() alike.
export interface RawTransaction {
  id: string;
  operation_type: string;
  status: string;            // backend truth & single status field: "Success" | "Declined" | "Pending" | ...
  amount: number;            // coerced from string on /transactions
  currency: string;
  next_action?: BackendNextAction; // 3DS redirect / APM presentation payload
  decline_code?: string;
  decline_reason?: string;
  clabe?: string;            // SPEI
  bank_name?: string;        // SPEI / APM
  [key: string]: unknown;    // forward-compat passthrough
}

// REMOVED from the public surface:
//   export type Outcome = ...        // deleted
//   export interface PayResult = ... // deleted
//   export interface Transaction = ...// deleted (camelCase model)
```

### 5 Direct-API method return types

| Method | Returns (v2) | Was (v1) |
|---|---|---|
| `pay` | `Promise<RawTransaction>` (bare) | `Promise<PayResult>` |
| `getTransaction` | `Promise<RawTransaction>` | `Promise<RawTransaction>` (unchanged) |
| `pollTransaction` | `Promise<RawTransaction>` | `Promise<RawTransaction>` (unchanged) |
| `getPaymentMethods` | `Promise<PaymentMethodInfo[]>` (unchanged — not a transaction) | unchanged |
| `getApmBanks` | `Promise<{ cash: ApmBank[]; transfer: ApmBank[] }>` (unchanged) | unchanged |

COF/vault group (`enrollCard`→`EnrollResult`, `getCustomerCards`→`Card[]`,
`removeCustomerCard`→`void`): vault-fed, NOT Direct API. Keep camelCase.
Document the policy boundary only; no behavior change.

## Mapper Deltas (`src/models/transaction.model.ts`)

| Symbol | Action (v2) |
|---|---|
| `Transaction` (camelCase interface) | Delete |
| `mapToTransaction` | Replace with `toRawTransaction(raw)`: shallow copy, `delete psp_response`, `amount = Number(raw.amount)`, else verbatim. Returns `RawTransaction`. |
| `mapPendingResult` | Delete (APM data rides inside the raw transaction — `next_action`/`clabe`/`bank_name` are already there) |
| `mapPayResult` | Delete. `pay()` now returns `toRawTransaction(raw)` directly; branching keys off the RAW body, not a wrapper. |
| `payResultFromTransaction` | Delete. The embedded-3DS poll path returns the FINAL `RawTransaction` directly. |
| `PayResult` / `Outcome` | Delete both types. |
| `FINAL_STATUSES` / `DECLINED_FINAL_STATUSES` / `pollUntilFinal` | KEEP — internal flow control only. `pollUntilFinal` reads `status` (a `RawTransaction` satisfies `HasStatus`). No classification is returned. |

Net: the mapper collapses to ONE public function, `toRawTransaction`, plus the
internal `FINAL_STATUSES`/`pollUntilFinal` poll utilities.

### amount coercion detail (unchanged)

Coerce string→number once in `toRawTransaction` via `Number()`. `/process` already
sends a JSON number (idempotent through `Number`); `/transactions/{id}` sends a
string. Precision note: `number` is IEEE-754 double — maintainer-accepted tradeoff
(amounts bounded in practice); document in the type's JSDoc.

## pay() flow → returned value

All arms return a `RawTransaction`. Branching is driven by the RAW body
(`raw.status` / `raw.next_action`) and the captured `inputType`, NOT by a wrapper
field.

- **Frictionless card**: process → `toRawTransaction(raw)`. Returns the raw
  transaction with a final `status` (Success/Declined). No `next_action`.
- **Embedded 3DS** (`threeDsMode: 'embedded'`, `raw.next_action` present): mount
  iframe + poll to FINAL → return the FINAL `RawTransaction` (status Success/Declined).
  BOTH the messenger single-read path and the fallback poll path must return a
  transaction; a still-`Pending` read is NOT final — it keeps polling and is never
  returned as the final result. (Preserves the earlier prior-finding fix: a single
  messenger read catching a still-`Pending` tx must not settle; only a
  `FINAL_STATUSES` status settles.)
- **Redirect 3DS** (`threeDsMode: 'redirect'`, `raw.next_action` present): SDK
  navigates the browser away; BEFORE unload it returns the raw `/process`
  transaction as-is (`status:"Pending"`, carries `next_action`). Merchant reconciles
  on `returnUrl` via `getTransaction`.
- **APM / SPEI** (`inputType === 'apm' | 'spei'`): SDK handles payflow presentation;
  returns the raw transaction (`status:"Pending"`, carrying `next_action` / `clabe` /
  `bank_name` exactly as the backend sent them). Never polls.

## Data Flow

    pay() ─► processPayment ─► raw body ─► toRawTransaction ─► RawTransaction
              │ card frictionless: return raw (final status) ───────────────┐
              │ card + next_action, redirect: navigate; return raw(Pending) ┤
              │ card + next_action, embedded: poll→FINAL; return finalRaw ───┤
              │ apm/spei: present payflow; return raw(Pending) ──────────────┤
              └──────────────────────────────────────► RawTransaction ◄──────┘
    getTransaction / pollTransaction ─► toRawTransaction ─► RawTransaction

## Internal call-sites to change (`src/tonder.ts`)

| Site | Change |
|---|---|
| `pay(): Promise<PayResult>` | → `Promise<RawTransaction>`. Drop `mapPendingResult` / `mapPayResult` imports & calls. |
| `pay()` apm/spei branch (`mapPendingResult(raw)` → `handleApmResult(pending)`) | Call `handleApmResult(toRawTransaction(raw))`. |
| `pay()` card branch (`const result = mapPayResult(raw); if (result.status === 'requires_action')`) | Compute `const tx = toRawTransaction(raw);` then branch on the RAW body: if `raw.next_action` (was `requires_action`) → `handleRequiresAction(tx, raw)`; else `return tx`. |
| `handleRequiresAction(result: PayResult)` | Signature → `handleRequiresAction(tx: RawTransaction)`. Redirect path: navigate, then `return tx` (Pending). Embedded path: poll to FINAL, `return finalTx` (drop `payResultFromTransaction`). Transaction id comes from `tx.id` (was `result.transactionId`). |
| `handleApmResult(pending)` | Signature → `handleApmResult(tx: RawTransaction)`; `return tx` (Pending). Drop wrapper construction. |
| `getTransaction(): Promise<Transaction>` | → `Promise<RawTransaction>`. |
| `pollTransaction()` | Already returns `RawTransaction` semantics — retype from `Transaction` to `RawTransaction`. |
| `getTransactionMapped()` | `return toRawTransaction(raw)` (was `mapToTransaction`). |
| Imports (lines ~27–30) | Remove `mapPayResult`, `mapPendingResult`, `payResultFromTransaction`; keep `toRawTransaction`, `FINAL_STATUSES`/`pollUntilFinal`. |

## File Changes

| File | Action | Description |
|---|---|---|
| `src/models/transaction.model.ts` | Modify | Delete `Transaction`, `mapToTransaction`, `mapPendingResult`, `mapPayResult`, `payResultFromTransaction`, `PayResult`, `Outcome`. Add `RawTransaction` + `toRawTransaction`. Keep `FINAL_STATUSES`/`DECLINED_FINAL_STATUSES`/`pollUntilFinal` as internal utilities. |
| `src/tonder.ts` | Modify | Retype `pay`/`getTransaction`/`pollTransaction`/`getTransactionMapped`/`handleRequiresAction`/`handleApmResult` per call-site table; branch on raw body. |
| `src/shared/types/index.ts`, `src/index.ts` | Modify | Export `RawTransaction`. Remove `Transaction`, `PayResult`, `Outcome` exports. |
| `README` (follow-up doc) | Modify | Add status→meaning table; document `pay()` now returns the bare transaction. |

## Testing Strategy (Strict TDD, vitest) — now simpler

| Layer | What | RED test |
|---|---|---|
| Unit | `toRawTransaction` | amount string→number; number passthrough; `psp_response` stripped; unknown field preserved |
| Integration | `pay` frictionless card | returns bare `RawTransaction` with final `status`; no wrapper key |
| Integration | `pay` embedded 3DS | returns FINAL `RawTransaction`; still-`Pending` single read does NOT settle (keeps polling) |
| Integration | `pay` redirect 3DS | returns raw `/process` tx (`status:"Pending"`, `next_action` present) before navigate |
| Integration | `pay` apm/spei | returns raw tx (`status:"Pending"`, carries `next_action`/`clabe`/`bank_name`) |
| Integration | `getTransaction`/`pollTransaction` | returns bare `RawTransaction` (snake_case) |

### Test assertions that must change (simpler than v1)

- `src/models/transaction.model.test.ts`: DELETE all `mapPayResult` /
  `payResultFromTransaction` / `mapPendingResult` classification tests
  (paid/declined/pending outcome assertions). Keep/retarget only `toRawTransaction`
  shaping tests (amount coercion, `psp_response` strip, unknown preserved). Largest
  reduction — the whole outcome-classification suite goes away from the PUBLIC
  contract (internal `pollUntilFinal`/`FINAL_STATUSES` tests may remain as flow-control
  unit tests).
- `src/tonder.pay.test.ts`: replace `expect(result).toEqual({ outcome, transaction })`
  assertions with `expect(result).toEqual(rawTransaction)` (bare). No `outcome` field.
- `src/tonder.handleRequiresAction.test.ts`: assert the returned value is the bare
  FINAL `RawTransaction` (embedded) / bare Pending raw tx (redirect). Remove any
  `outcome`/`PayResult` shape assertions; still assert the still-`Pending` read does
  not settle.
- `src/tonder.getTransaction.test.ts`: assert bare `RawTransaction` (no `outcome`).

Net: fewer assertions than v1 (~55 → materially fewer) because the entire
outcome-classification axis is removed from the public contract.

## Migration / Rollout

No migration (unreleased, feature branch). README follow-up: document that `pay()`
returns the bare transaction (same type as `getTransaction`/`pollTransaction`), and
add the status→meaning table (which `status` values mean paid / declined / pending).

## Open Questions

- None blocking. Redirect/APM `pay()` returning a `Pending` raw transaction is
  confirmed by design.
