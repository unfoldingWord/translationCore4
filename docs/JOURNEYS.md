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
| J4 | translator | Check | Check a book with tN and tW | shipped alpha.2; revised end state (D72) shipped alpha.6 | `e2e/j04-check-book.spec.ts` |
| J5 | translator | Check | Align a verse | shipped alpha.2; revised end state (D72) shipped alpha.6 | `e2e/j05-align-verse.spec.ts` |
| J6 | translator | Translate | Edit a checked verse and see the checks flag | shipped alpha.2 | `e2e/j06-edit-invalidation.spec.ts` |
| J7 | facilitator | Deliver | Export the book | increment 8 (D79): kernel #375; #19 USFM, #359 Scripture Burrito zip, #20 PDF; RTL run #29 Post-4.0 | `e2e/j07-publish.spec.ts` (`@inc8 @J7`; fixme until #375) |
| J8 | translator | Translate | Resume work across sessions and books | built (2026-09-05) | `e2e/j08-resume.spec.ts` |
| J9a | facilitator | Exchange | Import a tC3 project as a new project | increment 8 (D79): shell #361, parser #21 | `e2e/j09-import.spec.ts` (`@inc8 @J9`; fixme until #361) |
| J9b | facilitator | Exchange | Import an x-tcore project | retired: closed without data (D79 point 8; #14) | none |
| J9c | facilitator | Exchange | Import raw USFM as a new project | increment 8 (D79): shell #361, parser #195 | `e2e/j09-import.spec.ts` (`@inc8 @J9`; to write) |
| J9d | facilitator | Exchange | Import a Scripture Burrito as a new project | increment 8 (D79): shell #361, parser #196 | `e2e/j09-import.spec.ts` (`@inc8 @J9`; to write) |
| J10 | — | — | retired: RTL is a fixture axis on J2, J4, J5, J7 | retired | both runs listed on each of those rows; `e2e/j10-rtl.spec.ts` stays until they exist |
| J11 | facilitator | Exchange | Share the project to Door43 (first share pushes `main`) | increment 8.5 (D79): #362, #203, #120, #185 | `e2e/j11-share.spec.ts` (`@inc85 @J11`; to write) |
| J12 | facilitator | Start | Upgrade the pinned resources | shipped alpha.6 (#256, #257; D72) | `e2e/j12-upgrade-resources.spec.ts` |
| J13 | facilitator | Start | Change the gateway-language resource set | shipped alpha.2 | `e2e/j13-gateway-change.spec.ts` |
| J14 | — | — | retired: isolation is a MUST NOT row on J1 and J2 | retired | `e2e/j14-join-isolation.spec.ts` stays |
| J15 | — | — | retired: slow open is a quality requirement on opening a project | retired | `e2e/j15-slow-open.spec.ts` stays, cited by a FR |
| J16 | translator | Understand | Read a passage with helps and record a user comment | shipped alpha.5 | `e2e/j16-understand.spec.ts` |
| J17 | translator | Exchange | Receive a project and continue offline | Phase 2 | none |
| J18 | translator | Check | Resolve a verse fork | Phase 2 | none |
| J19 | consultant | Check | Record findings on a translation | Phase 2 | none |
| J20 | facilitator | Start | Create an OBS project | shipped alpha.7 (#287; D74) | `e2e/j20-obs-create.spec.ts` |
| J21 | translator | Translate | Translate a story frame by frame | shipped alpha.7 (#289, #292; D74) | `e2e/j21-obs-draft.spec.ts` |
| J22 | translator | Check | Check an OBS story | shipped alpha.7 (#291, #292; D74) | `e2e/j22-obs-check.spec.ts` |
| J23 | facilitator | Deliver | Export an OBS project as Markdown and PDF | increment 8 (with J7, one PDF path; D74, D79): #360, #359, layouts #11 | `e2e/j07-publish.spec.ts` (`@inc8 @J23`; OBS block to add) |
| J24 | facilitator | Exchange | Share an OBS project to Door43 | increment 8.5, rides J11 (D79 point 12) | `e2e/j11-share.spec.ts` (the OBS case, `@J24`) |
| J25 | translator | Understand | Read a story with helps and record a user comment | shipped alpha.7 (#290, #292; D74) | `e2e/j25-obs-understand.spec.ts` |

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
- Steps: open the derived tW/tN list · read a note or article · triage an item · write a check
  comment · set a bookmark.
- End state (revised 2026-09-11, D72): `check.decision.set` segments in the journal; §5.2
  sidecar at checkpoint; text unchanged. A check comment and a bookmark are fields of the same
  decision record (`comments`, `reminders`) and survive reopening; clearing a comment writes
  the field back to `false`. Neither changes progress.
- MUST NOT: write a check comment anywhere but the decision record; count a bookmarked or
  commented item differently from an unmarked one.
- Proof: `e2e/j04-check-book.spec.ts`, LTR and RTL; the comment and bookmark cases are added
  by #50. The teardown verifier proves the project matches its journal. Pending: a direct
  before-and-after compare of the book bytes. Owner: shipped alpha.2 (triage form); revised
  end state shipped alpha.6 (#50).

### J5 Align a verse

- Actor: translator. Activity: Check.
- Steps: link and unlink word pairs · turn suggestions on · confirm or reject each suggested
  link, or accept or reject them all.
- End state (revised 2026-09-11, D72): `align.verse.set` segments; §5.1 sidecar at checkpoint;
  text unchanged. When suggestions are on, an accepted suggestion writes the same segment as a
  manual link, and a suggestion that was shown and not accepted leaves no trace in the journal
  or the sidecar.
- MUST NOT: write an unconfirmed suggestion; count a verse as resolved or a suggested word as
  placed while a suggestion stands; store the suggestions switch in the project.
- Proof: `e2e/j05-align-verse.spec.ts`, LTR and RTL; the suggestion cases are added by #1.
  Pending: a direct before-and-after compare of the book bytes (same as J4). Owner: shipped
  alpha.2 (manual form); revised end state shipped alpha.6 (#262: #255, #134, #213, #1).

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
- Proof: `e2e/j07-publish.spec.ts`, tags `@inc8 @J7`; the LTR run is the gate.
- Owner: Increment 8 (D79). The export kernel #375 (one contract, one transactional wrapper,
  one download path, one menu) carries every producer: #19 aligned and plain USFM, #359 the
  Scripture Burrito zip (with the `relationships` mirror in the exported `metadata.json`), #20
  the dated PDF by the print-styled route. The RTL run (#29) stays Post-4.0. J7 is shipped only
  when all four outputs have proof.

### J8 Resume work

- Actor: translator. Activity: Translate.
- Steps: leave Translate or the project · come back later · open another book.
- End state: leaving with uncommitted changes makes exactly one checkpoint commit, message prefixed
  `Checkpoint, leaving Translate:` or `Checkpoint, leaving the project:`; leaving without changes
  makes none; the last draft is what reopens.
- Proof: `e2e/j08-resume.spec.ts` (#184, #185; the share leg is fixme until #120). Owner: built in Increment 4; tag pending.

### J9a–J9d Import

- Actor: facilitator. Activity: Exchange.
- Sources: a) tC3 project · b) x-tcore copy (closed without data, D79 point 8) · c) raw USFM ·
  d) Scripture Burrito.
- End state (a, c, d): one **new** project repository, valid Scripture Burrito at its first
  commit; imported segments carry `seed.source`; imported text byte-identical to the source
  text. Import never writes into an existing project in 4.0.0 (D79 point 7; the into-existing
  flow with a conflict review is #365, 4.1.0).
- MUST NOT (all): create a project or write anything on disk from damaged or incomplete input;
  leave a partial repository after a failed write (the shell deletes it).
- Proof: `e2e/j09-import.spec.ts`, tags `@inc8 @J9`: one shell block (#361), one block per
  parser (#195, #196, #21), one damaged block (#41) driven by `conformance/fixtures/import/MANIFEST.json`.
  Owner: Increment 8 (D79).

### J11 Share the project to Door43

- Actor: facilitator. Activity: Exchange (lives in Check, Community Checking, beside Export).
- Steps: press Share · on the first share of the session, sign in to Door43 with username and
  password; on the first share of the installation, also give a name and an email and read the
  D7 exposure notice · name the repository (default: the project's folder name) · the app
  creates the repository under the user's account, adds it as `origin`, pushes the working
  `main` branch · the app shows the repository URL.
- End state: the repository exists on the Door43 server the app was launched against, with
  `main` equal to the local `main`; the project is byte-identical except the D9 checkpoint
  commit; `origin` is set in the repository's git config; nothing about remotes is stored in
  the installation; the token exists in renderer memory only. A later share pushes `main`
  again with no dialog when the session has a token.
- Refusals (each a `Report` code, nothing pushed): the name exists on the account; the push is
  not a fast-forward, because another device pushed (the message says team sync is coming and
  local work is safe); the app is offline; sign-in failed; the create was rejected.
- MUST NOT: create a publication branch or an outbox; integrate or receive; force-push; write
  the token to disk, a URL or a log; write anything into the project.
- Proof: `e2e/j11-share.spec.ts`, tags `@inc85 @J11`. The live leg against `qa.door43.org`
  runs when the QA credentials are present and reports a labelled skip otherwise (#185).
- Owner: Increment 8.5 (D79 point 12): #362 the share operation, #203 sign-in and identity,
  #120 the Door43 authority, #185 the journey. Receive and team sync stay Phase 2 (D67; epic #24).

### J12 Upgrade the pinned resources

- Actor: facilitator. Activity: Start (touches Check).
- Precondition: J3; the app is online.
- Steps: check for updates · see the offer per language set · accept explicitly · re-derive.
- End state (defined 2026-09-11, D72): the set's §5.3 pins carry the new release's `sha` and
  `version`; every affected book's decisions are carried over or invalidated and retained
  (D36); the other language set's pins are unchanged; text ingredients byte-identical; a
  failed or interrupted download changes nothing.
- MUST NOT: upgrade silently (resource-handling stance 2026-07-12); move a pin before every
  resource of the release is installed and sha-verified; touch the original-language or
  gateway-Bible pins (that upgrade is #258, Increment 8).
- Proof: `e2e/j12-upgrade-resources.spec.ts`. Owner: shipped alpha.6 (#40: #256 built, #257
  proved).

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

### J20 Create an OBS project

- Actor: facilitator. Activity: Start.
- Steps: choose Open Bible Stories · choose the language, the name and the gateway set.
- End state (defined 2026-09-15, D74): a repository that is the pankosmia `text_stories`
  template byte for byte except `metadata.json` and the fifty title lines, which read `# N.`
  with no text; every frame is the image line plus an empty paragraph; no reference line;
  `currentScope` equals the template's table; front and back files copied from the gateway
  source. The harness validates it as an OBS project (BURRITO-SPEC §10).
- MUST NOT: offer a story subset; copy source text into a frame; rewrite an image line.
- Proof: `e2e/j20-obs-create.spec.ts` (written with #287). Owner: shipped alpha.7 (#287).

### J21 Translate a story frame by frame

- Actor: translator. Activity: Translate.
- Precondition: J20; the gateway OBS and the picture pack are installed (#288).
- Steps: open a story · read the gateway frame and its picture · write the frame · write the
  title and the reference line.
- End state (defined 2026-09-15, D74): the story file differs from before only inside the
  written paragraph, the `# N.` line, or the closing `_…_` line; one `text.frame.set` or
  `text.story.ref.set` segment per save; one paragraph per frame, single newlines kept.
- MUST NOT: touch another frame's bytes; write a second paragraph into a frame; save an
  image line.
- Proof: `e2e/j21-obs-draft.spec.ts` (#292). Owner: shipped alpha.7 (#289).

### J22 Check an OBS story

- Actor: translator. Activity: Check (Community Checking preview lives here — D63).
- Precondition: J21; `obs-tn` and `obs-twl` are installed for the gateway language.
- Steps: open a frame's note or word link · see the source phrase in the gateway text · select
  the target words · leave a check comment or a bookmark · preview the story.
- End state (defined 2026-09-15, D74): §5.2 decision records under the `story:frame` key for
  `translationNotes` and `translationWords`; a later frame edit flags them invalid and
  retains them (D36); the story file is byte-identical.
- MUST NOT: count `Occurrence`; offer an Align tool; write a PDF (that is J23).
- Proof: `e2e/j22-obs-check.spec.ts` (#292). Owner: shipped alpha.7 (#291).

### J23 Export an OBS project as Markdown and PDF

- Actor: facilitator. Activity: Deliver.
- End state: files written outside the project: the story Markdown, a dated PDF, a Scripture
  Burrito; the project byte-identical except the D9 checkpoint commit.
- Proof: `e2e/j07-publish.spec.ts`, OBS block, tags `@inc8 @J23`. Owner: Increment 8, with J7
  on one PDF path (D74, D79): #360 story Markdown and the flow-layout PDF, #359 the zip, #11 the
  wrapped layout.

### J24 Share an OBS project to Door43

- Actor: facilitator. Activity: Exchange. Rides J11 unchanged (D79 point 12): the same Share
  action, the same end state and refusals, an OBS project. Proof: the J11 spec with an OBS project.

### J25 Read a story with helps and record a user comment

- Actor: translator. Activity: Understand.
- Precondition: J20; the OBS help set is installed.
- Steps: open a story · read the frames with pictures and gateway text · read the notes,
  word links and questions for a frame (#331) · write a user comment.
- End state (defined 2026-09-15, D74): one `note.add` segment with a `{story, frame}`
  target per comment; the story file is byte-identical; Resume returns to Understand on the
  same story.
- MUST NOT: change progress; write into the story file.
- Proof: `e2e/j25-obs-understand.spec.ts` (#292). Owner: shipped alpha.7 (#290).

## Retired numbers

- J10 RTL: an axis, not a journey. Each of J2, J4, J5, J7 lists both runs in its proof.
- J14 join isolation: a MUST NOT row on J1 and J2. The spec stays.
- J15 slow open: a quality requirement on opening a project, cited by a FR. The spec stays.
