# Legibility increment — the prerequisite for team sync

Status: [decided 2026-09-02 — D67(2)]. This increment closes before any sync feature
starts. It adds infrastructure and documentation only. No item adds a user-facing
feature, changes `docs/BURRITO-SPEC.md` §8.1–8.6, or rewrites a stored byte. One step
touches the spec text: L-0 updates the two sentences that name the reference
implementation's path, in §8.9 (`docs/BURRITO-SPEC.md:512`) and in Appendix A
(`docs/BURRITO-SPEC.md:523`, `conformance/journal/*.mjs`) [VERIFIED — 089cc8a,
2026-09-03], and ships with the harness move in the same change set, per §9. No other step edits the
spec. Revised 2026-09-03 after four rounds of second-model review of PR #151.

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
  `docs/evidence/manifest.json` (commit, server version and hash, per-suite counts,
  durations, date). CI runs it and uploads the manifest. `validate-roundtrip.mjs` R7
  stops hard-coding 30. It runs the Phase-1 suite on the pristine sample first, parses
  the suite's own summary line for the Stage-1 count, and expects the same count on the
  server-touched copy. This follows the spec's rule that the suite's own summary line
  is the authoritative count (`docs/BURRITO-SPEC.md:7`).
- **L-2 The docs gate.** A check reads every statement in `docs/`, in the root
  `README.md` and in `conformance/README.md` that is marked as manifest-derived and
  fails when the value disagrees. `conformance/README.md` states 34 checks and Stage-1
  30 today while the spec header states 40 and 35 (`conformance/README.md:17-18`,
  `docs/BURRITO-SPEC.md:3` [VERIFIED — 089cc8a, 2026-09-03]); it is marked in L-2. Marker grammar, inline in
  Markdown:

  ```
  <!-- manifest:<json-path> -->VALUE<!-- /manifest -->
  ```

  `<json-path>` is a dotted path into `docs/evidence/manifest.json`, for example
  `suites.phase1.checks` or `server.version`. `VALUE` is the literal that the gate
  compares, as a string. Unmarked prose is not checked, so the gate starts small and
  grows as documents adopt the marker. The gate ships with `test/docsGate.test.ts` and
  two fixtures under `test/fixtures/docs-gate/`: `fresh.md`, whose marked values match
  a fixture manifest (the gate must pass), and `stale.md`, with one wrong value (the
  gate must fail and name the file, line and path). Verify: `npm run verify`. L-2 marks
  statements in `docs/PLATFORM-NOTES.md`, `docs/ARCHITECTURE.md`, `README.md` and
  `conformance/README.md`. It does not edit `docs/BURRITO-SPEC.md`. The spec header counts get their markers in the
  next change set that already changes the spec and the harness together (S1 at the
  latest), per §9.
- **L-3 One report shape.** `Report v1` and the refusal-code table in one module,
  `journal/report.mjs`, exporting `REPORT_SCHEMA` and `REFUSAL_CODES`
  (`TEAM-SYNC-PLAN.md` 1.2 and 1.3). L-3 also extends the normative gate with the
  negative-control convention of `TEAM-SYNC-PLAN.md` 1.3: every rule id and live code
  introduced after the extension needs exactly one `[negative …]` sibling check. Layer 4 store operations emit it. Every thrown
  refusal carries a code bound to a rule id. Codes bound to a rule that S1 will create
  are marked `[PROPOSED]` and are excluded from the gate until S1. Two cheap readers:
  the ops log and a dev-only Inspector panel. Tests assert codes, not strings.
- **L-4 Scenario files and one runner.** Promote `StepSpec` to a schema under
  `conformance/scenarios/`; a runner executes a file against the reference fold and the
  in-memory store. The first files are the J18–J20 steps rewritten as data. The
  receive-with-unsent scenario (`TEAM-SYNC-PLAN.md` X2) needs the sync engine and lands
  with X2, after this increment. The schema must already express its steps (`edit`,
  `send`, `integrate`, `receive`, `kill`, `open`) and its expectations, so that X2 adds
  a file and no schema change.
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
| L-0 | Move the reference modules to a root `journal/` package; update import paths; update the two spec sentences that name the path (`docs/BURRITO-SPEC.md:512` in §8.9 and `:523` in Appendix A); no logic change (D67(4e)) | the misnamed directory | all suites green; the diff holds file moves, import-path edits and the two path sentences only, no other hunk; `grep -n 'conformance/journal' docs/BURRITO-SPEC.md` returns nothing; `journalRuntime.test.ts` parity holds; the harness moves in the same change set, so §9 is met |
| L-1 | `npm run prove`, `docs/evidence/manifest.json`, CI upload, rig pristine check, R7 reads the Stage-1 count from the suite summary | eight commands; residue false-failures; the R7 constant | manifest committed from the CI run; `prove` on a clean clone passes and lists skips with reasons; R7 green on a reseeded rig, recorded |
| L-1b | Rig container for CI (the dev-env devcontainer follow-up) | the missing rig job | the rig job runs the rig-gated suites on `main` and on demand; never a pankosmia remote or token |
| L-2 | Docs gate with `test/docsGate.test.ts` and its two fixtures; mark recipe counts in PLATFORM-NOTES, ARCHITECTURE, the root README and `conformance/README.md`; correct ARCHITECTURE §9 "ports" wording | stale numbers; the "ports" sentence | `fresh.md` passes and `stale.md` fails in `npm run verify`; the gate runs in CI; `docs/BURRITO-SPEC.md` is not in the diff |
| L-3 | `Report v1`, refusal codes, ops log for layer 4, dev Inspector; tests assert codes; normative gate extended with the `[negative …]` claim rule | the unread fold report; string-matched failures | gate: every live code names a live rule and has exactly one `[negative <code>]` sibling; `[PROPOSED]` codes are listed and excluded; a fixture suite with a code and no sibling fails the gate |
| L-4 | Scenario schema and runner over the reference fold and memory store; J18–J20 as scenario files | hand-written probes | J18–J20 green as files with the same assertions as the suite; a schema fixture that contains every step kind X2 needs parses; `tc4 scenario` verb; an invalid-reference step (`TIT 99:1`) is refused by the schema |
| L-5 | `RepoPort`, git and HTTP adapters; J18–J20 and transport as one scenario set | two drifting suites | the same files green on git and rig runners; evidence record with version, hash, date |
| L-6 | `docs/SYSTEM.md` | orientation across eight surfaces | the orientation test (Section 4) meets its budget, recorded |
| L-7 | RISKS rows (scale, identity store, power loss, sync loss); #79 ticks | unrecorded risks | rows present; each names the check that mitigates it; `docs/LEGACY-IDS.md` is frozen (D44(b)) and is not edited |
| L-8 | Issue under #78: the history view may show two actor ids under one name (D67(4c)) | the two-names cost after a device change | issue filed with acceptance criteria and a Verify command |

L-0 to L-3 are independent of sync and can start now. L-4 and L-5 are the sync epic's
first two steps in disguise: no user-visible change, and the proof ends in the shape
the engine slots into. L-6 is last because its content is the outcome of L-1 to L-5.

## 4. Acceptance: the orientation test

`docs/SYSTEM.md` is the surface under test. The correct answers never come from it. They
come from executable sources: the manifest, the gates' own output, the file system, and
the code. An examiner (the project owner or a second agent session) computes the
correct answers with the commands in the table, before the test session starts, and
writes them into the record.

Procedure. A fresh agent session is given only `docs/SYSTEM.md` and the repository at
one commit. It answers the twelve questions below. Budget: one `npm run prove` run, at
most ten file reads, no subagents, no hand-written probes. The examiner counts tool
calls from the session transcript. The record is `docs/evidence/orientation-<date>.md`
in the same directory as the manifest, and holds: the commit hash, the correct answers
with the command that produced each, the session's answers, the tool-call count, and
one pass or fail per row.

| # | Question | Command that gives the correct answer |
|---|---|---|
| Q1 | Which suites exist, and what count did each report at this commit? | `jq .suites docs/evidence/manifest.json` |
| Q2 | Which of those suites need the rig, and did the rig run? | `jq '.suites[] \| select(.skipped)' docs/evidence/manifest.json` |
| Q3 | Which `R-8.x.y` ids are live, and which are `[PROPOSED]`? | `grep -o '\[R-8\.[0-9]*\.[0-9]*\]' docs/BURRITO-SPEC.md \| sort -u` lists every id; `node conformance/normative/check.mjs` exits 0 when every id is claimed by a live check (it prints counts, not ids); `grep -n 'PROPOSED' docs/BURRITO-SPEC.md` marks the proposed block |
| Q4 | Which refusal codes exist, and which rule does each enforce? | `node -e "import('./journal/report.mjs').then(m => console.table(m.REFUSAL_CODES))"` |
| Q5 | What does the app import from the reference modules, and from where? | `grep -rn "from '.*journal/" src/data/journal/` |
| Q6 | What happens to unsent own work at receive? | `tc4 scenario conformance/scenarios/receive-with-unsent.json` after X2; before X2, the answer is "not yet executable; the scenario is defined in TEAM-SYNC-PLAN X2" |
| Q7 | Which repositories exist on one device for one project, and which is canonical? | the repository table in `TEAM-SYNC-PLAN.md` Section 4 (a plan fact until S2; the `tc4 report` output after S2) |
| Q8 | Which operations write an ops record, and where is the record read? | `grep -rn "opsLog\." src/` |
| Q9 | Which scenario files exist, and which runners ran each? | `ls conformance/scenarios/`; `jq .scenarios docs/evidence/manifest.json` |
| Q10 | Is the working tree trustworthy after `pull-repo`? | `docs/PLATFORM-NOTES.md` #21 (a verified platform record; the answer is no) |
| Q11 | Which spec version and server version does this commit claim, and does the manifest agree? | `head -3 docs/BURRITO-SPEC.md`; `jq .server docs/evidence/manifest.json`; the docs gate result |
| Q12 | Which one command proves layer N, for each of the seven layers? | the `prove` verbose listing (`npm run prove -- --list`) |

The test passes when all twelve rows pass inside the budget. A failed row names the
surface that was wrong or missing in `SYSTEM.md`, and that surface is fixed and the
test rerun before the increment closes. The test is repeatable: the same commit, the
same questions, a new session.

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
