# Team sync plan — epic #24

Status: [PROPOSED] plan, adopted as the shape of epic #24 by D67 (2026-09-02). Rules
named here become normative only when the S1 change set lands them in
`docs/BURRITO-SPEC.md` with their checks (§9). Written against `main` after the audit of
2026-09-01 [VERIFIED — worktree at 60be039, see D67]. Revised 2026-09-03 after a
second-model review of PR #151 (23 findings; all addressed in this revision).

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
  record exists in `docs/evidence/` with version, hash and date. It is not a pass.

## 1. The system

### 1.1 The tower

The system has seven layers. Each layer has six faces: a typed input and output, the
rules it guarantees (`R-` ids), a report in the shared vocabulary, one reference
implementation that the app imports, a harness with one negative control per rule,
and one verb in the `tc4` command line.

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

Every operation reports in one closed schema, `Report v1`, defined in one module and
validated by one check.

Today the fold returns `FoldOutput` (`src/data/journal/runtime.ts:38-65`). It holds fold
state and the fold's own findings: `forks`, `retained`, `autoMerged`, `invalid`,
`pendingStructural`, `supersedeRefused`. It has no `op`, `ts`, `actor`, `repo`, `inputs`,
`outcome`, `refusals` or `durations` [VERIFIED — 9a9ac40, 2026-09-03]. `Report v1` is a
new contract that wraps `FoldOutput`'s findings under `fold` and adds the operational
fields. `FoldOutput` itself does not change. The `retained[]` reason vocabulary is
already closed (R-8.6.9) and is reused as is.

```
Report {
  op:        open | publish | checkpoint | seed | reconcile | send | integrate | receive | verify
  ts:        HLC ts of the operation (its identity)
  actor:     actorId
  repo:      repoPath
  inputs:    { name: { path, head?, count? } }     // every repository, branch, or set consumed
  outcome:   done | refused | partial | recovered
  refusals:  [{ code, rule, subject, action }]     // closed code vocabulary (1.3)
  fold:      { forks, retained, autoMerged, pendingStructural, invalid, supersedeRefused }
  carried:   { copied, identical, refused }        // receive only
  upheld:    [ rule ids this run verified ]
  durations: { phase: ms }
}
```

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
| `intake.shared-path` | R-8.7.9 (S1) | no | refuse the contribution |
| `receive.own-ts-missing` | R-8.7.12 (S1) | no | keep the working repository; report the missing `ts` |
| `receive.audio-missing` | R-8.7.14 (S1) | no | keep the working repository; report the missing path |
| `swap.incomplete` | R-8.7.13 (S1) | no | finish forward or roll back on open |

The normative gate checks that every code marked live names a live rule and has a
negative control. After S1, every row is live and the `[PROPOSED]` marks are removed.

### 1.4 Every operation leaves a record

Each layer 4 and layer 5 operation writes one ops record (a `Report`) to the
installation store before it starts and rewrites it once at the end, with the same
durable barrier the outbox uses. Recovery on open reads the last incomplete record. The
ops log is device-local and never enters the burrito, so journal `v: 1` is untouched.

### 1.5 Scenarios are data

Scenario files under `conformance/scenarios/` describe actors, steps (`edit`, `send`,
`integrate`, `receive`, `kill`, `open`) and expectations in `Report` terms. The step
language starts from the `StepSpec` interface in
`test/journalingInterleavings.test.ts:175` [VERIFIED — 9a9ac40, 2026-09-03], promoted
to a schema (L-4). Three runners execute one file: reference (memory port), git
(filesystem port), rig (HTTP port). A new question is a new file, not a new harness.

### 1.6 Evidence accretes

`npm run prove` writes `evidence/manifest.json`. A docs gate fails when a
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
become `R-8.7.7` to `R-8.7.14` in S1 and get conformance checks. App-facing invariants
bind the application, not the stored format. Per the D55 addendum of 2026-08-18, an app
rule carries no `R-` id and is exempt from the coverage gate. It is marked
"(D53, app rule)" in place, and its test lands with the app increment that implements
it. This plan does not supersede that addendum.

### 2.1 Format-facing (become `R-8.7.x` in S1)

- I1 Publication isolation. A publication commit touches only the actor's own
  `ingredients/checking/journal/<actor>/segments/`.
- I2 Send without receive. A send never needs a receive first and never merges another
  actor's bytes into the working repository.
- I3 Receive is rebuild-and-swap. The working repository is never merged into.
- I4 No own byte is lost at receive. Every own segment in the working repository or the
  outbox before receive is in the replacement, byte-identical, or the receive refuses.
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

[VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30), the rig pin; `git2` endpoint
inventory re-read 2026-09-03 in `upstream/pankosmia-web/src/endpoints/git2/`]

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
  (ARCHITECTURE §5 endpoint table; PLATFORM-NOTES #22).

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
| Own publication | `_local_/_pub_/<name>` | `<actorId>` | send (S2) | `metadata.json` with a re-made ingredients table, plus `ingredients/checking/journal/<actorId>/` only |
| Team main mirror | `_local_/_team_/<name>` | `main` | integrate (S4), receive (S5) | full Burrito: derived files and every accepted journal |
| Scratch (disposable) | `_local_/_scratch_/<name>-<hlc>` | any | S4, S5; deleted after use | a copy under construction |
| Previous working (recovery copy) | `_local_/_prev_/<name>` | `main` | S5 swap; deleted at the next checkpoint | the working projection before the swap |

The publication repository keeps `metadata.json` and runs `remake-ingredients` after the
deletes, so its ingredients table matches its files. It is therefore a structurally
valid Scripture Burrito with a scoped ingredient set, and the zip import accepts it
(Section 3, last bullet). It is not a complete project: `verifyProjectAgainstJournal`
does not apply to it (Section 7).

## 5. Work items

### 5.0 Item map

Foundation items X0, X1, X3 and X6 are the legibility steps L-0, L-1, L-3 and L-6. They
are specified in `LEGIBILITY.md` and are not repeated here. This document keeps the X
numbering so that epic #24's checklist reads in one sequence.

| Item | Delivered by | Content |
|---|---|---|
| X0 | L-0 | reference modules move to root `journal/` (D67(4e)) |
| X1 | L-1 | `npm run prove` and `evidence/manifest.json` |
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
refusal codes by code name. They never cite an `R-8.7.7` to `R-8.7.14` id, because
those ids do not exist until S1. S1 rewrites the claims to `[covers R-8.7.n]` in the
same change set that creates the ids.

### X2 — Sync engine as a reference module

`journal/sync.mjs` exports `send(port, ctx)`, `integrate(port, ctx)`, `receive(port,
ctx)`: orchestrations over the repository port that return a `Report`. The app imports
the engine as it imports the fold.

The audit of 2026-09-01 wrote a standalone simulation, `receive-with-unsent.mjs`, that
ran 15 checks over real git repositories and reproduced the receive gap. That file was
not retained when the audit worktree was removed [noted 2026-09-03]. Its result cannot
be rerun. X2 rebuilds it as a committed scenario file. The scenario is defined here so
that it does not depend on the lost file:

`conformance/scenarios/receive-with-unsent.json`: actors A and B on one project. Steps:
A edits 1:2 and sends. B edits 1:3, sends, integrates, receives. A, offline, edits 1:1,
edits 1:3 to a different text, and holds one more edit in the outbox with no segment
written yet. A receives. Expectations, in `Report` terms:

1. `outcome` is `done`.
2. `carried.copied` lists every A segment `ts` that was in A's working repository
   before the receive (I4).
3. Every outbox entry `ts` is present in the replacement's segment set (I4).
4. 1:3 is a fork with two live heads, A's and B's. Both events name the same `base`
   (A never received B's edit before making its own) and come from different actors
   (R-8.3.2). `fold.forks` lists the key with both heads and names the provisional one.
5. No other key is forked. A's 1:1 and 1:2 are linear.
6. The replacement's fold equals `fold(main ∪ publication(A) ∪ working(A) ∪ outbox(A))`.
7. A negative control: the receive is run with I4 disabled in the engine, and check 3
   fails. This proves the checks are not vacuous.

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
| `open`, `send`, `receive`, `integrate`, `verify`, `fold` | rig-gated test: the verb's `Report` equals the app's `Report` for the same action on the same repository, field for field, `durations` excluded |
| `report`, `ops` | the printed record equals the stored ops record byte for byte |
| `explain` | for a forked verse: names both heads, their bases, and R-8.6.4; for a linear verse: names the head and its base chain |
| `scenario` | runs one scenario file and exits non-zero on the first failed expectation; the negative-control scenario exits non-zero |
| `prove` | as L-1: writes the manifest; exits non-zero when any suite fails |
| `bench` | prints the S7 measurements as a `Report` with `durations`; no pass condition |

Acceptance: every row above has a test that fails when its oracle is violated, and the
Inspector renders the same `Report` and `explain` output as the command line for one
fixture (component test).

### X5 — Ops log for sync operations

Layer 5 operations write ops records (1.4). The swap intent is an ops record; `open()`
recovery reads it. The kill boundaries for the S5 swap are the five points below. Each
names the state that the next `open()` must produce.

| Kill point | State on disk | Required result on next open |
|---|---|---|
| K1 before the intent record is written | working at its path; scratch validated | scratch is deleted; working is untouched; report `outcome: refused` |
| K2 after the record, before move 1 | as K1 plus the record | same as K1; the record is closed as rolled back |
| K3 after move 1 (working → prev), before move 2 | no repository at the working path; prev and scratch exist | finish forward: move scratch to the working path; `outcome: recovered` |
| K4 after move 2, before the outbox clear | replacement at the working path; prev exists; outbox entries still marked carried | finish forward: clear the carried entries; close the record |
| K5 during a single `copy?delete_src` (copy done, delete not done) | source and target both exist | the source is deleted after the target verifies; then the K3 or K4 rule applies |

Acceptance: a kill sweep that stops at each of K1–K5 and at every durable boundary
between them ends, after one `open()`, with exactly one repository at the working path,
every own byte present (I4, I9), the actor id unchanged (I7), and the ops record closed
with `outcome` in `{refused, recovered, done}`. Never two candidates. The sweep records
how many kills it ran at each point (non-vacuity).

### X7 — Golden corpus accretion

The release script freezes the journey-written journals under
`conformance/golden/<version>/`. One check folds every frozen corpus and compares
hashes. Acceptance: the first corpus is frozen by the first `4.0.0-alpha.N` pre-release
cut after X7 merges (D46), and its check is green in CI; a one-byte change to a frozen
segment fails with `segment.invalid`.

### S1 — Ratify §8.7 as rules and scenarios

Scope of the change set, all in one commit per §9:

- BURRITO-SPEC §8.7: I1–I6 and I9 become `R-8.7.7` to `R-8.7.14`; the refusal codes
  (1.3) are listed with their rules; the two platform caveats of the current
  [PROPOSED] block stay. The `[PROPOSED]` mark on the sync block is removed.
- BURRITO-SPEC §1: the sentence "There are no companion repos, no copies, and no
  export/import loop" is amended to name the publication mirror and the team main
  mirror (Section 4). The spec version bumps.
- Harness: scenario files for receive with unsent work (X2), swap ordering,
  flush-then-receive equivalence, and the carry-over refusals; the J32 two-device
  property (D55 calls it J32f; Appendix A indexes it as J32) gains a `receive` step;
  `validate-transport.mjs` gains T5–T7 (S8).
- The pre-S1 test claims by invariant name are rewritten as `[covers R-8.7.n]`.

Acceptance: the normative gate passes with the new ids; every new check has a negative
control; `npm run validate:transport` reports 13/13, recorded with version, hash and
date; a D-number records the ratification and marks D55's "sync stays [PROPOSED]"
superseded.

### S2 — Send (adapter over `sync.send`)

First send creates `_local_/_pub_/<name>` by `git/copy`, `new-branch/<actorId>`,
ingredient deletes outside the own journal directory, `remake-ingredients`,
`add-and-commit`. `send()` is a flush: own segments not yet in the publication,
validated, then the outbox replayed into both working and publication, then one
commit. Idempotent. Works with the net gate off. Acceptance: publication commits touch
only `metadata.json` and own journal paths (spy test); after `send()` every own segment
in working ∪ outbox is in the publication byte-identical under a kill sweep; a planted
foreign segment is refused and surfaced with `segment.foreign-actor`.

### S3 — Transports: Door43 and sneakernet

Door43 send: `remote/add` then `git/push`. Receive side: `clone-repo?branch=<actorId>`
or `remote/add` plus `pull-repo` into a single-branch scratch. Sneakernet: export the
publication repository as a wrapped zip (PLATFORM-NOTES #26 trap b); import under
`_local_/_sideloaded_/`. The publication repository is a valid Burrito (Section 4), so
the standard import accepts it. Team main travels as a Door43 branch or a zip
(D67(4b)).

Acceptance: push and clone pass in CI against a git remote the rig job controls (a
bare repository served over HTTP, or the rig's gitea if one exists); a publication zip
round-trips byte-identically through export and import; net off disables the Door43
controls and leaves sneakernet working. A run against live git.door43.org is a manual
evidence record, not the acceptance. S3 stays open until the CI remote test is green.

### S4 — Integrate (adapter over `sync.integrate`)

The T3/T4 recipe: copy team main to scratch; add remote; `pull-repo`; read the
contribution's segments from the contribution repository, never the scratch worktree
(PLATFORM-NOTES #21); whitelist check (I1, becomes R-8.7.9); write accepted segments by
ingredient writes; fold; regenerate; `remake-ingredients`; commit; fast-forward team
main; delete scratch. Anyone may integrate (D67(4d)). Acceptance: every J20 rejection
case is reproduced with main HEAD unchanged; two contributions integrate in either
order to the same fold; a crash at every durable boundary leaves main before or after,
never between.

### S5 — Receive (adapter over `sync.receive`)

1. Drain the `SaveScheduler` (`src/data/saveScheduler.ts`); refuse while a write
   failure stands.
2. Copy team main to scratch; add the own publication as a remote; `pull-repo`.
3. Carry over own journal work: each own segment in the working repository is
   validated, filename-checked, actor-checked; a path present in scratch with different
   bytes refuses the whole receive with `segment.differs-from-accepted`; otherwise
   written. Replay every outbox entry into scratch. Record the refused list.
4. Carry over tolerated unjournaled ingredients: copy every file under
   `ingredients/audio/` from the working repository into scratch, byte-identical (I9).
   A copy failure refuses the whole receive with `receive.audio-missing`.
5. Verify: every own `ts` from working ∪ outbox is in the scratch union; every audio
   path from working is in scratch; fold; `verifyProjectAgainstJournal`
   (`src/data/journal/verify.ts`) on the regenerated scratch. On failure delete scratch
   and report; the working repository is untouched.
6. Regenerate derived files; `remake-ingredients`; commit.
7. Swap: write the intent record; move working to `_local_/_prev_/<name>`; move
   scratch to the working path; update the phase after each move; then clear the
   carried outbox entries and the record (D67(4a); kill points K1–K5 in X5).
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
- The I4 negative control (X2 check 7) fails when I4 is disabled.
- Every `ingredients/audio/` file present before receive is present after, byte for
  byte, and the I9 negative control (an audio file deleted from scratch before the
  swap) refuses.
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
closed [VERIFIED — GitHub, 2026-09-03]. Add `tc4 bench --receive`.

Acceptance: New Testament receive under 10 s on the reference machine. The reference
machine is the one named in the first `bench --receive` evidence record; later records
cite the same machine or state the change. The whole-Bible receive completes with a
determinate progress bar and its time is recorded. No threshold is set for whole Bible
until it is measured; the record states this. No UI-thread fold runs during receive
(asserted by the worker test of #94).

### S8 — Journey proof and CI

The two-actor journey (Section 6) as a scenario file on the rig runner plus a
Playwright e2e that compares the UI's `Report` with the command line's.
`validate-transport.mjs` gains T5 receive-with-unsent, T6 swap kill, T7 carry-over
refusals (10 checks today [VERIFIED — 9a9ac40, 2026-09-03]; 13 after). A rig CI job
runs the rig-gated suites (never on a clean clone; never with a pankosmia remote).
Acceptance: e2e green with an evidence record; transport 13/13; the CI job's last run
linked from the record.

### S9 — Documentation

- ARCHITECTURE §9 describes the five repositories per device (Section 4) and replaces
  its `syncEngine` and `publicationStore` paragraph with a pointer to `docs/SYSTEM.md`.
- RISKS gains rows for journal scale, identity store loss, power-loss durability, and
  sync data loss. Each row cites the check that mitigates it.
- The invariant ids I1–I9 are recorded in `docs/SYSTEM.md` beside their `R-8.7.n` ids.
  `docs/LEGACY-IDS.md` is frozen (D44(b)) and is not edited.
- Issue #79's two covered criteria are ticked, each with the test name that covers it.

Acceptance: the docs gate (L-2) is green; `npm run verify` is green; each RISKS row
names a check that exists in the repository.

## 6. The journey

Actor A and actor B each open the same project on separate installations. A drafts 1:2
and sends. B drafts 1:3, sends, and receives. A, offline, drafts 1:1, edits 1:3 to a
different text with the same `base` as B's edit, and has one action still in the
outbox. A receives. Expected: A's working repository has A's 1:1, 1:2, 1:3 and the
outbox action; 1:3 shows a fork with A's head and B's head (R-8.3.2); A picks one; the
resolution sends; B receives; B sees no fork and A's chosen 1:3; both projects fold to
the same state. Then A's device loses power during a receive between the two moves; the
next open completes or rolls back the swap; no own byte is missing.

## 7. Epic acceptance

- §8.7 sync block is normative with `R-8.7.7` to `R-8.7.14` ids, §1 is amended, and the
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
