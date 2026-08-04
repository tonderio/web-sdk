# Tasks: make the component lifecycle contract explicit

**Change:** `sdk-lifecycle-docs`
**Delivery:** commits only, no pull requests. `chain_strategy` not applicable.
**No design phase:** this is a docs-only change with no runtime mechanism to
design; the proposal already resolved the open questions (see the "Design
decisions carried over" note before Work Unit 5).

Every task cites the spec requirement it satisfies. Read the spec at
`openspec/changes/sdk-lifecycle-docs/specs/component-lifecycle-documentation/spec.md`
before starting — task text here is a pointer to it, not a replacement for it.

Two claims are permanently banned from both documents, checked explicitly in
Work Unit 6:

- Skipping `unmount()` freezes a page or its UI (RETRACTED — proven false by
  8 executed repros; see `investigation/unmount-lifecycle-phase9` in engram,
  observation #4082).
- A browser allows only one active `ApplePaySession` at a time (UNVERIFIED —
  belongs on a real-Safari validation list, never in either document).

---

## [x] Work Unit 1 — README: Component lifecycle section (sequential, first)

**Satisfies:** Requirement "The lifecycle section states when unmount() is
required and the specific cost of skipping it"; Requirement "A framework
lifecycle example is reachable by capability, not by section name".

**File:** `README.md`

- [x] 1.1. Add a new `### Component lifecycle` subsection under the existing
      `## Core concepts` heading (line 466), placed after `### Presentation mode`
      (starts line 499) and before `## Payment flows` (line 522) — this keeps it
      inside the conceptual section the proposal names, not appended at the end of
      the doc.

- [x] 1.2. Write the navigation-conditional rule verbatim in spirit (not necessarily
      verbatim in wording) as:

> If your page unloads to change checkout state, the browser cleans up for
> you. If your app changes routes without a page load, you own the cleanup.

This sentence MUST work for a static checkout page that never navigates AND
for an SPA that unmounts components. Do not write "always call `unmount()`"
(false for the static case) and do not write "`unmount()` is recommended"
(understates a stale-charge risk for the SPA case). The rule is conditional
on navigation, never on which framework is in use.

- [x] 1.3. State the Apple Pay consequence of skipping `unmount()` at full severity,
      matching spec wording exactly in substance: an orphaned session can still be
      authorized and reach `processPayment()` with stale payment data. Do not write
      "may leak resources" or any other softened phrasing.

- [x] 1.4. Add one runnable `useEffect`-style example in this subsection that pairs
      a mount call with an unmount call in the cleanup path, covering **both**
      `card_fields` and `apple_pay_button` in the same example (per Decision 2 in
      the proposal — one canonical example, not two separate ones, and not a
      per-flow repeat elsewhere in the README).

- [x] 1.5. Update the `## Contents` list (starts line 9) to add an entry for the
      new `Component lifecycle` subsection, alphabetically/positionally consistent
      with the existing entries under Core concepts.

**Verification:** Human review only — read the rendered subsection and confirm
against 1.2/1.3/1.4 above. No command covers wording or framing correctness.

---

## [x] Work Unit 2 — README: teardown in the two runnable samples (sequential, after Unit 1)

**Satisfies:** Requirement "Every runnable component example in the README
shows its own teardown", both scenarios.

**File:** `README.md`

- [x] 2.1. Apple Pay runnable sample, currently `README.md:656-688`: add
      `.unmount()` on the button handle inside the sample itself (not only in the
      prose sentence at line 690, which currently is the only place it appears).
      A reader who copies the code block as-is must end up with a call to
      `.unmount()` in what they pasted.

- [x] 2.2. Quick Start `card_fields` sample, currently `README.md:171-237` (the "1.
      Add containers for card fields" / "2. Initialize, mount, and pay"
      subsections): add `.unmount()` on the card-fields handle. This sample
      currently has zero `unmount()` calls.

- [x] 2.3. Add a one-line cross-link from each of these two samples to the new
      `Component lifecycle` subsection from Work Unit 1, so a reader who wants the
      "why" doesn't have to search for it.

- [x] 2.4. Line numbers above are from the pre-change README and will shift once
      Work Unit 1 lands. Locate the samples by heading text (`### Apple Pay`,
      `### 1. Add containers for card fields` / `### 2. Initialize, mount, and
pay`), not by the stated line numbers, once Unit 1 is committed.

**Verification:** Human review — for each sample, confirm copy-pasting the
fenced code block alone produces code that calls `.unmount()`. No command
covers this; it is a reading exercise, not a lint rule.

---

## [x] Work Unit 3 — README: restore the `unmount_context` JSDoc (sequential, can follow Unit 2)

**Satisfies:** proposal scope item (README section 4.1); supports the same
"lifecycle section states when unmount is required" spirit but is not itself
one of the 7 spec requirements — call this out explicitly to the reviewer
rather than mis-citing a requirement it doesn't satisfy.

**File:** `README.md`, `### tonder.create('card_fields', options?)` /
`unmount_context` field, currently around `README.md:805`.

- [x] 3.1. Restore the explanatory JSDoc from `src/types/card.ts:111-115` next to
      the `unmount_context?: 'all' | 'none' | 'current' | 'create' | string;`
      signature. Source text to adapt into README prose:

> Which previously-mounted context(s) to unmount before mounting. Defaults to
> `'all'`. Use `'none'` to keep existing contexts, `'current'` to replace
> only the context being mounted, or a specific context key.

- [x] 3.2. This is a small, explicit addition — the spec dropped it for budget, the
      proposal keeps it in scope (proposal section 4, item 1, bullet 4). Do the
      minimum: one to three lines of prose next to the existing type block. Do not
      expand it into a new subsection.

**Verification:** Human review — confirm the `'all'` default and the meaning
of each of the four values (`'all'`, `'none'`, `'current'`, a specific key)
are stated, not just the bare union type.

---

## [x] Work Unit 4 — README: one-line consequence + cross-link on the two `unmount()` API entries (sequential, can follow Unit 3)

**Satisfies:** Requirement "The lifecycle section states when unmount() is
required and the specific cost of skipping it" (reinforcement at point of
use, not the sole place the requirement is met — Work Unit 1 carries the
primary statement).

**File:** `README.md`

- [x] 4.1. `### apple_pay_button.unmount()`, currently `README.md:908`: add one
      line stating the consequence of skipping the call (stale-charge risk, same
      severity as Work Unit 1.3 — do not restate a softer version) and a cross-link
      to the `Component lifecycle` subsection.

- [x] 4.2. `### card_fields.unmount()`, currently `README.md:938`: add one line and
      a cross-link to the same subsection.

- [x] 4.3. Keep each addition to one line plus a link, per the proposal's explicit
      "cross-links cost one line each" budget (Decision 2). This is not the place
      to re-explain the rule.

**Verification:** Human review — confirm one line + link at each location,
not a restatement of Work Unit 1.

---

## [x] Work Unit 5 — `spa-docs-demos`: `ApplePayDemo.tsx` decision (independent, can run in parallel with README units)

**Satisfies:** proposal Decision 5 / open question 3. Not tied to a spec
requirement — this file is not part of either document the spec governs, but
the proposal puts a decision on record here and it must not be silently
skipped.

**File:** `/Volumes/MacDev/Tonder/spa-docs-demos/src/components/organism/ApplePayDemo.tsx`

**Design decision carried over from the proposal (no design phase ran, so
this is the binding decision):** `buttonRef.current?.unmount()` at line 108
is redundant with the returned cleanup function at line 189, because React
always runs an effect's cleanup before re-firing that effect. It is harmless.
Proposal Decision 5 recommends **keep it, plus a one-line comment** explaining
it is defensive rather than load-bearing, because an unexplained redundant
line in a teaching artifact invites a reader to copy it as "necessary."

- [x] 5.1. Pick one of the two explicit options — do not leave the line unexplained:
  - **Recommended:** keep line 108, add a one-line comment directly above or
    beside it stating it is defensive/belt-and-braces, not load-bearing,
    because cleanup at line 189 already runs first on every re-fire.
  - **Alternative:** remove line 108 entirely, relying solely on the
    cleanup at line 189.

- [x] 5.2. Everything else in `ApplePayDemo.tsx` (lines 92-192, the `cancelled`-flag
      plus `buttonRef` pattern) is correct per the executed repro in engram
      observation #4082 (`repro-demo-pattern.test.ts`, StrictMode double-invoke,
      zero leaks). Do not rewrite or restructure it. This is an explicit
      out-of-scope boundary, not an oversight — do not "improve" the rest of the
      file while touching line 108.

- [x] 5.3. This repo (`spa-docs-demos`) is separate from `tonder-js`. Confirm which
      repo/branch you are committing into before making the change — do not conflate
      it with the `tonder-js` commits in the other work units.

**Verification:** Human review — confirm exactly one line changed (108, plus
its comment) or removed, and no other line in the file differs from the
current committed version.

---

## [x] Work Unit 6 — README + internal guide: retraction/unverified-claim check (sequential, after Units 1-4)

**Satisfies:** Requirement "Neither document states the retracted freeze
claim or the unverified single-session constraint", both scenarios.

**Files:** `README.md`, `docs/internal_onboarding_notion.md`

- [x] 6.1. Search both documents for any phrasing implying skipping `unmount()`
      freezes a page or its UI. This claim was investigated with 8 executed repros
      against the real adapters and retracted (engram observation #4082) — it must
      not appear, not even hedged. Recommended check: `rg -i "freeze|frozen|hang"
README.md docs/internal_onboarding_notion.md`, then read every hit in context
      — the grep only finds candidates, it does not judge correctness.

- [x] 6.2. Search both documents for any statement that a browser allows only one
      active `ApplePaySession` at a time, hedged or not. This is UNVERIFIED per the
      proposal (untestable in jsdom, no real Safari device available) and must not
      appear in either document under any phrasing. Recommended check: `rg -i
"one active|single session|only one.*session" README.md
docs/internal_onboarding_notion.md`, then read every hit.

- [x] 6.3. This is the one task in this file with a hard pass/fail gate before
      commit: if either claim is found anywhere in either document (including
      content added in Work Units 1-4 and 7-11), it must be removed or rewritten
      before this work unit is considered done.

**Verification:** The `rg` commands above are a starting net, not proof of
absence — a paraphrase that avoids the exact search terms would slip through
grep. The actual verification is a human re-reading the full lifecycle
content added in this change, checking it against both banned claims
sentence by sentence.

---

## [x] Work Unit 7 — internal guide: Apple Pay flow, diagram, concepts, demos (independent, can run in parallel with README units)

**Satisfies:** Requirement "The internal guide documents Apple Pay's flow,
diagram branch, concepts, and demo coverage".

**File:** `docs/internal_onboarding_notion.md`

- [x] 7.1. `## Supported flows` (line 97): add `### 6. Apple Pay` after the
      existing `### 5. SafetyPay banks` (starts line 153), in the same numbered
      high-level-steps prose style as flows 1-5. Describe the mental model only:
      the SDK owns the button and the click, there is no `pay()` call for this
      flow, the result arrives via `events.payment`. No signatures, no options
      tables — per Requirement "points to README content by durable link, never by
      restating it" (Work Unit 9 governs the link mechanics; this task just must
      not violate it while writing the flow).

- [x] 7.2. `## Core mental model` mermaid diagram (lines 65-80): add an Apple Pay
      branch off the `D{Payment flow}` decision node (line 69) into the existing
      `H[Direct API /process]` node, following the existing edge style (e.g. a new
      node `M[Apple Pay]` with `D --> M` and `M --> H`). One node, two edges — do
      not restructure the existing diagram.

- [x] 7.3. `## Main public concepts` table (line 82, rows start line 86): add two
      rows, `isApplePayAvailable()` and `apple_pay_button`, in the same "one-line
      meaning plus a link" format as the existing rows. Link format is governed by
      Work Unit 9 — use the GitHub `main`-branch absolute link there, not a bare
      `README.md → section` reference.

- [x] 7.4. `## Demos` table (line 202, rows start line 208): add an Apple Pay row
      in the same "what it validates" format as the existing five rows.

**Verification:** Human review — confirm all four locations (flow list,
diagram, concepts table, demos table) contain an Apple Pay entry, per the
spec scenario "Apple Pay is findable in the flow list, diagram, concepts
table, and demos table".

---

## [x] Work Unit 8 — internal guide: Support ownership `validate-merchant` row (independent, can run in parallel with README units)

**Satisfies:** Requirement "The internal guide routes an
unregistered-merchant-domain support case".

**File:** `docs/internal_onboarding_notion.md`, `## Support ownership model`
table, currently lines 216-224.

- [x] 8.1. Add one row to the table routing an Apple Pay `validate-merchant`
      failure caused by an unregistered merchant domain. Per the proposal: first
      owner **Integrations**, escalate when the domain is confirmed registered with
      Apple and validation still fails. Match the existing table's column format
      (`Issue type | First owner | Escalate when`).

- [x] 8.2. This is called out in the proposal as the single highest-value addition
      in this entire change — the most common production Apple Pay failure will
      not be an SDK bug, and without this row it defaults to landing on the SDK
      team. Do not skip or defer this task.

**Verification:** Human review — confirm a Support engineer with only this
table open can name the first owner and the escalation condition for a
`validate-merchant` failure, per the spec scenario.

---

## [x] Work Unit 9 — internal guide: replace `README.md → section` refs with GitHub `main` links (independent, can run in parallel with README units, but should run after Unit 7 so new refs are also link-shaped)

**Satisfies:** Requirement "The internal guide points to README content by
durable link, never by restating it", both scenarios.

**File:** `docs/internal_onboarding_notion.md`

- [x] 9.1. Replace every existing `README.md → <section>` reference (the `Main
public concepts` table, line 82-95, has ten of these) with an absolute link
      of the shape:

```
https://github.com/tonderio/web-sdk/blob/main/README.md#<anchor>
```

using `main`, never a tag or commit SHA, per the proposal's explicit
rationale (a pinned ref rots into describing an old SDK; `main` always
matches what the merchant is installing — the tradeoff, an anchor breaking on
heading rename, is accepted and covered by Work Unit 11).

- [x] 9.2. Any Apple Pay reference added in Work Unit 7 that needs to point at a
      README signature, options table, or runnable example must use this same link
      format from the start, not a bare reference that gets fixed later.

- [x] 9.3. Confirm the anchor slugs actually resolve to the current README heading
      text (GitHub's auto-generated anchor = lowercased heading, spaces to hyphens,
      punctuation stripped) — do not guess an anchor without checking against the
      real heading.

- [x] 9.4. The internal guide must carry only mental model, flow narrative, and
      ownership routing. If any existing or newly-added paragraph in this file
      contains a signature, an options table, or runnable code that also exists in
      the README, that content belongs in the README, not here — flag and remove
      duplication if found while doing this pass.

**Verification:** Human review — click or otherwise confirm each replaced
link resolves against the current default-branch README. This is a docs-only
change to an untracked file (see Work Unit 10's note on `docs/` being
gitignored); "click and confirm" is a manual step, not a CI-covered one.

---

## [x] Work Unit 10 — internal guide: lifecycle cross-link in the Apple Pay flow (sequential, after Unit 1 exists so the anchor is real; can combine with Unit 7/9)

**Satisfies:** Requirement "The internal guide points to README content by
durable link, never by restating it" — specifically the "no internal-guide
paragraph reproduces README-owned content" scenario, applied to lifecycle.

**File:** `docs/internal_onboarding_notion.md`, inside the new `### 6. Apple
Pay` flow from Work Unit 7.1.

- [x] 10.1. Add one or two sentences noting that SPA merchants must unmount the
      Apple Pay button when navigating away, linking to the README's `Component
lifecycle` subsection (Work Unit 1) using the GitHub `main` link format from
      Work Unit 9 — do not restate the stale-charge consequence or the
      navigation-conditional rule here. That content lives in the README once, per
      Decision 2 in the proposal ("do not duplicate the README").

**Verification:** Human review — confirm the sentence links out rather than
re-explains, and confirm the link target (the README anchor for `Component
lifecycle`) actually exists once Work Unit 1 has landed.

---

## [x] Work Unit 11 — internal guide: maintenance rule step 4 (independent, small, can combine with Unit 9)

**File:** `docs/internal_onboarding_notion.md`, `## Maintenance rule` section,
currently lines 226-234 (three numbered steps under "When the SDK changes:").

- [x] 11.1. Add a fourth step: verify GitHub anchor links against the current
      README heading text whenever a README heading is renamed. This is the stated
      mitigation for the anchor-breakage risk accepted in Work Unit 9.

**Verification:** Human review — confirm the fourth step exists and names
anchor verification specifically, not a generic "keep docs in sync" line.

---

## [x] Work Unit 12 — `docs/internal_onboarding_notion.md` is gitignored: handle the delivery gap explicitly (belongs to Units 7-11, called out separately because it changes what "done" means)

**This is not a new edit task — it is a constraint on how Work Units 7-11 are
delivered and verified.**

- [x] 12.1. `docs/` is listed in `.gitignore` (`.gitignore:17:docs/`), confirmed via
      `git ls-files docs/` returning empty and `git check-ignore -v
docs/internal_onboarding_notion.md` reporting the match. Every edit made in
      Work Units 7-11 to this file **produces no commit and no diff** in this repo.
      Do not write a commit message claiming to have committed internal-guide
      changes — there is nothing to commit.

- [x] 12.2. Group all of Work Units 7-11 as one local edit pass on this file. It is
      not a git work unit and has no commit boundary; treat it as its own
      deliverable that happens to not go through git.

- [x] 12.3. Verification for this file cannot be "inspect the diff" — there is no
      diff. Verification is a human opening the file locally and reading it against
      Work Units 7-11's acceptance criteria one by one.

- [x] 12.4. When the file is ready (all of Work Units 7-11 done, Work Unit 6's
      banned-claims check passed on this file too), tell the user directly: the
      file at `docs/internal_onboarding_notion.md` is ready to copy into Notion —
      this is the actual delivery mechanism for this document, per the user's
      stated workflow. Do not treat a git commit as the completion signal for this
      file; it will never produce one.

---

## [x] Work Unit 13 — record the deferred `tryMountElement` defect (independent, small)

**Satisfies:** proposal Decision 3 / "success looks like" item "The deferred
`tryMountElement` defect is on record with a location and a reason, not
lost." Not one of the 7 spec requirements, but an explicit proposal
deliverable — call this out to the reviewer rather than mis-citing a spec
requirement for it.

- [x] 13.1. This is explicitly OUT OF SCOPE to fix. `tryMountElement` at
      `src/adapters/skyflow/skyflow.adapter.ts:696-714` makes three mount attempts
      (`MOUNT_RETRIES = 2`, `attempt <= MOUNT_RETRIES`) roughly 60ms apart and fails
      silently with only a `console.warn` — no throw, no observable event. Do not
      touch this code in this change.

- [x] 13.2. Record it durably as a forward-looking finding. If this project tracks
      follow-up work in a backlog/ticket system, file it there with: file/line
      (`src/adapters/skyflow/skyflow.adapter.ts:696-714`), the constants
      (`MOUNT_RETRIES = 2`, `MOUNT_RETRY_DELAY_MS = 30`), and the failure mode
      (silent `console.warn`, no throw). If no backlog system is in use for this
      project, save it to engram as its own observation (not folded into this
      tasks artifact, so it survives independently of this change's lifecycle) with
      title referencing "tryMountElement retry race" and type `discovery` or a
      follow-up-tracking type, `project: "web-sdk"`.

- [x] 13.3. Do not let this task be satisfied by the proposal's own Decision 3
      paragraph alone — the proposal already records it in prose; this task's job
      is to make sure it is _also_ durably reachable outside this one document
      (a ticket, or a standalone engram observation), so it is not lost if this
      SDD change is archived.

**Verification:** Human confirmation that a ticket exists or a standalone
engram observation was saved, independent of this tasks.md file.

---

## [x] Work Unit 14 — verification pass (sequential, last)

**Satisfies:** none directly — this is the gate that confirms Work Units 1-13
did not break anything, and confirms the spec's 7 requirements and 12
scenarios are met.

- [x] 14.1. Run `npm run test`. Must stay green. This change does not touch `src/`
      except by reading it for accuracy, so no test file changes are expected; if
      any test fails, investigate before proceeding — do not assume it is
      unrelated.

- [x] 14.2. Run `npm run typecheck`. Must stay green, for the same reason as 14.1.

- [x] 14.3. Run `npm run build`. Must stay green. This matters specifically because
      `postbuild` runs `scripts/check-dist-vocabulary.mjs`, which fails the build on
      `payflow`, `zplit`, `usrv-`, `ionic-lite`, `COMPOSITION SEAM`, `INTERNAL` as a
      tag, `/\bDD\d+\b/`, `/\bD\d+\b/`, `/phase \d+/i`, and `/\bDEV-\d+\b/` — but
      only inside non-test `src/**/*.ts` comments. It does not scan `README.md` or
      `docs/`. This change should not add any of those terms to `src/` comments,
      but run the build anyway; do not assume README/docs edits are exempt from
      needing a green build, since `postbuild` runs unconditionally on `npm run
build`.

- [x] 14.4. Run the project's lint command. The current baseline is 2 errors, 0
      warnings, both already in test files. That baseline must be unchanged by
      this docs change — no new errors, no new warnings, and the existing 2 must
      still be the same 2 (in the same test files), not replaced by different
      ones.

- [x] 14.5. Confirm every code sample added or edited in `README.md` (Work Units
      1, 2, 3, 4) is syntactically valid TypeScript/JavaScript as written — read
      each fenced block and check it would actually run if extracted, since README
      samples are not run by any test in this repo. This is a human read, not a
      command; there is no README-sample-extraction test in this project as of
      this change.

- [x] 14.6. Re-run the Work Unit 6 banned-claims check (6.1/6.2) as a final pass
      across the full diff, not just the units that primarily added lifecycle
      content — Work Units 7-11 also touch Apple Pay narrative and are equally
      capable of accidentally introducing either banned claim.

- [x] 14.7. Confirm net README line growth is reasonable. `README.md` is 1,672
      lines before this change; every addition must earn its lines per the
      proposal's explicit risk ("A README that grows without bound stops being
      read"). Report the before/after line count and the delta as part of this
      verification pass — this is an observation to make growth visible, not a
      hard numeric limit to enforce.

**Verification:** This entire work unit IS the verification. State plainly in
the completion report which checks are commands (14.1-14.4) and which are
human reads (14.5-14.7, and everything in Work Units 1-13 marked "human
review only") — do not imply a command covered something a human actually
read.

---

## Ordering summary

| Order | Work Unit                                      | Depends on                                    |
| ----- | ---------------------------------------------- | --------------------------------------------- |
| 1     | 1 — README lifecycle section                   | none                                          |
| 2     | 2 — README teardown in two samples             | 1                                             |
| 3     | 3 — README unmount_context JSDoc               | 2 (can reorder with 4, not with 1)            |
| 4     | 4 — README unmount() entries cross-link        | 3                                             |
| —     | 5 — ApplePayDemo.tsx line 108 decision         | none (parallel, different repo)               |
| —     | 7 — internal guide flow/diagram/concepts/demos | none (parallel)                               |
| —     | 8 — internal guide validate-merchant row       | none (parallel)                               |
| 5     | 9 — internal guide GitHub main links           | after 7 (so new refs are link-shaped too)     |
| 6     | 10 — internal guide lifecycle cross-link       | after 1 (needs real anchor) and 7             |
| —     | 11 — internal guide maintenance rule step 4    | none (parallel, pairs with 9)                 |
| —     | 12 — gitignore handling for docs/              | governs delivery of 7-11, not a separate edit |
| —     | 13 — record tryMountElement defect             | none (parallel)                               |
| 7     | 6 — banned-claims check                        | after 1-4 and 7-11 have content to check      |
| 8     | 14 — verification pass                         | after everything else                         |

Parallel-safe units: 5, 7, 8, 11, 13 have no dependency on each other or on
the README units and can be done in any order or concurrently. Everything
touching `docs/internal_onboarding_notion.md` (7, 8, 9, 10, 11) is one
uncommittable local edit pass per Work Unit 12 — parallelism there is about
authoring order, not about separate commits, since none of it produces a
commit.

---

## Commit boundaries (tonder-js repo only)

Per work-unit-commits: each commit is a deliverable unit, not a file-type
split. `docs/internal_onboarding_notion.md` changes (Units 7-11) produce no
commit at all (Unit 12) — they are not part of this commit sequence.
`ApplePayDemo.tsx` (Unit 5) is a different repository and is its own commit
there, not part of the `tonder-js` sequence below.

Suggested `tonder-js` commit sequence:

1. `docs(readme): add component lifecycle section` — Work Unit 1
2. `docs(readme): show unmount() in the two runnable samples` — Work Unit 2
3. `docs(readme): restore unmount_context default explanation` — Work Unit 3
4. `docs(readme): cross-link unmount() consequences from API reference` — Work Unit 4
5. `docs(readme): final banned-claims and vocabulary check` — Work Unit 6 as applied to README (may be folded into commit 4 if no fixes are needed, or its own commit if it requires edits)

`spa-docs-demos` repo, separate commit: Work Unit 5.

`docs/internal_onboarding_notion.md`: no commit, per Work Unit 12 — report
readiness to the user directly instead.

Engram or backlog entry for Work Unit 13: not a git commit.

---

## Review Workload Forecast

- **Estimated changed lines (tonder-js, git-visible only):** roughly 60-110
  added lines across `README.md` (new `Component lifecycle` subsection
  ~25-40 lines including the combined React example, 2 lines for teardown in
  the two samples, 3-5 lines for the `unmount_context` JSDoc restore, 2 lines
  for the two API cross-links, 1 line for the Contents entry). No lines
  removed except possibly whitespace. This is a rough range, not a measured
  diff — measure with `git diff --stat` after Work Unit 4 lands, per Work
  Unit 14.7.
- **`docs/` lines do not appear in any diff.** `docs/internal_onboarding_notion.md`
  is gitignored (`.gitignore:17:docs/`); all of Work Units 7-11's line
  additions (new flow section, mermaid node, two concept rows, one demo row,
  one ownership row, link replacements, one maintenance step — separately
  substantial, maybe 40-60 lines) are invisible to `git diff --stat` and must
  not be counted toward or against the tonder-js PR budget below.
- **400-line budget risk: Low.** The git-visible estimate (60-110 lines) sits
  well under 400 even before accounting for the docs/ lines being invisible
  to git. No chunking or size:exception is expected to be needed.
- **Chained PRs: Not applicable.** This change delivers by commits only, per
  the proposal header and this file's binding delivery constraint. There is
  no PR at all, chained or otherwise.
- **Decision needed before apply: No.** The proposal already resolved the one
  open design decision this file depends on (Work Unit 5, `ApplePayDemo.tsx`
  line 108 — keep plus comment, recommended). No blocking decision remains
  for `sdd-apply` to raise back to the user before starting.
