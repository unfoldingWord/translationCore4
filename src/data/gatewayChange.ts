// gatewayChange.ts — changing a project's gateway language (D23a / D30.2).
//
// WHERE THE WARNING BELONGS. Partial coverage needs no warning at all: the
// two-rung ladder resolves per (tool, book), so a project pinned to Spanish +
// English uses Spanish for Titus and English for Hebrews simultaneously, with
// no user action (D30.1/D30.2). A user should never have to switch languages
// because one book is uncovered.
//
// The only thing that DOES change which resource a checked book uses is an
// explicit whole-project gateway-language change. §5 default #2 (D23a) says
// that change "is explicit, and the app shows the consequences" — so the
// consequences are counted HERE, before it is committed, and the user can
// decline. They are NOT a banner discovered later when opening a book: that
// moves the user from deciding to discovering and removes the choice.
import type { DecisionFile, LanguageSet, ResourcesFile } from './burritoStore';
import { TOOL_SLOT, pinKey } from './resolve';
import type { Tool } from './resolve';

/** One book whose stored decisions were made against a resource the change
 * would move away from. */
export interface AffectedBook {
  tool: Tool;
  book: string;
  /** What its decisions were checked against. */
  checkedAgainst: { repoPath: string; version: string };
  /** How many stored decisions that book holds. */
  decisions: number;
}

export interface ChangeConsequences {
  /** Books that keep working exactly as before — nothing to say about them. */
  unaffectedBooks: number;
  affected: AffectedBook[];
  /** Total decisions that were made against a resource the change moves
   * away from. Some will carry over by meaning; the rest stop applying and
   * those checks come back as work. */
  decisionsAtRisk: number;
  /** True when nothing at all would be disturbed: commit without ceremony. */
  harmless: boolean;
}

export interface StoredDecisionFile {
  tool: Tool;
  book: string;
  file: DecisionFile | null;
}

/**
 * What would this gateway-language change cost?
 *
 * A book is affected when it HAS stored decisions AND those decisions were
 * checked against a resource that the new pin set no longer provides for it.
 * A book checked against the English fallback is unaffected by a change of the
 * PRIMARY language, because the fallback rung does not move — which is the
 * common case and is exactly why this must be counted rather than assumed.
 */
export const consequencesOfGatewayChange = (
  stored: StoredDecisionFile[],
  next: { primary: LanguageSet; fallback: LanguageSet },
): ChangeConsequences => {
  const provided = new Set<string>();
  for (const set of [next.primary, next.fallback]) {
    for (const slot of Object.values(TOOL_SLOT)) {
      const pin = set[slot];
      if (pin) provided.add(pinKey(pin));
    }
  }

  const affected: AffectedBook[] = [];
  let unaffectedBooks = 0;
  for (const entry of stored) {
    const file = entry.file;
    const count = file?.decisions?.length ?? 0;
    if (!file || count === 0) continue; // nothing to lose
    const checkedAgainst = file.resource;
    if (!checkedAgainst?.repoPath) {
      unaffectedBooks += 1; // no record: nothing states it would move
      continue;
    }
    const key = pinKey(checkedAgainst as never);
    if (provided.has(key)) {
      unaffectedBooks += 1;
      continue;
    }
    affected.push({
      tool: entry.tool,
      book: entry.book,
      checkedAgainst: {
        repoPath: checkedAgainst.repoPath,
        version: checkedAgainst.version ?? '',
      },
      decisions: count,
    });
  }

  const decisionsAtRisk = affected.reduce((sum, a) => sum + a.decisions, 0);
  return {
    unaffectedBooks,
    affected,
    decisionsAtRisk,
    harmless: affected.length === 0,
  };
};

/** Plain-language summary for the confirmation dialogue. Deliberately concrete
 * — book names and a count, not "some checks may be affected". */
export const describeConsequences = (
  c: ChangeConsequences,
  bookName: (code: string) => string,
): { headline: string; detail: string } => {
  if (c.harmless) {
    return {
      headline: 'Nothing you have already checked will be affected.',
      detail: '',
    };
  }
  const books = [...new Set(c.affected.map((a) => a.book))];
  const named = books.slice(0, 3).map(bookName);
  const more = books.length - named.length;
  const bookList =
    more > 0 ? `${named.join(', ')} and ${more} more` : named.join(' and ');
  return {
    headline: `${c.decisionsAtRisk} decision${
      c.decisionsAtRisk === 1 ? '' : 's'
    } in ${bookList} were made against the notes you are leaving.`,
    detail:
      'Decisions that match a check in the new notes carry over. The rest stop ' +
      'applying, so those checks come back as work — a book that was finished ' +
      'will not be finished any more. Nothing is deleted.',
  };
};

/** Apply the change to the pin file. Only `primary` moves; the English
 * fallback rung is the installed suite and never changes here (D30.2). */
export const applyGatewayChange = (
  resources: ResourcesFile,
  primary: LanguageSet,
): ResourcesFile => ({
  ...resources,
  schemaVersion: 2,
  languageSets: { ...resources.languageSets, primary },
});
