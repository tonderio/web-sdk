# Tasks: http-init (STRICT TDD — write each test before its impl)

## 1. Model
- [x] 1.1 `src/models/business.model.ts` — `BusinessConfig` interface (exact backend shape:
  `business{pk,name,...}`, `openpay_keys`, `fintoc_keys`, `mercado_pago`, `vault_id`, `vault_url`,
  `reference: string`, `is_installments_available`, `cardonfile_keys: { public_key: string|null } | null`).
  No core imports (avoid cycles).

## 2. FetchHttpClient adapter (TDD)
- [x] 2.1 `src/adapters/http/fetch-http.client.test.ts` — tests FIRST: header injection (auth +
  content-type), URL composition, 2xx→JSON, 4xx→`AppError(REQUEST_FAILED)`+statusCode, 5xx→same,
  network reject→`REQUEST_FAILED`, `AbortError`→`REQUEST_ABORTED`. Use `vi.stubGlobal('fetch', vi.fn())`.
- [x] 2.2 `src/adapters/http/fetch-http.client.ts` — `FetchHttpClient implements HttpPort`
  (`constructor(baseUrl, apiKey)`). Make 2.1 pass.

## 3. BusinessService (TDD)
- [x] 3.1 `src/core/services/business.service.test.ts` — tests FIRST with a mock `HttpPort`: success →
  typed `BusinessConfig`; `HttpPort` rejects (`REQUEST_FAILED`) → re-thrown as
  `AppError(FETCH_BUSINESS_ERROR)`; unknown reject → also `FETCH_BUSINESS_ERROR`.
- [x] 3.2 `src/core/services/business.service.ts` — `BusinessService.fetchBusinessConfig(apiKey)` →
  `GET /api/v1/payments/business/{apiKey}`. Make 3.1 pass. Pure (injected `HttpPort`).

## 4. Core state
- [x] 4.1 `src/core/TonderCore.ts` — narrow `TonderState.business` to `BusinessConfig | null` (import
  type from model). Keep `core/` pure.

## 5. init() + DI seam (TDD)
- [x] 5.1 Update `src/tonder.test.ts` — tests FIRST (inject mock `HttpPort` via `_createTonderWithDeps`):
  init success → `lifecycle==='ready'` + `state.business` = mock config; init failure →
  `AppError(INIT_ERROR)` + `lifecycle==='error'`; idempotency → second `init()` does not call
  `request` again.
- [x] 5.2 `src/tonder.ts` — implement `init()` (idempotent guard; build `FetchHttpClient` +
  `BusinessService`; fetch; store/ready; on error → `error` + throw `AppError(INIT_ERROR)`). Add
  `_createTonderWithDeps({ config, http })` test-only factory (NOT exported from index.ts). Register
  services in `ServiceManager`. Make 5.1 pass.

## 6. Public exports
- [x] 6.1 `src/index.ts` — export `BusinessConfig` type (named).

## 7. Verify
- [x] 7.1 `npm run typecheck`, `npm run lint`, `npm run build` (assert dist mjs/cjs/global/d.ts),
  `vitest run` — all green. `npm audit` → 0 new vulns.
- [x] 7.2 Work-unit commits on `feature/DEV-2245` (e.g. `feat: fetch http client`,
  `feat: business service + config model`, `feat: tonder.init loads business config`).
