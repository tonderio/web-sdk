# SDK Artifact Hygiene Specification

## Purpose

Declares what the SDK must not expose to merchant developers in any comment
they can reach, the triage rule for deciding what happens to a comment that
violates it, and the automated guard that keeps the property true. This spec
governs comment _content_, not runtime behavior — no requirement here
constrains what code does, only what a comment on that code may say.

## Requirements

### Requirement: The merchant-reachable surface excludes internal vocabulary

The merchant-reachable surface is defined by **reachability by a merchant
developer**, not by whether a file is a build artifact. A comment is on that
surface when a merchant can arrive at it through a channel the project
publishes or advertises. Two channels are in scope today, and the definition
MUST be read as extending to any future channel that meets the same test:

- **The published npm artifacts.** Every file listed in `package.json`'s
  `files`, plus anything referenced by `main`/`module`/`types`. A merchant's
  editor tooltip, bundler inspection, or `node_modules` read can show these
  to a human.
- **The public repository source.** The repository is public and the
  documentation portal links merchants directly to it, so a non-test source
  file is merchant-reachable even when nothing in it ships to npm.

No comment on that surface MUST carry internal-only vocabulary: an internal
project or predecessor-codebase name, an internal service or endpoint
identifier, a process/ticket reference (a sprint phase number, a ticket ID
pattern, a design-decision label whose document the reader does not have),
or an explicit internal-audience marker such as "INTERNAL".

Reachability is not the same as enforceability, and the two MUST NOT be
conflated. The published artifacts are machine-checkable, because the guard
scans concrete build output whose absence is itself a defect. The repository
source is checkable by the same function but under weaker guarantees: source
is scanned as it stands, its absence is not a build defect, and a channel
that becomes merchant-reachable in future is not automatically covered until
the guard's targets are extended to it. Where enforcement cannot follow
reachability, the gap MUST be recorded rather than closed by narrowing the
definition of the surface.

Two things are explicitly NOT boundaries that keep a comment off this
surface. A comment on a `private` class member is not exempt. The declaration
emitter used by this SDK's build ELIDES a private member's type — it emits
`private readonly env;` and `private pollTransactionUntilFinal;` with no shape
at all — but it PRESERVES the JSDoc attached to that member verbatim. So
`private` hides the type and publishes the prose, which is the opposite of the
intuition it invites. A comment in a file that ships to no artifact is not exempt
either, because the repository channel does not depend on the build.

#### Scenario: A published artifact carries no forbidden-vocabulary comment

- GIVEN a fresh `npm run build`
- WHEN each published artifact is scanned for the forbidden-vocabulary list
- THEN zero comment occurrences are found

#### Scenario: A source file that ships to no artifact is still in scope

- GIVEN a non-test source file whose contents reach no published artifact
- WHEN it is scanned for the forbidden-vocabulary list
- THEN zero comment occurrences are found, because the public repository is
  itself a merchant-reachable channel

#### Scenario: A comment on a private member still ships to dist/index.d.ts

- GIVEN a `private` class member carrying a JSDoc comment
- WHEN the SDK is built
- THEN that comment's text is present in `dist/index.d.ts`, regardless of
  the member's `private` modifier

### Requirement: Every internal-vocabulary comment is triaged by a fixed classifier

A comment flagged as carrying internal vocabulary MUST be resolved to
exactly one of three verdicts, decided by two rules applied in order:

1. **WHY-vs-WHAT rule**: a comment explaining WHY a non-obvious constraint
   exists is a KEEP/REWRITE candidate; a comment restating WHAT the
   following code already makes visible is a DELETE candidate.
2. **Merchant-audience test**: would a merchant developer who has never
   seen the internal system understand this comment, and does it help them
   use the SDK correctly?

| Verdict | Condition                                                                                  |
| ------- | ------------------------------------------------------------------------------------------ |
| KEEP    | Passes the WHY-vs-WHAT rule and passes the audience test (no forbidden vocabulary present) |
| REWRITE | Fails the audience test only — carries a load-bearing WHY that uses internal vocabulary    |
| DELETE  | Fails the WHY-vs-WHAT rule — restates code, or is pure process/ticket noise                |

REWRITE is the binding default for every comment that fails the audience
test while still passing the WHY-vs-WHAT rule: a load-bearing WHY MUST be
rewritten to keep its reasoning, never deleted merely because it also
happens to carry forbidden vocabulary. DELETE MUST be applied only when the
WHY-vs-WHAT rule alone already calls for deletion, independent of the
vocabulary.

#### Scenario: A load-bearing WHY comment is rewritten, not deleted

- GIVEN a comment that explains a non-obvious constraint (passes
  WHY-vs-WHAT) but names an internal system (fails the audience test)
- WHEN the comment is triaged
- THEN the verdict is REWRITE, and the resulting comment states the same
  constraint using no forbidden vocabulary

#### Scenario: A comment that restates code is deleted regardless of vocabulary

- GIVEN a comment that only restates what the following line of code
  already does
- WHEN the comment is triaged
- THEN the verdict is DELETE, independent of whether it also carries
  forbidden vocabulary

### Requirement: PROTECTED comments keep stating the constraint they encode

The comments below document a constraint whose silent loss would reintroduce
a defect that this repository's automated test suite cannot itself catch
(a Safari-only runtime rule, a user-gesture timing rule, or a type-checker
workaround). Any edit to these comments — REWRITE or otherwise — MUST leave
the stated constraint present in the result; only the vocabulary MAY change.

| Location                                                       | Constraint the comment MUST keep stating                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apple-pay-checkout.service.ts`, `start()`                     | `start()` is deliberately not `async`; wrapping it in `await` fails to type-check, and the resulting failure is invisible outside real Safari                                                                             |
| `tonder.ts`, constructor's Apple Pay parameter                 | that parameter is deliberately typed `unknown` to avoid a build-time type-checker conflict between the declaration-file emitter and the Apple Pay type definitions                                                        |
| `apple-pay.strategy.ts`, capability derivation                 | an absent debit/credit support flag means "do not filter by that card type", not "that card type is unsupported"                                                                                                          |
| `payment-method-catalog.ts`, method-code matching              | matching is done by prefix rather than an allow-list, because missing a new Apple Pay variant silently leaks a dead-end method to merchants, and a bare `apple_pay` code (no trailing qualifier) is deliberately excluded |
| `types/customization.ts`, button customization                 | no image, icon, or logo customization option exists, because Apple's platform guidelines forbid custom Apple Pay button artwork                                                                                           |
| `apple-pay.port.ts` / its browser adapter, merchant validation | the browser-supplied validation URL is deliberately never read, and no `await` occurs inside the user-gesture-triggered call                                                                                              |
| `tonder.ts`, availability check                                | the SDK's mount step deliberately does not call the standalone availability check, because mount needs to report which specific precondition failed, not just whether Apple Pay is available                              |

#### Scenario: Every PROTECTED constraint is still stated after cleanup

- GIVEN the PROTECTED locations above, with any edits that rewrite or remove
  vocabulary from their comments
- WHEN each location's current comment is read
- THEN each still states the specific constraint listed for it, in any
  wording

#### Scenario: A future edit to a PROTECTED location cannot silently drop its constraint

- GIVEN a future change touches the code or comment at one of the seven
  PROTECTED locations
- WHEN the resulting comment is checked against the table above
- THEN the constraint listed for that location is still present in the
  comment text, or the change explicitly documents its removal as an
  intentional behavior change, not a wording cleanup

### Requirement: A pure function identifies forbidden vocabulary inside comments

The SDK exposes a pure function, `findForbiddenVocabulary(source)`, that
scans a source string and reports every comment containing a term from the
forbidden-vocabulary list. It MUST default to block comments (`/* ... */`,
including JSDoc `/** ... */`) only, and MUST accept an optional flag that
additionally reports line comments. The default exists because build output
carries no leak-bearing line comment; the opt-in exists because `//` is
idiomatic in hand-written source, where a line comment is as reachable as a
block one.

The function MUST NOT report a match found outside a comment — in
particular, a forbidden term appearing inside a string literal (for example
a URL) or a template literal MUST NOT be reported, with or without the flag.
Beyond the source string it MUST take only options, and MUST perform no file
I/O, so it is testable against in-memory fixtures independent of any build
output.

The function MUST report every comment in its input, including comments
positioned after constructs whose tokenization depends on parser feedback.
A tokenizer that silently stops emitting comments partway through a file is
a defect, not a limitation: it makes the guard report zero for a dirty file,
which is indistinguishable from success. Any tokenization case the function
cannot handle MUST be documented at its definition.

#### Scenario: A forbidden term inside a JSDoc block comment is matched

- GIVEN a source string containing `/** uses the payflow gateway */`
- WHEN `findForbiddenVocabulary` runs on it
- THEN the match for `payflow` is reported

#### Scenario: A forbidden term inside a string literal is not matched

- GIVEN a source string containing the literal
  `payflow: 'https://payflow.tonder.io'`, with no block comment present
- WHEN `findForbiddenVocabulary` runs on it
- THEN no match is reported

#### Scenario: A forbidden term inside a line comment is not matched by default

- GIVEN a source string containing `// payflow legacy note` with no block
  comment present
- WHEN `findForbiddenVocabulary` runs on it with no options
- THEN no match is reported, consistent with the function's default
  block-comment-only scope

#### Scenario: A line comment is matched when the caller opts in

- GIVEN the same source string
- WHEN `findForbiddenVocabulary` runs on it with line comments enabled
- THEN the match for `payflow` is reported

#### Scenario: A comment after a substitution template is still reported

- GIVEN a source string in which a block comment carrying a forbidden term
  appears after a template literal containing a `${...}` substitution
- WHEN `findForbiddenVocabulary` runs on it
- THEN the match is reported, rather than being lost because tokenization
  desynchronised at the substitution

### Requirement: A build-time script enforces the guard on fresh build output

A script MUST run as part of the package's build pipeline (wired so it runs
automatically after every `npm run build`, before the package is ever
published or its end-to-end suite runs against built output) and MUST call
`findForbiddenVocabulary` against both merchant-reachable channels: the
published artifact targets, and the non-test source files of the public
repository. Test source files MUST be excluded, because no merchant reads
them as integration guidance.

The published targets MUST be derived from the package manifest rather than
hardcoded, so a newly published artifact is guarded without a second list to
forget. When a published target is missing, the script MUST exit non-zero
rather than silently skipping it — at that point in the pipeline its absence
means the build produced the wrong artifact set. The source channel carries
no equivalent requirement, since a source tree is not build output.

When a match is found in either channel, the script MUST exit non-zero and
MUST report, for each match, which file and which forbidden term triggered
it, so a contributor can locate and fix the offending comment without
re-deriving the scan. Its output MUST distinguish which channel a match came
from, because the remedy differs: an artifact match is fixed at the source
comment that produced it and never in the artifact.

#### Scenario: A clean build passes the guard

- GIVEN a build whose output contains no forbidden-vocabulary comment in any
  guarded target, and a source tree with none either
- WHEN the guard script runs
- THEN it exits zero

#### Scenario: A leak only in the repository source still fails the guard

- GIVEN a non-test source comment carrying a forbidden term, whose file
  reaches no published artifact, so every published target is clean
- WHEN the guard script runs
- THEN it exits non-zero and names the source file and term

#### Scenario: A reintroduced forbidden term fails the build

- GIVEN a source file is edited so a JSDoc block comment contains a
  forbidden term, and the package is rebuilt
- WHEN the guard script runs against the resulting build output
- THEN it exits non-zero and its output names the offending file and term

#### Scenario: A missing guarded target fails the build instead of passing silently

- GIVEN a guarded target file is absent from the build output
- WHEN the guard script runs
- THEN it exits non-zero rather than treating the absence as a pass

### Requirement: The forbidden-vocabulary list is validated against the tree whenever it changes

The forbidden-vocabulary list used by `findForbiddenVocabulary` MUST be
re-validated against the current source tree every time a term is added to
or removed from it, so the list never drifts into either noise or theatre:

- Adding a term MUST be checked against the current tree so it does not
  produce a match on a legitimate, non-leaking usage; if it would, the term
  MUST be scoped (for example, to a specific phrase rather than a bare word)
  until it does not.
- Removing a term MUST be checked so that no comment in the guarded targets
  still relies on that term being caught — a term is removed only once no
  live leak depends on it.

#### Scenario: Adding an overly broad term is caught before it lands

- GIVEN a candidate term that, if added to the list, would match a
  legitimate block comment already present in the tree
- WHEN the term is validated against the tree before the list change lands
- THEN the false-positive match is found and the term is scoped or rejected
  before the change is accepted

#### Scenario: Removing a term that still guards a live leak is caught before it lands

- GIVEN a candidate term whose removal is proposed
- WHEN the guarded target files are checked for a remaining comment that
  only the guard's forbidden-vocabulary list currently catches
- THEN the removal is rejected until no guarded target still needs that term
