# Team sync plan — epic #24

Status: [PROPOSED] plan, adopted as the shape of epic #24 by D67 (2026-09-02). Rules
named here become normative only when the S1 change set lands them in
`docs/BURRITO-SPEC.md` §8.7 with their checks (§9). Written against `main` after the
audit of 2026-09-01 [VERIFIED — worktree at 60be039, see D67].

Prerequisite: the legibility increment (`LEGIBILITY.md`) must close first (D67(2)).

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
one adapter. Layers 0–3 obey this today (`src/data/journal/runtime.ts`). Layer 5 must
obey it, or the protocol exists in three places.

### 1.2 One report vocabulary

Every operation reports in one closed schema, `Report v1`, defined in one module and
validated by one check. The fold report already has this shape. The `retained[]`
reasons are already closed (R-8.6.9).

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
  upheld:    [ R-ids this run verified ]
  durations: { phase: ms }
}
```

The UI renders `Report`. The command line prints `Report`. Tests assert on fields, not
on message strings. Evidence records are arrays of `Report` with a header.

### 1.3 Refusal codes

A refusal is a code bound to a rule and one recovery action. First set:

| code | rule | recovery |
|---|---|---|
| `segment.invalid` | R-8.1.6 | republish from the outbox (automatic) |
| `segment.differs-from-accepted` | R-8.1.5 | stop; show both hashes; never overwrite |
| `segment.foreign-actor` | R-8.1.12 | refuse the contribution; report the actor |
| `segment.misnamed` | R-8.1.2 | refuse the contribution |
| `intake.shared-path` | R-8.7.9 | refuse the contribution |
| `receive.own-ts-missing` | R-8.7.12 | keep the working repository; report the missing `ts` |
| `swap.incomplete` | R-8.7.13 | finish forward or roll back on open |
| `checkpoint.divergence` | R-8.7.5 | reopen to reconcile |
| `seed.mismatch` | R-8.8.2 | stop; show the mismatch set |

The normative gate checks that every code names a live rule and has a negative control.

### 1.4 Every operation leaves a record

Each layer 4 and layer 5 operation writes one ops record (a `Report`) to the
installation store before it starts and rewrites it once at the end, with the same
durable barrier the outbox uses. Recovery on open reads the last incomplete record. The
ops log is device-local and never enters the burrito, so journal `v: 1` is untouched.

### 1.5 Scenarios are data

Scenario files under `conformance/scenarios/` describe actors, steps (`edit`, `send`,
`integrate`, `receive`, `kill`, `open`) and expectations in `Report` terms. Three
runners execute one file: reference (memory port), git (filesystem port), rig (HTTP
port). A new question is a new file, not a new harness.

### 1.6 Evidence accretes

`npm run prove` writes `evidence/manifest.json`. A docs gate fails when a
manifest-derived statement in `docs/` disagrees with it. Each release freezes the
journey-written journals and their fold hashes under `conformance/golden/<version>/`;
one check folds every frozen corpus.

### 1.7 The driver's console

`tc4` is a Node command line over the HTTP adapter that imports the same modules as the
app: `open`, `send`, `receive`, `integrate`, `verify`, `report`, `ops`, `explain`,
`fold`, `scenario`, `prove`, `bench`. `explain <repo> <key>` answers why a verse shows
its text: live heads, bases, structural branch, supersedes, generation, retained
reasons, and the rule that decided each step. A dev-only Inspector panel in the app
renders the same `Report` and `explain` output.

## 2. Invariants (become `R-8.7.x` in S1)

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
- I7 Identity is preserved. The replacement lands at the same repository path (D53c).
- I8 Forks are legible. After a receive, every fork, retained head and pending
  structural event is shown. The project stays open (D53e).

## 3. Platform constraints

[VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30); `git2` inventory re-read
2026-09-02]

- One merge endpoint, `POST /git/pull-repo/<remote>/<repo>`, no branch parameter
  (PLATFORM-NOTES #17, #33). One publication repository per actor with one branch makes
  it deterministic.
- After a normal merge the worktree is not trustworthy (#21). The integrator writes the
  validated union by ingredient writes.
- `add-and-commit` panics on a repository with no commits (#20).
- Move primitive: `POST /git/copy/<repo>?target_path=&delete_src=true`. A swap needs
  two moves; they are not atomic together (D67(4a)).
- `POST /git/push` and `POST /git/clone-repo?branch=` exist; clone is https-only. Every
  remote call is behind the platform net gate.
- Repository paths are exactly three segments (`serverApi.assertRepoPath`).

## 4. Repositories per device per project

| Role | Path | Branch | Written by |
|---|---|---|---|
| Working projection (canonical) | `_local_/_local_/<name>` | `main` | the app, every mutation |
| Own publication | `_local_/_pub_/<name>` | `<actorId>` | send (S2) |
| Team main mirror | `_local_/_team_/<name>` | `main` | integrate (S4), receive (S5) |
| Scratch (disposable) | `_local_/_scratch_/<name>-<hlc>` | any | S4, S5; deleted after use |
| Previous working (recovery copy) | `_local_/_prev_/<name>` | `main` | S5 swap; deleted at the next checkpoint |

## 5. Work items

Foundation items X0, X1, X3, X6 and `docs/SYSTEM.md` are delivered by the legibility
increment (`LEGIBILITY.md`) and are not repeated here.

Dependency order:

```
LEGIBILITY closes ─▶ X2 sync reference module ─▶ S1 ratify §8.7 (rules + scenarios)
                                                    ├─▶ S2 send adapter ─▶ S3 transports
                                                    ├─▶ S4 integrate adapter ─▶ S5 receive adapter
                                                    └─▶ S6 fork view (reads Report)
X4 CLI + Inspector    X5 ops log for sync    X7 golden corpus    S7 performance    S8 journey    S9 docs
```

### X2 — Sync engine as a reference module

`journal/sync.mjs` exports `send(port, ctx)`, `integrate(port, ctx)`, `receive(port,
ctx)`: orchestrations over the repository port that return a `Report`. The app imports
the engine as it imports the fold. Acceptance: `receive` over the memory port reproduces
the receive-with-unsent simulation (15 checks) as a scenario file; J18–J20 pass as
scenarios over the git port; the same scenarios pass over HTTP on the rig; a two-device
property over edit, send, integrate, receive, kill upholds conservation, exclusivity and
R-8.7.12 with non-vacuity asserted.

### X4 — `tc4` command line and Inspector

As in 1.7. Acceptance: each verb has a rig-gated test that compares its `Report` to the
app's for the same action; `explain` for a forked verse names both heads, their bases,
and R-8.6.4.

### X5 — Ops log for sync operations

Layer 5 operations write ops records (1.4). The swap intent is an ops record; `open()`
recovery reads it. Acceptance: a kill sweep shows an incomplete record is always
completed or rolled back on the next open, never two candidates.

### X7 — Golden corpus accretion

The release script freezes the journey-written journals under
`conformance/golden/<version>/`. One check folds every frozen corpus and compares
hashes. Acceptance: first corpus frozen at the next release; a one-byte change to a
frozen segment fails with `segment.invalid`.

### S1 — Ratify §8.7 as rules and scenarios

Rules R-8.7.7 to R-8.7.14 (from §2), the refusal codes (1.3), and the two platform
caveats. Harness: scenario files for receive with unsent work, swap ordering,
flush-then-receive equivalence, carry-over refusals; J32f gains a `receive` command;
transport gains T5–T7. Acceptance: normative gate passes with the new ids; every new
check has a negative control; `validate:transport` 13/13 recorded with version, hash,
date; a D-number records the ratification and marks D55 superseded in part.

### S2 — Send (adapter over `sync.send`)

First send creates `_local_/_pub_/<name>` by `git/copy`, `new-branch/<actorId>`,
ingredient deletes outside the own journal directory, `add-and-commit`. `send()` is a
flush: own segments not yet in the publication, validated, then the outbox replayed
into both working and publication, then one commit. Idempotent. Works with the net gate
off. Acceptance: publication commits touch only own journal paths (spy test); after
`send()` every own segment in working ∪ outbox is in the publication byte-identical
under a kill sweep; a planted foreign segment is refused and surfaced.

### S3 — Transports: Door43 and sneakernet

Door43 send: `remote/add` then `git/push`. Receive side: `clone-repo?branch=<actorId>`
or `remote/add` plus `pull-repo` into a single-branch scratch. Sneakernet: export the
publication repository as a wrapped zip (`PLATFORM-NOTES` #26 trap b); import under
`_local_/_sideloaded_/`. Team main travels as a Door43 branch or a zip (D67(4b)).
Acceptance: push and clone work against the rig's gitea proxy or are recorded as needing
live Door43; a publication zip round-trips byte-identically; net off disables Door43
controls and leaves sneakernet working.

### S4 — Integrate (adapter over `sync.integrate`)

The T3/T4 recipe: copy team main to scratch; add remote; `pull-repo`; read the
contribution's segments from the contribution repository, never the scratch worktree
(#21); whitelist check (R-8.7.9); write accepted segments by ingredient writes; fold;
regenerate; `remakeIngredients`; commit; fast-forward team main; delete scratch. Anyone
may integrate (D67(4d)). Acceptance: every J20 rejection case reproduced with main HEAD
unchanged; two contributions integrate in either order to the same fold; a crash at every
durable boundary leaves main before or after, never between.

### S5 — Receive (adapter over `sync.receive`)

1. Drain the SaveScheduler; refuse while a write failure stands.
2. Copy team main to scratch; add the own publication as a remote; `pull-repo`.
3. Carry over own work: each own segment in the working repository is validated,
   filename-checked, actor-checked; a path present in scratch with different bytes
   refuses the whole receive; otherwise written. Replay every outbox entry into
   scratch. Record the refused list.
4. Verify: every own `ts` from working ∪ outbox is in the scratch union; fold;
   `verifyProjectAgainstJournal` on the regenerated scratch. On failure delete scratch
   and report; the working repository is untouched.
5. Regenerate derived files; `remakeIngredients`; commit.
6. Swap: write the intent record; move working to `_local_/_prev_/<name>`; move
   scratch to the working path; update the phase after each move; then clear the
   carried outbox entries and the record (D67(4a)).
7. Recovery on open: an incomplete record is finished forward when scratch validates,
   or rolled back when the previous copy exists and the working path is absent.
8. Report: the fold's forks, retained, pending structural, plus the carry-over report,
   become the `OpenReport` for S6. Ratchet the HLC over the received union (R-8.2.4).
9. The previous copy is deleted at the next successful checkpoint.

Design B (flush, then receive) is the documented alternative for step 3. The plan
keeps Design A because it does not make sending a precondition of receiving.

Acceptance: replacement fold equals `fold(main ∪ working ∪ outbox)`; a conflicting own
edit is a visible fork; the four carry-over refusals are reported; R-8.7.12 negative
control refuses; kill sweep across steps 2–7, including between the two moves, ends
with one working repository at the original path and every own byte present; actor id
unchanged; rig test of the two moves; whole-Bible receive time recorded (S7).

### S6 — Show forks and receive results (D53e; epic #25)

A non-modal summary after open and receive. A fork list with each head's text, actor
and time, and which head is provisional. Three actions: take all of theirs, take all of
mine, decide per verse. A resolution is one `text.verse.set` with `supersedes` naming
every live head (R-8.3.5). A provisional verse carries a marker in Translate. Retained
heads appear read-only with the closed reason vocabulary in plain words. Acceptance:
component tests over a fold report fixture; a resolution yields zero forks and both
heads superseded; e2e shows the fork visible, resolvable, and gone on the other device
after receive; no modal wall.

### S7 — Performance prerequisites (#92–#95)

Finish #95 (one journal scan per open) and #94 (fold in a Web Worker). Add `tc4 bench
--receive`. Acceptance: New Testament receive under 10 s on the reference machine; the
whole-Bible number recorded with a determinate progress bar; no UI-thread fold during
receive.

### S8 — Journey proof and CI

The two-actor journey (below) as a scenario file on the rig runner plus a Playwright
e2e that compares the UI's `Report` with the command line's. `validate:transport` gains
T5 receive-with-unsent, T6 swap kill, T7 carry-over refusals. A rig CI job runs the
rig-gated suites (never on a clean clone; never with a pankosmia remote). Acceptance:
e2e green with an evidence record; transport 13/13; the CI job's last run linked from
the record.

### S9 — Documentation

ARCHITECTURE §9 describes the five repositories per device. RISKS gains rows for
journal scale, identity store loss, power-loss durability, and sync data loss.
LEGACY-IDS gains I4.3.1–I4.3.5. Issue #79's two covered criteria are ticked.

## 6. The journey

Actor A and actor B each open the same project on separate installations. A drafts 1:2
and sends. B drafts 1:3, sends, and receives. A, offline, drafts 1:1, edits 1:3 to a
different text, and has one action still in the outbox. A receives. Expected: A's
working repository has A's 1:1, 1:2, 1:3 and the outbox action; 1:3 shows a fork with
B's head listed; A picks one; the resolution sends; B receives; B sees no fork and A's
chosen 1:3; both projects fold to the same state. Then A's device loses power during a
receive between the two moves; the next open completes or rolls back the swap; no own
byte is missing.

## 7. Epic acceptance

- §8.7 sync block is normative with `R-8.7.x` ids and the normative gate passes.
- The journey passes as an e2e on the rig, and transport T5–T7 are green.
- `verifyProjectAgainstJournal` holds on every repository the journey touched.
- No open finding from the adversarial review of S4 and S5 remains.
- A GitHub Release notes the milestone (D46).

## 8. Reversibility

Every item adds repositories, code paths, and events of existing ops. No item rewrites a
stored byte or changes §8.1–8.6. If sync is withdrawn after S5 ships, working
repositories remain valid single-actor projects; publication and team repositories can
be deleted. The one irreversible action is the swap, which is why S5 spends most of its
criteria on it.
