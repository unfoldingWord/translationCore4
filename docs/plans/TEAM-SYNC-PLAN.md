# Team sync plan — epic #24

Status: [PROPOSED] plan, adopted as the shape of epic #24 by D67 (2026-09-02). Rules
named here become normative only when the S1 change set lands them in
`docs/BURRITO-SPEC.md` with their checks (§9). Written against `main` after the audit of
2026-09-01 [VERIFIED — worktree at 60be039, see D67]. Revised 2026-09-03 after six
rounds of second-model review of PR #151 (23, 18, 13, 12, 18 and 12 findings). Each
finding was either fixed or answered in the pull request.

Prerequisite: the legibility increment (`LEGIBILITY.md`) closes first (D67(2)).

## 0. How to read this document

- Section 1 describes the system as it is after the epic. Section 2 lists the invariants
  the epic must uphold. Section 3 lists the platform facts that constrain the design.
  Section 4 lists the repositories on one device. Section 5 lists the work items with
  acceptance criteria. Sections 6 to 8 give the journey, the epic acceptance, and the
  reversibility analysis.
- Identifiers. `L-n` are legibility steps (`LEGIBILITY.md`). `X-n` are foundation items
  of this epic. `S-n` are sync items. `I-n` are invariants (Section 2). `T-n` are checks
  in `conformance/validate-transport.mjs`. `J-n` are check groups in the journal suite
  (BURRITO-SPEC Appendix A). `R-8.x.y` are normative rule ids in BURRITO-SPEC §8.
- Evidence tags follow `CONTRIBUTING.md`: `[VERIFIED — source, version, hash, date]`,
  `[decided YYYY-MM-DD — Dn]`, `[PROPOSED]`. A claim without a tag is a plan statement,
  not a fact about the code.
- Decision parts are written `D67(4a)` and `D53(c)`, the same way the decision log
  writes them. The code comments write `D53c` for the same part (`identity.ts:15`).
- Every acceptance criterion names a check that can fail. "Recorded" means an evidence
  record exists in `docs/evidence/` with version, hash and date. It is not a pass. A
  measurement that is recorded without a threshold is marked "measurement, not
  acceptance".
- Evidence lives in `docs/evidence/`. The `prove` manifest is
  `docs/evidence/manifest.json`. There is no root `evidence/` directory.

## 1. The system

### 1.1 The tower

The system has seven layers. Each layer has six faces: a typed input and output, the
rules it guarantees (`R-` ids for format-facing rules; app rules without an id under the
D55 addendum, Section 2), a report in the shared vocabulary, one reference
implementation that the app imports, a harness with one negative control per rule
introduced from L-3 onward (older rules stay under the D55 residual, 1.3), and one
verb in the `tc4` command line.

| L | Layer | Atom or operation | Pure | Today | After this epic |
|---|---|---|---|---|---|
| 0 | Sealed segment | one action, checksum-sealed, immutable | yes | normative; reference imported | unchanged |
| 1 | Event set | union of segments, de-duplicated by `ts` | yes | normative | unchanged |
| 2 | Fold | `fold(set) → state + report` | yes | normative; reference imported | adds `explain(key)` |
| 3 | Projection | derived files from the fold | yes | normative; reference imported | unchanged |
| 4 | Store operations | publish, open, checkpoint, seed, reconcile | durable, intent-journaled | app only | emits the shared report; writes the ops log |
| 5 | Sync operations | send, integrate, receive over N repositories | durable, intent-journaled | [PROPOSED]; two hand-written suites | reference module over a repository port; the app imports it |
| 6 | Journeys | what a translator does | n/a | Playwright | scenarios as data; three runners |

Rule of the tower: a layer is implemented once, below the app, over a port. The app is
one adapter. Layers 0–3 obey this today (`src/data/journal/runtime.ts` imports the
reference fold). Layer 5 must obey it, or the protocol exists in three places.

### 1.2 One report vocabulary

Every operation reports in one closed schema, `Report v1`, defined in one module,
`journal/report.mjs` (root package after L-0; exports `REPORT_SCHEMA` and
`REFUSAL_CODES`), and validated by one check.

Today the fold returns `FoldOutput` (`src/data/journal/runtime.ts:38-65`). It holds fold
state and the fold's own findings: `forks`, `retained`, `autoMerged`, `invalid`,
`pendingStructural`, `supersedeRefused`. It has no `op`, `ts`, `actor`, `repo`, `inputs`,
`outcome`, `refusals` or `durations` [VERIFIED — 9a9ac40, 2026-09-03]. `Report v1` is a
new contract that wraps `FoldOutput`'s findings under `fold` and adds the operational
fields. `FoldOutput` itself does not change. The `retained[]` reason vocabulary is
already closed (R-8.6.9) and is reused as is.

```
Report {
  op:        open | publish | checkpoint | seed | reconcile | send | integrate | receive
             | verify | fold | explain | bench
  ts:        HLC ts of the operation (its identity)
  actor:     actorId
  repo:      repoPath
  inputs:    { name: { path, head?, count? } }     // every repository, branch, or set consumed
  outcome:   done | refused | partial | recovered
  refusals:  [{ code, rule, subject, action }]     // closed code vocabulary (1.3)
  fold:      { forks, retained, autoMerged, pendingStructural, invalid, supersedeRefused }
  carried:   { copied, identical, refused }        // receive only; see below
  upheld:    [ rule ids this run verified ]
  durations: { phase: ms }
}
```

`carried` (receive only) partitions the actor's own segments that existed in the
working repository or the outbox before the receive: `copied` are those absent from
the scratch union and written into it; `identical` are those already present in scratch
with the same bytes (they arrived through the actor's own publication); `refused` are
those that failed a check, with their code. I4 holds when `copied ∪ identical` covers
every own `ts` and `refused` is empty. `outcome` for a receive is `done`, `refused` or
`recovered`; a receive never reports `partial`.

The UI renders `Report`. The command line prints `Report`. Tests assert on fields, not
on message strings. Evidence records are arrays of `Report` with a header.

### 1.3 Refusal codes

A refusal is a code bound to a rule and one recovery action. The `rule` column names
the rule that the code enforces. A rule id marked "(S1)" does not exist yet. It is
created by the S1 change set (Section 5). Until S1 lands, the normative gate checks
only the codes whose rule is live today. Codes bound to an S1 rule are marked
`[PROPOSED]` in the module and are excluded from the gate. Tests written before S1
assert these codes by code name, never by a future rule id.

| code | rule | live today | recovery |
|---|---|---|---|
| `segment.invalid` | R-8.1.6 | yes | republish from the outbox (automatic) |
| `segment.differs-from-accepted` | R-8.1.5 | yes | stop; show both hashes; never overwrite |
| `segment.foreign-actor` | R-8.1.12 | yes | refuse the contribution; report the actor |
| `segment.misnamed` | R-8.1.2 | yes | refuse the contribution |
| `checkpoint.divergence` | R-8.7.5 | yes | reopen to reconcile |
| `seed.mismatch` | R-8.8.2 | yes | stop; show the mismatch set |
| `intake.shared-path` | R-8.7.9 (S1; I5) | no | refuse the contribution |
| `receive.own-ts-missing` | R-8.7.11 (S1; I4) | no | keep the working repository; report the missing `ts` |
| `receive.audio-missing` | R-8.7.13 (S1; I9) | no | keep the working repository; report the missing path |
| `swap.incomplete` | R-8.7.12 (S1; I6) | no | finish forward or roll back on open |

The normative gate checks that every code marked live names a live rule and has a
negative control. After S1, every row is live and the `[PROPOSED]` marks are removed.

Negative-control convention. Today the gate (`conformance/normative/check.mjs`) proves
only that each `R-` id is claimed by a live check named `[covers R-x]`; per-rule
mutation proof is an open D55 residual. From L-3 onward, a new check that claims a rule
or a code has a sibling check whose name carries `[negative R-x]` or
`[negative <code>]`. The sibling feeds one violating input and asserts the refusal by
code. L-3 extends the gate: every `R-` id and every live code introduced after the gate
extension must have exactly one `[negative …]` claim, or the gate fails. Rules that
predate the extension are not required to have one; that remains the D55 residual.

### 1.4 Every operation leaves a record

Each layer 4 and layer 5 operation writes one ops record (a `Report`) to the
installation store before its first side effect and rewrites it at each phase change
and once at the end, with the same durable barrier the outbox uses. For a receive the
record covers the whole operation, from scratch creation to the outbox clear; the swap
intent of D67(4a) is the record's `moved-prev` and `moved-scratch` phases, not a
separate record. Recovery on open reads the last incomplete record. The
ops log is device-local and never enters the burrito, so journal `v: 1` is untouched.

### 1.5 Scenarios are data

Scenario files under `conformance/scenarios/` describe actors, steps (`edit`, `send`,
`integrate`, `receive`, `kill`, `open`) and expectations in `Report` terms. The step
language starts from the `StepSpec` interface in
`test/journalingInterleavings.test.ts:175` [VERIFIED — 9a9ac40, 2026-09-03], promoted
to a schema (L-4). Three runners execute one file: reference (memory port), git
(filesystem port), rig (HTTP port). A new question is a new file, not a new harness.

### 1.6 Evidence accretes

`npm run prove` writes `docs/evidence/manifest.json`. A docs gate fails when a
manifest-derived statement in `docs/` disagrees with it (L-2). Each release freezes the
journey-written journals and their fold hashes under `conformance/golden/<version>/`;
one check folds every frozen corpus.

### 1.7 The driver's console

`tc4` is a Node command line over the HTTP adapter that imports the same modules as the
app: `open`, `send`, `receive`, `integrate`, `verify`, `report`, `ops`, `explain`,
`fold`, `scenario`, `prove`, `bench`. `explain <repo> <key>` answers why a verse shows
its text: live heads, bases, structural branch, supersedes, generation, retained
reasons, and the rule that decided each step. A dev-only Inspector panel in the app
renders the same `Report` and `explain` output.

## 2. Invariants

Two kinds. Format-facing invariants bind the stored bytes and the receive result. They
become `R-8.7.7` to `R-8.7.13` in S1 and get conformance checks. App-facing invariants
bind the application, not the stored format. Per the D55 addendum of 2026-08-18, an app
rule carries no `R-` id and is exempt from the coverage gate. It is marked
"(D53, app rule)" in place, and its test lands with the app increment that implements
it. This plan does not supersede that addendum.

### 2.1 Format-facing (become `R-8.7.x` in S1)

Seven invariants, seven ids. The mapping is fixed here so that S1 and the refusal-code
table (1.3) agree:

| Invariant | Rule id in S1 | Refusal code |
|---|---|---|
| I1 | R-8.7.7 | none (asserted by the S2 spy test) |
| I2 | R-8.7.8 | none (asserted by the S2 flush test) |
| I5 | R-8.7.9 | `intake.shared-path`; the four segment codes |
| I3 | R-8.7.10 | none (asserted by the S5 kill sweep) |
| I4 | R-8.7.11 | `receive.own-ts-missing` |
| I6 | R-8.7.12 | `swap.incomplete` |
| I9 | R-8.7.13 | `receive.audio-missing` |

- I1 Publication isolation. Every commit on the `<actorId>` branch touches only the
  actor's own `ingredients/checking/journal/<actor>/` and the `ingredients` table
  entries of `metadata.json` that describe those files (the table is server-owned and
  must list every file, §3 rule 5). No other path and no other metadata field changes.
  The branch is created on a `git/copy` of the working projection and starts with no
  commit of its own, so there is no creation exception (S2). The S2 spy test checks
  every commit on the branch.
- I2 Send without receive. A send never needs a receive first and never merges another
  actor's bytes into the working repository.
- I3 Receive is rebuild-and-swap. The working repository is never merged into.
- I4 No own byte is lost at receive. Every own segment in the working repository or the
  outbox before receive is in the replacement, byte-identical, or the whole receive
  refuses. One exception is defined: a segment that fails its checksum (R-8.1.6) and
  whose `ts` is in the outbox is replayed from the outbox, because the outbox is its
  durable source. Every other failed check on an own-directory file (misnamed,
  foreign actor, differs from accepted) refuses the whole receive; the working
  repository is untouched.
- I5 Zero trust everywhere, including the actor's own old copy: validator, filename rule
  (R-8.1.2), actor binding (R-8.1.12), accepted bytes (R-8.1.5).
- I6 Swap ordering. The outbox and the recovery copy are cleared only after the
  replacement is verified and is the live working repository.
- I9 Tolerated unjournaled ingredients survive receive. Every file under
  `ingredients/audio/` in the working repository before receive is in the replacement,
  byte-identical, or the receive refuses. This extends R-8.7.3 (checkpoint never touches
  audio) to the receive operation. Without it, rebuild-and-swap deletes audio.

### 2.2 App-facing (D53, app rule; no `R-` id)

- I7 Identity is preserved. The replacement lands at the same repository path, because
  the actor id derives from the path (D53(c); `src/data/journal/identity.ts:10-15`
  [VERIFIED — 9a9ac40, 2026-09-03]). Test obligation: S5 acceptance.
- I8 Forks are legible. After a receive, every fork, retained head and pending
  structural event is shown. The project stays open (D53(e)). Test obligation: S6
  acceptance.

## 3. Platform constraints

[VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30), the rig pin, read in
`upstream/pankosmia-web/src/endpoints/git2/` on 2026-09-03; upstream `main` re-read the
same day at 0.18.7 (c43c40d, 2026-08-11) in `upstream/pankosmia-web-main/`; the two
inventories agree on every endpoint named below]

- One merge endpoint, `POST /git/pull-repo/<remote>/<repo>`, no branch parameter
  (PLATFORM-NOTES #17, #33). One publication repository per actor with one branch makes
  it deterministic.
- After a normal merge the worktree is not trustworthy (PLATFORM-NOTES #21). The
  integrator writes the validated union by ingredient writes.
- `add-and-commit` panics on a repository with no commits (PLATFORM-NOTES #20).
- Move primitive: `POST /git/copy/<repo>?target_path=<path>&delete_src=true`. The
  handler copies the tree, then calls `remove_dir_all` on the source
  [VERIFIED — `src/endpoints/git2/copy_repo.rs:19-24,120-130` at 0.18.5 (99fd9be);
  unchanged at 0.18.7 (c43c40d, 2026-08-11)]. A crash between the copy and the delete
  leaves two copies. A swap needs two such moves; they are not atomic together
  (D67(4a)). The current transport suite uses a copy and a separate delete
  (`conformance/validate-transport.mjs:44-48`); S5 is the first use of `delete_src`.
- `POST /git/push` and `POST /git/clone-repo?branch=` exist; clone is https-only. Every
  remote call is behind the platform net gate.
- Repository paths are exactly three segments (`serverApi.assertRepoPath`,
  `src/data/serverApi.ts`).
- Zip import (`POST /burrito/zipped/<repo_path>`) requires a root `metadata.json` and an
  `ingredients/` directory in the zip, and a target under `_local_/_sideloaded_/`
  (ARCHITECTURE §3.1 endpoint table; PLATFORM-NOTES #22).

## 4. Repositories per device per project

BURRITO-SPEC §1 says: a tC4 project is one git repository; there are no companion
repos, no copies, and no export/import loop. This plan keeps one canonical project
repository per device, the working projection. The other four entries below are
installation-local implementation state: two are mirrors of the same project (the
actor's own publication branch and the team main branch), two are transient. None of
them is a second project. Because the publication repository is exchanged with other
devices (Door43 branch or zip), the §1 sentence must be amended to say so. That
amendment is part of the S1 change set and goes through §9 (spec and harness together).
Until S1, §1 stands as written and this table is [PROPOSED].

| Role | Path | Branch | Written by | Content |
|---|---|---|---|---|
| Working projection (canonical) | `_local_/_local_/<name>` | `main` | the app, every mutation | full Burrito: derived files, all journals, audio |
| Own publication | `_local_/_pub_/<name>` | `<actorId>` | send (S2) | a full copy of the working projection at creation; after that, only `ingredients/checking/journal/<actorId>/` and its ingredients-table entries change |
| Team main mirror | `_local_/_team_/<name>` | `main` | integrate (S4), receive (S5) | full Burrito: derived files and every accepted journal |
| Scratch (disposable) | `_local_/_scratch_/<name>-<hlc>` | any | S4, S5; deleted after use | a copy under construction |
| Previous working (recovery copy) | `_local_/_prev_/<name>` | `main` | S5 swap; deleted at the next checkpoint | the working projection before the swap |

The publication repository is the shape that J19 and transport T3 already prove and
that ARCHITECTURE §9 describes (`publicationStore`, "a persistent `actor-<actorId>`
repo/branch") [VERIFIED — `docs/ARCHITECTURE.md:190`, `conformance/validate-transport.mjs:207-210`,
f1c07ff, 2026-09-03]: a `git/copy` of the working projection, with a `<actorId>` branch
created on the copy. Nothing is deleted and no metadata field is edited, because no
HTTP route writes `metadata.json` (D28 addendum; `src/data/serverApi.ts:145`). The
copied derived files are a frozen snapshot: every later commit on the branch touches
only the own journal directory and the ingredients-table entries that
`remake-ingredients` adds for new segments (I1). Because the branch point is a copy of
main's ancestor state and only journal paths change after it, a merge of the branch
into scratch brings only journal paths; that is what T3 asserts today. The copy is a
structurally valid Scripture Burrito, so the zip import accepts it. Its derived files
do not track its own fold, so `verifyProjectAgainstJournal` does not apply to it
(Section 7); the S2 path whitelist is its check. The S1 amendment to BURRITO-SPEC §1
names it as a mirror of the project, not a second project.

## 5. Work items

### 5.0 Item map

Foundation items X0, X1, X3 and X6 are the legibility steps L-0, L-1, L-3 and L-6. They
are specified in `LEGIBILITY.md` and are not repeated here. This document keeps the X
numbering so that epic #24's checklist reads in one sequence.

| Item | Delivered by | Content |
|---|---|---|
| X0 | L-0 | reference modules move to root `journal/` (D67(4e)) |
| X1 | L-1 | `npm run prove` and `docs/evidence/manifest.json` |
| X2 | this epic | sync engine as a reference module |
| X3 | L-3 | `Report v1`, refusal codes, ops log for layer 4 |
| X4 | this epic | `tc4` command line and Inspector |
| X5 | this epic | ops log for layer 5 (sync) operations |
| X6 | L-6 | `docs/SYSTEM.md` |
| X7 | this epic | golden corpus accretion |
| S1–S9 | this epic | sync features |

Dependency order:

```
LEGIBILITY closes ─▶ X2 sync reference module ─▶ S1 ratify §8.7 (rules + scenarios)
                                                    ├─▶ S2 send adapter ─▶ S3 transports
                                                    ├─▶ S4 integrate adapter ─▶ S5 receive adapter
                                                    └─▶ S6 fork view (reads Report)
X4 CLI + Inspector    X5 ops log for sync    X7 golden corpus    S7 performance    S8 journey    S9 docs
```

Rule for items before S1 (X2, X4, X5): their tests assert invariants I1–I9 by name and
refusal codes by code name. They never cite an `R-8.7.7` to `R-8.7.13` id, because
those ids do not exist until S1. S1 rewrites the claims to `[covers R-8.7.n]` in the
same change set that creates the ids.

### X2 — Sync engine as a reference module

`journal/sync.mjs` exports `send(port, ctx)`, `integrate(port, ctx)`, `receive(port,
ctx)`: orchestrations over the repository port that return a `Report`. The app imports
the engine as it imports the fold.

The audit of 2026-09-01 wrote a standalone simulation, `receive-with-unsent.mjs`, that
ran 15 checks over real git repositories and reproduced the receive gap [VERIFIED —
executed 2026-09-01 at 60be039 by the audit session; the file was not retained when the
audit worktree was removed, so the run is not repeatable; recorded 2026-09-03]. X2
rebuilds it as a committed scenario file. The scenario is defined here so that it does
not depend on the lost file. Verse references use the sample project
`conformance/sample-burrito/`, whose scope is `TIT` and `JON`
(`conformance/sample-burrito/metadata.json:69-71`). `TIT` has three chapters of 16, 15
and 15 verses (`conformance/sample-burrito/ingredients/vrs.json:1242-1245`), and
`TIT.usfm` carries chapter 1 verses 1 to 5 and beyond
(`conformance/sample-burrito/ingredients/TIT.usfm:8-14`)
[VERIFIED — 7fb8681, 2026-09-03]. So `TIT 1:1` to `TIT 1:4` are valid inputs and
`TIT 99:1` is outside the versification.

`conformance/scenarios/receive-with-unsent.json`: actors A and B on one project seeded
from the sample. Steps: A edits TIT 1:2 and sends. B edits TIT 1:3, sends, integrates,
receives. A, offline, edits TIT 1:1, edits TIT 1:3 to a different text, and holds one
more edit (TIT 1:4) in the outbox with no segment written yet. A receives.
Expectations, in `Report` terms:

1. `outcome` is `done`.
2. `carried.copied ∪ carried.identical` covers every A segment `ts` that was in A's
   working repository before the receive, and `carried.refused` is empty (I4). A's
   TIT 1:2 segment, which B already integrated, is `identical`; TIT 1:1 and TIT 1:3 are
   `copied`.
3. Every outbox entry `ts` is present in the replacement's segment set and is listed
   in `carried.copied` (I4). The report accounts for outbox work the same way it
   accounts for working segments.
4. 1:3 is a fork with two live heads, A's and B's. Both events name the same `base`
   (A never received B's edit before making its own) and come from different actors
   (R-8.3.2). `fold.forks` lists the key with both heads and names the provisional one.
5. No other key is forked. A's TIT 1:1 and TIT 1:2 are linear.
6. The replacement's fold equals `fold(main ∪ publication(A) ∪ working(A) ∪ outbox(A))`.
7. A negative control: the receive is run with the fault `skip-outbox-replay` and check
   3 fails. Faults are the engine's test-only switch: `receive(port, {..., faults})`
   accepts a closed list of named faults only when `ctx.testMode` is true; in the app
   `testMode` is never set and a non-empty `faults` list is refused before any
   repository is touched. The list is defined in `journal/sync.mjs` and each fault has
   exactly one scenario that uses it. This proves the checks are not vacuous.
8. An input control: a scenario step that edits `TIT 99:1` (chapter 99 does not exist
   in the sample's `vrs.json`) is refused by the runner's reference check against the
   project's versification before any repository is touched. This proves the runner
   rejects invented references.

Acceptance: the scenario passes over the memory port with its negative control failing;
J18–J20 pass as scenario files over the git port; the same files pass over HTTP on the
rig, recorded with version, hash and date; a two-device property over `edit`, `send`,
`integrate`, `receive`, `kill` upholds conservation, exclusivity and I4, with
non-vacuity asserted (the property reaches at least one receive with unsent work and at
least one kill inside a receive, and the run reports both counts).

### X4 — `tc4` command line and Inspector

As in 1.7. Each verb has one oracle:

| Verb | Oracle |
|---|---|
| `open`, `send`, `receive`, `integrate`, `verify`, `fold` | rig-gated test: the verb's `Report` equals the app's `Report` for the same action on the same repository, field for field, `ts` and `durations` excluded (`ts` is each run's own HLC stamp; `actor` is the same because both run on one installation) |
| `report`, `ops` | the printed record equals the stored ops record byte for byte |
| `explain` | for a forked verse: names both heads, their bases, and R-8.6.4; for a linear verse: names the head and its base chain |
| `scenario` | runs one scenario file and exits non-zero on the first failed expectation; the negative-control scenario exits non-zero |
| `prove` | as L-1: writes the manifest; exits non-zero when any suite fails |
| `bench` | emits a `Report` with `op: bench` and one `durations` entry per measured phase, each a positive number; the test fails when a phase is missing or zero; no threshold is applied here (S7 owns thresholds) |

Acceptance: every row above has a test that fails when its oracle is violated, and the
Inspector renders the same `Report` and `explain` output as the command line for one
fixture (component test).

### X5 — Ops log for sync operations

Layer 5 operations write ops records (1.4). A receive writes its record before it
creates scratch (S5 step 1) and advances the record's phase at each step; the swap
phases are `intent`, `moved-prev`, `moved-scratch`, `cleared`. `open()` recovery reads
the last incomplete record.

Kill mechanism, shared by S2, S4 and S5: every port call goes through the repository
port, and the port counts calls. A kill sweep runs the operation once to learn the call
count N, then runs it N more times, killing the process after call k for k in 1..N,
and runs `open()` after each kill. This is the mechanism the interleavings test uses
today (`test/journalingInterleavings.test.ts`) applied to the port. The sweep reports N
and the number of kills, so non-vacuity is visible. The S5 table below names the five
kill points whose recovery differs; every other k must land in one of those five
states or in "nothing changed".

| Kill point | State on disk | Required result on next open |
|---|---|---|
| K1 after the record is written, before or during scratch work (S5 steps 2–6) | working at its path; a record in phase `start`; zero or one scratch under `_local_/_scratch_/` | roll back: delete any scratch named in the record; close the record with `outcome: refused`, `refusals: [{code: swap.incomplete}]`; working untouched. A scratch directory with no record (a crash before the record's own barrier completed) is deleted by the same sweep of `_local_/_scratch_/<name>-*` and reported the same way |
| K2 after phase `intent`, before move 1 | as K1 with a validated, committed scratch and the record in phase `intent` | roll back: delete scratch; close the record with `outcome: refused`; working untouched |
| K3 after move 1 (working → prev), before move 2 | no repository at the working path; prev and scratch exist; record in phase `moved-prev` | finish forward: move scratch to the working path; set phase `moved-scratch`; continue as K4; `outcome: recovered` |
| K4 after move 2, before the outbox clear | replacement at the working path; prev exists; record in phase `moved-scratch`; carried outbox entries still present | finish forward: verify the working path folds; clear the carried entries; close the record with `outcome: recovered` |
| K5 the server dies inside one `copy?delete_src` call (copy done, delete not done) | source and target both exist; record in phase `intent` or `moved-prev` | the recovery reads the phase, verifies the target folds, deletes the source, then applies the K3 or K4 rule. The port-call kill sweep cannot produce this state over HTTP, because the copy and the delete are one request. K5 is therefore a fixture-seeded scenario: the test builds the on-disk state (both directories, the record in the given phase) directly, then runs `open()`. It runs on every port |

S2 and S4 have no swap, so their kill sweep asserts only their own acceptance: for S2,
after `open()` every own segment in working ∪ outbox is in the publication or still in
the outbox (nothing lost, the next send finishes the flush); for S4, team main is at the
pre-integration head or the post-integration head, never a partial commit, and no
scratch remains. Two repositories at the working path are impossible because a path
holds one repository. "Never two candidates" means: after recovery there is exactly one of
{working, prev, scratch} at the working path, and the others are deleted or parked at
their own paths.

Acceptance: a kill sweep that stops at each of K1–K5 and at every durable boundary
between them ends, after one `open()`, with exactly one repository at the working path,
every own byte present (I4, I9), the actor id unchanged (I7), and the ops record closed
with `outcome` in `{refused, recovered, done}`. Never two candidates. The sweep records
how many kills it ran at each point (non-vacuity).

### X7 — Golden corpus accretion

`npm run golden:freeze` copies the journals that the Playwright journeys (`npm run
journeys`, specs `e2e/j01-*.spec.ts` to `e2e/j07-*.spec.ts` today [VERIFIED — 089cc8a,
2026-09-03]) wrote into their fixture projects during the current run to
`conformance/golden/<package.json version>/` with their fold hashes. The journeys write
the journals into the rig's `_local_/_local_/` projects; the freeze step reads them
from there. X7 does not wait for the S8 two-actor journey; when S8 lands, its journals
join the next corpus. One check
folds every frozen corpus and compares hashes. The release procedure in
`docs/PACKAGING.md` gains the freeze step before `scripts/package-desktop.zsh`; a
release is a manual GitHub Release (D46), so no script cuts it.

Acceptance, all inside the X7 change set: `npm run journeys` then `npm run
golden:freeze` at that commit produce the first corpus, which is committed with the
code; the golden check is green in CI; a one-byte
change to a frozen segment fails with `segment.invalid`; `docs/PACKAGING.md` names the
freeze step.

### S1 — Ratify §8.7 as rules and scenarios

Scope of the change set, all in one commit per §9:

- BURRITO-SPEC §8.7: I1–I6 and I9 become `R-8.7.7` to `R-8.7.13`; the refusal codes
  (1.3) are listed with their rules; the two platform caveats of the current
  [PROPOSED] block stay. The `[PROPOSED]` mark on the sync block is removed.
- BURRITO-SPEC §1: the sentence "There are no companion repos, no copies, and no
  export/import loop" is amended to name the publication mirror (a copy of the project
  with an actor branch, Section 4) and the team main mirror. The spec version bumps.
- Harness: scenario files for receive with unsent work (X2), swap ordering,
  flush-then-receive equivalence, and the carry-over refusals; the J32 two-device
  property (D55 calls it J32f; Appendix A indexes it as J32) gains a `receive` step;
  `validate-transport.mjs` gains T5 receive-with-unsent, T6 swap kill, T7 carry-over
  refusals (10 checks today [VERIFIED — 9a9ac40, 2026-09-03]; 13 after). S1 owns these
  three checks; S8 runs them in the rig CI job.
- The pre-S1 test claims by invariant name are rewritten as `[covers R-8.7.n]`.

Acceptance: the normative gate passes with the new ids; every new check has a negative
control; `npm run validate:transport` reports 13/13, recorded with version, hash and
date; a D-number records the ratification and marks D55's "sync stays [PROPOSED]"
superseded.

### S2 — Send (adapter over `sync.send`)

First send creates `_local_/_pub_/<name>` by `git/copy` of the working projection and
`new-branch/<actorId>` on the copy. Nothing is deleted and no metadata field is edited
(Section 4). `send()` is a flush: own segments not yet in the publication, validated,
then the outbox replayed into both working and publication, then `remake-ingredients`
and one `add-and-commit` on the publication. Idempotent. Works with the net gate off.

Acceptance: every commit on the `<actorId>` branch touches only own journal paths and
the `ingredients` table entries for them (spy test: `git diff --name-only` per commit
is a subset of the own journal directory plus `metadata.json`, and a field-by-field
diff of `metadata.json` shows changes only inside `ingredients` for those paths); after
`send()` every own segment in working ∪ outbox is in the publication byte-identical
under the X5 kill sweep; a planted foreign segment is refused and surfaced with
`segment.foreign-actor`.

### S3 — Transports: Door43 and sneakernet

Door43 send: `remote/add` then `git/push`. Receive side: `clone-repo?branch=<actorId>`
or `remote/add` plus `pull-repo` into a single-branch scratch. Sneakernet: export the
publication repository with the server's zip export, which produces the unwrapped shape
(`metadata.json` at the zip root). `POST /burrito/zipped` requires that shape and
accepts the server's own export unchanged (PLATFORM-NOTES #22, recorded at rig 0.17.0
on 2026-07-27 in `docs/evidence/zip-roundtrip-correction-2026-07-27.md`; that record
carries no commit hash, so it does not meet the citation rule and this plan treats the
claim as [PROPOSED] until S3 re-verifies it at the rig pin 0.18.5 (99fd9be) and records
version, hash and date; #26 trap (b)). Import under `_local_/_sideloaded_/`. The publication
repository is a valid Burrito (Section 4), so the importer accepts it. Team main travels as a
Door43 branch or a zip (D67(4b)).

Acceptance: push and clone pass in CI against a git remote the rig job controls (a
bare repository served over HTTPS with a certificate the rig trusts, because
`clone-repo` is https-only (Section 3), or the rig's gitea if one exists); a publication zip
round-trips through export and import with `metadata.json` and every file under
`ingredients/` byte-identical (`.git/` and `.DS_Store` are excluded, as in the #22
record, which compared the 10 non-`.git` files); a team main zip exported by the
integrator (D67(4b)) round-trips the same way and, imported on a second device, folds to
the same state as the integrator's team main; net off disables the Door43
controls and leaves sneakernet working. A run against live git.door43.org is a manual
evidence record, not the acceptance. S3 stays open until the CI remote test is green.

### S4 — Integrate (adapter over `sync.integrate`)

The T3/T4 recipe: copy team main to scratch; add remote; `pull-repo`; read the
contribution's segments from the contribution repository, never the scratch worktree
(PLATFORM-NOTES #21); whitelist check (I5, becomes R-8.7.9: the contribution may add files only under its own actor directory; anything else is `intake.shared-path`); write accepted segments by
ingredient writes; fold; regenerate; `remake-ingredients`; commit; fast-forward team
main; delete scratch. Anyone may integrate (D67(4d)). Acceptance: every J20 rejection
case is reproduced with main HEAD unchanged; two contributions integrate in either
order to the same fold; a crash at every durable boundary leaves main before or after,
never between.

### S5 — Receive (adapter over `sync.receive`)

1. Drain the `SaveScheduler` (`src/data/saveScheduler.ts`); refuse while a write
   failure stands. Write the ops record for this receive in phase `start` (1.4, X5).
2. Copy team main to scratch; add the own publication as a remote; `pull-repo`.
3. Carry over own journal work: each own segment in the working repository is
   validated, filename-checked, actor-checked. A path present in scratch with identical
   bytes is recorded as `identical`. A path absent from scratch is written and recorded
   as `copied`. Any failed check refuses the whole receive with its code, except a
   checksum failure whose `ts` is in the outbox, which is replayed from the outbox (I4).
   Replay every outbox entry into scratch. Delete scratch on refusal; the working
   repository is untouched.
4. Carry over tolerated unjournaled ingredients: copy every file under
   `ingredients/audio/` from the working repository into scratch, byte-identical (I9).
   A copy failure refuses the whole receive with `receive.audio-missing`.
5. Fold the scratch union; regenerate derived files; `remake-ingredients`; commit.
6. Verify: every own `ts` from working ∪ outbox is in the scratch union; every audio
   path from working is in scratch; `verifyProjectAgainstJournal`
   (`src/data/journal/verify.ts`) on the regenerated, committed scratch. The verifier
   compares disk files with the projection, so it runs after step 5, never before. On
   failure delete scratch and report; the working repository is untouched.
7. Swap: set the record's phase to `intent`; move working to `_local_/_prev_/<name>`;
   move scratch to the working path; advance the phase after each move; then clear the
   carried outbox entries and close the record (D67(4a); kill points K1–K5 in X5).
8. Recovery on open: an incomplete record is finished forward when scratch validates,
   or rolled back when the previous copy exists and the working path is absent.
9. Report: the fold's forks, retained, pending structural, plus the carry-over report,
   become the `OpenReport` (`src/data/journal/journalingStore.ts`) for S6. Ratchet the
   HLC over the received union (R-8.2.4).
10. The previous copy is deleted at the next successful checkpoint.

Design B (flush, then receive) is the documented alternative for step 3. The plan
keeps Design A because it does not make sending a precondition of receiving.

Own edits at receive. Three cases, decided by the fold, not by the receive:

- A's edit and a received edit by another actor name the same `base`: a fork with two
  live heads (R-8.3.2). This is the expected result of concurrent offline work. It is
  shown, not resolved (I8).
- A's edit names the received head as its `base`: linear; A's edit is the live head.
- A's segment path already exists in scratch with different bytes: a tampered or
  rewritten own segment. Step 3 refuses with `segment.differs-from-accepted`. This is a
  refusal, never a fork.

Same-actor events never fork (R-8.3.3), so an own edit never forks with the actor's own
history. The phrase "a conflicting own edit is a visible fork" in the first version of
this plan meant the first case. It is written out here so that it cannot be read as a
same-actor fork.

Acceptance:

- The replacement fold equals `fold(main ∪ publication ∪ working ∪ outbox)`, the four
  inputs of D67(3).
- An own edit that shares a `base` with a received edit by another actor is a fork
  with both heads listed (R-8.3.2); an own edit whose `base` is the received head is
  linear and is the live head; no own edit forks with own history (R-8.3.3).
- Each of the four carry-over refusals (`segment.invalid`, `segment.misnamed`,
  `segment.foreign-actor`, `segment.differs-from-accepted`) is planted once and
  reported once.
- The I4 negative control (X2 check 7) fails under the fault `skip-outbox-replay`.
- Every `ingredients/audio/` file present before receive is present after, byte for
  byte, and the I9 negative control (the fault `drop-audio-carry`, which skips step 4
  for one file; the second named fault after `skip-outbox-replay`, X2 check 7) refuses
  with `receive.audio-missing`.
- The X5 kill sweep across K1–K5 ends with one working repository at the original path,
  every own byte present, actor id unchanged.
- The two moves are exercised on the rig, recorded with version, hash and date.
- Whole-Bible receive time is recorded (S7).

### S6 — Show forks and receive results (D53(e); epic #25)

A non-modal summary after open and receive. A fork list with each head's text, actor
and time, and which head is provisional. Three actions: take all of theirs, take all of
mine, decide per verse. A resolution is one `text.verse.set` with `supersedes` naming
every live head (R-8.3.5). A provisional verse carries a marker in Translate. Retained
heads appear read-only with the closed reason vocabulary in plain words. Acceptance:
component tests over a fold report fixture; a resolution yields zero forks and both
heads superseded; e2e shows the fork visible, resolvable, and gone on the other device
after receive; no modal wall. This is the test obligation of I8.

### S7 — Performance prerequisites (#94, #95)

Finish #95 (one journal scan per open) and #94 (fold in a Web Worker). #92 and #93 are
closed [VERIFIED — GitHub issue state, read with `gh issue view` on 2026-09-03:
https://github.com/unfoldingWord/translationCore4/issues/92 and /issues/93; an issue
state has no version or commit hash, so the URL and the date are the citation]. Add
`tc4 bench --receive`.

Acceptance: `tc4 bench --receive` over the existing default bench corpus (an aligned
New Testament: 27 books, 7,959 verses, 15,945 events, `conformance/bench-fold.mjs`;
`docs/evidence/bench-fold-2026-08-25.md:25-27` [VERIFIED — 6f1bafc, 2026-09-03]) placed
in team main, received into a working repository that holds ten own unsent segments,
completes in under 10 s wall clock from the `receive` call to the closed record, on the
reference machine, which is the machine of the existing fold benchmarks: Apple M2 Pro
(10 cores), 16 GB, macOS (`docs/evidence/bench-fold-2026-08-25.md:4`). A record
from another machine names it and is not the acceptance. No UI-thread fold runs during
receive (asserted by the worker test of #94). Measurement, not acceptance: the
whole-Bible receive completes with a determinate progress bar and its time is recorded.

### S8 — Journey proof and CI

The two-actor journey (Section 6) as a scenario file on the rig runner plus a
Playwright e2e that compares the UI's `Report` with the command line's. The transport
checks T5–T7 that S1 added run in a rig CI job with the other rig-gated suites (never
on a clean clone; never with a pankosmia remote).
Acceptance: e2e green with an evidence record; transport 13/13; the CI job's last run
linked from the record.

### S9 — Documentation

- ARCHITECTURE §9 describes the five repositories per device (Section 4) and replaces
  its `syncEngine` and `publicationStore` paragraph with a pointer to `docs/SYSTEM.md`.
- RISKS gains rows for journal scale, identity store loss, power-loss durability, and
  sync data loss. Each row cites the check that mitigates it.
- The invariant ids I1–I9 are recorded in `docs/SYSTEM.md`: I1–I6 and I9 beside their
  `R-8.7.n` ids (Section 2.1 table), I7 and I8 marked "(D53, app rule)" with no id
  (Section 2.2). `docs/LEGACY-IDS.md` is frozen (D44(b)) and is not edited.
- Issue #79's two covered criteria are ticked, each with the test name that covers it.

Acceptance: the docs gate (L-2) is green; `npm run verify` is green; each RISKS row
names a check that exists in the repository.

## 6. The journey

Actor A and actor B each open the same project, seeded from the sample burrito (X2
names the source; all references are to `TIT`), on separate installations. B's device
is the team's integrator (D67(4b)); it holds the team main mirror, and every
publication reaches team main through `integrate` (S4) on that device. A drafts
TIT 1:2 and sends; B integrates A's publication. B drafts TIT 1:3, sends, integrates
its own publication, and receives. A, offline, drafts TIT 1:1, edits TIT 1:3 to a
different text with the same `base` as B's edit, and has one action (TIT 1:4) still in
the outbox. A comes online and receives (team main now holds A's 1:2 and B's 1:3).
Expected: A's working repository has A's TIT 1:1, 1:2, 1:3 and the former outbox
action as a committed segment, and A's outbox is empty (S5 step 7); TIT 1:3 shows a
fork with A's head and B's head (R-8.3.2); A picks one; the resolution sends; B
integrates A's publication and receives; B sees no fork and A's chosen TIT 1:3; both
projects fold to the same state. Then A's device loses power during a receive between the two moves; the
next open completes or rolls back the swap; no own byte is missing.

## 7. Epic acceptance

- §8.7 sync block is normative with `R-8.7.7` to `R-8.7.13` ids, §1 is amended, and the
  normative gate passes (S1).
- The journey passes as an e2e on the rig, and transport T5–T7 are green (S8).
- `verifyProjectAgainstJournal` holds on every working repository and every team main
  mirror the journey touched. Publication repositories are checked by the S2 path
  whitelist instead, because they hold no derived projection and the verifier requires
  one (`src/data/journal/verify.ts:165-205`; R-8.7.4).
- No open finding from the adversarial review of S4 and S5 remains.
- A GitHub Release notes the milestone (D46).

## 8. Reversibility

Every item adds repositories, code paths, and events of existing ops. No item rewrites a
stored byte or changes §8.1–8.6. S1 changes §1 wording and §8.7 status; both are
documentation of behavior the harness proves, and both can be reverted with the code.
If sync is withdrawn after S5 ships, working repositories remain valid single-actor
projects; publication and team repositories can be deleted. The one irreversible
action is the swap, which is why S5 and X5 spend most of their criteria on it.
