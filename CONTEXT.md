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
the natural unit for OBS drafting and review.
_Avoid_: verse, paragraph

## Review and delivery

**User comment**:
Free text a translator writes about a passage in Understand. Stored as a grow-only `note.add`
segment in the journal (BURRITO-SPEC §8.5). The op name is not renamed.
_Avoid_: note (collides with translation Notes), comprehension note, annotation

**Journal check**:
A group of executable checks in the BURRITO-SPEC §8 journal conformance suite, identified as
`JC-n` (Appendix A).
_Avoid_: `Jn` (reserved for user journeys), journey

**OBS checking**:
Human review of an OBS draft using OBS Translation Notes and Translation Words,
with TQ excluded from the checking workflow. Structural correctness is enforced at
import and translation boundaries, not treated as a separate check tool.
_Avoid_: OBS verse checking, TQ checking

**DCS send**:
The workflow that sends a completed or in-progress OBS project to the Door43 Content
Service, including the DCS-compatible project data required for that transfer.
_Avoid_: export-only, PDF publish
