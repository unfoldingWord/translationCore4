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
// This never REPLACES a recorded coverage. A pin's identity is repoPath + sha
// (D58), so its content cannot change; a recorded book list is a fact about that
// commit, not a cache to refresh. Overwriting one could only ever lose
// information — for instance from a partially-fetched install.
import type { LanguageSet, ResourcePin, ResourcesFile } from './burritoStore';
import { LADDER } from './burritoStore';
import { coverageFor, type Coverage } from './resolve';

/** The pin slots that carry a repo and can therefore carry coverage. */
const SET_SLOTS = [
  'translationNotes',
  'translationWordsLinks',
  'translationWords',
  'translationAcademy',
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

  /** Returns the pin unchanged unless it both lacks coverage and has a local
   * answer available. */
  const fill = (pin: ResourcePin | undefined): ResourcePin | undefined => {
    if (!pin) return pin;
    if (pin.books && pin.books.length > 0) return pin; // never overwrite a fact
    const known = coverageFor(coverage, pin);
    // `source: 'local'` is the only case that adds information here. 'pin' is
    // already handled above, and 'none' means the resource is not on this
    // machine — which is the state the warning is for, not something to invent.
    if (known.source !== 'local' || known.books.length === 0) return pin;
    filled.push(`${pin.repoPath}@${pin.sha}`);
    return { ...pin, books: known.books };
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
