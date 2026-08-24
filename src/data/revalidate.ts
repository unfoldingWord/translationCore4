// revalidate.ts — C2.8. Two independent "the ground moved" checks that a
// checking session must run, both of which surface rather than discard work.
//
//   1. TEXT revalidation (I-3). A decision's `selections` point at words in the
//      target draft. When that verse is edited the selection may no longer be
//      present, so the decision needs re-review. The same validator the
//      conformance harness uses decides this — never a hand-rolled compare.
//   2. RESOLUTION revalidation (D17). A decision file records which resource
//      produced its checks. When the project's pins now resolve elsewhere, the
//      book's checks would derive from a different resource — "a warned update,
//      never silent".
//
// Neither check ever deletes a decision. Invalidation is a flag the user acts
// on; a resolution change is a banner, not a migration.
import { selectionsHelpers } from './vendor';
import { recordMatchesResolution , samePath } from './resolve';
import type { Resolution } from './resolve';
import type { CheckItem } from './derive';

/** Verse text keyed "chapter:verse", as the drafting model already produces. */
export type VerseTextIndex = { [ref: string]: string };

const refOf = (item: CheckItem): string =>
  `${item.contextId.reference.chapter}:${item.contextId.reference.verse}`;

/** Does this decision still match the draft? `true` = the selections are no
 * longer findable in the verse, so the item needs re-review. A decision with
 * no selections (nothing-to-select, or untouched) cannot go stale this way. */
export const decisionIsStale = (item: CheckItem, verseText: string | undefined): boolean => {
  const selections = item.selections;
  if (!Array.isArray(selections) || selections.length === 0) return false;
  if (verseText === undefined) return false; // no draft yet: not evidence of staleness
  try {
    const result = selectionsHelpers.validateVerseSelections(verseText, selections) as {
      selectionsChanged?: boolean;
    };
    return result?.selectionsChanged === true;
  } catch {
    return false; // a validator failure is not proof the decision is stale
  }
};

export interface RevalidationResult {
  items: CheckItem[];
  /** How many items this pass newly flagged. */
  invalidated: number;
}

/** Flag every decision whose selections no longer match the draft. Returns new
 * item objects; the caller decides whether to persist the flags (§5.2
 * `invalidated` + the derived `status`). */
export const revalidateAgainstDraft = (
  items: CheckItem[],
  verses: VerseTextIndex,
): RevalidationResult => {
  let invalidated = 0;
  const next = items.map((item) => {
    const stale = decisionIsStale(item, verses[refOf(item)]);
    if (!stale) return item;
    if (item.invalidated === true) return item; // already known
    invalidated += 1;
    return { ...item, invalidated: true, status: 'invalid' };
  });
  return { items: next, invalidated };
};

export interface ResolutionWarning {
  /** What the stored decision file says produced its checks. */
  stored: { repoPath?: string; version?: string; languageSet?: string };
  /** What the project's pins resolve to now. */
  current: { repoPath: string; version?: string; sha?: string } | null;
}

/**
 * SAFETY NET ONLY — not the routine path.
 *
 * The consequences of changing which resource a book is checked against are
 * shown at the moment of the change (`data/gatewayChange.ts`, D23a/D30.2), so
 * an ordinary session must never surprise a user with them. This fires only
 * when a decision file records a resource that is in NEITHER of the project's
 * current rungs — a genuinely inconsistent file: hand-edited, restored from a
 * backup, or arrived from a teammate with different pins.
 *
 * In particular, partial coverage is silent by construction: with Spanish
 * primary and English fallback, a book checked against either rung agrees with
 * one of them, so no warning fires (D30.1/D30.2).
 */
export const resolutionWarning = (
  stored: { repoPath?: string; version?: string; sha?: string; languageSet?: string } | null | undefined,
  resolution: Resolution | null,
  /** Both rungs' pins for this tool. Omitted only by callers that genuinely
   * have no pin file, where nothing can be judged inconsistent. */
  rungPins: Array<{ repoPath: string; version?: string; sha?: string }> = [],
): ResolutionWarning | null => {
  if (!stored?.repoPath || !resolution?.pin) return null;
  if (recordMatchesResolution(stored, resolution)) return null;
  // Recorded against the OTHER rung — that is the ladder working, not drift.
  // Identity is (repoPath + sha), D58/D59. A record without a sha matches NO
  // rung: tags are unenforced upstream, so a label agreement proves nothing —
  // a sha-less (tC3-era) record reads as drift until the import boundary's
  // tag→sha lookup resolves it (D59 §1).
  const sameRecord = (p: { repoPath: string; version?: string; sha?: string }): boolean =>
    samePath(p.repoPath, stored.repoPath) && !!stored.sha && p.sha === stored.sha;
  if (rungPins.some(sameRecord)) {
    return null;
  }
  return {
    stored,
    current: {
      repoPath: resolution.pin.repoPath,
      ...(resolution.pin.version ? { version: resolution.pin.version } : {}),
      sha: resolution.pin.sha,
    },
  };
};

/** Is this a language switch rather than a version bump? The two deserve
 * different words: an upgrade re-derives the same language, a switch changes
 * which language's notes the checker reads. */
export const isLanguageSwitch = (warning: ResolutionWarning): boolean =>
  !!warning.current && warning.stored.repoPath !== warning.current.repoPath;
