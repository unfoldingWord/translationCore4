// versification.ts — which scheme is this project in, and the one safe way to
// read scheme data (epic #33 / issue #15; BURRITO-SPEC §4.3, §5.2).
//
// This module is PURE: no server calls, no store, no state. It takes scheme
// documents and the project's recorded vrs register as input so the harness and
// unit tests can drive it directly.
//
// The mapping engine itself is NOT here. It is a lazy `import()` of
// proskomma-core, loaded only when a project's frame differs from a resource's
// (owner ruling 2026-08-24, Q1 option d) — an `eng` project never downloads it.

/** The placeholder a store reports when it has no scheme NAME to give — a
 * project tC4 did not create, whose burrito records no name because the platform
 * discards the one it was handed at creation. Deliberately not a real name, so
 * the resolver falls through to fingerprinting on the bytes. */
export const UNRECORDED_SCHEME = 'unrecorded';

/** A versification scheme name.
 *
 * Deliberately a plain string, NOT a union of the six schemes the platform ships
 * today. The platform is the authority on which schemes exist — it serves the
 * list at `GET /content-utils/versifications` — and a seventh will appear the
 * moment someone authors one. An earlier version of this module typed this as a
 * closed union of the six, which meant a project created against a new scheme
 * fell through both resolver rungs and dropped EVERY check as `unknown-frame`.
 * A new scheme must degrade to "we can map it", never to "we lost the book". */
export type SchemeName = string;

/** The six the platform ships as of 2026-08-24 — `resource-core`
 * `templates/content_templates/vrs/`, byte-identical to the upstream
 * specification's standard mappings.
 *
 * This is a CONVENIENCE for fixtures, tests and an offline fallback list. It is
 * NOT the set the resolver gates on: nothing in the ladder may reject a name for
 * being absent from it. Note there is no scheme for a text that follows `eng`
 * but numbers psalm superscriptions (the French LSG case) — 58 psalms differ
 * between `eng` and `org` for exactly that reason, and choosing `org` instead
 * moves 97 non-psalm chapters. That gap is tracked separately from issue #15. */
export const KNOWN_SCHEME_NAMES = ['eng', 'lxx', 'org', 'rsc', 'rso', 'vul'] as const;

/** Back-compat alias for the fixture list. Prefer `KNOWN_SCHEME_NAMES`. */
export const SCHEME_NAMES = KNOWN_SCHEME_NAMES;

/** Is this a usable scheme name — that is, anything other than the placeholder a
 * store reports when it has no name to give? Membership of the six is NOT the
 * test; see `SchemeName`. */
export const isSchemeName = (v: unknown): v is SchemeName =>
  typeof v === 'string' && v.length > 0 && v !== UNRECORDED_SCHEME;

/** The default every project gets unless the user picks otherwise (§4.3). */
export const DEFAULT_SCHEME: SchemeName = 'eng';

/** A `mappedVerses` value. The upstream Copenhagen format allows exactly one
 * target range per source range; the fork the platform and the client toolkit
 * both use ALSO allows an array — one source range to MANY targets. Readers
 * MUST accept both, the same way §5.3 requires accepting both TWLink forms. */
export type MappedValue = string | string[];

/** A scheme document in the platform's vrs-to-JSON shape. Loose-honest: real
 * files carry exactly these four keys, but the upstream schema also defines
 * `basedOn`, `verification` and `mergedVerses`, so do not assume absence. */
export interface SchemeDoc {
  maxVerses: Record<string, string[]>;
  mappedVerses?: Record<string, MappedValue>;
  excludedVerses?: unknown;
  partialVerses?: unknown;
  [key: string]: unknown;
}

/** The project's versification register, as the §8.5 `project.vrs.set` fold
 * exposes it: the scheme NAME recorded at creation and the exact vrs.json
 * bytes. A project tC4 did not create carries a name that is not a scheme name
 * (the store records `'unrecorded'`), which is why `bytes` matters. */
export interface VrsRegister {
  name: string;
  bytes: string;
}

// ---------------------------------------------------------------------------
// Reading scheme data safely
// ---------------------------------------------------------------------------

/** Is this a usable `maxVerses` table — every value an array of digit strings?
 *
 * The guard exists because `unplaceableReason` compares with
 * `verse > Number(chapters[chapter - 1])`, and `>` is FALSE for NaN — so a
 * non-numeric entry would make every verse in that chapter "exist", and a
 * mapped landing that passes becomes a §5.2/§8.5 identity, journaled
 * permanently (the same NaN-silent-pass shape R-E33-2 fixed for the inputs).
 * Validate once, at the load point, so the comparison can stay simple. */
export const isValidMaxVerses = (mv: unknown): mv is Record<string, string[]> =>
  !!mv &&
  typeof mv === 'object' &&
  !Array.isArray(mv) &&
  Object.values(mv).every(
    (chapters) =>
      Array.isArray(chapters) &&
      chapters.every((last) => typeof last === 'string' && /^[0-9]+$/.test(last)),
  );

/** Coerce every `mappedVerses` value to the fork's array form.
 *
 * **This is not optional and it is not a workaround.** proskomma's
 * `reverseVersification` does `for (const toSpec of toSpecs)`. Handed the
 * string form the platform actually ships, it iterates the string's
 * CHARACTERS and returns a silently corrupt table keyed "0", "1", "2", … It
 * throws nothing. The forward direction accepts both forms and so hides the
 * bug; the reverse direction is the derive path (#15), so the corruption
 * surfaces exactly where it does most damage.
 *
 * Normalizing here, once, at the single load point, is the whole defence. */
export const normalizeScheme = <T extends SchemeDoc>(doc: T): T => {
  const table = doc.mappedVerses;
  if (!table) return doc;
  const normalized: Record<string, string[]> = {};
  for (const [from, to] of Object.entries(table)) {
    normalized[from] = Array.isArray(to) ? to : [to];
  }
  return { ...doc, mappedVerses: normalized };
};

/** Canonical form of a scheme document, for identity comparison.
 *
 * Deliberately NOT the raw bytes. Real burritos re-serialize the same scheme —
 * a published Septuagint burrito carries `org` with alphabetical keys and
 * different whitespace, and a byte comparison identifies neither it nor the
 * platform's own copy. Compare meaning, not layout. */
export const canonicalizeScheme = (doc: SchemeDoc): string =>
  JSON.stringify(sortDeep(normalizeScheme(doc)));

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    );
  }
  return value;
};

// ---------------------------------------------------------------------------
// Which scheme is this project in?
// ---------------------------------------------------------------------------

export type SchemeSource =
  /** The name recorded in the §8.5 vrs register at creation. Authoritative. */
  | 'recorded'
  /** No usable recorded name, but the register's bytes match a known scheme. */
  | 'fingerprint'
  /** Neither — the frame is genuinely unknown. NEVER assume `eng` here. */
  | 'unknown';

export interface ResolvedScheme {
  name: SchemeName | null;
  source: SchemeSource;
}

/** Resolve the project's scheme through a source ladder, so that a better
 * source can take over later without any caller changing.
 *
 * 1. the recorded name in the vrs register — what tC4 passes to
 *    `POST /git/new-text-translation` and the journal seals immutably;
 * 2. a normalized fingerprint of the register's bytes against the known
 *    schemes — for projects tC4 did not create;
 * 3. `unknown`.
 *
 * Rung 1 covers every project tC4 creates. Rung 2 exists because the platform
 * DISCARDS the name it was given (it uses it only to pick a template file), so
 * a project opened from elsewhere has no name to read.
 *
 * **`unknown` is a common state, not an edge case.** Three of five sampled
 * published burritos carry no versification ingredient at all, and one that
 * does is `eng` — so absence carries no information and must not be read as
 * `eng`. A caller that gets `unknown` does not map; it says so. */
export const resolveProjectScheme = (
  register: VrsRegister | null,
  knownSchemes: Partial<Record<SchemeName, SchemeDoc>>,
): ResolvedScheme => {
  if (!register) return { name: null, source: 'unknown' };

  // Rung 1. A recorded name is authoritative — but only if it names a scheme we
  // were actually given, because a name we cannot resolve is not an answer.
  // Review finding R-E33-1: accepting any non-placeholder name here meant a
  // typo'd or withdrawn scheme short-circuited past the fingerprint rung and
  // resolved to something no caller could map with, dropping the whole book.
  // `isSchemeName` still rejects the store's 'unrecorded' sentinel without this
  // module coupling to that exact spelling.
  if (isSchemeName(register.name) && knownSchemes[register.name]) {
    return { name: register.name, source: 'recorded' };
  }

  // Rung 2. Fingerprint, on meaning rather than bytes.
  let parsed: SchemeDoc;
  try {
    parsed = JSON.parse(register.bytes) as SchemeDoc;
  } catch {
    return { name: null, source: 'unknown' };
  }
  const wanted = canonicalizeScheme(parsed);
  // Iterate the candidates the CALLER supplied, not a built-in list — the
  // platform decides which schemes exist, and a seventh must fingerprint like
  // any other. Sorted so the answer is deterministic if two documents ever
  // canonicalize identically.
  for (const name of Object.keys(knownSchemes).sort()) {
    const candidate = knownSchemes[name];
    if (candidate && canonicalizeScheme(candidate) === wanted) {
      return { name, source: 'fingerprint' };
    }
  }
  return { name: null, source: 'unknown' };
};

/** True when a reference in `from` needs no conversion to be valid in `to`.
 *
 * The short-circuit is load-bearing, not an optimization. Composing
 * `eng -> org -> eng` loses 3 verses of the 66-book canon that today's
 * unmapped code handles correctly, so a mapper that always composes would
 * regress the default project. It also keeps the lossy path unreachable for
 * any project that did not deliberately choose another scheme. */
export const sameFrame = (from: SchemeName | null, to: SchemeName | null): boolean =>
  from !== null && to !== null && from === to;

// ---------------------------------------------------------------------------
// Is a mapped reference actually usable?
// ---------------------------------------------------------------------------

/** Why a mapping produced no usable reference. Every one of these is a real,
 * measured outcome of mapping the `eng` helps corpus into the other schemes —
 * not a defensive hypothetical. */
export type UnplaceableReason =
  /** The mapping arithmetic went below verse 1 (`eng PSA 116:10` -> `rsc PSA 115:0`). */
  | 'verse-zero'
  /** The target scheme has no such chapter (`eng EST 1:1` -> `vul`, which has no EST 1). */
  | 'no-chapter'
  /** Past the chapter's last verse (`eng ACT 19:41` -> `rsc`, whose ACT 19 ends at 40). */
  | 'past-chapter-end'
  /** The fork's many-to-many form returned several targets; an identity cannot
   * be picked from them. No shipped scheme does this yet, but the format allows
   * it and the toolkit implements it. */
  | 'ambiguous'
  /** A span whose endpoints landed in different chapters — including one case
   * that maps BACKWARDS (`eng PSA 16:10-11` -> `vul PSA 16:10` and `PSA 15:10`),
   * so endpoint order cannot be assumed. */
  | 'span-split'
  /** The project's frame could not be established at all. */
  | 'unknown-frame'
  /** The reference itself does not parse — a non-integer chapter or verse, or a
   * verse field that is neither a number, a decimal string, nor a span. This is
   * a fault in the RESOURCE ROW, not in the project's versification, and it is
   * reported separately so a reader is not sent to diagnose the wrong thing
   * (review finding R-E33-4). */
  | 'malformed-reference';

/** Does this chapter/verse exist in the scheme?
 *
 * Defined AS `unplaceableReason(...) === null` so the two can never disagree.
 * They did: this predicate rejected a non-numeric chapter while
 * `unplaceableReason` accepted it, and `unplaceableReason` is the one that gates
 * journaling (review finding R-E33-2). One rule, one implementation.
 *
 * A mapping result MUST pass this before it becomes an identity. The mapped
 * reference is both the §5.2 identity key and the §8.5 journal register key,
 * written once and never re-derived — so `PSA 115:0` journaled once is
 * `PSA 115:0` forever. */
export const verseExists = (
  scheme: SchemeDoc,
  book: string,
  chapter: number,
  verse: number,
): boolean => unplaceableReason(scheme, book, chapter, verse) === null;

/** Classify a mapped single reference against the target scheme. Returns null
 * when the reference is usable. */
export const unplaceableReason = (
  scheme: SchemeDoc,
  book: string,
  chapter: number,
  verse: number,
): UnplaceableReason | null => {
  // Integer guard FIRST (review finding R-E33-2). `refPart` in derive.ts returns
  // a STRING for any reference part that is not plain digits, and the derive
  // pipeline casts chapter to number — so a non-numeric chapter reaches here as
  // e.g. 'front'. Without this guard `chapters[chapter - 1]` indexes with NaN,
  // yields undefined, and `verse > Number(undefined)` is false, so the whole
  // check silently PASSED and a reference naming a chapter that does not exist
  // could be journaled permanently.
  if (!Number.isInteger(chapter) || !Number.isInteger(verse)) return 'malformed-reference';
  if (verse < 1) return 'verse-zero';
  const chapters = scheme.maxVerses?.[book.toUpperCase()];
  if (!chapters || chapter < 1 || chapter > chapters.length) return 'no-chapter';
  if (verse > Number(chapters[chapter - 1])) return 'past-chapter-end';
  return null;
};
