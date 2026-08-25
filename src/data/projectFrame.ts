// projectFrame.ts — establish a project's versification frame, and fetch the
// scheme documents a conversion needs (epic #33 / issue #15).
//
// This is the I/O half of the frame question; `versification.ts` holds the pure
// half. Keeping them apart is what lets the resolver ladder be unit-tested
// against real scheme data with no server at all.
//
// WHY THE SCHEME DATA COMES FROM THE SERVER, NOT THE PROJECT FILE
//
// Every project carries a verbatim copy of its scheme at `ingredients/vrs.json`,
// but nothing upstream reads the `mappedVerses` half of it — the platform only
// ever reads `maxVerses`, to scaffold books and to build the canonical book
// list. tC4 would be that table's only consumer, so the project copy is not
// treated as the authority for mapping. The named scheme served by
// `GET /content-utils/versification/<name>` is. The project copy keeps exactly
// one job: fingerprinting, when no name was recorded.
import {
  KNOWN_SCHEME_NAMES,
  isSchemeName,
  resolveProjectScheme,
  type ResolvedScheme,
  type SchemeDoc,
  type SchemeName,
} from './versification';

/** What a derive pass needs to know about frames. */
export interface ProjectFrame extends ResolvedScheme {
  /** The scheme documents needed for a conversion, keyed by name. */
  schemes: Partial<Record<SchemeName, SchemeDoc>>;
  /** What the caller can do with this frame right now:
   *
   *   `ready`       — map: the frame is known and the scheme documents needed
   *                   for a conversion are present (or it is `eng`, which needs
   *                   none).
   *   `unavailable` — the frame IS known (a trusted recorded name or a
   *                   fingerprint), but the scheme data required to map could not
   *                   be fetched — offline, or the platform endpoint was down.
   *                   This is TRANSIENT and D30.5 first-class: the checks are not
   *                   lost, they simply cannot be numbered until the data loads.
   *                   A caller MUST NOT drop the check list as "no verse in this
   *                   numbering" here (review finding R-E33-6).
   *   `unknown`     — the frame could not be established at all (no recorded
   *                   name, and the bytes did not fingerprint). Rare; a real data
   *                   problem, not a transient one.
   */
  state: 'ready' | 'unavailable' | 'unknown';
}

/** The frame every unfoldingWord resource is in — helps and original-language
 * texts alike (measured: 194,080 tN references, 58,834 TWL references and 1,189
 * original-language chapters, zero contradictions). A resource pinned from
 * elsewhere may differ; that is an `extraScripture` concern, not a derive one. */
export const RESOURCE_FRAME: SchemeName = 'eng';

interface FrameDeps {
  /** The store, for the §8.5 versification register. */
  store: { readVersification: () => Promise<{ name: string; bytes: string } | null> };
  /** The platform: the list of schemes it serves, and each document by name.
   * The LIST matters — the platform is the authority on which schemes exist, so
   * a scheme authored after this code shipped resolves normally instead of
   * dropping the project to `unknown`. */
  api: {
    getVersification: (name: string) => Promise<unknown>;
    getVersifications?: () => Promise<string[]>;
  };
}

const cache = new Map<string, ProjectFrame>();

/** Forget cached frames. A project's scheme is immutable for its life (§4.3), so
 * this exists for tests and for switching projects, not for invalidation. */
export const forgetProjectFrames = (): void => cache.clear();

/** Establish the project's frame and gather the scheme documents a conversion
 * needs.
 *
 * The fast path is one register read and — when the project is `eng`, which is
 * the default and the whole resource suite's frame — NO scheme fetch at all,
 * because `mapReference` short-circuits before it looks at any document.
 *
 * The fingerprint path costs up to six scheme fetches, and only happens for a
 * project tC4 did not create whose burrito records no scheme name. */
export const resolveProjectFrame = async (
  repoPath: string,
  deps: FrameDeps,
): Promise<ProjectFrame> => {
  // Only `ready`/`unknown` frames are cached (see the end of this function), so
  // a hit is always a final answer. An `unavailable` frame was never stored, so
  // it is recomputed every call — which is what lets a reconnect map normally
  // rather than staying stuck on a stale "could not fetch".
  const cached = cache.get(repoPath);
  if (cached) return cached;

  const register = await deps.store.readVersification();
  const { names: available, complete: listComplete } = await availableSchemes(deps);

  // Establish the frame NAME.
  //
  // Rung 1: a RECORDED name, but only one we can trust. Review finding R-E33-1:
  // accepting any non-placeholder name meant a typo'd or withdrawn scheme
  // short-circuited past the fingerprint rung and dropped the whole book. A name
  // is trusted when the platform serves it — or, when we could not obtain the
  // served list (offline), when it is one of the schemes this build ships:
  // offline we cannot prove a name is a typo, and losing the book is never the
  // right answer for a transient fetch failure (review finding R-E33-6).
  let name: SchemeName | null = null;
  let source: ProjectFrame['source'] = 'unknown';
  if (register && isSchemeName(register.name)) {
    // Trusted when the platform serves the name — or, when the served list could
    // not be obtained (offline), unconditionally: offline we cannot prove a name
    // is a typo, and losing the book is never right for a transient failure.
    const trusted = available.includes(register.name) || !listComplete;
    if (trusted) {
      name = register.name;
      source = 'recorded';
    }
  }

  // Rung 2: fingerprint the register's bytes, only when rung 1 found no name.
  // Needs the candidate documents, so this is where the fetches happen.
  const known: Partial<Record<SchemeName, SchemeDoc>> = {};
  if (!name) {
    for (const candidate of available) {
      const doc = await fetchScheme(deps, candidate);
      if (doc) known[candidate] = doc;
    }
    const resolved = resolveProjectScheme(register, known);
    if (resolved.name) {
      name = resolved.name;
      source = 'fingerprint';
    }
  }

  // Gather the documents a conversion actually needs (RESOURCE_FRAME + name),
  // reusing anything rung 2 already fetched. `eng` needs none — it short-circuits.
  const schemes: Partial<Record<SchemeName, SchemeDoc>> = {};
  if (name && name !== RESOURCE_FRAME) {
    for (const needed of [RESOURCE_FRAME, name]) {
      const doc = known[needed] ?? (await fetchScheme(deps, needed));
      if (doc) schemes[needed] = doc;
    }
  }

  // Classify. eng (or any same-as-resource frame) is always ready. A known
  // non-eng frame is ready when both documents loaded, else unavailable. No name
  // at all is unknown.
  const state: ProjectFrame['state'] = !name
    ? 'unknown'
    : name === RESOURCE_FRAME || (!!schemes[RESOURCE_FRAME] && !!schemes[name])
      ? 'ready'
      : 'unavailable';

  const frame: ProjectFrame = { name: state === 'unknown' ? null : name, source, schemes, state };
  // Do NOT cache `unavailable` (R-E33-9): it is a transient "could not fetch"
  // outcome, and the early-return above already recomputes it every call. Caching
  // it would only store an entry that is always bypassed. `ready` and `unknown`
  // are stable for the project's life and worth caching.
  if (state !== 'unavailable') cache.set(repoPath, frame);
  return frame;
};

/** One scheme document, or null when the platform cannot supply it. A missing
 * document is not fatal: the caller ends up `unavailable` (frame known, data not
 * loaded) or `unknown`, never a wrong reference. */
const fetchScheme = async (deps: FrameDeps, name: SchemeName): Promise<SchemeDoc | null> => {
  try {
    const doc = await deps.api.getVersification(name);
    return doc && typeof doc === 'object' && 'maxVerses' in doc ? (doc as SchemeDoc) : null;
  } catch {
    return null;
  }
};

/** Which schemes the platform serves, and whether that list is authoritative.
 *
 * `complete` is true only when the served list was actually obtained. When it is
 * false we are using the shipped six as a stand-in (no listing endpoint, or the
 * fetch failed) — which the frame resolver needs to know: offline it cannot tell
 * a real recorded name from a typo, so it must not treat an unrecognised name as
 * a typo and drop the book. */
const availableSchemes = async (
  deps: FrameDeps,
): Promise<{ names: readonly string[]; complete: boolean }> => {
  if (!deps.api.getVersifications) return { names: KNOWN_SCHEME_NAMES, complete: false };
  try {
    const listed = await deps.api.getVersifications();
    return Array.isArray(listed) && listed.length
      ? { names: listed.filter(isSchemeName), complete: true }
      : { names: KNOWN_SCHEME_NAMES, complete: false };
  } catch {
    return { names: KNOWN_SCHEME_NAMES, complete: false };
  }
};
