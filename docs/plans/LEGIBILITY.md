# Legibility increment — the prerequisite for team sync

Status: [decided 2026-09-02 — D67(2)]. This increment closes before any sync feature
starts. It adds infrastructure and documentation only. No item adds a user-facing
feature, changes `docs/BURRITO-SPEC.md` §8.1–8.6, or rewrites a stored byte.

## 1. The problem

The audit of 2026-09-01 [VERIFIED — worktree at 60be039] needed three subagents and
about forty probes to orient. The only trusted output was executed output. Five costs,
each traced to its cause:

### 1.1 Truth is spread over eight surfaces that agree only by discipline

Observed: ARCHITECTURE §9 says "ports"; the code imports. The verification recipe says
34/34 and 59/59; the suites run 40 and 339. `validate-roundtrip.mjs` R7 hard-codes 30
and fails on a live rig. Issue #79 shows two criteria unticked that tests now cover.

Cause: numbers and status are typed into prose, and nothing compares prose to reality.
The authority contract says which document wins. It cannot say whether a document is
current.

### 1.2 Proof is eight commands with different gating

Observed: `validate`, `validate:journal`, `validate:normative`, `vitest`, rig-gated
vitest files, `validate:transport` with `RIG_REPOS`, `validate:roundtrip`, and the
bench. The round-trip suite gave three false failures on a rig that was not reseeded.

Cause: each suite grew where it was needed; nothing composes them; rig state is
implicit.

### 1.3 Nothing can say what a receive would do

Observed: the question "what happens to unsent work at receive" had no answer in the
system. A 150-line probe was needed.

Cause: scenarios exist only as code inside two suites. The interleavings harness has a
step language (`StepSpec`), but it is private to one test file.

### 1.4 The fold describes state and conflict, and nobody reads it at runtime

Observed: `open()` computes forks, retained heads, pending structural events and
auto-merges into `lastOpenReport`. Nothing in `src/` reads it. Refusals surface as a
Home banner string.

Cause: the report was built for tests; the fork UI (#25) is Post-4.0; there was no
intermediate consumer.

### 1.5 The sync protocol is proven twice by hand

Observed: J18–J20 drive git by hand in `validate-journal.mjs`; `validate-transport.mjs`
drives HTTP by hand; both assert the same protocol; they were last recorded green on
different dates.

Cause: the fold was made environment-agnostic and imported; the protocol never was,
because it had no engine, only scenarios.

## 2. The fixes

- **L-1 `prove` and the manifest.** One root command runs every suite that applies,
  detects the rig, checks the rig is pristine before rig suites, and writes
  `evidence/manifest.json` (commit, server version and hash, per-suite counts,
  durations, date). CI runs it and uploads the manifest. `validate-roundtrip.mjs` R7
  reads its expected count from the Phase-1 summary instead of a constant.
- **L-2 The docs gate.** A check reads every statement in `docs/` that is marked as
  manifest-derived and fails when the value disagrees. Unmarked prose is not checked,
  so the gate starts small and grows as documents adopt the marker. Negative control: a
  stale count must fail CI.
- **L-3 One report shape.** `Report v1` and the refusal-code table in one module. Layer
  4 store operations emit it. Every thrown refusal carries a code bound to a rule id.
  Two cheap readers: the ops log and a dev-only Inspector panel. Tests assert codes,
  not strings.
- **L-4 Scenario files and one runner.** Promote `StepSpec` to a schema under
  `conformance/scenarios/`; a runner executes a file against the reference fold and the
  in-memory store; the audit probes become the first files.
- **L-5 The repository port.** Define `RepoPort`; extract the git adapter from J18–J20
  and the HTTP adapter from `validate-transport.mjs`; rewrite J18–J20 as scenario files
  that run over both adapters with identical assertions. This is a refactor of the
  proof, not a feature. It lands before any engine code.
- **L-6 `docs/SYSTEM.md`.** The tower, the report schema, the refusal codes, the
  repositories per device, the ports and adapters, and for each layer the one command
  that proves it. Counts and versions are manifest-derived.

## 3. The increment as change sets

Each step is one change set, cut from `main`, merged before the next, all suites green
before and after.

| Step | Change set | Removes | Evidence at merge |
|---|---|---|---|
| L-0 | Move the reference modules to a root `journal/` package; update imports; no logic change (D67(4e)) | the misnamed directory | all suites green; the diff shows moves only; `journalRuntime.test.ts` parity holds |
| L-1 | `npm run prove`, `evidence/manifest.json`, CI upload, rig pristine check, R7 fix | eight commands; residue false-failures; the R7 constant | manifest committed from the CI run; `prove` on a clean clone passes and lists skips with reasons |
| L-1b | Rig container for CI (the dev-env devcontainer follow-up) | the missing rig job | the rig job runs the rig-gated suites on `main` and on demand; never a pankosmia remote or token |
| L-2 | Docs gate; mark recipe counts, spec header counts; correct ARCHITECTURE §9 wording | stale numbers; the "ports" sentence | a negative-control PR fails CI |
| L-3 | `Report v1`, refusal codes, ops log for layer 4, dev Inspector; tests assert codes | the unread fold report; string-matched failures | gate: every code names a live rule and has a negative control |
| L-4 | Scenario schema and runner over the reference fold and memory store; audit probes as files | hand-written probes | six scenario files green; `tc4 scenario` verb |
| L-5 | `RepoPort`, git and HTTP adapters; J18–J20 and transport as one scenario set | two drifting suites | the same files green on git and rig runners; evidence record with version, hash, date |
| L-6 | `docs/SYSTEM.md` | orientation across eight surfaces | the orientation test (§4) meets its budget |
| L-7 | RISKS rows (scale, identity store, power loss, sync loss); LEGACY-IDS I4.3.x; #79 ticks | unrecorded risks | rows present; each cites its evidence |
| L-8 | Issue under #78: the history view may show two actor ids under one name (D67(4c)) | the two-names cost after a device change | issue filed with acceptance criteria |

L-0 to L-3 are independent of sync and can start now. L-4 and L-5 are the sync epic's
first two steps in disguise: no user-visible change, and the proof ends in the shape
the engine slots into. L-6 is last because its content is the outcome of L-1 to L-5.

## 4. Acceptance

The increment closes when a fresh agent session, given only `docs/SYSTEM.md` and the
repository, can answer the eleven audit scenarios and produce the same verdict table
within a budget: one `prove` run, at most ten reads, no subagents, no hand-written
probes. The tool-call count is recorded beside the manifest.

Secondary measures from the manifest: hand-typed counts remaining in `docs/` (target
zero); protocol assertions that exist in only one runner (target zero).

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
