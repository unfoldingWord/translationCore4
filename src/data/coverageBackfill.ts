// coverageBackfill.ts — record a pinned resource's book coverage while it is
// local, for pins written before per-pin coverage existed (issue #16, D41).
//
// WHY A BACKFILL AT ALL
//
// #16 records coverage AT PIN TIME, which covers every pin written from now on.
// It cannot help a project pinned earlier: those pins carry no `books`, so the
// resolver is back to guessing from local installs, and every fallback has to be
// warned (the B20 behaviour #16 exists to retire).
//
// The fix is cheap because the answer is often already on disk. If a coverage-less
// pin's resource IS installed, its real book list can be read right now and
// written into the pin — the same computation `coverageFromLocal` performs, just
// persisted instead of recomputed every session. After that pass, the only pins
// still lacking coverage are those whose resource is not on this machine, which
// is exactly the case nobody can answer and the warning is honest about
// [decided 2026-08-24 — owner ruling, Q3 option (c)].
//
// This never SHRINKS or replaces a recorded coverage. A pin's identity is
// repoPath + sha (D58), so its content cannot change; a recorded book list is a
// fact about that commit, not a cache to refresh. But a record captured from a
// partially-fetched install can be INCOMPLETE, and an incomplete record silently
// substitutes the fallback for books the resource covers — so a sha-exact local
// read may WIDEN a record. Widening only adds facts about the same commit.
import type { LanguageSet, ResourcePin, ResourcesFile } from './burritoStore';
import { LADDER } from './burritoStore';
import { coverageFor, type Coverage } from './resolve';
import { PIN_BOOK_RE, WHOLE_COLLECTION } from '../../journal/grammar.mjs';

/** The pin slots that carry a repo and can therefore carry coverage —
 * including the §5.3 1.10 OPTIONAL slots (D64): without recorded `books`, a
 * transferred project cannot tell an uncovered primary tq/simplified from an
 * unfetched one (2026-08-27 Codex review). */
const SET_SLOTS = [
  'translationNotes',
  'translationWordsLinks',
  'translationWords',
  'translationAcademy',
  'translationQuestions',
  'simplifiedText',
] as const;

export interface BackfillResult {
  resources: ResourcesFile;
  /** Pins that gained a book list, by `repoPath@sha`. Empty means nothing to do. */
  filled: string[];
  /** True when `resources` differs from the input and is worth writing. */
  changed: boolean;
}

/** Add `books` to every pin that lacks it and whose resource is local.
 *
 * Pure: it returns a new document and never writes. The caller decides whether
 * to persist, which keeps this testable and keeps the write on the caller's own
 * compare-and-swap path. */
export const backfillCoverage = (
  resources: ResourcesFile | null,
  coverage: Coverage,
): BackfillResult => {
  if (!resources) return { resources: resources as never, filled: [], changed: false };

  const filled: string[] = [];

  /** Returns the pin unchanged unless a sha-exact local read adds information.
   *
   * A recorded list is never SHRUNK or replaced — but it can be WIDENED. The
   * record may have been captured from a partial copy at the pinned sha (a
   * single-book sideload, an interrupted install); books the sha-exact local
   * read proves present are facts about the same commit, and leaving them out
   * keeps silently substituting the fallback for books the resource actually
   * covers (B20). Widening only ever adds, so no information is lost. */
  const fill = (pin: ResourcePin | undefined): ResourcePin | undefined => {
    if (!pin) return pin;
    // Strip the pin's own record for the lookup: coverageFor would answer from
    // it ('pin' outranks 'local'), and the question here is what the sha-exact
    // LOCAL read knows. 'none' means the resource is not on this machine —
    // which is the state the warning is for, not something to invent.
    const local = coverageFor(coverage, { ...pin, books: undefined });
    if (local.source !== 'local' || local.books.length === 0) return pin;
    const recordedList = Array.isArray(pin.books)
      ? pin.books.filter((b): b is string => typeof b === 'string').map((b) => b.toUpperCase())
      : [];
    // A whole-collection record already covers everything — nothing to widen,
    // and mixing book codes into it would break the §5.3 form.
    if (recordedList.length === 1 && recordedList[0] === WHOLE_COLLECTION) return pin;
    // A local 'BIBLE' marker means the resource is not book-partitioned and
    // covers everything (the tw articles). Record the §5.3 whole-collection
    // form — exactly ['BIBLE'] — so the fact TRAVELS with the project: another
    // machine without the resource must resolve to this pin (fetch), not to
    // the warned English fallback. Never onto a pin that already records: a
    // record is never replaced (§5.3), and the marker never mixes with codes.
    if (local.books.includes(WHOLE_COLLECTION)) {
      if (recordedList.length > 0) return pin;
      filled.push(`${pin.repoPath}@${pin.sha}`);
      return { ...pin, books: [WHOLE_COLLECTION] };
    }
    // Any other non-book code (the ta modules' 'TRANSLATE') has no §5.3 form —
    // the seal refuses it, and no tool resolves through ta coverage. Untouched.
    if (local.books.some((b) => !PIN_BOOK_RE.test(b))) return pin;
    const missing = local.books.filter((b) => !recordedList.includes(b));
    if (recordedList.length > 0 && missing.length === 0) return pin; // nothing to add
    filled.push(`${pin.repoPath}@${pin.sha}`);
    return { ...pin, books: recordedList.length === 0 ? local.books : [...recordedList, ...missing] };
  };

  const nextSets: Record<string, LanguageSet> = {};
  for (const rung of LADDER) {
    const set = resources.languageSets?.[rung];
    if (!set) continue;
    const nextSet = { ...set } as LanguageSet;
    for (const slot of SET_SLOTS) {
      const filledPin = fill(set[slot]);
      if (filledPin) nextSet[slot] = filledPin;
    }
    nextSets[rung] = nextSet;
  }

  // extraScripture pins are per-book source texts; coverage applies to them too,
  // and a source pane for a book the text lacks should not be offered.
  const nextExtra = resources.extraScripture?.map((entry) => {
    const filledPin = fill(entry as unknown as ResourcePin);
    return (filledPin ?? entry) as typeof entry;
  });

  const changed = filled.length > 0;
  return {
    changed,
    filled,
    resources: changed
      ? {
          ...resources,
          languageSets: { ...resources.languageSets, ...nextSets } as ResourcesFile['languageSets'],
          ...(nextExtra ? { extraScripture: nextExtra } : {}),
        }
      : resources,
  };
};
