# Change: http-init — HTTP foundation + business config + tonder.init()

## Intent
Implement the networking foundation every later flow depends on: a `HttpPort` adapter (fetch-based),
a `BusinessService` that fetches the business config, and a real `tonder.init()` that loads + stores
that config. First slice of M1.

## Why now
`init()` is a stub. Secure inputs (need `vault_id`/`vault_url`) and card payment (need `business.pk`,
auth, base URLs) both require the business config + a working HTTP client first.

## Scope (in)
- `adapters/http/fetch-http.client.ts` — `FetchHttpClient implements HttpPort`. Base URL from
  `resolveEnv(mode).api`; default headers `Authorization: Token <apiKey>` + `Content-Type: application/json`;
  JSON parse with text fallback; map non-2xx → `AppError(REQUEST_FAILED, statusCode, body)`,
  `AbortError` → `AppError(REQUEST_ABORTED)`, network error → `AppError(REQUEST_FAILED)`. Generic
  (no domain knowledge).
- `models/business.model.ts` — `BusinessConfig` type, EXACT backend shape. Fix two ionic type bugs:
  `reference: string` (backend returns `"TNDR-{uuid}"`), `cardonfile_keys: { public_key: string | null } | null`.
- `core/services/business.service.ts` — `BusinessService.fetchBusinessConfig(apiKey)`:
  `GET /api/v1/payments/business/{apiKey}`; catch inner `REQUEST_FAILED` and re-wrap as
  `AppError(FETCH_BUSINESS_ERROR)`. Pure (depends on injected `HttpPort`).
- `core/TonderCore.ts` — narrow `TonderState.business` from `unknown` to `BusinessConfig | null`.
- `tonder.ts` — implement `init()`: idempotent (no-op if already `ready`); set `initializing`;
  build `FetchHttpClient` + `BusinessService`; fetch config; on success store in core + `ready`; on
  failure set `error` + throw `AppError(INIT_ERROR)` wrapping the cause. Add test-only
  `_createTonderWithDeps({ config, http })` factory (exported from `tonder.ts`, NOT from `index.ts`).
- `index.ts` — export `BusinessConfig` type.

## Scope (out)
- Customer registration, Skyflow/secure inputs, /process, COF, APMs (later slices).
- HMAC signatures / secureToken (not needed for business config — it's `Token apiKey` only).

## Approach
Ports & Adapters: `core/` stays pure; `FetchHttpClient` lives in `adapters/http/` and is injected via
`HttpPort`. Tests inject a mock `HttpPort` for `BusinessService`/`init`; `vi.stubGlobal('fetch')` only
in the `FetchHttpClient` adapter test. STRICT TDD: write each test before its impl.

## Acceptance criteria
- `FetchHttpClient`: calls `fetch` with `{base}{path}` + auth/content headers; 2xx → parsed JSON;
  4xx/5xx → `AppError(REQUEST_FAILED)` with the right `statusCode`; network → `REQUEST_FAILED`;
  abort → `REQUEST_ABORTED`.
- `BusinessService.fetchBusinessConfig`: success → typed `BusinessConfig`; any HTTP failure →
  `AppError(FETCH_BUSINESS_ERROR)`.
- `tonder.init()`: success → `core.state.lifecycle === 'ready'` and `state.business` = fetched config;
  failure → throws `AppError(INIT_ERROR)` and `lifecycle === 'error'`; idempotent → second call does
  not re-fetch (HttpPort.request called once).
- All gates green: typecheck, lint, build (4 artifacts), `vitest run`. No new `npm audit` vulns.

## Delivery
Work-unit commits on `feature/DEV-2245` (no PR). STRICT TDD active (`vitest run`).
