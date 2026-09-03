# Legibility increment — the prerequisite for team sync

Status: [decided 2026-09-02 — D67(2)]. This increment closes before any sync feature
starts. It adds infrastructure and documentation only. No item adds a user-facing
feature, changes `docs/BURRITO-SPEC.md` §8.1–8.6, or rewrites a stored byte. Revised
2026-09-03 after a second-model review of PR #151.

How to read this document: Section 1 states five problems, each with an observation and
its cause. Section 2 states one fix per problem. Section 3 is the sequence of change
sets, L-0 to L-8. Section 4 is the closing test. Section 5 is the CI shape. Section 6
is reversibility. Identifiers and evidence tags are as in `TEAM-SYNC-PLAN.md` Section 0.

## 1. The problem

The audit of 2026-09-01 [VERIFIED — worktree at 60be039] needed three subagents and
about forty probes to orient. The only trusted output was executed output. Five costs,
each traced to its cause. Each observation carries its own tag. Observations tagged at
9a9ac40 were re-read on 2026-09-03 in this branch and hold today. Observations tagged at
60be039 only were seen during the audit; the audit worktree is gone, and they are not
re-run.

### 1.1 Truth is spread over eight surfaces that agree only by discipline

Observed:

- ARCHITECTURE §9 says `foldEngine` and `reconcile` are "ports of the reference
  implementation"; the code imports the reference modules (`src/data/journal/runtime.ts`)
  [VERIFIED — `docs/ARCHITECTURE.md:190`, 9a9ac40, 2026-09-03].
- The verification recipe in PLATFORM-NOTES says expect 34/34 and 59/59
  (`docs/PLATFORM-NOTES.md:120`); the BURRITO-SPEC header says the suites run 40 and 339
  (`docs/BURRITO-SPEC.md:3`) [VERIFIED — 9a9ac40, 2026-09-03].
- `validate-roundtrip.mjs` R7 hard-codes Stage-1 = 30 (`conformance/validate-roundtrip.mjs:185-193`);
  the spec header says Stage-1 is 35 [VERIFIED — 9a9ac40, 2026-09-03]. R7 therefore
  fails on a live rig [VERIFIED — 60be039, 2026-09-01; not re-run].
- Issue #79 shows two criteria unticked that tests now cover [VERIFIED — 60be039,
  2026-09-01; not re-run].

Cause: numbers and status are typed into prose, and nothing compares prose to reality.
The authority contract says which document wins. It cannot say whether a document is
current.

### 1.2 Proof is eight commands with different gating

Observed: `validate`, `validate:journal`, `validate:normative`, `vitest`, rig-gated
vitest files, `validate:transport` with `RIG_REPOS`, `validate:roundtrip`, and the
bench [VERIFIED — `package.json` and `conformance/package.json`, 9a9ac40, 2026-09-03].
The round-trip suite gave three false failures on a rig that was not reseeded
[VERIFIED — 60be039, 2026-09-01; not re-run].

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
auto-merges into `lastOpenReport` (`src/data/journal/journalingStore.ts`). No other
module in `src/` reads it [VERIFIED — grep at 9a9ac40, 2026-09-03: the only file that
names `lastOpenReport` is `journalingStore.ts`]. Refusals surface as a Home banner
string.

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
  `evidence/manifest.json` (commit, server version and hash, per-suite counts,
  durations, date). CI runs it and uploads the manifest. `validate-roundtrip.mjs` R7
  stops hard-coding 30. It runs the Phase-1 suite on the pristine sample first, parses
  the suite's own summary line for the Stage-1 count, and expects the same count on the
  server-touched copy. This follows the spec's rule that the suite's own summary line
  is the authoritative count (`docs/BURRITO-SPEC.md:7`).
- **L-2 The docs gate.** A check reads every statement in `docs/` that is marked as
  manifest-derived and fails when the value disagrees. Marker grammar, inline in
  Markdown:

  ```
  <!-- manifest:<json-path> -->VALUE<!-- /manifest -->
  ```

  `<json-path>` is a dotted path into `evidence/manifest.json`, for example
  `suites.phase1.checks` or `server.version`. `VALUE` is the literal that the gate
  compares, as a string. Unmarked prose is not checked, so the gate starts small and
  grows as documents adopt the marker. Two controls land with the gate: a positive
  control (one marked statement that matches, and the gate passes) and a negative
  control (a pull request with one stale marked count, and CI fails). The spec header
  counts are marked, not edited. A correction to a count in the spec header is its own
  change set: it bumps the spec version and ships with the harness run that produced
  the count, per §9. L-2 itself changes no spec text.
- **L-3 One report shape.** `Report v1` and the refusal-code table in one module
  (`TEAM-SYNC-PLAN.md` 1.2 and 1.3). Layer 4 store operations emit it. Every thrown
  refusal carries a code bound to a rule id. Codes bound to a rule that S1 will create
  are marked `[PROPOSED]` and are excluded from the gate until S1. Two cheap readers:
  the ops log and a dev-only Inspector panel. Tests assert codes, not strings.
- **L-4 Scenario files and one runner.** Promote `StepSpec` to a schema under
  `conformance/scenarios/`; a runner executes a file against the reference fold and the
  in-memory store. The first files are the receive-with-unsent scenario defined in
  `TEAM-SYNC-PLAN.md` X2 and the J18–J20 steps rewritten as data.
- **L-5 The repository port.** Define `RepoPort`; extract the git adapter from J18–J20
  and the HTTP adapter from `validate-transport.mjs`; rewrite J18–J20 as scenario files
  that run over both adapters with identical assertions. This is a refactor of the
  proof, not a feature. It lands before any engine code.
- **L-6 `docs/SYSTEM.md`.** The tower, the report schema, the refusal codes, the
  repositories per device, the ports and adapters, the invariant ids I1–I9, and for each
  layer the one command that proves it. Counts and versions are manifest-derived (L-2
  markers).

## 3. The increment as change sets

Each step is one change set, cut from `main`, merged before the next, all suites green
before and after.

| Step | Change set | Removes | Evidence at merge |
|---|---|---|---|
| L-0 | Move the reference modules to a root `journal/` package; update import paths; no logic change (D67(4e)) | the misnamed directory | all suites green; the diff holds file moves and import-path edits only, no other hunk; `journalRuntime.test.ts` parity holds |
| L-1 | `npm run prove`, `evidence/manifest.json`, CI upload, rig pristine check, R7 reads the Stage-1 count from the suite summary | eight commands; residue false-failures; the R7 constant | manifest committed from the CI run; `prove` on a clean clone passes and lists skips with reasons; R7 green on a reseeded rig, recorded |
| L-1b | Rig container for CI (the dev-env devcontainer follow-up) | the missing rig job | the rig job runs the rig-gated suites on `main` and on demand; never a pankosmia remote or token |
| L-2 | Docs gate; mark recipe counts and spec header counts with the L-2 marker; correct ARCHITECTURE §9 "ports" wording | stale numbers; the "ports" sentence | positive control passes; a negative-control pull request fails CI; no spec text other than markers changes |
| L-3 | `Report v1`, refusal codes, ops log for layer 4, dev Inspector; tests assert codes | the unread fold report; string-matched failures | gate: every live code names a live rule and has a negative control; `[PROPOSED]` codes are listed and excluded |
| L-4 | Scenario schema and runner over the reference fold and memory store; first scenario files | hand-written probes | receive-with-unsent scenario and its negative control (X2 checks 1–7) plus J18–J20 as files, all green; `tc4 scenario` verb |
| L-5 | `RepoPort`, git and HTTP adapters; J18–J20 and transport as one scenario set | two drifting suites | the same files green on git and rig runners; evidence record with version, hash, date |
| L-6 | `docs/SYSTEM.md` | orientation across eight surfaces | the orientation test (Section 4) meets its budget, recorded |
| L-7 | RISKS rows (scale, identity store, power loss, sync loss); #79 ticks | unrecorded risks | rows present; each names the check that mitigates it; `docs/LEGACY-IDS.md` is frozen (D44(b)) and is not edited |
| L-8 | Issue under #78: the history view may show two actor ids under one name (D67(4c)) | the two-names cost after a device change | issue filed with acceptance criteria and a Verify command |

L-0 to L-3 are independent of sync and can start now. L-4 and L-5 are the sync epic's
first two steps in disguise: no user-visible change, and the proof ends in the shape
the engine slots into. L-6 is last because its content is the outcome of L-1 to L-5.

## 4. Acceptance: the orientation test

The increment closes when a fresh agent session, given only `docs/SYSTEM.md` and the
repository, answers the twelve questions below and fills the verdict table within the
budget. Budget: one `npm run prove` run, at most ten file reads, no subagents, no
hand-written probes. The session's tool-call count is recorded in
`docs/evidence/orientation-<date>.md` beside the manifest, with the verdict table and
the commit hash.

The questions. Each has one correct answer that `SYSTEM.md` plus the manifest must give.

| # | Question | Source of the correct answer |
|---|---|---|
| Q1 | Which suites exist, and what count did each report at this commit? | `evidence/manifest.json` |
| Q2 | Which of those suites need the rig, and did the rig run? | manifest `suites.*.skipped` and reasons |
| Q3 | Which `R-8.x.y` ids are live, and which are `[PROPOSED]`? | `SYSTEM.md` rule table; normative gate output |
| Q4 | Which refusal codes exist, and which rule does each enforce? | `SYSTEM.md` refusal table |
| Q5 | What does the app import from the reference modules, and from where? | `SYSTEM.md` tower; `journal/` package |
| Q6 | What happens to unsent own work at receive? | the receive-with-unsent scenario file and its `Report` |
| Q7 | Which repositories exist on one device for one project, and which is canonical? | `SYSTEM.md` repository table |
| Q8 | Which operations write an ops record, and where is the record read? | `SYSTEM.md` ops log section |
| Q9 | Which scenario files exist, and which runners ran each? | `conformance/scenarios/` and the manifest |
| Q10 | Is the working tree trustworthy after `pull-repo`? | `SYSTEM.md` platform constraints (PLATFORM-NOTES #21) |
| Q11 | Which spec version and server version does this commit claim, and does the manifest agree? | `SYSTEM.md` markers; manifest `server.*` |
| Q12 | Which one command proves layer N, for each of the seven layers? | `SYSTEM.md` tower, "proves it" column |

The verdict table has one row per question: the answer given, the source the session
read, and pass or fail against the correct answer. The test passes when all twelve rows
pass inside the budget. A failed row names the surface that was wrong or missing, and
that surface is fixed before the increment closes.

Secondary measures from the manifest: hand-typed counts remaining in `docs/` without an
L-2 marker (target zero); protocol assertions that exist in only one runner (target
zero).

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
