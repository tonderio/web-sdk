# Change: skyflow-inputs — secure card inputs (Skyflow Collect/Reveal)

## Intent
Expose secure card inputs: the SDK mounts Skyflow Collect iframes into merchant-provided `<div>`s,
collects per-field tokens, and reveals saved fields. Slice 2 of M1. The token output feeds the card
payment slice (next).

## Why now
Card payment needs Skyflow field tokens; this is the input layer. `init()` (slice 1) already loads the
`vault_id`/`vault_url` needed to initialize Skyflow.

## Scope (in)
- `adapters/skyflow/skyflow-loader.ts` — `SkyflowSdkLoader = () => Promise<SkyflowStatic>`;
  `createSkyflowLoader()` production loader: lazy-load `https://js.skyflow.com/v1/index.js` with a
  `typeof window.Skyflow` guard + single-load promise (no duplicate injection); failure →
  `AppError(SKYFLOW_LOAD_ERROR)`. `SkyflowStatic` types the used surface of `window.Skyflow`.
- `adapters/skyflow/skyflow.adapter.ts` — `SkyflowAdapter implements TokenizerPort`. Constructor injects
  the loader + `VaultService` (so it's unit-testable). Lazy `ensureInitialized()` reads `vault_id`/
  `vault_url` from core state (`init()` must have run → else `SKYFLOW_NOT_INITIALIZED`), inits Collect
  with `getBearerToken → VaultService`. `mount` (context map `create` vs `update:{card_id}`,
  `tryMountElement` 3×/30ms warn-only, styling resolution per-field over `cardForm` default),
  `unmount`, `collect` → `records[0].fields`, `reveal` (skips CVV per PCI). Errors:
  `MOUNT_COLLECT_ERROR`, `SKYFLOW_NOT_INITIALIZED`.
- `core/services/vault.service.ts` — `VaultService.fetchVaultToken()` → `GET /api/v1/vault-token/` →
  bearer; empty/malformed → `INVALID_VAULT_TOKEN`; HTTP failure → `VAULT_TOKEN_ERROR`; re-throw existing
  `AppError` (no double-wrap).
- `types/card.ts` — `CardField`, `RevealableCardField`, `IMountCardFieldsRequest`,
  `IRevealCardFieldsRequest`, `IRevealCardField`. `types/customization.ts` — `ICardCustomization` +
  styling types (ported/cleaned from ionic).
- `ports/tokenizer.port.ts` — enrich with the card types; add `unmount(context?): void`.
- `shared/errors` — add `SKYFLOW_LOAD_ERROR` + message.
- `tonder.ts` — public `mountCardFields(req)`, `unmountCardFields(context?)`, `revealCardFields(req)`;
  guard `lifecycle !== 'ready'` → `SKYFLOW_NOT_INITIALIZED`; wire `VaultService` + `SkyflowAdapter`;
  extend `_createTonderWithDeps` with optional `tokenizer`.
- `index.ts` — export the new public types.

## Scope (out)
- Card payment `/process` (next slice); COF saved-card CVV path beyond exposing `collect`.

## Approach
Ports & Adapters: `SkyflowAdapter` (DOM + external SDK) lives in `adapters/skyflow/` behind
`TokenizerPort`, injected like `HttpPort`. **Testability seam**: the `SkyflowSdkLoader` is injectable —
tests pass `() => Promise.resolve(fakeSkyflow)` (spied container/elements) + a mock `VaultService`; no
real script, network, or browser. jsdom for DOM. `core/` stays pure (Skyflow/DOM only in the adapter).
STRICT TDD: write each test before its impl (test files for VaultService + SkyflowAdapter + facade).

## Acceptance criteria
- `VaultService`: success → token string; HTTP failure → `VAULT_TOKEN_ERROR`; missing token →
  `INVALID_VAULT_TOKEN`; existing `AppError` re-thrown as-is.
- `SkyflowAdapter`: loads the SDK once (loader called once across two mounts); inits with
  `vaultID/vaultURL/getBearerToken`; `create()`s each field with correct table/column/type; mounts into
  the given container id when the DOM node exists; `tryMountElement` does NOT throw on missing node;
  context map isolates `create` vs `update:{card_id}`; `collect()` returns `records[0].fields`;
  `collect()` with no `create` context or a rejecting container → `MOUNT_COLLECT_ERROR`; `reveal()`
  before any collect → `SKYFLOW_NOT_INITIALIZED`, skips CVV; styling: per-field overrides `cardForm`,
  card_number gets the icon padding default.
- Facade: `mountCardFields` before `init` ready → `SKYFLOW_NOT_INITIALIZED`; after ready → delegates to
  `tokenizer.mount`.
- Gates green: typecheck, lint, build (4 artifacts), `vitest run`; `npm audit` 0 vulns. New public types
  in `dist/index.d.ts`; loader/adapter internals not leaked beyond the typed surface.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active (`vitest run`).
