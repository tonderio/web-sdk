# Design: Apple Pay Merchant Validation Service (Phase 4)

One new service with one method, one new test file, one new `MESSAGES_EN` entry. **This is the
smallest phase in `docs/apple-pay-integration-plan.md` §6**, and the design is deliberately
proportionate to it: there is no new type, no new interface, no new abstraction, and no DI
change.

Almost everything worth deciding here is a decision _not_ to add something — a parameter, a
cache, a retry, a type alias, a service-locator key. Each one is a change a reviewer would wave
through, and each one is wrong for a reason that is invisible unless it is written down. That is
what this document is for.

Decisions are labelled `DD1…DD8`. The proposal's decisions are `D1…D5` and remain binding; every
cross-reference is explicit.

---

## Quick path

1. `src/core/services/apple-pay.service.ts` — new. `ApplePayService`, constructor takes
   `HttpPort`, one method `validateMerchant(): Promise<unknown>`.
2. `src/core/services/apple-pay.service.test.ts` — new. Fake `HttpPort` built with `vi.fn()`.
3. `src/shared/errors/messages.ts` — one added entry, `APPLE_PAY_VALIDATION_ERROR`.

Not touched: `src/tonder.ts`, `src/index.ts`, `src/ports/*`, `ErrorKeyEnum`.

Verify: `npm run test` · `npm run typecheck` · `npm run build`, plus an unchanged lint error set.

---

## 1. Architecture

### Layering

```
core/services/apple-pay.service.ts     PURE. imports: ports/http.port (type-only),
        │                              shared/errors/{AppError,ErrorKeyEnum}
        │ this.http.request(...)
        ▼
ports/http.port.ts                     HttpPort — injected, never constructed here
        ▲
        │ implements (at runtime, from Phase 5 onward)
adapters/http/fetch-http.client.ts     the only module that knows about fetch and auth
```

This is the same shape as `business.service.ts` and `direct-api.service.ts`, unchanged. `core/`
importing `ports/` is the standard hexagonal direction; the import is `import type` and erases at
build, so `core/` stays runtime-pure with no DOM and no `fetch`.

### What this change deliberately does not build

No component, no facade branch, no strategy, no DI wiring, no export. `ApplePayService` is
constructed by nothing but its own test. Phase 5 assembles it.

---

## 2. The service

### 2.1 DD1 — Constructor takes `HttpPort`; the service is **not** registered in `ServiceManager`

```ts
export class ApplePayService {
  private readonly http: HttpPort;

  constructor(http: HttpPort) {
    this.http = http;
  }
}
```

The constructor is `BusinessService`'s verbatim (`business.service.ts:14-19`), which is also
`DirectApiService`'s, `CustomerService`'s and `CardService`'s. There is nothing to decide there.

The real question is registration. Today `src/tonder.ts:150-160` constructs five services and
registers all five under string keys:

```ts
this.businessService = new BusinessService(this.http);
// ...
this.services.register(BUSINESS_SERVICE_KEY, this.businessService);
```

**The case for registering now.** Symmetry — every other service is there, and an author reading
`tonder.ts` in Phase 5 will find five services and wonder why the sixth is missing.
`ServiceManager` registration is internal plumbing, not a merchant-reachable surface, so the
inherited D3 ("nothing becomes reachable before the change that gives it behavior") is arguably
about `src/index.ts` exports and public config keys, not about an internal `Map<string, unknown>`.
Registering now would also make Phase 5's diff smaller.

**The case against, which wins.** Three reasons, in increasing order of weight:

| Reason                                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope                                                       | The proposal's Affected Areas freezes `src/tonder.ts` as **Unchanged** and states scope is frozen at three files. Registration is a `tonder.ts` edit                                                                                                                                                                                                                                                                                       |
| Reachability is not only an API property                    | `register()` requires `new ApplePayService(this.http)` in the constructor, which runs for every SDK instance including merchants who never render an Apple Pay button, and puts the module in `tonder.ts`'s eager import graph — so it ships in every bundle. D3's reasoning does extend here; "reachable" includes "loaded and constructed"                                                                                               |
| **The injection style is Phase 5's decision, not this one** | `ServiceManager` is not the only pattern in the codebase. `CofService` is handed its collaborators directly (`new CofService(this.cardService, this.tokenizer, …)`, `tonder.ts:187`). Whether Phase 5's orchestration resolves this service by key or receives it as a constructor argument is a choice Phase 5 makes when it knows what it is building. Registering a key now presupposes an answer to a question that has not been asked |

**DD1 — `ApplePayService` is constructed with an injected `HttpPort` and is registered nowhere.
`src/tonder.ts` is untouched. The change that first calls `validateMerchant()` decides how the
service reaches its caller.**

Nothing is lost by waiting: `ServiceManager.get` throws `Service "x" is not registered.`
(`ServiceManager.ts:26-31`), so a Phase 5 that forgets to wire it fails eagerly and loudly on the
first call rather than silently returning `undefined`. And a registered key with no reader is
dead wiring a reviewer cannot distinguish from a bug.

### 2.2 DD2 — `validateMerchant()` takes no parameters, and returns bare `unknown`

```ts
/**
 * Request an Apple Pay merchant session from the backend.
 *
 * The request body is EMPTY and takes NO parameters (D1). The backend resolves
 * `merchantIdentifier`, `displayName` and `initiativeContext` from the business
 * tied to the api_key, using the browser-set `Origin` header. Nothing
 * client-controlled travels — in particular `event.validationURL` is never read,
 * because letting the browser choose where a certificate-bearing backend
 * connects is an SSRF surface with no upside.
 *
 * Returns Apple's opaque `merchantSession` VERBATIM (D2). The SDK is a courier:
 * it does not parse, validate, log or type this value beyond `unknown` — the
 * only legal thing to do with it is hand it to
 * `ApplePaySessionHandle.completeMerchantValidation`.
 *
 * STATELESS BY REQUIREMENT (D3): no cache, no retry, no in-flight
 * deduplication. Apple requires a new session per transaction, single use,
 * expiring in five minutes — each of those additions would replay a spent
 * session.
 *
 * @throws AppError(APPLE_PAY_VALIDATION_ERROR) on any transport failure.
 */
public async validateMerchant(): Promise<unknown> {
  try {
    return await this.http.request<unknown>({
      method: 'POST',
      path: '/api/v1/payments/apple-pay/validate-merchant/',
      body: {},
    });
  } catch (error) {
    throw new AppError({
      errorCode: ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR,
      originalError: error,
    });
  }
}
```

**Zero parameters is the enforcement mechanism, not a stylistic choice.** Phase 3 closed the
first half of the SSRF surface at the port: `ApplePaySessionHandlers.onValidateMerchant()` takes
no arguments (`apple-pay.port.ts:47`), so the adapter cannot hand a URL to anything. This closes
the second half: even if a URL were somehow available at the call site, there is no parameter to
receive it. Forwarding `event.validationURL` now requires a deliberate signature change in
**two** files — the port and the service — which is exactly the friction D1 asks for.

**On the return type: bare `unknown`, not a named alias.** The alternative considered was
`export type ApplePayMerchantSession = unknown`, which would read better at call sites. It loses
on three counts:

- **It enforces nothing.** A type alias to `unknown` is structurally identical to `unknown`. It
  buys documentation, not a constraint — and pays for it with a real export.
- **The port already made this call.** `ApplePaySessionHandle.completeMerchantValidation(merchantSession: unknown)`
  (`apple-pay.port.ts:93`) is typed bare `unknown`, with the reasoning written in its JSDoc. An
  alias here would either contradict the port or force a second file's edit for zero enforcement.
- **Naming a type implies it has a shape.** `merchantSession` is opaque by Apple's own definition
  — `completeMerchantValidation(any merchantSession)` (`ApplePaySession.md:313-325`). A named
  type invites a future author to widen it into an interface and assert on fields of a payload
  Apple can change without notice.

**DD2 — `validateMerchant(): Promise<unknown>`. No parameters, ever. No named alias for the
return value. The intent lives in JSDoc, where it costs nothing and cannot pretend to enforce
something it does not.**

`unknown` rather than `any` (D2): the value cannot be dereferenced accidentally.

> **Enforcement note.** `tsconfig.json` excludes `**/*.test.ts` (line 20) and `vitest run` does
> not typecheck, so **no type-level assertion written in a test file is checked by anything**. A
> `@ts-expect-error` "you cannot pass a URL" test would be decorative — this is Phase 1's erased
> type-assertion lesson repeating. The zero-parameter guarantee is enforced by `tsc` at Phase 5's
> call site, which _is_ in `src/` and _is_ typechecked. Do not write the decorative test.

---

## 3. DD3 — Failure wrapping is unconditional

Two precedents exist in the codebase and they disagree:

| Precedent                         | Behavior                                                                                                                             | Where                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `DirectApiService.processPayment` | `catch (error) { throw new AppError({ errorCode, originalError: error }) }` — wraps **everything**, including an incoming `AppError` | `direct-api.service.ts:103-108` |
| `Tonder.pay`                      | `if (error instanceof AppError) throw error;` then wraps the rest                                                                    | `tonder.ts:364`                 |

`Tonder.pay`'s comment says why: _"DirectApiService already wraps transport failures as
PAYMENT_PROCESS_ERROR; re-throw any AppError as-is."_ The guard exists because a **service below
it** has already produced the domain code. That condition does not hold here. `ApplePayService`
sits directly on the transport, and `FetchHttpClient` throws `AppError(REQUEST_FAILED)` for every
4xx, 5xx and network failure, and `AppError(REQUEST_ABORTED)` on abort
(`fetch-http.client.test.ts:123-159`).

So an `instanceof AppError` re-throw here would mean **`APPLE_PAY_VALIDATION_ERROR` is never
thrown in production**. Every realistic failure arrives as an `AppError` from the transport, and
the merchant would receive `REQUEST_FAILED` with the copy "Request failed." That would delete the
entire point of this phase.

**DD3 — `ApplePayService` wraps unconditionally, following `DirectApiService`. An incoming
`AppError` from the transport is re-wrapped, not re-thrown. The domain code is produced here,
once; `Tonder`'s `instanceof` guard is the _consumer's_ job and Phase 5 inherits it for free.**

Nothing is lost by wrapping:

- The transport error is preserved on `originalError` and remains fully inspectable.
- `AppError.resolveStatusCode` reads `originalError.status_code`
  (`AppError.ts:73-80`), so the HTTP status survives the wrap — a 404 stays a 404.
- `AppError.resolveSystemError` walks `originalError.code` and `originalError.body.*`
  (`AppError.ts:117-134`), so support diagnostics survive too.

> **Doc bug found, do not copy.** `direct-api.service.ts:78-80` claims in its class JSDoc that
> "An existing `AppError` is re-thrown unchanged (no double-wrap)". The code does no such thing —
> it wraps unconditionally. The behavior described is `Tonder.pay`'s, not the service's. Write
> `ApplePayService`'s JSDoc to match its actual code. Fixing the `DirectApiService` comment is
> out of scope here.

---

## 4. DD4 — The message entry sits with its siblings

`MESSAGES_EN` is `Record<string, string>` and is **not** exhaustive over `ErrorKeyEnum`, so
nothing in the type system forces an entry — `AppError.resolveMessage` silently falls back to the
`UNKNOWN_ERROR` copy (`AppError.ts:91-98`). The only thing that catches a missing entry is a test
that asserts the fallback did not happen (§5, case 6).

The copy itself is settled by proposal **D5** and is not re-decided here. The only design
decision left is placement.

**DD4 — the new entry goes immediately after `APPLE_PAY_CONTAINER_NOT_FOUND` and before
`UNKNOWN_ERROR` (`messages.ts:63-67`), keeping the Apple Pay codes contiguous.**

`UNKNOWN_ERROR` stays last: it is the fallback and reads as the terminator of the map. Phase 5
adds its three remaining codes into the same block, so the six read together at review time —
which is when the `APPLE_PAY_SESSION_ERROR` vs `APPLE_PAY_VALIDATION_ERROR` distinction (D5) gets
its final check.

---

## 5. DD5 — The test proves absence, which changes how the assertions are written

The requirements this phase must prove are unusual: two of the four are about what is **not**
there. That rules out the assertion style used everywhere else in the service tests.

`direct-api.service.test.ts:55-64` asserts with `expect.objectContaining({...})`. **That is the
wrong tool here.** `objectContaining` passes with extra keys — a request carrying
`body: { validationURL: '…' }` would sail straight through an `objectContaining({ method, path })`
assertion. The whole security content of this change would be untested.

**DD5 — the primary request assertion uses exact deep equality on the entire
`HttpRequestOptions` object. Any added key — a header, a body field, a `signal` — fails the test.
That is the point.**

The fake `HttpPort` must therefore be a `vi.fn()` whose recorded call arguments are inspectable,
not a hand-written object; and it must live in the test file (binding constraint: nothing under
`src/` may exist only for testing).

```ts
import { describe, it, expect, vi } from 'vitest';
import { ApplePayService } from './apple-pay.service';
import type { HttpPort, HttpRequestOptions } from '../../ports/http.port';
import { AppError } from '../../shared/errors/AppError';
import { ErrorKeyEnum } from '../../shared/errors/ErrorKeyEnum';
import { MESSAGES_EN } from '../../shared/errors/messages';

const VALIDATE_PATH = '/api/v1/payments/apple-pay/validate-merchant/';

/** Fake transport. Returns the spy too so the recorded options can be read back. */
function fakeHttp(impl: HttpPort['request']) {
  const request = vi.fn(impl);
  return { http: { request } as HttpPort, request };
}

describe('ApplePayService.validateMerchant', () => {
  // 1 — exact method and path, and NOTHING else in the request
  it('POSTs an empty body to the merchant-validation path and sends nothing else', async () => {
    const { http, request } = fakeHttp(async () => ({ opaque: true }));

    await new ApplePayService(http).validateMerchant();

    expect(request).toHaveBeenCalledTimes(1);
    // EXACT equality, never expect.objectContaining: an extra key is precisely
    // the regression this assertion exists to catch. objectContaining would
    // pass with a validationURL in the body.
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: VALIDATE_PATH,
      body: {},
    });
  });

  // 2 — the absence assertions, spelled out so a failure names the thing that leaked
  it('sends no client-derived value and sets no auth header of its own', async () => {
    const { http, request } = fakeHttp(async () => ({}));

    await new ApplePayService(http).validateMerchant();

    const [options] = request.mock.calls[0] as [HttpRequestOptions];
    expect(Object.keys(options.body as Record<string, unknown>)).toHaveLength(
      0,
    );
    expect(options.headers).toBeUndefined(); // auth is the transport's job
    expect(JSON.stringify(options)).not.toMatch(
      /validationURL|merchant_identifier|domain_name|initiative_context/i,
    );
  });

  // 3 — pass-through by IDENTITY, not deep equality
  it('returns the opaque merchant session verbatim, unparsed', async () => {
    const merchantSession = {
      epochTimestamp: 1,
      signature: 'opaque',
      nested: { a: [1, 2] },
    };
    const { http } = fakeHttp(async () => merchantSession);

    const result = await new ApplePayService(http).validateMerchant();

    // toBe, not toEqual: identity proves the service neither copied nor
    // re-serialized the blob. toEqual would pass on a structural clone.
    expect(result).toBe(merchantSession);
  });

  // 4 — the response is not assumed to be an object
  it('passes a non-object response through without parsing it', async () => {
    const { http } = fakeHttp(async () => 'an-opaque-string' as never);

    await expect(new ApplePayService(http).validateMerchant()).resolves.toBe(
      'an-opaque-string',
    );
  });

  // 5 — DD3: an AppError from the transport is RE-WRAPPED, not re-thrown
  it('wraps a transport AppError as APPLE_PAY_VALIDATION_ERROR and keeps the original', async () => {
    const transportError = new AppError({
      errorCode: ErrorKeyEnum.REQUEST_FAILED,
      status_code: 404,
    });
    const { http } = fakeHttp(async () => {
      throw transportError;
    });

    const error = await new ApplePayService(http)
      .validateMerchant()
      .catch((e: unknown) => e as AppError);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR);
    expect(error.originalError).toBe(transportError);
    expect(error.status_code).toBe(404); // survives the wrap
  });

  // 6 — the MESSAGES_EN entry: the only thing that catches a missing one
  it('resolves the merchant-validation copy instead of the UNKNOWN_ERROR fallback', async () => {
    const { http } = fakeHttp(async () => {
      throw new Error('boom');
    });

    const error = await new ApplePayService(http)
      .validateMerchant()
      .catch((e: unknown) => e as AppError);

    expect(error.code).toBe(ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR);
    expect(error.message).not.toBe(MESSAGES_EN[ErrorKeyEnum.UNKNOWN_ERROR]);
    expect(error.message).toBe(
      MESSAGES_EN[ErrorKeyEnum.APPLE_PAY_VALIDATION_ERROR],
    );
  });

  // 7 — DD6: no memory between calls
  it('issues a fresh request on every call — no cache, no deduplication', async () => {
    const { http, request } = fakeHttp(async () => ({}));
    const service = new ApplePayService(http);

    await service.validateMerchant();
    await service.validateMerchant();

    expect(request).toHaveBeenCalledTimes(2);
  });
});
```

Case 6 deserves a note: `expect(error.message).toBe(MESSAGES_EN[...])` reads tautologically
because it compares against the same map. It is not the load-bearing assertion — the line above
it is. `not.toBe(MESSAGES_EN[UNKNOWN_ERROR])` is what fails if the entry is missing, since
`resolveMessage` falls back to exactly that string. Both lines stay: the second documents intent,
the first does the work.

---

## 6. Constraints that are decisions

### 6.1 DD6 — The service holds no state, and this is a correctness requirement

Apple's rules (`ApplePaySession.md:331-335`, proposal D3): a new session per transaction, single
use, five-minute expiry.

**DD6 — `ApplePayService` has exactly one field, `http`. No cache field, no in-flight promise, no
retry counter, no timeout.**

This is worth a decision label because all three forbidden additions are things a competent
reviewer approves without thinking:

| "Improvement"               | What it actually does                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| Cache the merchant session  | Returns a session that is already spent or within minutes of expiry. The sheet rejects it |
| Retry on failure            | Replays a single-use session, or races a second one against the first                     |
| Deduplicate in-flight calls | Two concurrent transactions share one session; the second payment fails                   |

Test case 7 is the mechanical guard: two calls must produce two requests. It is cheap and it
fails loudly the day someone adds a cache.

### 6.2 DD7 — The extension point for the unconfirmed backend contract

Plan §8.2 records that the endpoint's contract is not yet confirmed with the backend: whether it
resolves everything from the api_key plus `Origin` with an empty body, and where `displayName`
comes from. This does not block — `HttpPort` is injected, so the service is fully testable
against a fake with no backend, no network and no Safari.

**DD7 — if the backend later requires a field, it is added as an explicit parameter on
`validateMerchant` and one key in the body object, and that value MUST be resolvable by the SDK
from data it already holds — business config or the cached catalog. It may NEVER come from
Apple's event.**

The change is localized by construction: one parameter, one body key, one updated exact-equality
assertion in test case 1. What may not move is D1. The risk is not "the contract changes"; it is
"the contract changes into something client-supplied", and the SDK not sending `validationURL` —
not a backend allowlist — is what closes the SSRF surface.

---

## 7. DD8 — One work unit

**DD8 — one commit, containing the service, its test, and the single `MESSAGES_EN` entry.
Commits only, no pull request.**

Splitting was considered and rejected. The message entry cannot ship separately: Phase 3's
working rule (proposal D5) is that the change which first throws a code owns its message, and
test case 6 fails without it, so a service-only commit would be red. The service cannot ship
without its test under strict TDD. Three files, roughly 120 lines including JSDoc — a split would
produce a commit that does not stand alone in exchange for nothing.

**Strict TDD applies and genuinely bites here.** Unlike Phase 1, this is runtime behavior over an
injected port; vitest can and does enforce every requirement. Write test case 1 first, watch it
fail on a missing module, then the service.

---

## 8. Nothing was decided here, deliberately

Stated so a reviewer does not go looking for a section that is missing:

| Area                    | Why there is no decision                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Data modelling          | The only data is opaque and untyped (DD2). There is no model                                                  |
| Validation              | There is no client input to validate — the method takes no arguments                                          |
| New types or interfaces | `HttpPort`, `AppError` and `ErrorKeyEnum` all exist and are reused. A new one would be a duplicated interface |
| Error taxonomy          | `APPLE_PAY_VALIDATION_ERROR` was declared in Phase 1. No enum change                                          |
| Observability           | Proposal question 4: nothing is added. Instrumenting a call with no consumer is speculative                   |
| Concurrency             | DD6 forbids the only concurrency mechanism that would apply (in-flight dedup)                                 |
| Migration / rollback    | Revert one commit. No public surface, no persisted data, no backend dependency                                |

---

## 9. Traceability

| DD  | Subject                                                  | Ties to            | Verified by                                                       |
| --- | -------------------------------------------------------- | ------------------ | ----------------------------------------------------------------- |
| DD1 | `HttpPort` constructor; no `ServiceManager` registration | D3 (inherited), D4 | `src/tonder.ts` unchanged; no importer outside the test           |
| DD2 | Zero parameters; bare `unknown` return                   | D1, D2             | `npm run typecheck` at Phase 5's call site; test cases 3, 4       |
| DD3 | Unconditional wrap, not `instanceof` re-throw            | D4                 | Test case 5                                                       |
| DD4 | Message entry placement                                  | D5                 | Test case 6; review reads the six Apple codes together in Phase 5 |
| DD5 | Exact deep equality over `objectContaining`              | D1                 | Test cases 1, 2                                                   |
| DD6 | No cache, no retry, no dedup                             | D3                 | Test case 7; one field on the class                               |
| DD7 | Future backend field must be SDK-resolvable              | D1, plan §8.2      | Review-time rule; no code today                                   |
| DD8 | One commit                                               | —                  | Green on test, typecheck, build                                   |

---

## Checklist

- [ ] `src/core/services/apple-pay.service.ts` exists; class has exactly one field (`http`) and
      one method
- [ ] `validateMerchant()` declares **zero** parameters and returns `Promise<unknown>`
- [ ] The request is `POST /api/v1/payments/apple-pay/validate-merchant/` with `body: {}` and no
      `headers`, asserted by **exact** deep equality (not `objectContaining`)
- [ ] The success response is returned by identity (`toBe`), including a non-object response
- [ ] Every transport failure — including an incoming `AppError` — becomes
      `AppError(APPLE_PAY_VALIDATION_ERROR)` with `originalError` preserved
- [ ] `MESSAGES_EN` gains exactly one entry, placed after `APPLE_PAY_CONTAINER_NOT_FOUND`; the
      three codes Phase 5 owes still have none
- [ ] Two calls produce two requests
- [ ] `src/tonder.ts`, `src/index.ts`, `src/ports/*` and `ErrorKeyEnum.ts` are untouched
- [ ] No `@ts-expect-error` "cannot pass a URL" test — test files are typechecked by nothing
- [ ] `npm run test`, `npm run typecheck`, `npm run build` green; lint error set unchanged

## Next step

`sdd-tasks` — the task breakdown for the single work unit in DD8, TDD-ordered.
