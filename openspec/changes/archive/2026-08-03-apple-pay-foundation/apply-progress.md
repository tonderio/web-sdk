**What**: `apple-pay-foundation` (Apple Pay phase 1) is fully implemented. All 23 tasks done across two work units. Branch `feature/applepay-foundation`, based on `main`, NOT pushed.

**Commits**

- `c29fb86` docs(openspec): SDD artifacts
- `277c8b3` feat: declare Apple Pay foundation types and error codes (unit 1 — inert declarations)
- `30a2b0d` refactor: narrow create() return type per component (unit 2 — component types)

**Verified independently by the orchestrator, not just reported by the apply agent**

- `npm run test` → 32 files, 317 tests, all passing
- `npm run typecheck` → exit 0 (both passes, including `e2e/tsconfig.json` covering the real `create('card_fields')` call site at `e2e/support/fixtures.ts:123-135`)
- `npm run build` → all bundles + `dist/index.d.ts` emitted
- D3 absence checks: no `ApplePayConfig` in `src/`; `TonderEvents` has no `payment` key (the single grep hit is a doc comment explaining why it is deliberately unwired); `TonderCustomization` has no `apple_pay_button` key; `TonderComponentType` is still exactly `'card_fields'`
- `rg -c ApplePay dist/index.d.ts` → 0. `@types/applepayjs` does not leak into any build output
- `src/index.ts` gained exactly one export: `TonderMountableComponent`

**Where**: new — `src/types/component.ts`, `src/types/apple-pay.ts`, `src/types/apple-pay.test.ts`, `src/models/business.model.test.ts`. Modified — `business.model.ts`, `direct-api.service.ts` (+test), `ErrorKeyEnum.ts`, `shared/types/index.ts`, `types/customization.ts`, `types/card.ts` (+test), `tonder.ts`, `index.ts`, `package.json`.

**Learned / deviations**

- **`ApplePayButtonComponent` is a type ALIAS, not an empty `extends` interface.** The design specified `interface ApplePayButtonComponent extends TonderMountableComponent {}`, which trips `@typescript-eslint/no-empty-object-type`. The apply agent added an `eslint-disable-next-line`; the orchestrator reverted that to `export type ApplePayButtonComponent = TonderMountableComponent`. Reason: it would have been the ONLY eslint suppression in all of `src/` (verified), and adding permanent lint debt to preserve a shape with zero members is a bad trade — converting the alias back to an interface is a one-line edit in the phase that gives the button a method. Structurally identical to TypeScript either way. `src/` still has zero suppressions.
- **`MESSAGES_EN` gap**: the six new `ErrorKeyEnum` members have no message entries. That map is `Record<string, string>`, not exhaustive, so nothing forced it. `AppError` falls back to `UNKNOWN_ERROR` copy for unknown codes. Inert now since nothing throws them — **the phase that first throws one of these codes owns adding its message**. Recorded in `docs/apple-pay-integration-plan.md` §5.2.
- **Pre-existing lint failures, NOT ours**: `npm run lint` was already red on `main` with two `no-unused-vars` errors — `src/tonder.handleRequiresAction.test.ts:184` (`externallyAbortedMessenger`) and `src/tonder.pay.test.ts:483` (`cardSaveSpy`). Confirmed pre-existing; neither file was touched by this change. Spawned as its own task; do not fold it into Apple Pay work.
- **`docs/` is gitignored** (`.gitignore:17`), so `docs/apple-pay-integration-plan.md` is a local working document and is never committed. Consistent with its "temporary document" header.
- Repo branch convention is `feature/DEV-XXXX`; this branch uses a descriptive name because no Jira ticket was supplied.
- Still true: type assertions in `*.test.ts` are NOT enforced (`tsconfig.json:20` excludes them; vitest runs without `--typecheck`). `npm run typecheck` is the only real gate. Fixing that tooling gap is approved as its own separate change and was deliberately kept out.

**Next**: sdd-verify (complete — see verify-report.md)
