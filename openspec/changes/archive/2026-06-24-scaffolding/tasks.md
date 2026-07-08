# Tasks: scaffolding — project bootstrap

## 1. Build & tooling
- [x] 1.1 `package.json`: name `@tonder.io/web-sdk`, version `0.1.0`, `type: module`, `sideEffects: false`,
  `exports` map (import→ESM, require→CJS, types→dts), `main`/`module`/`types`, `files: ["dist"]`,
  scripts: `build` (rollup), `dev` (rollup -w), `test` (vitest run), `test:watch`, `typecheck`
  (`tsc --noEmit`), `lint`, `format`. Engines node ≥18.
- [x] 1.2 `tsconfig.json`: strict, `target`/`module` ESNext, `moduleResolution` Bundler, `declaration`,
  `declarationMap`, `sourceMap`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `outDir dist`,
  `rootDir src`.
- [x] 1.3 `rollup.config.mjs`: inputs `src/index.ts`; outputs ESM (`dist/index.mjs`), CJS
  (`dist/index.cjs`), IIFE global (`dist/index.global.js`, name `Tonder`), all with sourcemaps; plus a
  `.d.ts` bundle via `rollup-plugin-dts`. Plugins: `@rollup/plugin-node-resolve`,
  `@rollup/plugin-typescript`. No obfuscation. (Skyflow/Kushki are runtime-loaded — not bundled/externals.)
- [x] 1.4 `vitest.config.ts`: environment `jsdom` (browser SDK), globals, `include src/**/*.test.ts`.
- [x] 1.5 ESLint (flat config, `@typescript-eslint`) + Prettier, minimal sensible rules. Add
  `.eslintignore`/config ignoring `dist`.
- [x] 1.6 Update `.gitignore` if needed (already ignores `node_modules/`, `dist/`, `docs/`, `.atl/`).

## 2. Shared (errors, config, types)
- [x] 2.1 `src/shared/errors/ErrorKeyEnum.ts`: enum/union of error codes (port from ionic-lite:
  `INIT_ERROR`, `FETCH_BUSINESS_ERROR`, `PAYMENT_PROCESS_ERROR`, `SAVE_CARD_ERROR`, `INVALID_CARD_DATA`,
  `CARD_ON_FILE_DECLINED`, `THREEDS_REDIRECTION_ERROR`, `REQUEST_FAILED`, `UNKNOWN_ERROR`, … ).
- [x] 2.2 `src/shared/errors/messages.ts`: `MESSAGES_EN` map code→message.
- [x] 2.3 `src/shared/errors/AppError.ts`: `AppError extends Error` with `status:'error'`, `code`,
  `statusCode`, `details`, `originalError?`; `buildPublicAppError(...)` factory. Shape per ionic-lite.
- [x] 2.4 `src/shared/config/env.ts`: `resolveEnv(mode)` → base URLs `{ api, app, payflow, vault }` for
  `production | sandbox | stage`.
- [x] 2.5 `src/shared/types/index.ts`: `TonderConfig` (`apiKey`, `mode`, `returnUrl`, `customization?`,
  `getSecureToken?`, `getSignature?`), `PaymentMethod` tagged union
  (`{type:'card'} | {type:'saved_card', id} | {type:'apm', apm, config?} | {type:'spei'}`),
  `IPublicError`, result types (`PayResult` discriminated union stub).

## 3. Ports
- [x] 3.1 `src/ports/http.port.ts` — `HttpPort` interface (`request<T>(...)`).
- [x] 3.2 `src/ports/tokenizer.port.ts` — `TokenizerPort` (mount/collect/reveal — interface only).
- [x] 3.3 `src/ports/acquirer.port.ts` — `AcquirerPort` (COF subscription — interface only).
- [x] 3.4 `src/ports/redirect-host.port.ts` — `RedirectHostPort` (mount payflow iframe + onComplete).

## 4. Core skeleton
- [x] 4.1 `src/core/TonderCore.ts` — holds state + `subscribe`/`emit` (Observer) + lifecycle flags. Pure
  (no DOM/HTTP imports).
- [x] 4.2 `src/core/ServiceManager.ts` — registry that holds/returns services (stub, typed).

## 5. Facade & entry
- [x] 5.1 `src/tonder.ts` — `Tonder` class (composition root): constructor wires `TonderCore` +
  `ServiceManager`; `async init()` stub (will fetch business config later); throws `AppError` on bad
  config. `createTonder(config): Tonder` factory.
- [x] 5.2 `src/index.ts` — public exports: `createTonder`, `AppError`, and public types. Named exports only.

## 6. Smoke test
- [x] 6.1 `src/tonder.test.ts` — `createTonder({apiKey,mode,returnUrl})` returns an object with async
  `init`; `createTonder({})` (missing apiKey) throws/produces an `AppError` with `code: INIT_ERROR`.

## 7. Verify
- [x] 7.1 `npm install`, `npm run typecheck`, `npm run lint`, `npm run build` (assert dist has
  `.mjs`,`.cjs`,`.global.js`,`.d.ts`), `npm test` all green.
- [x] 7.2 Commit as work units (e.g. `chore: build tooling`, `feat: errors+config+types`,
  `feat: ports + core + facade skeleton`, `test: smoke test`).
