# translationCore 4 user testing script

Give this file to the Grok agent that operates tC4 as a user. Run the cases through the interface. Record each expected result separately. A screen that looks successful is not enough: saved work must survive a new session, and exports must contain the expected content.

**Status:** [PROPOSED] test procedure, prepared 2026-10-02. Product expectations were [VERIFIED] by reading `docs/JOURNEYS.md`, the cited `e2e/` specifications, the import fixture manifest, and decisions D69, D70, D72, D74, D79–D80 and the later share/consent rules in J11, at repository commit `daf42c9e8b9d155f44fe18422a16fb66ba7ad8da`. This script has not been executed. Added edge probes are labelled below; they are proposed tests, not claims of shipped functionality.

## Instructions to the testing agent

You are testing translationCore 4 from the user's side. Complete the cases below in order. Use the app to create, edit, check, import, export and navigate. Read-only inspection of files, downloads and network activity is allowed when available. Do not fix the app, change its stored data directly, or seed decisions through APIs during manual cases. Use the automated evidence procedure below to avoid repeating assertions already proved by the matching scripted UI actions. Direct fixture setup inside a journey is setup evidence, not proof that a user completed that setup through the interface.

Use a dedicated test installation or profile and disposable projects. The test owner supplies the app URL or executable, fixture directory, output directory, and any approved Door43 QA destination. Never reset a shared development rig. Do not delete or change existing user projects. Share only to the designated test account/server; if none is supplied, mark the live share cases BLOCKED and continue everything else. Do not put credentials in reports, screenshots, request logs or URLs.

Do not use arbitrary browsing as the test strategy. Follow each case's steps and assertions. At the end, run the bounded exploratory pass. Keep findings from exploration separate from contractual failures.

### Result rules

- `PASS`: every listed assertion has evidence.
- `FAIL`: an assertion is contradicted by evidence. Capture the first failure before recovery.
- `BLOCKED`: a prerequisite or observation tool is missing. Name it. Do not turn this into a product defect.
- `NOT APPLICABLE`: the case is explicitly outside the tested build's documented scope or environment. Cite the scope evidence. An unexpectedly missing shipped control is a FAIL, not NOT APPLICABLE.
- `NOT RUN`: no attempt was made. Give the reason.

Split a case into assertion results when necessary. For example, UI persistence can PASS while the journal assertion is BLOCKED for lack of file access. Never promote the whole case to PASS while a required assertion remains unobserved. A failure in project creation blocks that project's dependent cases; continue cases on independent fixture imports or other projects. Do not silently repair a prerequisite and conceal the failed case.

### Deterministic interaction rules

1. Use visible labels and accessible roles. Scope actions to the named project card, modal, book, chapter, verse, story or frame. Never click an unscoped “first” button.
2. If labels are translated, record the exact displayed label and its English meaning once. Keep the UI language fixed for the baseline run.
3. Wait for a visible completion state instead of sleeping after each click. Proposed runner limits: 10 seconds for a local save, 30 seconds for local navigation, 120 seconds for a large project open, and 180 seconds for a download/share. Record an overrun as a timing failure against these runner limits; do not call it a product performance requirement without a documented budget.
4. Retry a failed action only once, after collecting evidence. Record both attempts. A successful retry does not erase the first failure.
5. For a normal restart: wait for save completion, leave the project through Home, close the app/browser session, reopen it, then use Resume. A reload alone is not a new app session. Crash probes use a different procedure below.
6. Identify words by `(reference, displayed text, occurrence, token position)`. Repeated words are distinct occurrences. Freeze the chosen tokens and check IDs in the run manifest before altering them.
7. Do not assume a blank verse has progress zero if the fixture contains `___` or pre-existing decisions. Record a baseline numerator and denominator. Prefer raw counts to rounded percentages.
8. Use fixture content and actual catalogue/configuration identifiers. Do not invent resource names, versions, language codes, remote owners or repository paths. Run the supplied negative input before the corresponding valid input. If both fail identically, investigate the fixture/environment before blaming the product.
9. Capture text literally, including accents, whitespace and line breaks. For file equality, compare bytes; for a PDF, compare extracted text, page geometry and rendered pages. PDF bytes, timestamps and zip container bytes need not be repeatable.
10. Keep external networking blocked during local cases while preserving access to the local tC4 server. Browser “offline” can block that server too. Renderer request logs alone cannot prove that the platform server sent no external requests.

## Use automated evidence before manual work

Run the existing deterministic checks and scripted journeys first. Grok then reviews the evidence, reproduces failures and performs the remaining user checks. An automated pass can cover the specific assertion it actually exercised, on the recorded build and fixture. It cannot cover an entire case merely because its test title sounds similar.

### Collect checks without touching the rig

From this repository, run:

```bash
node scripts/collect-user-test-evidence.mjs
```

The command invokes the existing format, journal and normative scripts against the checked-in reference fixtures. It starts no server, reseeds no rig, performs no resource download and tests no live project. Each run creates a new ignored directory under `test-results/user-evidence/`, with `summary.md`, `manifest.json`, `input-hashes.json` and full per-suite logs. The manifest records commit, dirty working-tree state, runtime, exit codes, timing and the authoritative suite summary lines. A failed suite gives a nonzero command exit; an existing explicit output directory is refused rather than overwritten.

Use `--list` to preview commands or `--out /absolute/path/to/new-directory` to choose the evidence destination. This runner ignores `BURRITO` and `OBS_BURRITO` environment overrides so its recorded fixture scope remains fixed. It is a reference-fixture regression check; do not use its PASS as proof that Grok's newly edited project or downloaded zip is correct.

### Run the existing UI journeys with reviewable artifacts

Use a dedicated disposable checkout with dependencies, rig resources/cache and browser installed according to [Journeys from a clean clone](../dev-env/README.md#journeys-from-a-clean-clone). Set a separate port lane. Separate ports alone do not isolate stored data: the checkout must also have its own `dev-env/state/`. The journeys' global setup reseeds that directory on every run.

From that isolated repository root, run:

```bash
TC4_RIG_PORT=19999 TC4_VITE_PORT=5299 PLAYWRIGHT_HTML_OPEN=never npm run test:e2e -- --reporter=list,html --trace=on --retries=0 --output=test-results/journeys
```

The ports are an example lane; use free ports. The HTML report is `playwright-report/index.html`. Open it using `npx playwright show-report`. Test artifacts, including traces and files written by the journey, are under `test-results/journeys/`. The distinct output subdirectory prevents a journey run from clearing the collected non-rig evidence. Archive both report and artifacts before the next run; Playwright replaces its report/output. Do not supply real user credentials. Live share cases need the separately approved QA credentials; a labelled skip remains uncovered. Review/redact any credential-bearing trace before handing it to another agent or sharing it.

For a focused repeat, use the relevant file, for example:

```bash
TC4_RIG_PORT=19999 TC4_VITE_PORT=5299 PLAYWRIGHT_HTML_OPEN=never npm run test:e2e -- e2e/j02-draft-verse.spec.ts --reporter=list,html --trace=on --retries=0 --output=test-results/journeys
```

Focused runs still reseed the isolated rig. `--list` on Playwright inventories tests without performing UI actions; it is not test evidence.

### What Grok reviews and what it still does

| Evidence | Grok checks | Manual work avoided |
|---|---|---|
| Collected format/journal/normative logs | Actual exit codes and failed rows; fixture/source hashes; dirty-tree caveat; scope and skipped prerequisites | Repeating the reference format/journal invariants by hand |
| Playwright HTML report and trace | Exact test outcome and steps, expected/actual assertions, app state at failure; match tested build to current app | UI actions/assertions actually covered by each passing journey |
| Journey downloads and file comparisons | Open exported files; inspect PDF render/text; verify content/diffs correspond to test assertions | Rebuilding the same export/import fixtures and checking the same persisted values manually |
| Journey teardown state | `client-settings.json`, `home-projects.json`, and journal verifier results where the test invokes it | Repeating those exact persisted-state assertions |
| Manual/exploratory evidence | Actual installer, OS dialogs, keyboard/focus, viewport/zoom, visual clarity, approved live QA sharing and missing-resource cases | These remain manual unless a specific automated assertion covers them |

For each assertion covered by automation, record `execution: automated`, exact test title/file, outcome, build, fixture and report/artifact path in `case-results.jsonl`. Grok must open the report and relevant artifact, not trust a supplied green summary alone. If code, fixture, pins or runtime materially differ, rerun the affected test or perform the assertion manually. Skipped tests, hidden prerequisites and direct API setup do not prove an interface action. The runner intentionally does not edit the canonical `docs/evidence/manifest.json`.

## Record the environment and fixtures

Create `run-manifest.json` before testing. Include:

- Run ID, UTC start time, app version/build/commit when available, executable or URL, platform-server version when available, OS, browser/runtime version, UI language, timezone, viewport and scale.
- Evidence directory and whether screenshots, download inspection, project files, git history, platform egress and controlled faults are available.
- Scope authority for the tested build. Use its journey/release specification. The checkout's README and ROADMAP contain older status statements that conflict with JOURNEYS; do not infer feature availability from the README alone.
- Every selected fixture's absolute path, SHA-256, source manifest entry and expected language/books/chapters.
- Project display names and actual app-assigned identifiers/paths. Record these after creation; do not predict the slug.
- The exact installed resource versions, commit hashes and coverage used by each project; selected check IDs and target/source token occurrences.
- The approved Door43 test server/account/organization and repository name, if supplied. Record no secrets.

The following symbolic project names are runner labels, not invented resource identifiers. Give projects names containing the run ID, then resolve the real card/path from the app:

| Runner label | Setup | Purpose |
|---|---|---|
| A | New LTR Bible project; add Titus and Jonah from the app's Book list | Baseline drafting, understanding, checking and alignment |
| B | New Bible project, same language/books, name differing from A by one character | Isolation control; never edit after its baseline snapshot |
| C | New OBS project with installed gateway OBS and pictures | Stories, comments and exports |
| D | Fresh imports in each import case | Import/refusal and round-trip tests |
| E | Separate disposable Bible/OBS projects or owner-provided copies | Resource upgrades, missing resources and controlled faults |
| R | Owner-provided RTL fixture or project created using a supported RTL language from the catalogue | Repeat the specified axes |

Choose the target language from the actual app list. On the referenced rig, J1 uses a rejected `es-419` create request followed by accepted `es`; this is version-specific evidence, not a universal rule for every installer. Record the code the tested build supports. Use English installed helps for the baseline. Use the installed Spanish gateway package for the second-language cases when available.

### Fixed text values

These exact values come from the existing journey specifications. They are user-entered fixture content, not a translation-quality claim.

| Variable | Exact value | Source |
|---|---|---|
| V1 | `Pero tú habla lo que está de acuerdo con la sana doctrina.` | `e2e/j02-draft-verse.spec.ts`, Titus 2:1 |
| V9 | `Exhorta a los siervos a que se sujeten a sus amos y a que agraden en todo` | Same, Titus 2:9 |
| V10 | `no defraudando sino mostrando toda buena fe` | Same, Titus 2:10 |
| COMMENT | `Pablo le dice a Tito qué enseñar (J16).` | `e2e/j16-understand.spec.ts` |
| CHECKCOMMENT | `Ask the team about this one.` | `e2e/j04-check-book.spec.ts` |
| CHECKCOMMENT2 | `Resolved with the team.` | Same |
| FRAME1 | `Así fue como Dios hizo todo en el principio. Creó el universo y todo lo que hay en él en seis días.` | `e2e/j21-obs-draft.spec.ts` |
| TITLE | `La creación` | Same |
| REF | `Una historia bíblica de Génesis 1-2` | Same |

For other passages, capture their text from the pinned source pane before the test and freeze it in the manifest. For an invalidation mutation, remove the exact selected target token occurrence and its adjacent space, then record the complete expected new verse. For repeated-word probes, use an actual repeated word in the fixture. Do not silently replace the fixed baseline inputs with plausible alternatives.

### Import fixtures

Resolve entries relative to `conformance/fixtures/import/MANIFEST.json`, not the machine's planning-workspace root. Folder entries need an owner-prepared zip in the same shape used by J9; record that zip's hash and mapping. Do not change the fixtures.

| Fixture | Expected result |
|---|---|
| `usfm/no-id.sfm` | Refuse with `import.damaged.usfm-parse` |
| `usfm/57-TIT.usfm` | One new project; language `es-419`; Titus, three chapters |
| `usfm/57-TIT.usfm` + `usfm/32-JON.usfm` + `usfm/58-PHM.txt` in one selection | One new project; `es-419`; Titus 3, Jonah 4, Philemon 1 chapters |
| `tc3/cfm_fbt_tit_book.zip` | One new project; `cfm`; Titus, three chapters |
| Three `tc3/multi/en_kjv_*_book.zip` files named in the manifest | One new English project; John 21, Job 42, Luke 24 chapters; choose the manifest's `CC BY-SA 4.0` license |
| `burrito/tc4-export.zip` | One new `es-419` project; Jonah 4 and Titus 3 chapters |
| `../../sample-burrito`, `../../sample-burrito-obs`, `burrito/foreign` | Accept according to the manifest; keep the source language and contents |
| Every `expect: refuse` manifest entry | Refuse with that entry's exact `code`; write no project |

## Evidence and persistence checks

Capture evidence per case as `CASE-ID-before`, `CASE-ID-after`, and `CASE-ID-reopen`, with screenshots and literal text/counts. Record downloaded filename, size, SHA-256 and extracted contents. Every case produces at least a result record; every successful writing case produces a reopened value or exported file that a second run can verify.

If read-only project access exists, snapshot relative-path → SHA-256 for all project files outside `.git`, plus `HEAD`, commit count, actor identity and remote configuration. Snapshot A and B separately. Compare exact file changes after each case; identify each expected changed path. Text ingredients are the project's USFM or story Markdown files; discover their actual paths from metadata. Checking sidecars and journal segments are separate state and may change when a decision or comment changes.

A checkpoint can change git history and materialize legitimate pending journal state. For read-only operations and export-isolation assertions, first leave and reopen once to settle pending changes, then take the baseline. Export may create the D9 checkpoint commit; it must not create a publish record or rewrite translation text. Do not exclude metadata or checking files from comparisons just to make a case pass.

With no file access, verify reopen and export contents where possible and mark byte/journal assertions BLOCKED. Do not claim a plain-USFM export proves unrelated files stayed unchanged. With no platform egress capture, network-zero assertions are BLOCKED even if the browser log is quiet. UI assertions can still be tested.

## Start and project isolation

Cases S01–S07 cover J1 and the isolation requirement formerly called J14.

| ID | Do these actions | Expected result |
|---|---|---|
| S01 | Launch the dedicated fresh profile. Choose an offered UI language. Open and close the account menu. | First-run controls are usable. Home renders without a crash. No Door43 request occurs merely from startup, idle or opening the menu. |
| S02 | Open Add project → Bible. Attempt creation with required name/language missing, then cancel. | Validation identifies the missing field or Create is disabled. No new project/card/repository exists. This is a proposed validation probe; record the actual validation wording. |
| S03 | Enter the supported target language, LTR direction and A's name. Create Bible → Start a blank book → Titus → Create book. | Exactly one new project. Titus opens in Understand, chapter 1. Translate is available. Disk assertion: valid Scripture Burrito and its own actor identity. |
| S04 | Return Home. Add Jonah through A's add-book control. Reopen both books. | A has Titus and Jonah, each exactly once; each book has the expected chapter list. Disk assertion: one USFM ingredient per book; create/add-book checkpoint history matches J1. |
| S05 | Create B with the same language/books and a similar name. Record B's baseline bytes, progress, actor identity and HEAD. | A and B are distinct projects/repos with different actor identities. Creating B leaves A unchanged. |
| S06 | Open A, change Titus 2:1 to V1, wait for saved, return Home, then open B at Titus 2:1. | A reopens with V1. B retains its original text and progress. B's files, actor identity and HEAD are unchanged. |
| S07 | Restart. List projects, then open A and B by their individual cards. | Each appears once. Names, language, books and work remain attached to the correct project. No duplicate card/repository is created. |

## Bible drafting and resume

Cases T01–T12 cover J2 and J8. If S06 already wrote V1, use its captured change for T01 or run T01 on a fresh A-equivalent project; do not claim a second identical save is a first draft.

| ID | Do these actions | Expected result |
|---|---|---|
| T01 | A → Titus 2 → Translate → Verse → Start this verse for verse 1. Enter V1 and leave the editor. | Saved state follows the actual write; reopen shows exact V1. Other verses and Jonah stay byte-identical. Disk assertion: changed verse has `text.verse.set`; typing alone makes no git commit. |
| T02 | In a separate untouched verse, enter its frozen source text and keep focus inside the textbox. Wait for the idle save. | Idle save completes without blur. A new session shows exact entered text. Indicator does not report saved before persistence succeeds. |
| T03 | A → Titus 2 → Section → Draft section 9–10. Enter `V9`, one space, then `V10`. In Place mode set verse 10 at the first `no`. Save. | Verse 9 contains exactly V9; verse 10 exactly V10. Outside these verses, bytes are unchanged. Disk assertion: one `text.verse.set` per changed verse. |
| T04 | In the 9–10 section, stack the verse-10 marker on verse 9 in Place mode. Save and reopen. | One span `9-10` has the joined text. No text is lost/duplicated. Disk assertion: `text.structure.apply`; affected decisions/alignments invalidated and retained, with no re-key. |
| T05 | Reopen that span. Move verse 10 to the first `no` again. Save and reopen. | Separate verses 9 and 10 contain V9 and V10. Surrounding verse bytes stay unchanged. Structural action and affected-record retention follow T04. |
| T06 | In a separate section, use the editor's paragraph/poetry controls on frozen text. Save and reopen. | Paragraph/poetry layout survives. Disk assertion: the corresponding `\p`/`\q1` slots are present; adjacent verse text is unchanged. Use controls, not typed USFM markup. |
| T07 | Switch literal/simplified source tabs and the original-language pane at a known Greek verse in Titus. | Each pane identifies the source it displays and matches its pin. Greek text appears in the original pane. Reading changes no project text or check/alignment record. |
| T08 | Record drafted count, draft exactly one previously undrafted verse, save, return Home. | Draft count increases by one at the relevant scope; denominator stays fixed. Reopen reconstructs the same count. |
| T09 | Edit a verse, wait for saved, switch Translate → Check. Inspect history if available. Repeat Check → Translate → Check with no edits. | First departure commits pending work once, using the J8 checkpoint prefix. Repeated departures with no pending work add no commits. |
| T10 | Edit and save, return Home, restart, click Resume. | Same project, book, chapter and activity return; exact final text returns. Leaving the project checkpoints pending work once. |
| T11 | Visit A/Titus 2 in Understand. Return Home, click Titus tile. Click a never-opened Jonah tile. Repeat C/story 3/frame 4 after OBS setup. | Titus returns to its remembered chapter/activity. A never-opened book starts chapter 1 in Understand. OBS returns to the selected story/frame/activity once its place is persisted. |
| T12 | With external access blocked, restart and repeat a verse edit, save, source read and reopen using installed resources. | Local work completes; no external request. No forced download, sign-in or online gate appears for this local work. |

## Bible understanding and comments

Cases U01–U04 cover J16. Settle pending draft changes before the byte snapshot.

| ID | Do these actions | Expected result |
|---|---|---|
| U01 | A → Titus 2 → Understand. Read ULT then UST. Open a translation note, follow its Academy help, and return to the passage. | Source tabs show the selected pinned texts. The note/article opens and is readable. Passage context remains clear. Text ingredients are unchanged. |
| U02 | At Titus 2:1, enter COMMENT in the user-comment field. Save; leave and reopen. | Exact comment returns at Titus 2:1. Disk assertion: `note.add` targets that passage; USFM bytes are unchanged. |
| U03 | Switch to Translate and inspect the Comments help tab. Then inspect another verse and B. | Comment is labelled with its correct passage and appears only in A at its correct scope. It does not leak to another project or verse. |
| U04 | Record progress before/after reading and adding a user comment. Restart into Understand. | Reading/commenting moves neither drafting nor checking progress. The stored comment and remembered passage survive. |

## Bible checks and invalidation

Cases K01–K12 cover J3, J4 and J6. Freeze two actual undecided check IDs, their tools/references, source quotes and target tokens. If an A verse has no draft for selection, draft its frozen source text through Translate first and settle the checkpoint.

| ID | Do these actions | Expected result |
|---|---|---|
| K01 | A → Check → translationNotes. Open the chosen actual note and its Academy help. Switch to translationWords and open the chosen article. | Derived items use A's pinned resources. Quotes/references match those resources. Articles load from the correct tW/tA pins. No missing-translation-key warning occurs. |
| K02 | On one undecided item, select the frozen target token occurrence(s), then Mark valid. Leave and reopen. | The selected words and valid decision return on the same check. Decided count rises by exactly one; total does not change. Disk assertion: full decision and `check.decision.set` persist. |
| K03 | On a different undecided item, take the supported “nothing to select” path and mark valid. Reopen. | Explicit no-selection decision persists; no fabricated target selection. Count rises by one. |
| K04 | On a third undecided item, use the Invalid triage action. | Item list and decided-count meter agree that it is decided. Restart gives the same result. |
| K05 | On an undecided item, add a bookmark and CHECKCOMMENT without deciding it. Record counts first. Reopen. | Both persist on the same decision record. Bookmark/comment filters each gain exactly that one item. Decided/draft progress stays unchanged; text stays unchanged. |
| K06 | Filter bookmarked, then commented. Open the same item; replace the comment with CHECKCOMMENT2. Reopen, delete the comment, and clear the bookmark. | Filters show the recorded item set. Replacement persists exactly. Deletion removes the comment/filter badge; clearing removes the bookmark. Disk assertion: fields reset to `false` on the retained record. Progress stays unchanged. |
| K07 | With external access blocked, reopen both tools and an installed help article. | Checks/articles remain available offline. No external request. Decisions reconstruct from persisted records. |
| K08 | Edit K02's verse through Translate by removing the exact selected token occurrence. Save; return to its check. | Affected decision is visibly flagged invalidated and kept for review; selection is not silently reassigned to a repeated word. Unrelated verse decisions stay unchanged. |
| K09 | Re-review the invalidated item and explicitly mark it valid against the current draft. Restart. | Flag clears for that item only. Updated selection/decision persists. Progress and list agree after reopening. |
| K10 | Open A's checks, switch Home → C's OBS checks, then Home → A's checks. Repeat using Resume/book/story tiles. | Each session uses the open project's own resource type/pins. No OBS item/pin/decision leaks into Bible checks or vice versa. |
| K11 | On E with owner-provided coverage fixtures, open a book absent from a pinned resource, then a book whose supported resource contains zero checks. | Both states are explained and usable; absence of book coverage is distinct from a supported book with no checks. Neither crashes or invents items. |
| K12 | On an owner-provided mismatched-pin fixture, open checks; compare with a matching-pin control. | Mismatch warns before old decisions are treated as current. Matching control has no mismatch warning. Text is unchanged. Without this fixture, BLOCKED. |

## Alignment and suggestions

Cases A01–A09 cover J5 and the alignment side of J6. Alignment lives under Check. Use a verse with a pinned original, target draft, and recorded token inventory. For each token occurrence, track bank versus linked location.

| ID | Do these actions | Expected result |
|---|---|---|
| A01 | Open the alignment tool for the chosen verse. Click the already selected verse again. | Original-word cards and target bank remain visible. Stored links render. Repeat click does not empty/reset the bank. |
| A02 | Link one frozen bank token to a chosen original card. Reopen. | Token leaves bank, appears in that card and persists once. Text is unchanged. Disk assertion: `align.verse.set` and sidecar at checkpoint. |
| A03 | Unlink the same token. Reopen. | Token returns to bank and disappears from the link. No token occurrence is lost or duplicated. |
| A04 | Link/unlink several actual repeated-word occurrences individually. | Each occurrence occupies exactly one bank/link position. `bank occurrences + linked occurrences = initial target occurrences` after each operation. Same-word spelling does not collapse distinct occurrences. |
| A05 | With suggestions off, Mark valid while some bank words remain. Then change one link and Mark valid again. | Explicit valid can coexist with unplaced words. Editing makes the verse require review again; explicit Mark valid restores valid. |
| A06 | On a dedicated fixture trained by prior confirmed project alignments, verify suggestions initially off. Switch on; record a visible proposal. Attempt Mark valid, then leave without accepting. | Proposal does not count as placed/resolved; Mark valid is refused while it stands. Reopen/file inspection shows no unconfirmed link/journal event. If no proposal appears, this positive case is BLOCKED; absence of proposals is not a pass for acceptance/rejection. |
| A07 | On reproducible copies of the same trained fixture, accept one proposal in one copy and make the same link manually in the other. | Both persist the same semantic alignment and save operation, allowing actor/time differences. Neither rewrites text. |
| A08 | On separate proposal-bearing copies, reject one, Reject all, and Accept all. Reopen each. | Rejections persist no proposed links; accepted links persist once; bank counts remain conserved. Suggestion preference is not written into the project. |
| A09 | Edit a verse with a confirmed alignment, then reopen Align. Separately open an E project without a pinned original. | Edited alignment is invalidated and retained. Missing original gives an explained unavailable state, not a crash. Unrelated alignments are unchanged. |

## OBS create translate understand and check

Cases O01–O12 cover J20–J22 and J25.

| ID | Do these actions | Expected result |
|---|---|---|
| O01 | Add project → Open Bible Stories. Choose offered language, name C, and installed gateway set; create. | One OBS project, all 50 stories; no subset chooser. New story titles are numbered and empty; target frames are blank while source pictures/text are available. Disk assertion: template/image lines and scope match J20; gateway front/back copied. |
| O02 | C → story 1 → Translate. Enter FRAME1 in frame 1, TITLE in title, REF in reference field. Save each separately and reopen. | Exact values persist. Only the respective paragraph/title/reference changes each time; other frames/story files/image lines stay unchanged. Disk assertion: separate `text.frame.set`/`text.story.ref.set` save actions as specified. |
| O03 | In another frame enter frozen source text containing a single newline; save and reopen. Then attempt a second paragraph through the editor. | Single newline is retained. Stored frame remains one paragraph; app normalizes/refuses the extra paragraph without corrupting frame boundaries. This boundary probe is proposed; record exact behavior. |
| O04 | Record draft progress before/after drafting one previously empty frame. | Numerator increases by one, denominator stays fixed. Title/reference-only changes do not falsely count an empty frame as drafted. |
| O05 | Story 1 → Understand. Select frame 1, read gateway/picture, notes, word links and questions. | Helps belong to selected story/frame; content uses OBS pins. Missing optional content is explicitly unavailable, not a Bible help or silent wrong fallback. |
| O06 | Add COMMENT as a user comment on frame 1; reopen, then inspect Translate → Comments. | Exact comment persists with story 1/frame 1 label. Disk assertion: `note.add` target `{story:1, frame:1}`; story file unchanged. Progress unchanged. |
| O07 | Visit story 3/frame 4 in Understand; leave and restart through Resume. | Understand returns to story 3/frame 4. Frame-1 comment stays with story 1. |
| O08 | Story 1 → Check. Open a note and word link for frame 1, select frozen target words and mark valid. | Decisions persist for both tools under correct `story:frame` key. No Align tool or original-language occurrence counting is offered for OBS. |
| O09 | Add CHECKCOMMENT and bookmark to an undecided OBS check; reopen and filter. | Comment/bookmark persist on that check, filters reflect them, progress and story bytes stay unchanged. |
| O10 | Edit frame 1 by removing one selected token; return to both O08 checks. | Affected decisions flagged invalid and retained. Another frame's decisions and source image lines remain unchanged. |
| O11 | Open Community Checking preview; switch stories and return. | Drafted story title/frame text/reference appears at correct positions with pictures. Preview does not itself create a PDF or alter story bytes. |
| O12 | Block external access, restart C, read images/helps, edit a frame, comment and reopen. | Installed pictures and resources support the local workflow. No forced sign-in/download; no external request. |

## Import and refusal

Cases I01–I10 cover J9a, J9c and J9d. Before every attempt, record project list/count and all existing project hashes. Keep each successful import as a separate D project. For damaged inputs, run every refusal row in the manifest, not just one representative.

| ID | Do these actions | Expected result |
|---|---|---|
| I01 | Import `usfm/no-id.sfm` first. Inspect review and try to proceed if possible. | Review reports `import.damaged.usfm-parse`; no import/project/write. Existing projects unchanged. |
| I02 | Import `usfm/57-TIT.usfm`. Complete required Details using the manifest. Review then Import. Reopen. | Exactly one new project, Titus/three chapters, `es-419` retained. Opens Understand. Stored USFM bytes equal input; seed events carry `seed.source`. |
| I03 | Select the three USFM fixtures together in one import. Review books/language then import. | One new project, three expected books with chapter counts 3/4/1. No project per file and no duplicate books. |
| I04 | Import a supported USFM fixture without a language declaration, then the declared-language control from J9's fixture set. | Details warns/names the missing code in the first; control keeps the language check green. Do not invent a fixture or confuse this warning with damaged USFM. |
| I05 | Import the tC3 Titus zip offline. Inspect exactly what carries over; use installed versions explicitly where offered. | One `cfm` project with Titus/three chapters. Text agrees with fixture. Imported decisions are carried or invalidated/retained according to review; unavailable version is not silently replaced. No external request for local review/import. |
| I06 | Select all three tC3 multi-book zips together; choose the manifest license and review. Import. | One English project with John/Job/Luke and expected chapter counts; selected license recorded correctly. |
| I07 | Import `burrito/tc4-export.zip`, the supplied sample Bible/OBS burritos and the foreign burrito separately. | Each creates one new project and retains source language, text, checking state and existing journal as applicable. A tC4-journal burrito gains no redundant seed event. No existing project is overwritten. |
| I08 | For every manifest `expect: refuse` entry, select its exact fixture, inspect review and attempt import if enabled. | The entry's exact report code appears; no new project/partial repo; existing projects byte-identical. Record one assertion record per fixture. |
| I09 | Start a valid import, cancel on review. Then test a name clash against an existing project's actual display name. | Cancel writes nothing. Name clash is flagged; Import is disabled/refused and existing project unchanged. |
| I10 | With asking on, use tC3 review → Look up on Door43. Cancel consent, then repeat and Continue against the approved environment. | No lookup before explicit action. Cancel sends nothing. Continue resolves real versions where present and preserves found pins when another member uses installed versions. Missing remote release remains explained. |

## Export and round trip

Cases X01–X12 cover J7 and J23. Export outside the project. Record filenames and the app's date convention/timezone; if the run crosses midnight, record both dates. Settle pending writes before taking source snapshots.

| ID | Do these actions | Expected result |
|---|---|---|
| X01 | A → Check → Community Checking. Open export menu. C → same. | Bible offers applicable plain/aligned USFM and Scripture Burrito; OBS offers Story Markdown and Scripture Burrito. Desktop with PDF bridge offers Export PDF. Browser without the bridge need not offer PDF; record environment. |
| X02 | Export plain USFM for Titus. Open downloaded file. Repeat export without edits. | Both files equal stored Titus bytes, including BOM if present. No alignment markup introduced; accents/text/verse span/formatting retained. Project content unchanged except allowed checkpoint. |
| X03 | Export aligned USFM for a fixture with valid confirmed alignments and a footnote. Inspect/unweave using a read-only verifier if available. | Text/footnote retained; woven links correspond to stored valid records. Unaligned verse retains its stored text. Stale alignment is not passed off as current. No alignment markup is written back to project. |
| X04 | Export Scripture Burrito for A. Unzip and run the existing format verifier read-only on the output if available. | Ingredient checksums/size and scope pass. Text/checking/journal files match checkpointed source bytes. Export metadata has the pin-derived relationships mirror. No `.git`, `.bak` or `.DS_Store` payload. |
| X05 | Export Story Markdown for C. Unzip and compare `content/` against stored story Markdown. | Every included content file is byte-identical, including titles, frames, references and image lines. Project unchanged. |
| X06 | Export Scripture Burrito for C and inspect/validate as OBS. | OBS scope/format/checksums pass, source content preserved, relationships mirror present, no git/temp payload. |
| X07 | Desktop A: preview/export PDF. Use a fixture with drafted verses in at least two chapters. | Every drafted chapter appears; undrafted content follows documented omission/placeholder rules. Date, text and accents visible. Extracted PDF text agrees with preview; page count agrees. |
| X08 | Repeat X07 with Letter paper and Double spacing through page setup. | PDF page geometry is Letter; preview uses same setup. Double spacing increases pages for the long fixture used by J7; do not assert this for a too-short document. Page setup does not write project state. |
| X09 | Desktop C: export PDF in flow layout, then wrapped layout on a sufficiently drafted fixture. | Flow pictures above frames; wrapped pictures occupy a quarter-width start corner with text wrapping. Drafted frames have pictures; contiguous undrafted runs have appropriate placeholders; preview and PDF agree. |
| X10 | Desktop: export PDF from a separate completely undrafted OBS project. | One explanatory no-drafted-story line in preview/PDF; no fabricated source translation. |
| X11 | Desktop: start export, cancel native Save dialog. Repeat and complete Save; if a controlled interrupted download is available, repeat with interruption. | Cancel reports no false Saved success. Completed download reports Saved only after completion. Interruption reports failure/interruption, leaves project work intact. Browser readiness wording may differ. |
| X12 | Import X04 and X06 downloads as new projects through UI. Reopen texts, comments, decisions and alignments. Export plain/Markdown again and compare. | Source project unchanged. Copies retain language/text/checking/journal. No additional seed on an existing-journal import. Round-trip text bytes agree; correct book/story state reopens without finding. |

For zip repeatability compare sorted extracted paths and payload hashes; account for the documented exported metadata mirror. For PDF repeatability use page count, paper dimensions, extracted content and rendered-page comparison under the same runtime/fonts/setup/date. Never demand identical archive/PDF hashes when their container metadata varies.

## Resources and gateway language

Cases G01–G10 cover J3, J12 and J13. Run on E so pin changes cannot contaminate the baseline A/C cases. Positive upgrades need pinned old/new release fixtures or a fixed catalogue response approved for this run. “Latest today” is not deterministic: freeze both releases and their hashes first.

| ID | Do these actions | Expected result |
|---|---|---|
| G01 | Home → E's Settings. Inspect Checking language and Manage source texts offline. | Current installed package identified correctly; offered installed packages come from local data. Manage source texts opens the correct project. No background update/download. |
| G02 | With asking on, choose Check for updates; cancel internet consent. Repeat and Continue; inspect offer, then close without accepting. | Cancel sends nothing. Continue covers that Source texts session. Merely seeing an offer moves no pins, decisions, alignments or text. |
| G03 | Select installed second gateway package. Read per-book consequences; cancel, then repeat and explicitly confirm. | Cancel writes no package change. Confirm moves primary set only, leaves English fallback unchanged, carries or invalidates/retains decisions. Text unchanged; next checks use new language. |
| G04 | Repeat G03 with a package missing one book's help coverage or Bible text. | Coverage resolves consistently per `(tool, book)` via primary → English, not a mixed per-item list. Missing Bible pane names the English ULT/UST fallback. No invented third-language fallback. |
| G05 | Repeat G03 on OBS. | OBS language set changes; fallback and `extraScripture` do not change. OBS checks remain OBS checks. |
| G06 | Accept the frozen newer help-set release. Reopen checks. | Full release installed and SHA-verified before pins move. New exact version/sha stored; matching decisions carry, dropped/mismatched decisions invalidated and retained. Other language set and scripture text pins unchanged; text unchanged. |
| G07 | Upgrade fallback independently on a dedicated copy. | Only selected fallback pins and affected decisions change. Primary pins/text untouched. Cancellation at confirmation leaves pins/decisions unchanged. |
| G08 | Accept a frozen original-language upgrade after reading its affected-verse count. | Count shown before confirmation. Covered alignments marked invalid and kept after verified installation; help pins/decisions/text unchanged. Titus-only project offers Greek, not Hebrew; Titus+Jonah can offer both. |
| G09 | Upgrade a gateway Bible text independently. | Only that scripture pin moves after verification. Checking decisions and alignments remain unchanged. No help-set upgrade side effects. |
| G10 | On owner-supplied missing-pin fixtures, open the guided fix screen. Download/cancel consent; explicitly re-pin locally after warned counts; sideload wrong then correct pinned commit on separate copies. | Missing state explained; other work remains possible. Cancel downloads nothing. Local re-pin requires explicit confirmation and retains invalidated records. Wrong sideload commit refused; correct commit installs, tool becomes ready without moving its pin. |

## Internet consent sign in and share

Cases N01–N13 cover J11/J24 and the consent boundary. Test transport success only against the approved QA server. Real QA results and mocked/control results must be labelled separately. Keep asking on except in N04.

| ID | Do these actions | Expected result |
|---|---|---|
| N01 | Fresh app: inspect “Ask before using the internet”. Toggle off/on in account menu, close/reopen, restart. | Fresh default on; preference survives restart; toggling does not itself contact Door43. Menu remains usable after switch. |
| N02 | Home project card → Share on Door43. Cancel “Use the internet?”. Repeat with Don't ask again checked, then Cancel. | Zero external requests; project/remote/sign-in/preference unchanged, including checked-box cancel. |
| N03 | Repeat Share, Continue. Sign in without Stay signed in, inspect destination/repository/books or stories, then cancel before upload. | One consent covers this share task. Actual server and signed-in identity visible; computer-account author notice present. No repository creation/push from cancelling review. No password persisted. |
| N04 | On a disposable profile, check Don't ask again and Continue. Close task; start another network task. Then restore asking in the menu. | Only Continue persists opt-out. Subsequent task omits consent while off; restoring on restores dialog. Sign-in/out do not alter the preference. |
| N05 | From account menu, open Sign in to Door43. Enter QA credentials; submit, cancel consent; repeat and Continue. | Opening/filling form alone sends no credentials. Cancel sends nothing and retains usable sign-in form. Continue signs in. Failed QA credential control shows cause/report and no false signed-in state. |
| N06 | On disposable A-equivalent project, complete first Share to approved own account. Independently inspect remote. | One remote repo; remote `main` equals local checkpointed `main`. `origin` recorded in project git config; badge/Shared at destination correct. No publish branch/outbox. Project content unchanged except checkpoint. |
| N07 | Edit through UI, save/checkpoint, Home → Upload changes. | New remote `main` equals local. No new repository/review dialog when token available; still follows internet-consent preference. No receive/merge/force-push. |
| N08 | New app session without Stay signed in. Then repeat on a desktop profile with Stay signed in. Browser control if available. | Without kept token, new session asks sign-in. Desktop kept token resumes at first permitted Share, not startup; no identity/network lookup merely from opening menu. Browser without keychain explains session-only persistence. |
| N09 | Share review “Sharing as @username → Change”, and shared card Change. | Sign-out/change removes prior session/kept token and returns to sign-in; no stale username used for next share. No credential in localStorage, project files, logs or remote URL. Secret-storage assertions require appropriate read-only inspection. |
| N10 | Account menu → Sign out of Door43; restart. | No external request for sign-out. Session/kept token removed, signed-out menu restored, asking preference unchanged. |
| N11 | In approved QA setup, share with an already-existing repo name in own account and organization. Attempt non-fast-forward upload against owner-prepared diverged remote. | Each refuses with its report code and pushes nothing. Diverged remote unchanged; local work safe; explanation says team sync is coming. Never force-push or receive. |
| N12 | Repeat first Share on C-equivalent OBS project to approved organization allowed to create repos. Inspect stories/repo and remote `main`. | Same contract as Bible, correct OBS story list, correct organization/server. Unavailable organization cannot be chosen and explains why. |
| N13 | Signed-in account → Open my page on Door43; cancel then Continue consent. Close task and run local edit/restart with asking on and off. | Page link asks when preference on; Cancel opens/sends nothing. Local work sends no external request regardless of asking preference or a previous allowed network task. |

## Controlled failure and recovery

Cases F01–F08 need a dedicated owner-approved fault-capable environment. Do not induce faults in shared/user data. Do not fake success by inspecting only a spinner. No fault capability means BLOCKED for that case, not PASS. Freeze injected fault and restoration procedure in the manifest.

| ID | Fault and actions | Expected result |
|---|---|---|
| F01 | Refuse a save of a new verse through controlled local write failure; restore access and retry through UI. | Save failure visible; never false saved. Editor keeps entered text available for recovery; successful retry/reopen yields exact final text, no duplicate/lost verse. Recovery-text assertion is a proposed probe. |
| F02 | Refuse checkpoint when leaving Translate/Home. Restore and use offered retry. | Failure visible; no misleading successful departure/checkpoint. Retry preserves text and makes only the needed checkpoint. |
| F03 | Interrupt/refuse one member of the frozen help-set download. Restore and retry. | No partial pin upgrade; prior pins/decisions/text remain. Retry yields complete verified release before moving pins. |
| F04 | Cause import write failure after repo creation but before successful completion. | `import.write-failed`; partial repo removed; existing projects unchanged; same valid import can later succeed through UI. |
| F05 | Internet gate fails to enable, or status cannot be read. Start Share/Download. | Task does not start; visible failure says nothing sent. No sign-in/upload/download request escapes. |
| F06 | Keychain cannot forget token; choose Sign out. Separately provide an expired/refused kept token and attempt Share. | Forget failure explained; app does not falsely claim saved credential removed. Refused kept token is forgotten and sign-in requested inside permitted Share. |
| F07 | Open owner-provided large-journal fixture, then corrupt-journal fixture, then a valid small project. | Large open shows determinate real progress and finishes. Broken journal shows report and clears progress indicator. Valid project can subsequently open. Record observed small-open indicator threshold; J15's 300 ms budget belongs to its documented environment. |
| F08 | Dedicated project: after saved is confirmed, force-close app and reopen. Separately close immediately during an in-progress save, recording the last confirmed durable text. | Confirmed saved work survives. For in-flight close, distinguish confirmed durable text from pending edits; record any loss/error and recovery without asserting unsaved keystrokes were guaranteed durable. Never accept saved-then-lost text. |

## RTL keyboard layout and bounded exploration

These are additional axes/proposed quality probes. RTL is a fixture axis, not a new journey. J7's RTL proof is deferred in the current journey record; report RTL export findings as that axis, not a missing LTR export failure.

| ID | Do these actions | Expected result |
|---|---|---|
| Q01 | R: repeat T01/T03–T05/U01/K02–K06/A01–A04/X02–X03 using frozen actual RTL passage text and supported original. | Exact Unicode survives save/reopen/export; direction follows target/source independently. Verse markers/tokens retain correct logical references and occurrences. Record mixed digits/punctuation without judging translation quality. |
| Q02 | R OBS with wrapped PDF support: repeat O02/O08/X09 on frozen RTL text. | Right-to-left text survives; wrapped image begins at upper-right. Label PDF axis as deferred if outside this build's release criteria. |
| Q03 | Keyboard only: account trigger Enter; arrows/Home/End between menu items; Escape. Repeat opening/closing a project modal and consent dialog. | Account focus starts on first row, arrows work, Escape closes and returns to trigger. Modal keyboard focus visible; no trap preventing completion. Broader modal behavior is a proposed accessibility probe. |
| Q04 | Test agreed baseline viewport, then 1024×768 and 200% zoom. Open draft editor, Check rail, long comment, export and sign-in dialogs. | Required controls/text remain reachable by scroll; no hidden Save/Cancel, overlapping blocking layer or clipped critical error. Record screenshot/viewport for each finding. |
| Q05 | For each activity, perform exactly 10 switches: A Bible → C OBS → B Bible → A, rotating chapter/story/tool. Finish by reopening K02 and O08. | No wrong-project labels/resources/comments/selections or save target. Frozen decisions and B baseline remain correct. Record each destination, rather than clicking randomly. |
| Q06 | Bounded exploratory pass: 15 minutes, after deterministic cases. Explore long labels, rapid navigation, empty states, copy/paste, selection and keyboard paths. | Each finding has a replayable sequence with literal inputs. Classify as contract violation, proposed quality issue or uncertainty. Do not mark untested deterministic cases PASS from exploration. |

## Deliver the results

Save `run-manifest.json`, `case-results.jsonl`, `summary.md` and the referenced screenshots/downloads/diffs. Use one JSONL record per assertion; preserve stable case IDs and a separate repeat/axis field. For every changed-data case, include reopening evidence. For every failure, include its exact reproduction steps and actual/expected values.

Example record structure (replace placeholders with observations):

```json
{
  "case_id": "T01",
  "assertion": "reopened Titus 2:1 equals V1",
  "axis": "baseline LTR",
  "attempt": 1,
  "status": "PASS or FAIL or BLOCKED or NOT APPLICABLE or NOT RUN",
  "project": "actual observed project identifier",
  "preconditions": ["references to manifest entries"],
  "steps": ["literal actions actually performed"],
  "expected": "literal expected value or invariant",
  "actual": "literal observed value",
  "evidence": ["relative evidence filenames"],
  "elapsed_ms": 0,
  "report_code": null,
  "blocking_reason": null
}
```

The summary must include:

1. Tested build/environment and source scope; which capabilities were unavailable.
2. Counts by status and by baseline/conditional/RTL/exploratory axis, calculated from the records.
3. A journey coverage table: J1 S; J2 T; J3 K/G; J4 K; J5 A; J6 K08–K09/A09; J7 X; J8 T09–T11; J9 I/X12; J11 N; J12 G; J13 G03–G05; J16 U; J20–J22 O; J23 X; J24 N12; J25 O05–O07. Separate UI, persistence, disk and network evidence coverage.
4. All failed assertions with reproducible steps and evidence. Rank observed data loss, cross-project writes, leaked credentials, unexpected external requests and false-success states highest; do not infer these occurred without proof.
5. Blocked/unrun cases and the specific fixture/tool/permission needed to complete them.
6. Proposed quality/exploratory findings in their own list. A repeated deterministic run must use the same fixture hashes, pins, frozen selections and inputs on newly isolated projects.

Do not count retired J9b/J10/J14/J15 as unimplemented user journeys. Do not test Phase 2 receive, team sync, fork resolution or consultant roles as shipped features. Do not test import into an existing project or the deferred editor renumber action as 4.0.0 requirements.

## Sources for the expected results

- [User journeys](JOURNEYS.md): authoritative goals, end states, exclusions and proof rows.
- [Product decisions](DECISIONS.md): checkpoint, section/span, suggestion, OBS, export/import and share decisions.
- [Project format](BURRITO-SPEC.md): normative file and journal contracts; use the existing verifier for full-format assertions.
- [Import manifest](../conformance/fixtures/import/MANIFEST.json): exact valid/damaged inputs and refusal codes.
- [Journey specifications](../e2e/): selectors, fixture text, persistence proofs and conditional environments. Particularly `internet-consent.spec.ts`, `guided-fix.spec.ts`, `check-project-switch.spec.ts`, and the `j*.spec.ts` files cited by JOURNEYS.
- [Conformance instructions](../conformance/README.md): read-only validation of extracted Bible/OBS outputs, including the `BURRITO` and `OBS_BURRITO` overrides.
