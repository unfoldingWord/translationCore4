# Team sync plan — epic #24

Status: [PROPOSED] plan, adopted as the shape of epic #24 by D67 (2026-09-02). Rules
named here become normative only when the S1 change set lands them in
`docs/BURRITO-SPEC.md` with their checks (§9). Written against `main` after the audit of
2026-09-01 [VERIFIED — worktree at 60be039, see D67]. Reviewed by a second model and
consolidated 2026-09-03; the review's design catches are kept, its detail is not.

Prerequisite: the legibility increment (`LEGIBILITY.md`) closes first (D67(2)).

## 0. How to read this document

- A plan states what is decided, what is verified, and what is open. It does not fix
  implementation detail. Where a sentence says "decided in Sn", the change set for Sn
  makes that decision, through §9 when it touches the format, and records it.
- Identifiers. `L-n` are legibility steps (`LEGIBILITY.md`). `X-n` are foundation items
  of this epic. `S-n` are sync items. `I-n` are invariants (Section 2). `T-n` are checks
  in `conformance/validate-transport.mjs`. `J-n` are check groups in the journal suite
  (BURRITO-SPEC Appendix A). `R-8.x.y` are normative rule ids in BURRITO-SPEC §8.
- Evidence tags follow `CONTRIBUTING.md`: `[VERIFIED — source, version, hash, date]`,
  `[decided YYYY-MM-DD — Dn]`, `[PROPOSED]`. A sentence without a tag is a plan
  statement, not a fact about the code.
- Decision parts are written `D67(4a)` and `D53(c)`, as the decision log writes them.
- Evidence lives in `docs/evidence/`.

## 1. The system

### 1.1 The tower

The system has seven layers. Each layer has a typed input and output, the rules it
guarantees, a report in one shared vocabulary, one reference implementation that the
app imports, a harness, and one verb in the `tc4` command line.

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

Every operation reports in one closed schema, `Report`, defined in one module and
validated by one check (L-3). Today the fold returns `FoldOutput`
(`src/data/journal/runtime.ts:38-65`), which holds fold state and the fold's findings
(`forks`, `retained`, `autoMerged`, `invalid`, `pendingStructural`, `supersedeRefused`)
and no operational fields [VERIFIED — 9a9ac40, 2026-09-03]. `Report` wraps those
findings under `fold` and adds the operation (`op`, `ts`, `actor`, `repo`, `inputs`,
`outcome`, `refusals`, `durations`; for a receive also `carried`). `FoldOutput` does not
change. The `retained[]` reason vocabulary is already closed (R-8.6.9) and is reused.
The existing `OpenReport` (`src/data/journal/journalingStore.ts`) becomes a `Report`
with `op: open`; one report type remains. Field shapes are decided in L-3.

The UI renders `Report`. The command line prints `Report`. Tests assert on fields, not
on message strings. Evidence records are arrays of `Report` with a header.

### 1.3 Refusal codes

A refusal is a code bound to a rule and one recovery action. Codes whose rule does not
exist yet are marked "(S1)"; the S1 change set creates the rule. Until then the gate
checks only the live codes, and tests before S1 assert the code name, never a future
rule id.

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
| `swap.incomplete` | R-8.7.12 (S1; I6) | no | finish forward or roll back on open |

Today the normative gate (`conformance/normative/check.mjs`) proves that each `R-` id
is claimed by a live check; per-rule mutation proof is an open D55 residual. How
negative controls are named and gated is decided in L-3.

### 1.4 Every operation leaves a record

Each layer 4 and layer 5 operation writes one ops record (a `Report`) to the
installation store before its first side effect and closes it at the end, with the
same durable barrier the outbox uses. A receive's record covers the whole operation;
the swap intent of D67(4a) is a phase of that record, not a separate one. Recovery on
open reads the last incomplete record. The ops log is device-local and never enters the
burrito, so journal `v: 1` is untouched. Phase names are decided in X5.

### 1.5 Scenarios are data

Scenario files under `conformance/scenarios/` describe actors, steps (`edit`, `send`,
`integrate`, `receive`, `kill`, `open`) and expectations in `Report` terms. The step
language starts from the `StepSpec` interface in
`test/journalingInterleavings.test.ts:175` [VERIFIED — 9a9ac40, 2026-09-03], promoted
to a schema in L-4. Three runners execute one file: reference (memory port), git
(filesystem port), rig (HTTP port). A new question is a new file, not a new harness.

### 1.6 Evidence accretes

`npm run prove` writes `docs/evidence/manifest.json` (L-1). A docs gate fails when a
manifest-derived statement in the documents disagrees with it (L-2). Each release
freezes the journey-written journals and their fold hashes under
`conformance/golden/<version>/`; one check folds every frozen corpus (X7).

### 1.7 The driver's console

`tc4` is a Node command line over the HTTP adapter that imports the same modules as the
app: `open`, `send`, `receive`, `integrate`, `verify`, `report`, `ops`, `explain`,
`fold`, `scenario`, `prove`, `bench`. `explain <repo> <key>` answers why a verse shows
its text: live heads, bases, structural branch, supersedes, generation, retained
reasons, and the rule that decided each step. A dev-only Inspector panel in the app
renders the same `Report` and `explain` output.

## 2. Invariants

Format-facing invariants bind the stored bytes and the receive result. They become
`R-8.7.7` to `R-8.7.12` in S1 and get conformance checks. App-facing invariants bind
the application, not the stored format; under the D55 addendum of 2026-08-18 an app
rule carries no `R-` id, is marked "(D53, app rule)" in place, and is tested by the
app increment that implements it.

### 2.1 Format-facing (become `R-8.7.x` in S1)

| Invariant | Rule id in S1 | Refusal code |
|---|---|---|
| I1 | R-8.7.7 | none (S2 spy test) |
| I2 | R-8.7.8 | none (S2 flush test) |
| I5 | R-8.7.9 | `intake.shared-path`; the four segment codes |
| I3 | R-8.7.10 | none (S5 kill sweep) |
| I4 | R-8.7.11 | `receive.own-ts-missing` |
| I6 | R-8.7.12 | `swap.incomplete` |

- I1 Publication isolation. Every commit the `<actorId>` branch adds after its branch
  point touches only the actor's own `ingredients/checking/journal/<actor>/` and the
  `ingredients` table entries of `metadata.json` that describe those files (the table
  must list every file, §3 rule 5). The inherited history of the copied projection is
  outside I1.
- I2 Send without receive. A send never needs a receive first and never merges another
  actor's bytes into the working repository.
- I3 Receive is rebuild-and-swap. The working repository is never merged into.
- I4 No own byte is lost at receive. Every own segment in the working repository or the
  outbox before receive is in the replacement, byte-identical, or the whole receive
  refuses and the working repository is untouched. One exception: a segment that fails
  its checksum (R-8.1.6) and whose `ts` is in the outbox is replayed from the outbox,
  its durable source.
- I5 Zero trust everywhere, including the actor's own publication and own old copy:
  validator, filename rule (R-8.1.2), actor binding (R-8.1.12), accepted bytes
  (R-8.1.5).
- I6 Swap ordering. The outbox and the recovery copy are cleared only after the
  replacement is verified and is the live working repository.

Structural constraint, not a rule yet: a replacement built from journals and
regenerated files contains nothing else, so a receive would silently drop any file in
a tolerated unjournaled ingredient class (R-8.7.3 names `ingredients/audio/`). The
receive design must carry such files over byte for byte or refuse. There is no audio
today; the rule, its code and its test are decided in S5 if and when the class is used.

### 2.2 App-facing (D53, app rule; no `R-` id)

- I7 Identity is preserved. The replacement lands at the same repository path, because
  the actor id derives from the path (D53(c); `src/data/journal/identity.ts:10-15`
  [VERIFIED — 9a9ac40, 2026-09-03]). Tested by S5.
- I8 Forks are legible. After a receive, every fork, retained head and pending
  structural event is shown. The project stays open (D53(e)). Tested by S6.

## 3. Platform constraints

[VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30), the rig pin, read in
`upstream/pankosmia-web/src/endpoints/git2/` on 2026-09-03; upstream `main` re-read the
same day at 0.18.7 (c43c40d, 2026-08-11); the two agree on every endpoint named below]

- One merge endpoint, `POST /git/pull-repo/<remote>/<repo>`, no branch parameter
  (PLATFORM-NOTES #17, #33). One publication repository per actor with one branch makes
  it deterministic.
- After a normal merge the worktree is not trustworthy (PLATFORM-NOTES #21). The
  integrator writes the validated union by ingredient writes.
- `add-and-commit` panics on a repository with no commits (PLATFORM-NOTES #20).
- Move primitive: `POST /git/copy/<repo>?target_path=<path>&delete_src=true`. The
  handler copies the tree, then calls `remove_dir_all` on the source
  (`src/endpoints/git2/copy_repo.rs:19-24,120-130`). A crash between the copy and the
  delete leaves two copies. A swap needs two such moves; they are not atomic together
  (D67(4a)). S5 is the first use of `delete_src`.
- No HTTP route writes `metadata.json` (D28 addendum; `src/data/serverApi.ts:145`).
  `remake-ingredients` rescans and rewrites every `role` (PLATFORM-NOTES #5). A single
  file is registered by the presence-only `update_ingredients` flag on its write
  (`src/data/serverApi.ts:143,373`; BURRITO-SPEC §6 W-2).
- `POST /git/push` and `POST /git/clone-repo?branch=` exist; clone is https-only. Every
  remote call is behind the platform net gate.
- Repository paths are exactly three segments (`serverApi.assertRepoPath`).
- Zip import (`POST /burrito/zipped/<repo_path>`) requires the unwrapped shape, a root
  `metadata.json` and an `ingredients/` directory, and a target under
  `_local_/_sideloaded_/`; the server's own export has that shape (ARCHITECTURE §3.1;
  PLATFORM-NOTES #22, #26 trap (b)).

## 4. Repositories per device per project

BURRITO-SPEC §1 says a tC4 project is one git repository with no companion repos, no
copies, and no export/import loop. This plan keeps one canonical project repository
per device. The other entries below are installation-local state: two mirrors of the
same project and two transient copies. Because the publication mirror is exchanged
with other devices, the §1 sentence is amended in S1, through §9. Until then this
table is [PROPOSED].

| Role | Path | Branch | Written by |
|---|---|---|---|
| Working projection (canonical) | `_local_/_local_/<name>` | `main` | the app, every mutation |
| Own publication | `_local_/_pub_/<name>` | `<actorId>` | send (S2) |
| Team main mirror | `_local_/_team_/<name>` | `main` | integrate (S4), receive (S5) |
| Scratch (disposable) | `_local_/_scratch_/<name>-<hlc>` | any | S4, S5; deleted after use |
| Previous working (recovery copy) | `_local_/_prev_/<name>` | `main` | S5 swap; deleted at the next checkpoint |

The publication repository has the shape that J19 and transport T3 already prove and
that ARCHITECTURE §9 describes as `publicationStore` [VERIFIED — `docs/ARCHITECTURE.md:190`,
`conformance/validate-transport.mjs:207-210`, f1c07ff, 2026-09-03]: a `git/copy` of the
working projection with a `<actorId>` branch created on the copy. Nothing is deleted
and no metadata field is edited (Section 3). Only journal paths change after the branch
point, so a merge of the branch brings only journal paths; that is what T3 asserts.
The copy is a valid Scripture Burrito, so the zip import accepts it. Its derived files
do not track its own fold, so `verifyProjectAgainstJournal` does not apply to it; the
S2 path check is its check.

## 5. Work items

Foundation items X0, X1, X3 and X6 are the legibility steps L-0, L-1, L-3 and L-6,
specified in `LEGIBILITY.md`. The X numbering is kept so that epic #24's checklist
reads in one sequence.

Dependency order:

```
LEGIBILITY closes ─▶ X2 sync reference module ─▶ S1 ratify §8.7 (rules + scenarios)
                                                    ├─▶ S2 send adapter ─▶ S3 transports
                                                    ├─▶ S4 integrate adapter ─▶ S5 receive adapter
                                                    └─▶ S6 fork view (reads Report)
X4 CLI + Inspector    X5 ops log for sync    X7 golden corpus    S7 performance    S8 journey    S9 docs
```

Items before S1 (X2, X4, X5) assert invariants by name and refusals by code name; S1
rewrites those claims as `[covers R-8.7.n]` in the change set that creates the ids.

### X2 — Sync engine as a reference module

`journal/sync.mjs` exports `send(port, ctx)`, `integrate(port, ctx)`, `receive(port,
ctx)`: orchestrations over the repository port that return a `Report`. The app imports
the engine as it imports the fold.

The audit of 2026-09-01 wrote a standalone simulation, `receive-with-unsent.mjs`, that
reproduced the receive gap over real git repositories (15 checks) [VERIFIED — executed
2026-09-01 at 60be039; the file was not retained when the audit worktree was removed,
so the run is not repeatable]. X2 rebuilds it as a committed scenario file. The scenario
uses the sample project (`conformance/sample-burrito/`, books `TIT` and `JON`). Actors
A and B; B's device is the integrator. A edits TIT 1:2 and sends; B integrates it. B
edits TIT 1:3, sends, integrates, receives. A, offline, edits TIT 1:1, edits TIT 1:3
to a different text with the same `base` as B's, and holds one more edit in the
outbox. A receives. Expected: `outcome: done`; every own `ts` from working and outbox is
in the replacement (I4); TIT 1:3 is a fork with two live heads, A's and B's, because
different actors share one `base` (R-8.3.2); no other key forks; the replacement fold
equals `fold(main ∪ publication ∪ working ∪ outbox)`, the four inputs of D67(3).

Acceptance: the scenario passes over the memory port and has a negative control that
makes the receive refuse with `receive.own-ts-missing` (the mechanism is decided in
X2); J18–J20 pass as scenario files over the git port and over HTTP on the rig,
recorded; a two-device property over `edit`, `send`, `integrate`, `receive`, `kill`
upholds conservation, exclusivity and I4 with non-vacuity asserted.

### X4 — `tc4` command line and Inspector

As in 1.7. Acceptance: for each mutating verb, the verb's `Report` equals the app's for
the same action from the same fixture snapshot, with `ts` and `durations` excluded;
`explain` for a forked verse names both heads, their bases, and R-8.6.4; the Inspector
renders the same output as the command line for one fixture. The oracle for the
CLI-only verbs (`scenario`, `prove`, `bench`, `ops`) is decided in X4.

### X5 — Ops log for sync operations

Layer 5 operations write ops records (1.4). A kill sweep drives every port call: the
port counts calls, and the sweep restores one fixture snapshot, kills after call k for
each k, and runs `open()`. Acceptance: after every kill and one `open()`, exactly one
repository is at the working path, every own byte is present (I4), the actor id is
unchanged (I7), and the record is closed. The server dying inside one
`copy?delete_src` request cannot be produced by a port-call kill and is a
fixture-seeded recovery scenario. Phase names and the per-phase recovery rule are
decided in X5; S5 step 8 references them.

### X7 — Golden corpus accretion

A freeze step copies the journals that the Playwright journeys (`npm run journeys`,
`e2e/j0*.spec.ts`) wrote into `conformance/golden/<version>/` with their fold hashes;
one check folds every frozen corpus. The release procedure (`docs/PACKAGING.md`, D46)
gains the step. Acceptance: the first corpus is frozen and committed in the X7 change
set, its check is green, and a one-byte change to a frozen segment fails with
`segment.invalid`.

### S1 — Ratify §8.7 as rules and scenarios

One change set per §9: BURRITO-SPEC §8.7 gains `R-8.7.7` to `R-8.7.12` (Section 2.1)
and lists the refusal codes; the `[PROPOSED]` mark on the sync block is removed; §1 is
amended to name the publication and team main mirrors (Section 4); the version bumps.
Harness: the X2 scenario files, the J32 two-device property (D55 calls it J32f) gains a
`receive` step, `validate-transport.mjs` gains T5 receive-with-unsent, T6 swap kill,
T7 carry-over refusals (10 checks today [VERIFIED — 9a9ac40, 2026-09-03]). Acceptance:
the normative gate passes with the new ids; `npm run validate:transport` reports 13/13,
recorded; a D-number records the ratification and marks D55's "sync stays [PROPOSED]"
superseded.

### S2 — Send (adapter over `sync.send`)

First send creates `_local_/_pub_/<name>` by `git/copy` and `new-branch/<actorId>`
(Section 4). `send()` is a flush: own segments not yet in the publication, validated,
then the outbox replayed into both working and publication, each write with
`update_ingredients`, then one `add-and-commit` on the publication. `remake-ingredients`
is never called on the publication (Section 3). Idempotent. Works with the net gate
off. Acceptance: every commit in `main..<actorId>` touches only own journal paths and
their `ingredients` entries (spy test); after `send()` every own segment in
working ∪ outbox is in the publication byte-identical under the X5 kill sweep; a
planted foreign segment is refused with `segment.foreign-actor`.

### S3 — Transports: Door43 and sneakernet

Door43 send: `remote/add` then `git/push`. Receive side: `clone-repo?branch=<actorId>`
or `remote/add` plus `pull-repo` into a single-branch scratch. Sneakernet: the server's
zip export of the publication, imported under `_local_/_sideloaded_/`. Team main
travels as a Door43 branch or a zip (D67(4b)). Acceptance: push and clone pass in CI
against an HTTPS git remote the rig job controls; a publication zip and a team-main zip
round-trip with `metadata.json` and every `ingredients/` file byte-identical; net off
disables the Door43 controls and leaves sneakernet working. The zip-import claim of
PLATFORM-NOTES #22 is re-verified at the rig pin and recorded with version, hash and
date.

### S4 — Integrate (adapter over `sync.integrate`)

The T3/T4 recipe: copy team main to scratch; add remote; `pull-repo`; read the
contribution's segments from the contribution repository, never the scratch worktree
(PLATFORM-NOTES #21); whitelist check (I5): the contribution may add files only under
its own actor directory; write accepted segments by ingredient writes; fold;
regenerate; `remake-ingredients`; commit; fast-forward team main; delete scratch.
Anyone may integrate (D67(4d)). Acceptance: every J20 rejection case is reproduced with
main HEAD unchanged; two contributions integrate in either order to the same fold; a
kill at every port call leaves main at the old head or the new head, never between.

### S5 — Receive (adapter over `sync.receive`)

1. Drain the `SaveScheduler`; refuse while a write failure stands. Open the ops record.
2. Copy team main to scratch. Bring in the own publication through the same zero-trust
   intake as any contribution (I5, S4 recipe).
3. Carry over own work: each own segment in the working repository is validated,
   filename-checked, actor-checked, then written into scratch if absent; a failed check
   refuses the whole receive with its code (I4). Replay every outbox entry into scratch.
   Carry over any tolerated unjournaled ingredient class (Section 2.1 constraint).
4. Fold the scratch union; regenerate derived files; `remake-ingredients`; commit.
5. Verify: every own `ts` from working ∪ outbox is in the scratch union;
   `verifyProjectAgainstJournal` (`src/data/journal/verify.ts`) on the regenerated,
   committed scratch. It compares disk files with the projection, so it runs after
   step 4, never before. On failure delete scratch and report; working is untouched.
6. Swap: advance the record to its swap phase; move working to `_local_/_prev_/<name>`;
   move scratch to the working path; then clear the carried outbox entries and close
   the record (D67(4a)).
7. Recovery on open: the record's phase selects finish-forward or roll-back (X5).
8. Report: the `Report` with `op: receive`; S6 reads it. Ratchet the HLC over the
   received union (R-8.2.4).
9. The previous copy is deleted at the next successful checkpoint.

Design B (flush, then receive) is the documented alternative for step 3. The plan
keeps Design A because it does not make sending a precondition of receiving.

Own edits at receive are decided by the fold: an own edit that shares a `base` with
another actor's edit is a fork (R-8.3.2); an own edit whose `base` is the received
head is linear; an own segment path present in scratch with different bytes is a
rewritten own segment and refuses with `segment.differs-from-accepted`. Same-actor
events never fork (R-8.3.3).

Acceptance: the replacement fold equals `fold(main ∪ publication ∪ working ∪ outbox)`;
the fork and linear cases above are each exercised; each of the four carry-over
refusals is planted once and reported once; the X5 kill sweep ends with one working
repository at the original path, every own byte present, actor id unchanged; the two
moves are exercised on the rig, recorded.

### S6 — Show forks and receive results (D53(e); epic #25)

A non-modal summary after open and receive. A fork list with each head's text, actor
and time, and which head is provisional. Three actions: take all of theirs, take all of
mine, decide per verse. A resolution is one `text.verse.set` with `supersedes` naming
every live head (R-8.3.5). A provisional verse carries a marker in Translate. Retained
heads appear read-only with the closed reason vocabulary in plain words. Acceptance:
component tests over a `Report` fixture; a resolution yields zero forks and both heads
superseded; e2e shows the fork visible, resolvable, and gone on the other device after
receive; no modal wall. This is I8's test.

### S7 — Performance prerequisites (#94, #95)

Finish #95 (one journal scan per open) and #94 (fold in a Web Worker); #92 and #93
closed 2026-08-25 by PR #97 (97016a8). Add `tc4 bench --receive`. Acceptance: receive
of the existing default bench corpus (aligned New Testament, 15,945 events,
`docs/evidence/bench-fold-2026-08-25.md:25-27`) into a working repository holding ten
unsent own segments completes in under 10 s on the bench machine named in that record;
no UI-thread fold runs during receive. Whole-Bible receive time is recorded as a
measurement, not an acceptance.

### S8 — Journey proof and CI

The two-actor journey (Section 6) as a scenario file on the rig runner plus a
Playwright e2e that compares the UI's `Report` with the command line's. A rig CI job
runs the rig-gated suites, including T5–T7 (never on a clean clone; never with a
pankosmia remote). Acceptance: e2e green with an evidence record; transport 13/13; the
CI job's last run linked from the record.

### S9 — Documentation

ARCHITECTURE §9 describes the repositories per device and points to `docs/SYSTEM.md`
for `syncEngine` and `publicationStore`. RISKS gains rows for journal scale, identity
store loss, power-loss durability, and sync data loss, each naming the check that
mitigates it. `docs/SYSTEM.md` records I1–I6 beside their `R-8.7.n` ids and I7, I8 as
app rules. `docs/LEGACY-IDS.md` is frozen (D44(b)) and is not edited. Issue #79's two
covered criteria are ticked with the covering test names. Acceptance: docs gate green;
`npm run verify` green.

## 6. The journey

Actor A and actor B each open the same project, seeded from the sample burrito, on
separate installations. B's device is the team's integrator (D67(4b)). A drafts TIT 1:2
and sends; B integrates it. B drafts TIT 1:3, sends, integrates, and receives. A,
offline, drafts TIT 1:1, edits TIT 1:3 to a different text with the same `base` as B's
edit, and has one action still in the outbox. A comes online and receives. Expected:
A's working repository has A's TIT 1:1, 1:2, 1:3 and the former outbox action as a
committed segment, and A's outbox is empty; TIT 1:3 shows a fork with A's head and B's
head (R-8.3.2); A picks one; the resolution sends; B integrates and receives; B sees no
fork and A's chosen TIT 1:3; both projects fold to the same state. Then A's device
loses power during a receive between the two moves; the next open completes or rolls
back the swap; no own byte is missing.

## 7. Epic acceptance

- §8.7 sync block is normative with `R-8.7.7` to `R-8.7.12`, §1 is amended, and the
  normative gate passes (S1).
- The journey passes as an e2e on the rig, and transport T5–T7 are green (S8).
- `verifyProjectAgainstJournal` holds on every working repository and team main mirror
  the journey touched. Publication repositories are checked by the S2 path test, because
  they hold no projection of their own fold.
- No open finding from the adversarial review of S4 and S5 remains.
- A GitHub Release notes the milestone (D46).

## 8. Reversibility

Every item adds repositories, code paths, and events of existing ops. No item rewrites a
stored byte or changes §8.1–8.6. S1 changes §1 wording and §8.7 status; both document
behavior the harness proves, and both revert with the code. If sync is withdrawn after
S5 ships, working repositories remain valid single-actor projects; publication and
team repositories can be deleted. The one irreversible action is the swap, which is why
S5 and X5 spend most of their criteria on it.

## 9. Decided in the change sets, not here

These design points were raised during review and are deliberately left open. Each is
decided in the named change set, recorded there, and, where it touches the format,
lands through §9.

- L-3: `Report` field shapes; the negative-control convention and whether the
  normative gate enforces it for new rules and codes.
- X2: the mechanism for negative controls in scenarios (fault injection or otherwise).
- X4: oracles for the CLI-only verbs.
- X5: ops-record phase names and the per-phase recovery rule.
- S5: whether tolerated unjournaled ingredients (audio) get a rule, a code and a test,
  once the class is in use.
- S5: whether the own publication needs a distinct code when its intake refuses.
