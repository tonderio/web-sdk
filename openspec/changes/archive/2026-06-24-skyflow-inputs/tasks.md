# Tasks: skyflow-inputs (STRICT TDD — test before impl per unit)

## 1. Errors + types (no behavior)
- [x] 1.1 `src/shared/errors/ErrorKeyEnum.ts` + `messages.ts` — add `SKYFLOW_LOAD_ERROR`
  ('Error loading the Skyflow secure fields library.'). Confirm the others exist
  (SKYFLOW_NOT_INITIALIZED, MOUNT_COLLECT_ERROR, INVALID_VAULT_TOKEN, VAULT_TOKEN_ERROR).
- [x] 1.2 `src/types/card.ts` — `CardField`, `RevealableCardField` (no cvv), `IMountCardFieldsRequest`
  ({ fields, card_id?, unmount_context? }), `IRevealCardField`, `IRevealCardFieldsRequest`.
- [x] 1.3 `src/types/customization.ts` — `ICardCustomization` + styling types (ported/cleaned from ionic
  commons.ts: per-field + `cardForm` global + labels/placeholders + `enableCardIcon`).
- [x] 1.4 `src/ports/tokenizer.port.ts` — use the card types; add `unmount(context?: string): void`.

## 2. VaultService (TDD)
- [x] 2.1 `src/core/services/vault.service.test.ts` (FIRST, mock HttpPort): success → token string;
  network reject → `VAULT_TOKEN_ERROR`; body without `token` → `INVALID_VAULT_TOKEN`; existing
  `AppError` re-thrown unchanged.
- [x] 2.2 `src/core/services/vault.service.ts` — `fetchVaultToken()` → `GET /api/v1/vault-token/`. Pure
  (injected HttpPort). Make 2.1 pass.

## 3. Skyflow loader
- [x] 3.1 `src/adapters/skyflow/skyflow-loader.ts` — `SkyflowStatic` interface, `SkyflowSdkLoader` type,
  `createSkyflowLoader()` (guard `window.Skyflow`, single-load promise, script inject, onerror →
  `SKYFLOW_LOAD_ERROR`). (Production loader is integration-only; unit tests inject a fake loader.)

## 4. SkyflowAdapter (TDD — the core of this slice)
- [x] 4.1 `src/adapters/skyflow/skyflow.adapter.test.ts` (FIRST) — fake loader + mock VaultService +
  jsdom. Cover: not-initialized before vault config → `SKYFLOW_NOT_INITIALIZED`; loader called once;
  `Skyflow.init` args (vaultID/vaultURL/getBearerToken); `create()` per field (table/column/type);
  `element.mount(containerId)` when DOM node present; `tryMountElement` no-throw on missing node; mount
  twice reuses instance; context map create vs `update:{card_id}`; `unmount()` unmounts elements;
  `collect()` returns `records[0].fields`; `collect()` no-context / rejecting container →
  `MOUNT_COLLECT_ERROR`; `reveal()` no prior collect → `SKYFLOW_NOT_INITIALIZED`; reveal skips CVV;
  styling per-field over `cardForm`; card_number icon padding default. (~20 cases.)
- [x] 4.2 `src/adapters/skyflow/skyflow.adapter.ts` — `SkyflowAdapter implements TokenizerPort`
  (constructor: core/state accessor for vault config, VaultService, mode, loader, customization?).
  `ensureInitialized`, `typeByField`, `validationsByField`, `resolveFieldStyles`, `tryMountElement`
  (3×/30ms warn-only), `mount`, `unmount`, `collect`, `reveal`, `collectForCard` (private). Make 4.1 pass.

## 5. Facade wiring (TDD)
- [x] 5.1 `src/tonder.test.ts` (add) — `mountCardFields` before ready → `SKYFLOW_NOT_INITIALIZED`; after
  ready → delegates to injected mock `tokenizer.mount`; `unmountCardFields`/`revealCardFields` delegate.
- [x] 5.2 `src/tonder.ts` — wire `VaultService` + `SkyflowAdapter`; public `mountCardFields`,
  `unmountCardFields`, `revealCardFields` (guard `lifecycle !== 'ready'`); extend `_createTonderWithDeps`
  with optional `tokenizer`. Make 5.1 pass.

## 6. Public exports
- [x] 6.1 `src/index.ts` — export `CardField`, `IMountCardFieldsRequest`, `IRevealCardFieldsRequest`,
  `IRevealCardField`, `ICardCustomization`.

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (assert dist mjs/cjs/global/d.ts + new
  types present), `vitest run`, `npm audit` (0 vulns) — all green. Confirm `core/` has no DOM/Skyflow
  imports (only `adapters/skyflow/` touches them).
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: vault service`, `feat: skyflow loader`,
  `feat: skyflow adapter (collect/reveal)`, `feat: mount/reveal card fields on facade`).
