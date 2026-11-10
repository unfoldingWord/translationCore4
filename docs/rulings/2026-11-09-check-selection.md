# Check: a changed selection takes the mark away, and a mark is the save

- Asked: 2026-11-09, while fixing #853 (words selected after Mark valid were not saved): what
  happens to a check's mark when the translator changes the selected words after it? The first
  reading of the issue saved the new words into the valid check.
- Options: save the changed words into the valid check by themselves, a moment after the last
  change and on leaving the check; or treat the selection as an editor treats unsaved changes,
  so that a change takes the mark away and only a mark saves.
- Answer: the owner, 2026-11-09, in the design session for #853: the second. The owner had the
  rule written into the description of #853 on 2026-11-10. This file words the rule as that
  description does; it does not quote the owner.

## The rule

1. A changed selection clears the mark. Any finished change of the selected words on a marked
   check (Valid, Invalid or To do) saves an unmark at once. The stored check goes back to no
   decision, not To do. It counts as not done in the progress and in the rail, and a teammate
   receives no decision for it on sync. The words stay selected on screen.
2. A mark is the save. Mark valid stores the words on screen.
3. The unmark is stored, not kept on the screen only. The earlier mark stays in History (H5).
4. Previous and Next are off while words are selected on a check with no decision. They come
   back when the check is marked or the words are unselected.
5. Every other way out asks first: a click in the rail, All checking tools, a mode tab, a
   project switch.
6. Closing the app, or a crash, drops the selected words. The stored check already has no
   decision, so nothing untrue is kept.

## Changes

`docs/DIFFERENCES.md` (four entries), J4 in `docs/JOURNEYS.md`, `docs/STORAGE.md` §5.4, and the
journeys mapped under J4 in `parity/app/journeys/coverage.json`.

## Effect for translators

A check never shows a mark that was made for other words than the ones on screen. A translator
who changes the words sees the mark go, marks the check again, and the words are kept. Words
that no mark saved are never dropped without a sign: the translator is held on the check or
asked first.

## What Invalid means (owner, 2026-11-10)

- Asked: 2026-11-10, about Mark invalid with words selected on screen: "Is the check invalid
  or the text?" The app shows two things as Invalid: the translator's own mark, and a decision
  that no longer holds because the text or the helps changed.
- Answer: the owner, 2026-11-10: the text. The Invalid button means the translation fails
  this check.

So no words translate the check, and Mark invalid takes the selected words off the screen at
the click, as its record stores none. Words tapped on a check that shows Invalid hold the
check like any others, until a mark or until they are unselected.

## Not decided

- Mark To do with words on screen: the mark turns Previous and Next back on (rule 4), but
  only Mark valid stores words, so the words are dropped on Next.
- A decision that no longer holds also shows as Invalid. Whether it gets words of its own is
  open.

## The words (owner, 2026-11-10)

The question reads "The selected words are not saved", with the buttons "Stay" and "Leave
without them", as Align's question does. The owner agreed to the words on 2026-11-10; the
translations in the nine other languages have not been read by a speaker.
