# tC4 Product Vision

**Status:** Product direction  
**Audience:** Current and future maintainers  
**Confirmed:** 2026-08-29

## Purpose

This document defines what translationCore 4 (tC4) is, who it serves, and how to
prioritize its scope. It guides product direction; the roadmap governs delivery,
the Burrito specification governs project format, and the architecture documents
govern implementation. The scope below is a target, not a claim about the current
alpha or pilot roadmap.

## Vision

tC4 is an **offline-first desktop workspace** where mother-tongue bilingual
translators understand, translate, and concept-check Bible or Open Bible Stories
translations in one durable project.

It puts trusted resources at the translator's fingertips, preserves their work above
all else, supports dependable asynchronous exchange through Scripture Burritos and
Door43, and produces readable deliverables: USFM and PDF for Bible projects, and
Markdown and PDF for Open Bible Stories.

## Users

tC4 serves translators drafting or checking in their minority language from a major
gateway language. Some are experts; others need extensive help. The app presents
passage-specific information without forcing either group through workflow gates.
Facilitators and consultants support the work, but the translator's needs decide
product tradeoffs.

## Understand, Translate, Check

UTC is tC4's enduring workflow. Translators move among its three activities as their
understanding and text develop.

### Understand

Understand helps translators comprehend the passage, identify translation issues,
decide how to handle them naturally, and record shared notes and insights. Time spent
here should reduce drafting effort and later rework. Translators may use as few or as
many resources as they need; preparation is encouraged, not enforced.

### Translate

Translate makes natural composition easy without exposing file management. Bible
translators work by verse or by sections derived from ULT `\ts` markers. Open Bible
Stories translators work frame by frame.

Resources, shared notes, and target-language context remain close at hand. An optional
blind-drafting mode hides source and reference resources while retaining notes and
target-language context. Translation text stays editable, and revisions never
silently rewrite untouched content.

### Check

Check pivots the translation by concept: a term, name, metaphor, or translation issue
across its contexts. Teams may also check verse by verse. translationWords and
translationNotes provide the structured checking backbone. Translators can record
decisions, override checks, and edit the text from the checking context.

translationQuestions supports Understand and Translate; no tQ checks are planned.
Community checking and deliverable preparation belong within Check, not in a fourth
top-level workflow.

## Core commitments

### Preserve the work

Translators may risk their lives to create irreplaceable work. Data loss is therefore
not an ordinary defect. tC4 must never silently lose, rewrite, invalidate, or strand
their work.

One authoritative project holds the translation, pinned resources, append-only shared
notes, decisions, alignments, history, and collaboration state. USFM, Markdown, and PDF
are deliverables; a Scripture Burrito is the complete portable project. Projects must
remain recoverable and compatible with future tC4 versions.

### Work offline

Once a project and its resources are local, all of UTC and local export work offline.
Door43 is the primary connected path, while resources and Burritos may also arrive by
USB, email, or another local channel. tC4 does not promise anonymity when Door43 is
used.

### Exchange work dependably

Work normally happens with one user on one machine while others may work independently
on the same logical project. Users can send and receive work through Door43, continue
offline, import parallel work, and resolve conflicts without silently losing either
contribution.

### Keep resources explicit

The core resources are ULT, UST, tN, tW, tA, and tQ. Other resources may supplement
them. BT Servant is an optional online, read-only question-answering aid; it never
writes the translation or becomes necessary for UTC.

Resources stay pinned. tC4 announces newer versions but never installs them silently.
Before updating, users see how many checks may be invalidated. They may remain on the
current version and download that exact version if needed. Updates preserve notes and
decisions while identifying work that needs reconsideration.

## Initial public release

The intended first complete public release includes:

- Bible and Open Bible Stories projects;
- new projects, tC3 migration, raw USFM import, and Burrito import from Door43 or local
  transfer;
- Windows, macOS, and Linux;
- correct RTL and complex-script editing and export, including SIL Graphite fonts and
  shaping;
- English, Spanish, and French interfaces, with Arabic following soon afterward; and
- Door43 send and receive, continued offline work, conflict resolution, and future
  project compatibility.

The desktop shell is Electronite (D20, a hard requirement). Plain Electron/Chromium does
not shape SIL Graphite fonts. Electronite is the means; the enduring requirement is
correct script rendering everywhere. A different runtime is possible only through a new
decision that supersedes D20 and proves the same rendering.

Bible projects produce USFM, review PDF, and Scripture Burrito. OBS projects produce
Markdown, review PDF, and Scripture Burrito. PDFs follow USFM or OBS structure with a
coherent Bible-like treatment. Options are document-level only: one or two columns,
normal or double spacing, Letter or A4 paper, possibly A5, and base character size.
tC4 is not a desktop-publishing system.

## Future explorations

These fit UTC but remain experiments, not release promises:

- **Basic Checks:** selectable automated checks with live reports that link to the
  editable text and show when a change resolves a finding.
- **Audio drafting:** preserve oral composition as project work; conversion to editable
  text remains experimental.
- **STT-assisted oral checking:** use a better-supported language with similar sounds to
  create a familiar-alphabet representation that existing checks can process. The
  representation is not authoritative; the audio remains the source.
- **AI-assisted alignment:** propose alignments for human correction and acceptance;
  never replace approved work silently.
- **Adaptive AI checking:** learn from manual checks and alignments across the current
  project to rank all visible occurrences. Show manual completeness separately from AI
  confidence. Edits, alignment changes, and resource updates may invalidate confidence.
  No cross-project learning is implied.
- **Additional resources:** allow more resources without making each one part of the
  default experience.

AI assists human judgment. It does not make final quality claims, edit the translation
automatically, or become required for UTC.

## Priorities

Four requirements are invariant:

1. Preserve the translator's work and exact language text.
2. Keep UTC usable offline after setup.
3. Render and preserve the user's writing system correctly.
4. Keep complete projects and deliverables portable.

Within those boundaries, prioritize:

1. Understanding and translation quality.
2. Low translator effort and interface simplicity.
3. Offline collaboration and interoperability.
4. Configurability, resource breadth, and secondary workflows.

Reject or redesign a feature that weakens a higher commitment.

## Non-goals

tC4 is not a general translation or Bible-study app, a program-management suite, a
live collaborative editor, an anonymity guarantee, an autonomous AI translator, a
replacement for training or human review, or a desktop-publishing system.

## Success

tC4 succeeds when translators can stop switching among tools for their core Bible or
Open Bible Stories translation process. They can start or import work, complete UTC,
continue offline, exchange the complete project, resolve conflicts without loss, and
produce readable deliverables in the target writing system—all from one authoritative
project.
