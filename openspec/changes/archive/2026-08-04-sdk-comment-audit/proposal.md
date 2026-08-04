# Proposal: Remove internal vocabulary from published SDK artifacts

## Intent

`@tonder.io/web-sdk` ships source comments verbatim to merchant developers. Verified in the built artifacts:

| Artifact                                  | Published | Forbidden-vocabulary lines |
| ----------------------------------------- | --------- | -------------------------- |
| `dist/index.d.ts` (every editor tooltip)  | yes       | 11                         |
| `dist/tonder-web-sdk.js` (unminified CDN) | yes       | 41                         |
| `dist/index.mjs`                          | yes       | 8                          |
| `dist/tonder-web-sdk.min.js`              | yes       | 0 (terser strips)          |

Confirmed leaks include `dist/index.d.ts:222` (`...COF subscription calls. INTERNAL.`), `:892` (`own session (DD3)`), `:962` (`payflow iframe`), `:1058` (`COMPOSITION SEAM (payflow CheckoutMessenger...)`).

**Structural cause**: `rollup-plugin-dts` emits declarations for `private` members too, so `private` is not a leak boundary. Any comment on any class member is public surface.

## Scope

### In scope

- Apply the classifier below to ~42–57 flagged comment lines across ~16–19 non-test `src/` files.
- Reword the false JSDoc at `src/core/services/direct-api.service.ts:82-95` to describe actual behavior.
- Add an automated regression guard over **built** artifacts.

### Out of scope (non-goals)

- `src/**/*.test.ts` — excluded from `package.json` `files`, never published.
- Adding the missing `instanceof AppError` guard in `direct-api.service.ts` (behavioral change, tracked separately).
- Renaming the public `TonderBaseUrls.payflow` field (`src/shared/config/env.ts:16` → `dist/index.d.ts:301`) — breaks merchant code.
- Identifier renames, API changes, README edits (Phase 9), `docs/` edits.

## The classifier (binding; `sdd-apply` decides ~50 times without asking)

1. **Rule**: a comment explaining WHY a non-obvious constraint exists usually STAYS; a comment restating WHAT the code does usually GOES.
2. **Audience test**: would a merchant developer who has never seen Tonder's backend understand this, and does it help them?
3. **Verdicts**:

| Verdict | When                                                                   | Default?                              |
| ------- | ---------------------------------------------------------------------- | ------------------------------------- |
| KEEP    | passes rule 1 and rule 2                                               | —                                     |
| REWRITE | load-bearing WHY that fails the audience test                          | **yes — default for every leak case** |
| DELETE  | restates code, or is pure process/ticket noise (`phase 7`, `DEV-2xxx`) | only when rule 1 fails                |

**REWRITE preserves the reasoning and strips the vocabulary.** Deleting a leak is only allowed when the comment would be deleted on rule 1 alone.

## PROTECTED comments (must survive verbatim or with reasoning intact)

| Location                                                                       | Why it is load-bearing                                                                                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apple-pay-checkout.service.ts:81-98`                                          | `start()` deliberately not `async` (an `await` becomes TS2705; failure invisible outside real Safari). Class is not exported — no rewrite needed.               |
| `tonder.ts:166-181`                                                            | 7th ctor param typed `unknown` to dodge `rollup-plugin-dts` + `@types/applepayjs` TS2503. `rollup-plugin-dts` is a public package — no de-internalizing needed. |
| `apple-pay.strategy.ts:61`                                                     | absent `supports_debit`/`supports_credit` means "do not filter"                                                                                                 |
| `shared/payment-method-catalog.ts:59,65`                                       | prefix-vs-allowlist decision; bare `apple_pay` exclusion                                                                                                        |
| `types/customization.ts:125`                                                   | no image/icon option — Apple HIG                                                                                                                                |
| `ports/apple-pay.port.ts:45` + `adapters/browser/apple-pay.adapter.ts:116,119` | `validationURL` deliberately unread; no `await` in the gesture tick                                                                                             |
| `tonder.ts:249`                                                                | `mount()` deliberately does not call this                                                                                                                       |

## Regression guard (highest-value deliverable)

A one-time cleanup decays. Recommendation:

- **Where**: `scripts/check-dist-vocabulary.mjs`, wired as `"postbuild"`. `npm run build` is already a prerequisite of `prepublishOnly` and `pretest:e2e`, so the guard runs before every publish and every e2e run, on **fresh** artifacts. A plain Vitest test cannot do this — `npm run test` never builds, so it would pass on stale or missing `dist/`.
- **TDD**: the script exports a pure `findForbiddenVocabulary(source)`; a Vitest unit test drives it against fixtures. Unit tests stay independent of `dist/`.
- **False positives — ONE mechanism: scan block comments only** (`/* ... */`). ~75% of raw keyword hits are legitimate code (literal endpoint paths, `https://payflow.tonder.io`). All confirmed leaks are JSDoc. Line-comment scanning is rejected because a naive `//`-to-EOL regex matches inside URL literals. A small documented allowlist remains as an escape hatch, not the primary defense.
- **Seed word list** (must reach zero legitimate comment uses after cleanup): `payflow`, `zplit`, `usrv-`, `ionic-lite`, `COMPOSITION SEAM`, `INTERNAL`, `/DD\d+/`, `/phase \d+/i`, `/DEV-\d+/`.
- **Targets**: `dist/index.d.ts`, `dist/tonder-web-sdk.js`, `dist/index.mjs`.

## Capabilities

### New

- `sdk-artifact-hygiene`: published artifacts must not expose internal vocabulary; the guard enforces it.

### Modified

- None.

## Affected areas

| Area                                      | Impact   | Description                   |
| ----------------------------------------- | -------- | ----------------------------- |
| ~16–19 non-test `src/` files              | Modified | comment-only edits            |
| `src/core/services/direct-api.service.ts` | Modified | correct a false claim         |
| `scripts/check-dist-vocabulary.mjs`       | New      | guard                         |
| `scripts/*.test.ts` (or `src/__guards__`) | New      | unit tests for the classifier |
| `package.json`                            | Modified | `postbuild` hook              |

## Risks

| Risk                                                   | Likelihood       | Mitigation                                                                                                          |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| A rewrite strips the reasoning with the vocabulary     | Med              | REWRITE is the default; reviewer/verify checks each PROTECTED entry still states its WHY, not just that text exists |
| `dist/` is gitignored — not in the diff, may be absent | High (confirmed) | guard runs as `postbuild`, so `dist/` always exists when it runs; it exits non-zero if a target file is missing     |
| Word list too broad → CI noise                         | Med              | comment-only scan + every word validated against the post-cleanup tree before landing                               |
| Comment churn hides a behavior change                  | Low              | no runtime code is edited; `npm run test` must be green with no test edits                                          |

## Rollback

Single revert of the change's commits. No runtime behavior, no API surface, no data.

## Success criteria

- [ ] `npm run build` then a scan of `dist/index.d.ts`, `dist/tonder-web-sdk.js`, `dist/index.mjs` reports **zero** forbidden-vocabulary comment hits (down from 11/41/8).
- [ ] `npm run build` fails (non-zero exit) when a forbidden word is reintroduced into a JSDoc block.
- [ ] Every PROTECTED comment above is still present and still explains its constraint.
- [ ] `npm run test`, `npm run typecheck`, `npm run build` green.
- [ ] `npm run lint` error set unchanged from its two known pre-existing errors.
- [ ] No runtime code changed except where a comment rewrite is the entire edit.

## Forward findings (not this change)

- **README candidates (Phase 9)** — merchant-relevant knowledge buried in source: CVV never revealable, PCI DSS Req 3.2.1 (`src/types/card.ts:30-31`); 2-decimal currency assumption, JPY/KWD unsupported (`src/core/strategies/apple-pay.strategy.ts:166-168`); `on_success` fires on declines — "a decline is a result, not a failure" (`src/shared/types/index.ts:61-64`).
- **`TonderBaseUrls.payflow`** is a public exported property. Renaming is a breaking API decision, not a comment fix.
- **`docs/internal_onboarding_notion.md`**: `docs/` is gitignored (`.gitignore:17`), so this file is local-only and never published or committed. Lower risk than assumed; still worth confirming when Phase 9 is scoped.

## Delivery

Commits only, no PR. Estimated ~150–250 changed lines.
