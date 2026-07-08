# Archive Report: presentation-mode

**Change**: presentation-mode (direct implementation — no SDD change folder)
**Branch**: feature/DEV-2245
**Date**: 2026-07-03
**Verdict**: PASS WITH WARNINGS (the CRITICAL was fixed post-verify)

## What was done
- Renamed `threeDsMode` → `presentationMode` and `threeDsContainerId` →
  `presentationContainerId` across `src/`, tests, `e2e/`, and `README.md`. The
  field is client-only and never sent to the backend.
- Fixed the embedded-APM path: mount the hosted page and LEAVE it visible,
  returning the `Pending` transaction immediately with no poll (previously it
  mounted then unmounted in the same tick, so the shopper never saw the page).
- Added the public `unmountPresentation()` method to close the embedded-APM
  iframe.
- Card 3DS embedded is unchanged (polls to final, auto-unmounts).

## Evidence
- `npm test`: 225/225 pass. `npm run typecheck`: clean. `npm run build`: fresh.
- Verify CRITICAL (rename leftover in `e2e/support/fixtures.ts` +
  `e2e/tests/threeds.spec.ts`, which silently forced embedded e2e into redirect)
  fixed in commit `4f73903`; grep confirms zero leftover old names in
  `src/`, `e2e/`, `README.md`, `dist/index.d.ts`.
- Verify WARNING (`pay.html` demo internal naming: DOM id `threeDsMode`,
  sessionStorage key) intentionally deferred — demo-internal and harmless, and
  the area is reworked by the follow-up modal change.

## Commits (feature/DEV-2245)
- `fefbcb4` refactor(presentation): rename threeDsMode to presentationMode and fix embedded APM
- `83910ee` docs(readme): document presentationMode and per-flow embedded behavior
- `4f73903` test(e2e): complete threeDsMode->presentationMode rename in e2e fixtures

## Superseded-in-progress
The `presentationContainerId` + `unmountPresentation()` approach is being
replaced by an SDK-owned modal + events/callbacks in the next change (started via
`/sdd-new`). This archive documents the interim state as shipped.
