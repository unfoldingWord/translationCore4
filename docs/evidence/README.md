# Evidence records

Each file here records one measurement, on one date, by one method. A `[VERIFIED]` tag in the
specification or in the platform notes points to a file here. The record is the proof.

## Read these three rules first

1. **A record states what was true on its date. It states nothing about today.** Read the
   date in the heading before you use a number from a record.
2. **The current state is the specification and the harness, not a record.** For the format,
   read `../BURRITO-SPEC.md`. For platform behavior, read `../PLATFORM-NOTES.md`. To measure
   the current state, run the harness.
3. **A record is never edited to change a measurement.** If a measurement is superseded, the
   record gets a note at the top that names the new value and the new evidence. The original
   measurement stays. This keeps the history honest.

## You do not need to read this directory

These files are a citation target. Follow a link into this directory when you want to check a
claim. Do not read the directory from start to finish.

To contribute, read `../../README.md` and `../../CONTRIBUTING.md`.

## How to add a record

Do the steps that follow:

1. Run the measurement. Record the exact command.
2. Write the file. Name it `<subject>-<YYYY-MM-DD>.md`.
3. State the date, the method, and the version of every component that you measured.
4. State the result exactly. Do not round a number and do not summarize a count.
5. State the limits of the measurement. Name what you did not test.
6. Add the `[VERIFIED — evidence/<file>]` tag to the claim that the record proves.

"Verifying a platform claim" (the final section of `../PLATFORM-NOTES.md`) gives the rules for a claim about the Pankosmia platform.
Read that document before you record a platform measurement.

## Corrections are records too

Some files correct an earlier claim of this project.
`zip-roundtrip-correction-2026-07-27.md` withdraws a claim that this project made about the
platform and states why the claim was wrong. These files stay published on purpose. A
withdrawn claim, kept with its reason, is more useful than a claim that quietly disappears.

## Provenance of source reads

`investigated-commits.txt` lists the repository revisions that this project read. Cite a
version, a commit hash and a date together. A hash alone does not say whether the code is
current.
