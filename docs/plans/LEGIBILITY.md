# Legibility increment — the prerequisite for team sync

Status: [decided 2026-09-02 — D67(2)]. This increment closes before any sync feature
starts. It adds infrastructure and documentation only. No item adds a user-facing
feature, changes `docs/BURRITO-SPEC.md` §8.1–8.6, or rewrites a stored byte. One step
touches the spec text: L-0 updates the two sentences that locate the reference
implementation (`docs/BURRITO-SPEC.md:512` in §8.9 and `:523` in Appendix A
[VERIFIED — 6f1bafc, 2026-09-03]) and ships with the harness move, per §9. Reviewed by a
second model and consolidated 2026-09-03.

Identifiers and evidence tags are as in `TEAM-SYNC-PLAN.md` Section 0.

## 1. The problem

The audit of 2026-09-01 [VERIFIED — worktree at 60be039] needed three subagents and
about forty probes to orient. The only trusted output was executed output. Five costs,
each traced to its cause. Observations tagged 9a9ac40 or later were re-read in this
branch on 2026-09-03 and hold; observations tagged 60be039 only were seen during the
audit and are not re-run, because that worktree is gone.

### 1.1 Truth is spread over eight surfaces that agree only by discipline

Observed: ARCHITECTURE §9 says `foldEngine` and `reconcile` are "ports of the reference
implementation" while the code imports the reference modules
(`docs/ARCHITECTURE.md:190`, `src/data/journal/runtime.ts`); the verification recipe
says expect 34/34 and 59/59 (`docs/PLATFORM-NOTES.md:120`) while the spec header says
40 and 339 (`docs/BURRITO-SPEC.md:3`); `conformance/README.md:17-18` says 34 and
Stage-1 30; `validate-roundtrip.mjs` R7 hard-codes Stage-1 = 30
(`conformance/validate-roundtrip.mjs:185-193`) while the spec says 35 [all VERIFIED —
9a9ac40 or 089cc8a, 2026-09-03]. R7 therefore fails on a live rig, and issue #79 shows
two criteria unticked that tests now cover [VERIFIED — 60be039, 2026-09-01; not re-run].

Cause: numbers and status are typed into prose, and nothing compares prose to reality.
The authority contract says which document wins. It cannot say whether a document is
current.

### 1.2 Proof is eight commands with different gating

Observed: `validate`, `validate:journal`, `validate:normative`, `vitest`, rig-gated
vitest files, `validate:transport` with `RIG_REPOS`, `validate:roundtrip`, and the
bench [VERIFIED — `package.json`, `conformance/package.json`, 9a9ac40, 2026-09-03]. The
round-trip suite gave three false failures on a rig that was not reseeded [VERIFIED —
60be039, 2026-09-01; not re-run].

Cause: each suite grew where it was needed; nothing composes them; rig state is
implicit.

### 1.3 Nothing can say what a receive would do

Observed: the question "what happens to unsent work at receive" had no answer in the
system. A 150-line probe was needed [VERIFIED — 60be039, 2026-09-01; the probe was not
retained, see `TEAM-SYNC-PLAN.md` X2].

Cause: scenarios exist only as code inside two suites. The interleavings harness has a
step language, the `StepSpec` interface in `test/journalingInterleavings.test.ts:175`
[VERIFIED — 9a9ac40, 2026-09-03], but it is private to one test file.

### 1.4 The fold describes state and conflict, and nobody reads it at runtime

Observed: `open()` computes forks, retained heads, pending structural events and
auto-merges into `lastOpenReport`; no other module in `src/` reads it [VERIFIED — grep
at 9a9ac40, 2026-09-03: only `src/data/journal/journalingStore.ts` names it]. An open
failure surfaces as an error banner string on Home [VERIFIED — `src/state.jsx:1836-1845`,
f1c07ff, 2026-09-03].

Cause: the report was built for tests; the fork UI (#25) is Post-4.0; there was no
intermediate consumer.

### 1.5 The sync protocol is proven twice by hand

Observed: J18–J20 drive git by hand in `conformance/validate-journal.mjs`;
`conformance/validate-transport.mjs` drives HTTP by hand; both assert the same
protocol [VERIFIED — 9a9ac40, 2026-09-03]; they were last recorded green on different
dates [VERIFIED — 60be039, 2026-09-01].

Cause: the fold was made environment-agnostic and imported; the protocol never was,
because it had no engine, only scenarios.

## 2. The fixes

- **L-1 `prove` and the manifest.** One root command runs every suite that applies,
  detects the rig, checks the rig is pristine before rig suites, and writes
  `docs/evidence/manifest.json` (commit, server version and hash, and per suite: the
  command, whether it needs the rig, whether it ran, counts, duration). CI runs it and
  uploads the manifest. `validate-roundtrip.mjs` R7 stops hard-coding 30 and takes the
  Stage-1 count from the Phase-1 suite's own summary line, which the spec names as the
  authoritative count (`docs/BURRITO-SPEC.md:7`). The manifest's exact fields are
  decided in L-1.
- **L-2 The docs gate.** A check reads every statement in `docs/`, `README.md` and
  `conformance/README.md` that is marked as manifest-derived and fails when the value
  disagrees. Unmarked prose is not checked, so the gate starts small and grows as
  documents adopt the marker. L-2 corrects and marks the stale counts of 1.1. It does
  not edit `docs/BURRITO-SPEC.md`; the spec header's counts get their markers in the
  next change set that already changes the spec and the harness together, per §9. The
  marker grammar and the gate's own positive and negative controls are decided in L-2.
- **L-3 One report shape.** `Report` and the refusal-code table in one module
  (`TEAM-SYNC-PLAN.md` 1.2, 1.3). Layer 4 store operations emit it; `OpenReport`
  becomes a `Report`. Every thrown refusal carries a code bound to a rule id; codes
  whose rule S1 creates are marked and excluded from the gate until S1. Two cheap
  readers: the ops log and a dev-only Inspector panel. Tests assert codes, not strings.
  How negative controls are named and gated is decided in L-3.
- **L-4 Scenario files and one runner.** Promote `StepSpec` to a schema under
  `conformance/scenarios/`; a runner executes a file against the reference fold and the
  in-memory store; the first files are J18–J20 rewritten as data. The schema must
  already express the step kinds X2 needs, so that X2 adds a file and no schema change.
  The receive-with-unsent scenario itself needs the sync engine and lands with X2.
- **L-5 The repository port.** Define `RepoPort`; extract the git adapter from J18–J20
  and the HTTP adapter from `validate-transport.mjs`; rewrite J18–J20 as scenario files
  that run over both adapters with identical assertions. This is a refactor of the
  proof, not a feature. It lands before any engine code.
- **L-6 `docs/SYSTEM.md`.** The tower, the report schema, the refusal codes, the
  repositories per device, the ports and adapters, the invariant ids, and for each
  layer the one command that proves it. Counts and versions are manifest-derived.

## 3. The increment as change sets

Each step is one change set, cut from `main`, merged before the next, all suites green
before and after.

| Step | Change set | Removes | Evidence at merge |
|---|---|---|---|
| L-0 | Move the reference modules to a root `journal/` package; update import paths; update the two spec sentences that locate the path and `docs/ARCHITECTURE.md:190`; no logic change (D67(4e)) | the misnamed directory | all suites green; the diff holds moves, import-path edits and the three path sentences only; `grep -n 'conformance/journal' docs/BURRITO-SPEC.md docs/ARCHITECTURE.md` returns nothing; `journalRuntime.test.ts` parity holds |
| L-1 | `npm run prove`, `docs/evidence/manifest.json`, CI upload, rig pristine check, R7 reads the suite summary | eight commands; residue false-failures; the R7 constant | manifest committed from the CI run; `prove` on a clean clone passes and lists skips with reasons; R7 green on a reseeded rig, recorded |
| L-1b | Rig container for CI (the dev-env devcontainer follow-up) | the missing rig job | the rig job runs the rig-gated suites on `main` and on demand; never a pankosmia remote or token |
| L-2 | Docs gate; correct and mark the stale counts of 1.1; correct ARCHITECTURE §9 "ports" wording | stale numbers; the "ports" sentence | the gate's negative control fails and its positive control passes in `npm run verify`; `docs/BURRITO-SPEC.md` is not in the diff |
| L-3 | `Report`, refusal codes, ops log for layer 4, dev Inspector; tests assert codes | the unread fold report; string-matched failures | gate: every live code names a live rule; codes bound to S1 rules are listed and excluded |
| L-4 | Scenario schema and runner; J18–J20 as scenario files | hand-written probes | J18–J20 green as files with the same assertions as the suite; a fixture with every step kind X2 needs parses; `tc4 scenario` verb |
| L-5 | `RepoPort`, git and HTTP adapters; J18–J20 and transport as one scenario set | two drifting suites | the same files green on git and rig runners; evidence record with version, hash, date |
| L-6 | `docs/SYSTEM.md` | orientation across eight surfaces | the orientation test (Section 4) passes, recorded |
| L-7 | RISKS rows (scale, identity store, power loss, sync loss); #79 ticks | unrecorded risks | rows present; each names the check that mitigates it; `docs/LEGACY-IDS.md` is frozen (D44(b)) and not edited |
| L-8 | Issue under #78: the history view may show two actor ids under one name (D67(4c)) | the two-names cost after a device change | issue filed with acceptance criteria and a Verify command |

L-0 to L-3 are independent of sync and can start now. L-4 and L-5 are the sync epic's
first two steps in disguise: no user-visible change, and the proof ends in the shape
the engine slots into. L-6 is last because its content is the outcome of L-1 to L-5.

### 3.1 L-1 record: the manifest (decided in #154, 2026-09-04)

`npm run prove` (`scripts/prove.mjs`) writes `docs/evidence/manifest.json`. The copy in the
repository is taken from the PUSH-event CI run, never the pull_request-event run: that one
checks out a synthetic merge commit that is not in the branch history. Field names:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `tool` | `scripts/prove.mjs` |
| `commit`, `dirty` | the HEAD commit; `dirty` is true when the working tree had uncommitted changes other than the manifest |
| `date` | ISO 8601, when the run ended |
| `node`, `platform`, `ci` | the Node version, `<platform>-<arch>`, and whether `CI` was set |
| `rig.api`, `rig.detected`, `rig.version`, `rig.product` | the rig URL; whether `GET /version` answered; its `pkg_version` and `product_name` |
| `rig.rev`, `rig.revSource` | the pinned pankosmia-web revision, read from `dev-env/server/Cargo.toml` (the HTTP API reports no hash) |
| `rig.repos`, `rig.pristine`, `rig.extraRepos` | the repos directory used (`RIG_REPOS`); whether `_local_/_local_` holds only `sample_burrito`; the extra repos when it does not |
| `suites[]` | one entry per suite, in run order (see below) |
| `ok` | true when every suite that ran passed and no rig suite was refused |

Each `suites[]` entry: `id`, `layer` (`verify`, `unit`, `conformance`, `rig`, `bench`),
`command` (`<cwd>$ <argv>`), `needsRig`, `ran`, `skipped` (the reason, or null),
`ok`, `exitCode`, `passed`, `failed`, `skippedTests` (from the suite's own summary line;
null when the suite prints no counts), `summary` (the summary lines, verbatim),
`durationMs`.

Rules the command follows:

- A suite's own summary line is the authoritative count. `prove` reads it and never
  counts checks itself.
- A skip names its prerequisite. A rig suite is **refused**, and `prove` exits 1, when
  the rig answers but is not pristine; the refusal names the extra repos and the reseed
  commands. The rig suites themselves leave the rig non-pristine, so a reseed precedes
  every rig run.
- When the rig answers, the plain `vitest` suite excludes the `*.integration.test.ts`
  files: they run once, in `vitest:rig`, after the transport and round-trip suites, so
  the project they create and keep never precedes a state-sensitive suite. With no rig
  they self-skip and stay included.
- The rig suites do not run on Windows: the round-trip suite shells out to `zip`, `unzip`
  and `mv`. The skip names this.
- `bench:fold` runs only with `--bench` (about one minute); `--list` runs nothing.
- The Phase-1 summary line is also what round-trip R7 reads for its expected Stage-1
  count (evidence: `docs/evidence/roundtrip-r7-2026-09-04.md`).

### 3.2 L-2 record: the docs gate (decided in #155, 2026-09-04)

`npm run docs:gate` (`scripts/docs-gate.mjs`) reads every statement that is marked as
manifest-derived and compares it with `docs/evidence/manifest.json`. `npm run verify`
ends with the gate; CI runs it after `prove`, against the manifest that run wrote.

**The document set.** `docs/` (every `.md`, recursively), `README.md`, `CONTRIBUTING.md`
and `conformance/README.md`. `docs/BURRITO-SPEC.md` is scanned but carries no marker yet:
its header counts get their markers in the next change set that changes the spec and the
harness together (§9).

**The marker.** An HTML comment placed immediately before the value it vouches for.
GitHub renders the comment as nothing, so the reader sees only the value.

| Form | Meaning |
|---|---|
| `<!-- manifest: <suite-id> <field> -->VALUE` | a count of one `suites[]` entry; `<field>` is `passed`, `failed` or `skippedTests` |
| `<!-- manifest: <suite-id> summary[<prefix>] -->VALUE` | the `N passed` of the suite's own summary line that starts with `<prefix>` (`Stage-1`, `Stage-2`, `Phase-2`); the same line round-trip R7 reads |
| `<!-- manifest: <path> -->VALUE` | a top-level field, dotted (`commit`, `rig.rev`, `node`) |

`VALUE` is the first token after the comment. Markdown emphasis, backticks and brackets
before it are skipped, so `**809**`, `` `809` `` and `(809)` all read as `809`; a trailing
`.` or `-` at a sentence end is not part of the value. The comparison is exact against
the manifest value's string form. A marker inside a fenced code block or an inline code
span (as in this table) is an example, not a claim, and is not checked. Unmarked prose is
not checked.

**Mark only values that are the same in every clean-clone CI run at one commit**: the suite counts and
`rig.rev` (the pinned revision). Never `commit`, `date` or `node`. CI runs the gate
against the manifest its own run writes, so those fields are always the run's own, and a
document can never cite them correctly (CI run 33921706415 on 9949a34 showed this: three
`commit` markers stale by construction). A `[VERIFIED]` tag on a manifest-derived count
therefore names `docs/evidence/manifest.json` as its source and says that the file carries
the run's commit, date and Node version; the hash and date CONTRIBUTING rule 2 asks for
are in the cited file, not retyped.

**The findings.** One line each, naming the file, the line, the marker and both values:

| Kind | Condition |
|---|---|
| `stale` | the document's value and the manifest's value differ |
| `no-evidence` | the manifest holds `null` at the path (the suite was skipped; the skip reason is printed). A marked claim without evidence fails |
| `grammar` | the marker names an unknown suite, field or path, or no value follows it |

Exit 0 when every marked statement agrees; 1 on any finding; 2 when the manifest cannot
be read. `--manifest <path>` reads another manifest (the controls use it).

**The controls** (`test/docsGate.test.ts`, in the plain `vitest` suite, so in `verify`,
`prove` and CI). Positive: a marked statement that matches passes, on a fixture manifest
and on the real documents against the committed manifest. Negative: a stale value fails
and the finding names the file, the line and the marker path, on a fixture and through the
CLI against the real documents with one manifest count altered; a marker over a skipped
suite and a marker with no value also fail.

**A change set that changes a count.** Adding tests changes the `vitest` count; CI's
`prove` then writes a manifest that disagrees with the marked documents and the gate fails
in CI. That failure is the gate working. The change set completes by taking the manifest
from its own push-event CI run (3.1), committing it, and updating the marked statements
in the same PR. L-2 itself was the first case: the committed manifest (674c1bf) said 809;
CI on the L-2 branch said 828, because PR #165 had added 7 tests after that manifest was
recorded and L-2's controls added 12. The gate named the stale markers (CI run
33921454776, push event, 2066b73); the refreshed manifest and the corrected documents
landed in the next commits of PR #169.

**Two consequences of reading the manifest on disk.** (a) On a developer machine, `prove`
with a rig writes a manifest from a different surface (the plain `vitest` suite excludes
the integration files, so its count differs from the clean-clone count the documents
state). The gate then reports those differences and prints a note; restore the committed
manifest (`git checkout docs/evidence/manifest.json`) before `npm run verify`. (b) The
rig suites (`conformance:transport`, `conformance:roundtrip`, `vitest:rig`) are `null` in
the committed manifest, so their counts (10, 12, 41) stay unmarked prose until L-1b's
rig job records them; a marker over them today would fail as `no-evidence`. L-2 marked
the counts the manifest on `main` holds: `vitest` passed and skipped, `conformance:validate`
total and the three group lines, `conformance:journal`, `conformance:normative`.

## 4. Acceptance: the orientation test

`docs/SYSTEM.md` is the surface under test. A fresh agent session, given only
`docs/SYSTEM.md` and the repository at one commit, answers the twelve questions below
within a budget: one `npm run prove` run, at most ten file reads, no subagents, no
hand-written probes. An examiner establishes each correct answer beforehand from an
executable source (the manifest, a gate's output, a listing, the code), never from
`SYSTEM.md`, and records the commit, the correct answers with their sources, the
session's answers, its tool-call count, and one pass or fail per row in
`docs/evidence/orientation-<date>.md`. The test passes when every row passes inside the
budget. A failed row names the surface that was wrong or missing in `SYSTEM.md`; it is
fixed and the test rerun before the increment closes. The exact commands per question
are fixed in L-6, when the sources exist.

| # | Question |
|---|---|
| Q1 | Which suites exist, and what count did each report at this commit? |
| Q2 | Which of those suites need the rig, and did the rig run? |
| Q3 | Which `R-8.x.y` ids are live, and which are `[PROPOSED]`? |
| Q4 | Which refusal codes exist, and which rule does each enforce? |
| Q5 | What does the app import from the reference modules, and from where? |
| Q6 | What happens to unsent own work at receive? (Before X2: "receive is [PROPOSED]; no executable scenario exists.") |
| Q7 | Which repositories exist on one device for one project, and which is canonical? (Before S2: one, the working projection.) |
| Q8 | Which operations write an ops record, and where is the record read? |
| Q9 | Which scenario files exist, and which runners ran each? |
| Q10 | Is the working tree trustworthy after `pull-repo`? |
| Q11 | Which spec version and server version does this commit claim, and does the manifest agree? |
| Q12 | Which one command proves layer N, for each of the seven layers? |

Secondary measures from the manifest: hand-typed counts remaining without a marker
(target zero); protocol assertions that exist in only one runner (target zero).

## 5. CI

- `prove` replaces the separate unit and conformance jobs and uploads the manifest.
- The docs gate runs after `prove`.
- The normative gate is extended with the refusal-code and scenario-rule checks.
- The scenario runner (reference and git) runs on every pull request.
- The rig job runs on `main` merges and on demand until it is fast. Never a pankosmia
  remote or token. It seeds before it runs.
- Two rules: a gate must be able to fail (each new job lands with a negative-control run
  linked from the evidence record); CI writes only the manifest, never prose.

## 6. Reversibility

Every step is additive or a pure move. L-0 is the one large diff; it is mechanical and
protected by an existing parity test.
