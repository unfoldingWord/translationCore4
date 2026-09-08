# User journeys

**Status:** the only list of user journeys [decided 2026-09-06 — D69].
**Rules:**

- A journey is a goal one actor pursues, defined by its **end state** on disk (CONTEXT.md).
  UI state alone never counts as done.
- `Jn` is a stable identifier. A retired number is never reassigned.
- Journal conformance checks are `JC-n`, not `Jn` (BURRITO-SPEC Appendix A).
- Steps are in the actor's terms. Their order is not prescribed.
- Every `Jn` has one primary activity, one owner, and one proof row. A proof row that does
  not resolve, or a spec that cites `JOURNEYS-AND-GAPS`, is a defect. `npm run docs:gate`
  checks this (#199): a cited spec exists, a shipped row cites a live test, and every
  `e2e/j*.spec.ts` is cited by a row. The gate never runs a test.
- The proof steps are build and test requirements. They are never gates for the user.
- "An increment moves at least one `Jn` to shipped" replaces the ROADMAP rule "an increment
  completes a journey."

Status values: **shipped** (tag) · **built** (in main, no tag yet) · **increment N** ·
**Phase 2** · **vision** · **retired**.

Owner of increment numbers: the GitHub milestones, mirrored in `docs/ROADMAP.md`.

## Index

| ID | Actor | Activity | Goal | Status | Proof |
|---|---|---|---|---|---|
| J1 | facilitator | Start | Create a Bible project and add books | shipped alpha.1 | `e2e/j01-create-project.spec.ts` |
| J2 | translator | Translate | Draft verses beside the sources | shipped alpha.1; revised end state (D70) shipped alpha.5 | `e2e/j02-draft-verse.spec.ts` |
| J3 | facilitator | Start | Get pinned resources | shipped alpha.2 | `e2e/j03-get-resources.spec.ts` |
| J4 | translator | Check | Check a book with tN and tW | shipped alpha.2 | `e2e/j04-check-book.spec.ts` |
| J5 | translator | Check | Align a verse | shipped alpha.2 | `e2e/j05-align-verse.spec.ts` |
| J6 | translator | Translate | Edit a checked verse and see the checks flag | shipped alpha.2 | `e2e/j06-edit-invalidation.spec.ts` |
| J7 | facilitator | Deliver | Export the book | increment 7 (#19 USFM, #20 PDF); RTL run #29 Post-4.0 | `e2e/j07-publish.spec.ts` (fixme) |
| J8 | translator | Translate | Resume work across sessions and books | built (2026-09-05) | `e2e/j08-resume.spec.ts` |
| J9a | facilitator | Exchange | Import a tC3 project | increment 7 | `e2e/j09-import.spec.ts` (fixme) |
| J9b | facilitator | Exchange | Import an x-tcore project | increment 7 | `e2e/j09-import.spec.ts` (fixme) |
| J9c | facilitator | Exchange | Import raw USFM | increment 7 (#195) | `e2e/j09-import.spec.ts` (to write) |
| J9d | facilitator | Exchange | Import a Scripture Burrito | increment 7 (#196) | `e2e/j09-import.spec.ts` (to write) |
| J10 | — | — | retired: RTL is a fixture axis on J2, J4, J5, J7 | retired | both runs listed on each of those rows; `e2e/j10-rtl.spec.ts` stays until they exist |
| J11 | facilitator | Exchange | Send the project to Door43 | Phase 2 | none |
| J12 | facilitator | Start | Upgrade the pinned resources | increment 6 | `e2e/j12-upgrade-resources.spec.ts` (fixme) |
| J13 | facilitator | Start | Change the gateway-language resource set | shipped alpha.2 | `e2e/j13-gateway-change.spec.ts` |
| J14 | — | — | retired: isolation is a MUST NOT row on J1 and J2 | retired | `e2e/j14-join-isolation.spec.ts` stays |
| J15 | — | — | retired: slow open is a quality requirement on opening a project | retired | `e2e/j15-slow-open.spec.ts` stays, cited by a FR |
| J16 | translator | Understand | Read a passage with helps and record a user comment | shipped alpha.5 | `e2e/j16-understand.spec.ts` |
| J17 | translator | Exchange | Receive a project and continue offline | Phase 2 | none |
| J18 | translator | Check | Resolve a verse fork | Phase 2 | none |
| J19 | consultant | Check | Record findings on a translation | Phase 2 | none |
| J20 | facilitator | Start | Create an OBS project | vision (D66) | none |
| J21 | translator | Translate | Translate a story frame by frame | vision (D66) | none |
| J22 | translator | Check | Check an OBS story | vision (D66) | none |
| J23 | facilitator | Deliver | Export an OBS project as Markdown and PDF | vision (D66) | none |
| J24 | facilitator | Exchange | Send an OBS project to DCS | vision (D66) | none |

## Entries

Each entry: actor · activity · goal · precondition · steps · end state · VISION commitment ·
MUST NOT · proof · owner. Entries for shipped journeys take their end state from the spec.

### J1 Create a Bible project

- Actor: facilitator. Activity: Start.
- Precondition: fresh install (first run and UI language choice are steps here).
- Steps: first run · choose UI language · choose target language and script direction · name the
  project · add one or more books.
- End state: one new git repository that is a valid Scripture Burrito after the create-project and
  add-book checkpoints (three commits or more, D9); one USFM ingredient per added book; its own
  actor id.
- MUST NOT: touch any other project repository (from J14: a second project is a second repo with
  a different actor id, and the first stays byte-identical).
- Proof: `e2e/j01-create-project.spec.ts` + `e2e/j14-join-isolation.spec.ts`.
- Owner: shipped alpha.1.

### J2 Draft verses beside the sources

- Actor: translator. Activity: Translate.
- Precondition: J1.
- Steps: open a book · read the sources · read the original-language pane · type a section straight through · place the verse
  numbers · stack two verse numbers to make a verse span, or drag one past text to break one ·
  leave the section · see progress update. The verse-by-verse form (type one verse, leave it)
  stays available.
- End state (revised 2026-09-06, D70): the section's verse texts in the book's USFM ingredient
  with every verse number placed; text outside the edited verses byte-identical; one
  `text.verse.set` segment per changed verse; when a span was created or broken, one
  `text.structure.apply` action with the new skeleton and conservative dispositions, and the
  alignments and decisions on the affected verses marked invalid and kept. Save indicator at
  `saved` is a step, not the end state.
- MUST NOT: write to any other project (J14 rule); commit on every save (D9: commits at
  checkpoints); re-key an alignment or a decision (Increment 5 uses `invalidate-retain` only).
- Proof: `e2e/j02-draft-verse.spec.ts`, run LTR and RTL (J10 axis); the section and span cases
  are added by #141 and #63.
- Owner: shipped alpha.1 (verse form); revised end state shipped alpha.5 (#141, #63).

### J3 Get pinned resources

- Actor: facilitator. Activity: Start.
- Steps: choose the gateway language · pick the resource set · download.
- End state: §5.3 pins with `sha`, `repoPath`, and a `version` that is not `master`; the pinned
  resources are installed and match the pins; the helps open offline; a missing resource shows
  its missing state.
- Proof: `e2e/j03-get-resources.spec.ts` (installed state, pins, offline, missing states);
  `test/resourceFetch.test.ts` (download and sha verification). Pending: a proof that text
  ingredients are unchanged. Owner: shipped alpha.2.

### J4 Check a book

- Actor: translator. Activity: Check.
- Steps: open the derived tW/tN list · read a note or article · triage an item.
- End state: `check.decision.set` segments in the journal; §5.2 sidecar at checkpoint; text
  unchanged.
- Proof: `e2e/j04-check-book.spec.ts`, LTR and RTL. The teardown verifier proves the project
  matches its journal. Pending: a direct before-and-after compare of the book bytes. Owner:
  shipped alpha.2.

### J5 Align a verse

- Actor: translator. Activity: Check.
- Steps: link and unlink word pairs.
- End state: `align.verse.set` segments; §5.1 sidecar at checkpoint; text unchanged.
- Proof: `e2e/j05-align-verse.spec.ts`, LTR and RTL. Pending: a direct before-and-after compare
  of the book bytes (same as J4). Owner: shipped alpha.2.

### J6 Edit a checked verse

- Actor: translator. Activity: Translate (touches Check).
- Steps: edit a verse that has decisions · see the affected checks flagged.
- End state: new verse text; affected decisions invalidated and retained (§5.2, D36); nothing
  deleted.
- Proof: `e2e/j06-edit-invalidation.spec.ts`. Owner: shipped alpha.2.

### J7 Export the book

- Actor: facilitator. Activity: Deliver (lives inside Check, Community Checking — D63).
- Steps: preview the typeset text · choose an export · save it outside the project.
- End state: files written outside the project directory: PDF with a date; aligned USFM with a
  date if the format allows; plain USFM without alignment; a Scripture Burrito. The project is
  byte-identical except the D9 checkpoint commit. No publish record in the project.
- MUST NOT: write anything else into the project.
- Proof: `e2e/j07-publish.spec.ts`, LTR and RTL.
- Owner: Increment 7: #19 for the aligned USFM, plain USFM, and Scripture Burrito exports; #20
  for the dated PDF (moved from Post-4.0, owner ruling 2026-09-06). The RTL run (#29) stays
  Post-4.0. J7 is shipped only when all four outputs have proof.

### J8 Resume work

- Actor: translator. Activity: Translate.
- Steps: leave Translate or the project · come back later · open another book.
- End state: leaving with uncommitted changes makes exactly one checkpoint commit, message prefixed
  `Checkpoint, leaving Translate:` or `Checkpoint, leaving the project:`; leaving without changes
  makes none; the last draft is what reopens.
- Proof: `e2e/j08-resume.spec.ts` (#184, #185; the share leg is fixme until #120). Owner: built in Increment 4; tag pending.

### J9a–J9d Import

- Actor: facilitator. Activity: Exchange.
- Sources: a) tC3 project · b) x-tcore copy · c) raw USFM · d) Scripture Burrito.
- End state (all four): one new project repository, valid Scripture Burrito; imported segments
  carry `seed.source`; imported text byte-identical to the source text.
- MUST NOT (all four): create a project or write anything on disk from damaged or incomplete
  input.
- Proof: `e2e/j09-import.spec.ts` (fixme; c and d need new cases). Owner: Increment 7 (#21, #14, #195, #196, #41).

### J11 Send to Door43 (Phase 2)

- Actor: facilitator. Activity: Exchange.
- Steps include the D7 identity exposure notice before the first push.
- End state: [Phase 2, to define when §8 sync ops ratify].

### J12 Upgrade the pinned resources

- Actor: facilitator. Activity: Start (touches Check).
- Steps: see the upgrade offer · accept explicitly · re-derive.
- End state: new pins; decisions carried over or invalidated and retained (D36); text byte-identical.
- MUST NOT: upgrade silently (resource-handling stance 2026-07-12).
- Proof: `e2e/j12-upgrade-resources.spec.ts` (fixme). Owner: increment 6 (#40).

### J13 Change the gateway-language resource set

- Actor: facilitator. Activity: Start.
- Precondition: two gateway-language suites are installed (the rig holds English and Spanish).
- Steps: open sources · choose the other language for checking · confirm the change explicitly.
- End state: the primary pins name the new language set with `version`, `sha`, `repoPath`; the
  English fallback set stays unchanged (D30, §5.3); decisions re-attach to the new set, or are invalidated and
  retained (D36). The sources modal and its confirmation are steps.
- Proof: `e2e/j13-gateway-change.spec.ts`. Owner: shipped alpha.2.

### J16 Read a passage with helps and record a user comment

- Actor: translator. Activity: Understand.
- Precondition: J3.
- Steps: open the passage · open a source tab (ULT or UST) · open a translation note · open an
  Academy article · write a user comment. The proof MUST walk the three help steps.
- End state: one `note.add` segment bound to the passage; text ingredients byte-identical.
  Reading without a comment is not a journey.
- Term: the user-facing word is "user comment". The journal op stays `note.add` (BURRITO-SPEC §8.5).
- Proof: `e2e/j16-understand.spec.ts` (#117 adds the non-eng frame axis). Owner: built Increment 4 (#104); proof Increment 5 (#197).

### J17–J19 (Phase 2)

- J17 translator receives a project and continues offline.
- J18 translator resolves a verse fork through the reviewQueue.
- J19 consultant records findings without drafting.
- End states: defined when the §8 sync operations ratify (issue #22).

### J20–J24 (vision, D66)

Create an OBS project · translate frame by frame · check a story · export Markdown and PDF ·
send to DCS. End states follow the OBS content model (format question #147).

## Retired numbers

- J10 RTL: an axis, not a journey. Each of J2, J4, J5, J7 lists both runs in its proof.
- J14 join isolation: a MUST NOT row on J1 and J2. The spec stays.
- J15 slow open: a quality requirement on opening a project, cited by a FR. The spec stays.
