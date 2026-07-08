# Change: scaffolding — project bootstrap

## Intent
Stand up the empty `@tonder.io/web-sdk` repo as a buildable, testable TypeScript library following the
pre-decided architecture (Ports & Adapters, hexagonal-lite). This is the foundation every later change
builds on. No business logic yet — just build, tooling, and the skeleton of the public surface + core.

## Why now
The repo only has `README.md` + `.gitignore`. Nothing compiles, tests, or bundles. Until this lands,
all work is planning. The full design is already documented (gitignored `docs/04-proposal.md`); this
change implements its build setup + `src/` skeleton.

## Scope (in)
- **Build/tooling**: `package.json` (`@tonder.io/web-sdk`, v0.1.0), `tsconfig.json` (strict),
  `rollup.config.mjs` (ESM + CJS + IIFE global + `.d.ts`, sourcemaps, no obfuscation), `vitest.config.ts`,
  minimal ESLint + Prettier.
- **Public surface skeleton**: `src/index.ts` (exports `createTonder` + public types), `src/tonder.ts`
  (composition root: `createTonder()` factory + `Tonder` facade stub with `init()`).
- **Core skeleton**: `core/TonderCore.ts` (state + lifecycle + subscribe/emit stub), `core/ServiceManager.ts`
  (registry stub).
- **Ports**: `ports/{http,tokenizer,acquirer,redirect-host}.port.ts` (interfaces only).
- **Shared**: `shared/errors/{AppError.ts,ErrorKeyEnum.ts,messages.ts}` (port the ionic-lite AppError
  shape), `shared/config/env.ts` (base URLs per mode: api, app, payflow, vault),
  `shared/types/index.ts` (public type stubs: `TonderConfig`, `PaymentMethod` union, `AppErrorShape`).
- **One smoke test** proving Vitest + the build wiring work (e.g. `createTonder()` returns an object
  with `init`).

## Scope (out — later changes)
- Any real flow (payment, COF, 3DS, APMs, transactions), adapters' real impl, widgets, CDN publish.

## Approach
Follow `docs/04-proposal.md` §5 layout verbatim. TypeScript strict, named exports, `core/` pure (no
DOM/HTTP imports — those live behind ports/adapters). Skyflow/Kushki are NOT dependencies (loaded at
runtime later). Keep stubs minimal but typed; everything must compile, lint, build (3 formats + dts),
and the smoke test must pass.

## Acceptance criteria
- `npm install` resolves; `npm run build` emits ESM + CJS + IIFE + `.d.ts` to `dist/` with sourcemaps.
- `npm run typecheck` passes (strict). `npm run lint` passes.
- `npm test` runs Vitest; the smoke test passes.
- `import { createTonder } from '@tonder.io/web-sdk'` exposes `createTonder(config)` returning an object
  with an async `init()`; `AppError` is exported and matches the standardized shape.
- `src/` tree matches the documented layout; `core/` has no DOM/HTTP imports.

## Delivery
Work-unit commits (no PR chaining). Strict TDD: N/A for this change (build/config bootstrap; covered by
the single smoke test). After this lands, set `testing.strict_tdd: true` + `test_command: "vitest run"`.
