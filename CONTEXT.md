# translationCore 4 domain language

This glossary defines the content and workflow terms used when tC4 handles Bible
and Open Bible Stories projects.

## People

**Translator**:
A mother-tongue bilingual person who understands, translates and checks the text of a
project in their own language. The translator's needs decide product tradeoffs.
_Avoid_: user (when the role matters), drafter, MTT

**Facilitator**:
A person who sets up and moves a project on the translator's behalf: creates, imports,
upgrades resources, publishes and sends. The application never stores this role; it names
which journeys a person of this kind typically runs.
_Avoid_: admin, project manager, coordinator

**Consultant**:
A person who reviews a translation and records findings without drafting it. Enters the
product with Phase 2 team collaboration; no 4.0.0 journey belongs to this actor.
_Avoid_: checker (ambiguous with a translator running Check)

## Journeys

**Journey**:
A goal one actor pursues in the product, defined by its **end state**: the on-disk state of
the project when the goal is reached. The steps are described in the actor's terms and their
order is not prescribed. Identified as `Jn`; the number is a stable identifier and never
implies order.
_Avoid_: flow, screen, feature, use case

**End state**:
What is true of the project repository on disk when a journey is complete. The only
definition of done for a journey; UI state alone never counts.
_Avoid_: acceptance criteria, happy path

**Activity**:
One of the parts of the product a journey belongs to: Start, Understand, Translate,
Check, Exchange, Deliver. A journey has one primary activity and may touch others.
_Avoid_: mode, screen, phase (reserved for Phase 1 / Phase 2 delivery)

**Export**:
The set of files a Deliver journey writes outside the project. For a Bible project: a dated PDF,
a dated aligned USFM, a plain USFM without alignment, and a Scripture Burrito. For an OBS
project: Markdown, a PDF, and a Scripture Burrito. Never a record inside the project.
_Avoid_: publish (the retired tab name), output

**Increment**:
A development unit: a GitHub milestone and its epic. An increment moves at least one `Jn` to
shipped. Only a person has a journey; an increment does not.
_Avoid_: journey (for the development unit), sprint

## Projects and content

**Bible project**:
A tC4 translation project whose content is organized by book, chapter and verse, as
opposed to an OBS project.
_Avoid_: text-translation project, scripture project


**Section**:
A run of consecutive verses that a translator drafts as one unit, marked in the book by
`\ts\*` milestones. Presentation only: a section never changes the stored verse text.
_Avoid_: chunk, translator section, passage (for the unit of drafting)

**Verse span**:
One verse key that covers consecutive verse numbers, written `\v 9-10` and keyed by the exact
string `"9-10"`. A span is a legal verse key everywhere a single verse is.
_Avoid_: bridge, bridged verses, verse range

**Structural change**:
An edit that changes the set of verse keys in a book: creating or breaking a verse span,
renumbering, adding or removing verses or chapters. Recorded as one all-or-nothing journal
action (BURRITO-SPEC §8.5). Editing the text inside a verse is never a structural change.
_Avoid_: verse move, restructuring, skeleton edit (an implementation term)

**OBS project**:
A first-class tC4 translation project for Open Bible Stories, represented alongside
Bible projects and governed by the OBS content model rather than by Bible book and
verse assumptions.
_Avoid_: OBS book, text-translation project

**Story**:
A numbered Open Bible Story that belongs to an OBS project and contains the ordered
illustrated narrative content translated by the project.
_Avoid_: book, chapter

**Frame**:
An atomic illustrated scene and its associated story text within an OBS story. It is
the natural unit for OBS drafting and review. In the story file the image line begins a
frame and exactly one paragraph follows it.
_Avoid_: verse, paragraph

**Story title**:
The first line of a story, `# N. Title`. Drafted like a frame; addressed as frame 0 of the
story, as OBS Translation Notes addresses its title notes.
_Avoid_: heading, chapter title

**Reference line**:
The last line of a story, `_A Bible story from: …_`, naming the passages the story retells.
Drafted like a frame; never a check target.
_Avoid_: footer, scripture reference (ambiguous with a verse reference)

**Frame locator**:
The key of a frame, `story:frame` without leading zeros (`1:1`); `1:0` is the story title.
Used by the check records, the journal and the helps.
_Avoid_: reference (for the key), `SS:FF`

**Image pack**:
The shared resource of frame images that a project's stories display when the project
carries no image of its own. A project may override any image with its own ingredient.
_Avoid_: picture pack, image bundle

**Source phrase**:
The words of an OBS help (`Quote`, `OrigWords`) in the language of the pinned
gateway-language OBS. The translator matches it to target words by hand.
_Avoid_: original words, target language words

## Review and delivery

**User comment**:
Free text a translator writes about a passage in Understand. Stored as a grow-only `note.add`
segment in the journal (BURRITO-SPEC §8.5). The op name is not renamed.
_Avoid_: note (collides with translation Notes), comprehension note, annotation

**Translation note**:
An entry in the pinned Translation Notes resource that explains a phrase of a passage. A
translator reads it; nobody in the project writes one.
_Avoid_: note (alone), comment

**Check comment**:
Free text a translator writes on one check item, for the next person who works that check.
It can be edited and cleared. It lives in the check's decision record and is a tC3 feature
carried forward.
_Avoid_: comment (alone), note, user comment (that is the Understand passage comment)

**Bookmark**:
A flag a translator sets on one check item to come back to it later. It can be set and
cleared. It lives in the check's decision record.
_Avoid_: reminder (the stored field name), flag, star

**Alignment suggestion**:
A link between a target word and an original-language word that the app proposes from the
project's own confirmed alignments. A suggestion is never saved until the translator confirms
it; a project with no alignments has no suggestions.
_Avoid_: prediction, auto-alignment, machine alignment

**Journal check**:
A group of executable checks in the BURRITO-SPEC §8 journal conformance suite, identified as
`JC-n` (Appendix A).
_Avoid_: `Jn` (reserved for user journeys), journey

**OBS checking**:
Human review of an OBS draft, frame by frame, using OBS Translation Notes and OBS
Translation Words with manual target selection, plus the Community Checking preview of the
story. There is no alignment layer. TQ is excluded. Structural correctness is enforced at
import and translation boundaries, not treated as a separate check tool.
_Avoid_: OBS verse checking, TQ checking, OBS alignment

**DCS send**:
The workflow that sends a completed or in-progress OBS project to the Door43 Content
Service, including the DCS-compatible project data required for that transfer.
_Avoid_: export-only, PDF publish

## Exchange and export (D79, 2026-09-22)

**Export**:
A file that leaves the app through the browser download path: a PDF, a USFM file, a Scripture
Burrito zip, story Markdown. The project is byte-identical after an export except the D9
checkpoint commit.
_Avoid_: publish (for a file), save as, download (as the user's verb)

**Export kernel**:
The layer every export runs through (`src/data/export/kernel.ts`): the D9 checkpoint when the
project is dirty, the producer, the browser download and the export Report.
_Avoid_: export service, exporter

**Export producer**:
A pure function from project data to one file, registered in the export kernel's table
(`src/data/export/producers.ts`). It makes no checkpoint, no download and no Report.
_Avoid_: exporter, writer

**Weave**:
The step that puts the §5.1 alignment records of a book into its USFM as `\zaln` and `\w`
markup (`src/data/export/weave.mjs`, through word-aligner-lib's
`addAlignmentsToTargetVerseUsingMerge`). Only the aligned USFM export weaves: the stored book
has no alignment markup (I-1). A verse with no valid record keeps its stored text (issue #19).
_Avoid_: merge (for the whole book), embed

**Print document**:
The one HTML document that the PDF export prints: the print DOM of the book
(`src/views/print/PrintBook.jsx`) for each chapter with a drafted verse, with one line for each
run of undrafted chapters between them, the page setup as CSS and the print stylesheet (`src/ds/tokens/print.css`). It stands alone: it reads no screen token and loads no web font
(issue #20). The Community Checking preview sets the same DOM and stylesheet on page sheets.
_Avoid_: print view, print page

**PDF bridge**:
The one desktop-app channel that turns a print document into PDF bytes: `export:pdf` in
`scripts/desktop-main.cjs`, exposed to the page as `tc4Desktop.printPdf` by `scripts/preload.cjs`.
It prints in a hidden window with `printToPDF` and opens no print dialog. A browser has no PDF
bridge (issue #20).
_Avoid_: print API, PDF service

**Relationships mirror**:
The `relationships` array of an exported `metadata.json`: the pins of
`checking/resources.json` as Scripture Burrito relationships, one row for each repository,
derived by `relationshipsFromPins` (`journal/relationships.mjs`, BURRITO-SPEC §3 rule 6).
`resources.json` stays the authority; nobody edits the mirror by hand (issue #359).
_Avoid_: pin list, resource links

**Page setup**:
The presentation choices of the Community Checking preview (`PageSetup`): columns, spacing,
drop-cap chapters, verse numbers, paper size, pictures and the OBS layout. The preview and every
export producer read the same page setup. It is held in memory and never stored (D80 point 5).
_Avoid_: print settings, layout spec

**QA server**:
`https://qa.door43.org`, the Door43 server that a development build uses for account and write
calls (`DCS_SERVER`, #120). It is reset weekly and holds no durable data. A packaged build uses
production, `https://git.door43.org`. Reads always use production.
_Avoid_: staging, test server, QA mode

**Share**:
The push of a project's working `main` branch to a repository under the user's Door43
account, created by the app on the first share. Send only; receiving and team sync are Phase 2.
_Avoid_: sync, send, upload, publish (for Door43)

**Share-born main**:
A Door43 `main` branch created by a first share, holding one actor's working history, as
opposed to a team main built by integrate. The sync plan's X8 scenario proves the two behave
the same.

**Import bundle**:
The one in-memory shape every import parser produces (`ImportBundle`): project facts, books or
stories, alignments, decisions, checking files, version requests, findings, or a Scripture
Burrito archive to store as it is. The import shell turns it into a new project.
_Avoid_: import result, payload

**Import parser**:
A pure function from a file's bytes to an import bundle: `usfm`, `burrito`, `tc3`. It creates
nothing and shows nothing.
_Avoid_: importer (for the parser alone), converter

**Import shell**:
The layer every import runs through (`src/data/import/shell.ts`): it creates the new project
with the primary language subtag, uploads one wrapped zip to the platform's remake, seeds the
journal of a bundle built from parts, commits, and deletes the project when a step fails. It
returns the import Report.
_Avoid_: import service, importer

**Version request**:
A resource version that an imported project names for one slot (`VersionRequest`; a tC3
project's `manifest.json` `externalResources`). The review page looks up its sha: a version
that DCS has becomes a full pin; else the user goes online or uses the installed versions. An
import stores no pin without its sha (D82).
_Avoid_: unresolved pin

**Burrito check**:
The checks that tell if a Scripture Burrito is valid for an import
(`src/data/import/burritoCheck.mjs`): `metadata.json` is present, parses and matches the bundled
schema; each listed ingredient is present with its md5 and size; the flavor is `textTranslation`
or `gloss/textStories`. The burrito parser and the conformance harness use the same module. A
failed check is a damaged finding that names the check.
_Avoid_: platform audit (a different check, not used for an import — D80 point 6)

**tC4 burrito**, **foreign burrito**:
A tC4 burrito is a Scripture Burrito that has `ingredients/checking/` (the sidecars and the
journal of BURRITO-SPEC §5). An import keeps its alignments, decisions and journal. A foreign
burrito has no `ingredients/checking/`. An import keeps only its text, and the review page says
so.

**Report**:
The one record every store operation leaves about its outcome: `{op, ok, code?, rule?, facts,
startedAt, endedAt}`, defined and validated in `journal/report.mjs`. An open, a checkpoint, a
seed and a reconcile each return one; the export, import and share kernels return one. The
store keeps the last one as `lastReport`.
_Avoid_: result, status, OpenReport (retired by #156), log entry (the ops record of #374 is a
Report written to the installation store)

**Refusal code**:
The stable name a refused operation returns in its `Report` (for example `share.non-fast-forward`,
`import.damaged.truncated`), bound to a rule id or marked as an app rule. The table
`REFUSAL_CODES` in `journal/report.mjs` is closed: a thrown `Refusal` carries one code from it.
Tests assert codes, never message strings.
_Avoid_: error code, error message (as the thing a test checks)
