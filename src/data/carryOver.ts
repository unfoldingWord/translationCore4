// carryOver.ts — what happens to a book's decisions when the resource behind
// its checks changes (D17, and the tC3 precedent the project owner set on
// 2026-08-04).
//
// THE RULE: **the resource is the primary key.** The check list derived from
// the currently-pinned resource IS the work. A stored decision that cannot be
// placed on that list is not a queue item to work through later — it no longer
// describes any check that exists, so it is marked invalidated and the user
// simply has that check to do again.
//
// The honest consequence, and the one to tell the user about up front: a book
// that was 100% checked will not be 100% checked after a resource change. The
// new resource asks questions the old one did not.
//
// Nothing is deleted. An invalidated decision keeps its full §5.2 record, so
// switching back later can re-attach it (its checkId is still the old
// resource's, which matches again once that resource is pinned again).
import { mergeAndReattach } from './derive';
import type { CheckItem } from './derive';
import type { Decision, DecisionFile } from './burritoStore';

export interface CarryOverResult {
  /** The file to write back: same decisions, with the unplaceable ones marked. */
  file: DecisionFile;
  /** How many decisions carried onto the new list. */
  carried: number;
  /** How many were invalidated because the new resource has no such check. */
  invalidated: number;
  /** Checks in the new list with no decision at all — work that now exists. */
  undecided: number;
}

/**
 * Recompute one book's decision file against a freshly derived check list.
 *
 * `derived` MUST come from the resource being switched TO. Decisions that
 * re-attach keep their state; the rest are flagged `invalidated` (and their
 * status forced to `invalid` UNLESS the user set `todo`, which §5.2 lets stand)
 * — tC3's behaviour, and the one that keeps progress honest rather than
 * crediting work against checks that no longer exist. Records are kept BY
 * PROVENANCE (everything in `file.decisions` is user data), never deleted.
 */
export const carryOverDecisions = (
  file: DecisionFile,
  derived: CheckItem[],
  resource: { repoPath: string; version: string; languageSet?: string },
): CarryOverResult => {
  const saved = (file.decisions ?? []) as unknown as CheckItem[];
  const { items, unplaced, placed } = mergeAndReattach(derived, saved);

  // What the file holds after the change is keyed to the NEW resource: the
  // decisions that sit on the new check list, carrying their contextIds. A
  // decision that re-attached across a language change is here under the
  // derived contextId, which is the point — the resource is the primary key.
  //
  // F5 — keep BY PROVENANCE, not by inspecting fields. A record that came from
  // `file.decisions` is user data by origin; `placed` marks the derived items
  // that carry one. The old field test asked "does this look like user data?",
  // and a re-pin that cleared an item's status back to a fresh-looking shape
  // then read as untouched — silently DELETING a status-only ("todo") decision
  // on the switch-away-and-back cycle. Provenance cannot be fooled that way.
  const carriedDecisions = items.filter((i) => placed.has(i)) as unknown as Decision[];

  // Plus, retained and marked, the ones neither pass could place. They no
  // longer describe a check that exists, so they do not count as progress —
  // but they are kept, so pinning the old resource back restores them.
  // §5.2: invalidation MUST NOT leave status "valid"; a "todo" the user set is
  // their triage and is preserved, so the round-trip is loss-free.
  const invalidatedDecisions = (unplaced as unknown as Decision[]).map((d) => ({
    ...d,
    invalidated: true,
    status: d.status === 'todo' ? ('todo' as const) : ('invalid' as const),
  }));

  // Checks in the new list with no decision at all — work that now exists.
  const undecided = items.filter((i) => !placed.has(i)).length;

  return {
    file: {
      ...file,
      resource,
      decisions: [...carriedDecisions, ...invalidatedDecisions],
    },
    carried: carriedDecisions.length,
    invalidated: invalidatedDecisions.length,
    undecided,
  };
};

/** Plain-language summary of what a change costs THIS book. Phrased as work
 * that reappears, not as a queue: "you will have N checks to do again". */
export const describeCarryOver = (r: CarryOverResult, bookLabel: string): string => {
  if (r.invalidated === 0) {
    return `${bookLabel}: every decision carried over.`;
  }
  return (
    `${bookLabel}: ${r.carried} decision${r.carried === 1 ? '' : 's'} carried over, ` +
    `${r.invalidated} no longer applies and will need checking again.`
  );
};
