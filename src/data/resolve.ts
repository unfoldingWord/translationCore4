// resolve.ts — (tool, book) resource resolution and the check-session preflight
// (BURRITO-SPEC §5.3; D17 + the five D30 constraints; INCREMENT-2 C2.1/C2.2).
//
// The rules this module encodes, verbatim from D30:
//   (1) the resolution unit is (tool, book) — never per-check mixing in a book;
//   (2) the automatic ladder is exactly primary GL -> English fallback;
//   (3) a project's pins bind every opener — no personal preference input here;
//   (4) online + pinned version absent -> fetch it (sb-zip + SHA);
//   (5) offline + pinned version absent -> that (tool, book) is UNAVAILABLE as a
//       first-class state, never an error, never a block on other work.
import { LADDER } from './burritoStore';
import type { LanguageSet, ResourcePin, ResourcesFile, Rung } from './burritoStore';

/** The tools that derive a check list, and the pin slot each one derives from.
 * tW derives from the per-book TWL links; tN from the per-book notes TSV. The
 * tw articles and tA modules are read THROUGH those items, so they never drive
 * resolution. `translationQuestions` is reserved post-Phase-1 (OQ #12/D11). */
export const TOOL_SLOT = {
  translationWords: 'translationWordsLinks',
  translationNotes: 'translationNotes',
} as const;

export type Tool = keyof typeof TOOL_SLOT;

/** Which books each pinned repo actually contains, keyed by `repoPath`. Built
 * from what is local on disk (the platform's own `book_codes`), never assumed.
 * A repo missing from the map has unknown coverage, which resolves the same as
 * "does not cover". Version identity is enforced separately by `isPinLocal`,
 * so keying by repo alone cannot smuggle in the wrong version's readiness. */
export type Coverage = { [pinKey: string]: string[] };

/** Repo-path equality.
 *
 * **The stored form is DCS's own form** [decided 2026-08-04 — owner ruling:
 * "maintain DCS casing so there is as little conversion needed as possible"].
 * Pins, install records and coverage keys all carry the path exactly as the
 * catalogue reports it, so the normal comparison is a plain string match and
 * nothing is converted on the way in or out.
 *
 * The comparison itself still ignores case, because a DCS path is a
 * case-insensitive address and burritos written elsewhere may carry a
 * different casing [VERIFIED live 2026-08-04: `GET /api/v1/repos/
 * Es-419_gl/es-419_tn` -> 200, `full_name: es-419_gl/es-419_tn`]. That is a
 * comparison-time tolerance, not a stored conversion: without it a resource
 * that IS installed reads as absent and the user is told to download it
 * again. */
export const samePath = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && (a === b || a.toLowerCase() === b.toLowerCase());

export const pinKey = (pin: ResourcePin): string => `${pin.repoPath}@${pin.version}`;

/** Books a coverage map holds for a pin. The map is keyed by the repo path as
 * DCS reports it, so the direct hit is the normal path; the scan is the same
 * comparison-time tolerance `samePath` describes, for a pin written elsewhere
 * in a different casing. */
const booksFor = (coverage: Coverage, repoPath: string): string[] => {
  const direct = coverage[repoPath];
  if (direct) return direct;
  const hit = Object.keys(coverage).find((k) => samePath(k, repoPath));
  return hit ? coverage[hit] : [];
};

export const covers = (coverage: Coverage, pin: ResourcePin, book: string): boolean =>
  booksFor(coverage, pin.repoPath).includes(book.toUpperCase());

export interface Resolution {
  tool: Tool;
  book: string;
  /** The rung whose pin supplies this book's check list; `null` when neither
   * rung covers the book — the tool is simply not offered for it. */
  rung: Rung | null;
  pin: ResourcePin | null;
  /** True when the primary GL did not cover this book and English answered. A
   * caller SHOULD surface this: a resolution change is a warned update (D17). */
  usedFallback: boolean;
}

/** Resolve one (tool, book) against the project's pins. Pure: the pins bind
 * every opener (D30.3), so nothing here reads user preference or device state. */
export const resolveToolBook = (
  resources: ResourcesFile,
  tool: Tool,
  book: string,
  coverage: Coverage,
): Resolution => {
  const slot = TOOL_SLOT[tool];
  for (const rung of LADDER) {
    const set: LanguageSet | undefined = resources.languageSets?.[rung];
    const pin = set?.[slot];
    if (pin && covers(coverage, pin, book)) {
      return { tool, book, rung, pin, usedFallback: rung === 'fallback' };
    }
  }
  return { tool, book, rung: null, pin: null, usedFallback: false };
};

/** The §5.2 `resource` record for a resolved (tool, book) — what the decision
 * file stores so a later reader knows which resource produced its checks. */
export const resolutionRecord = (r: Resolution): { repoPath: string; version: string; languageSet: Rung } | null =>
  r.pin && r.rung ? { repoPath: r.pin.repoPath, version: r.pin.version, languageSet: r.rung } : null;

/** True when a stored §5.2 resource record still matches the current
 * resolution. A false here is the "warned update" trigger (D17): the book's
 * checks would now derive from a different resource. */
export const recordMatchesResolution = (
  stored: { repoPath?: string; version?: string } | null | undefined,
  r: Resolution,
): boolean =>
  !!stored && !!r.pin && samePath(stored.repoPath, r.pin.repoPath) && stored.version === r.pin.version;

// ---------- preflight (C2.2, FR-5) ----------

/** What a check session can do with one (tool, book), given the pins, what is
 * local, and whether the machine is online. These are the D30.4/D30.5 states —
 * `unavailable` is first-class, NOT an error. */
export type PreflightState =
  | 'ready' // the resolved pin is local; open the session
  | 'fetch' // pinned version absent + online -> fetch it (sb-zip + SHA)
  | 'unavailable' // pinned version absent + offline -> first-class unavailable
  | 'unpinned' // no resources.json / no pin for this tool at all
  | 'not-covered'; // pins exist, but neither rung covers this book

export interface Preflight {
  tool: Tool;
  book: string;
  state: PreflightState;
  resolution: Resolution | null;
  /** The pin the app must fetch when `state === 'fetch'`. */
  needs: ResourcePin | null;
  /** B20 (D-warned-fallback): set when the session opened against the FALLBACK
   * rung only because the pinned PRIMARY resource is not installed. The session
   * is usable, but the UI MUST surface a warned-update — the user is checking
   * against a substitute — and offer to fetch this pin. Null when the primary is
   * local (or absent), i.e. the fallback is the plainly-correct resolution. */
  unavailablePrimary?: ResourcePin | null;
}

/** Decide what opening this (tool, book) requires. `isLocal` answers "is this
 * exact pinned version present on this machine?" — the caller supplies it from
 * the platform's local repo list. */
export const preflightToolBook = (
  resources: ResourcesFile | null,
  tool: Tool,
  book: string,
  opts: { coverage: Coverage; isLocal: (pin: ResourcePin) => boolean; online: boolean },
): Preflight => {
  const none = { tool, book, resolution: null, needs: null };
  if (!resources?.languageSets) return { ...none, state: 'unpinned' };

  const resolution = resolveToolBook(resources, tool, book, opts.coverage);
  if (resolution.pin) {
    const state: PreflightState = opts.isLocal(resolution.pin)
      ? 'ready'
      : opts.online
        ? 'fetch'
        : 'unavailable';
    // B20 (warned fallback) — coverage is evidence from LOCAL installs only
    // ("never assumed"), so a fallback resolution is ambiguous: the primary may
    // genuinely lack this book, OR it is simply not installed and its coverage
    // is unknown. We do NOT silently switch resource/language (the original bug),
    // and we do NOT force a fetch for a book the primary may not even cover (the
    // over-correction). Instead: open the fallback (it works) and flag the
    // not-local pinned primary so the UI warns and offers to fetch it. The
    // precise fetch-vs-fallback call needs the primary's coverage — deferred to
    // the resolver-metadata increment that records per-pin coverage (with D40).
    const primaryPin = resources.languageSets.primary?.[TOOL_SLOT[tool]];
    const unavailablePrimary =
      resolution.usedFallback && primaryPin && !opts.isLocal(primaryPin) ? primaryPin : null;
    return {
      tool,
      book,
      state,
      resolution,
      needs: state === 'fetch' ? resolution.pin : null,
      unavailablePrimary,
    };
  }

  // Nothing covered the book. Distinguish "no pin at all in this slot" from
  // "pinned, but this book is not in the resource" — different user messages.
  const slot = TOOL_SLOT[tool];
  const anyPin = LADDER.some((rung) => resources.languageSets?.[rung]?.[slot]);
  if (!anyPin) return { ...none, state: 'unpinned' };

  // A pinned resource whose content is not local yet has unknown coverage; when
  // online that is a fetch, not a verdict about the book.
  const unfetched = LADDER.map((rung) => resources.languageSets?.[rung]?.[slot])
    .filter((p): p is ResourcePin => !!p)
    .find((p) => !opts.isLocal(p));
  if (unfetched) {
    return opts.online
      ? { tool, book, state: 'fetch', resolution, needs: unfetched }
      : { tool, book, state: 'unavailable', resolution, needs: null };
  }
  return { ...none, state: 'not-covered', resolution };
};

/** Does the whole session block? No — never. D30.5: an unavailable (tool, book)
 * never blocks drafting, other books, or other tools. This helper exists so
 * callers state that intent in code rather than re-deriving it. */
export const blocksOtherWork = (): false => false;
