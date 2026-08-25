// mapReference.ts — convert a reference from one versification frame into
// another (epic #33 / issue #15; BURRITO-SPEC §5.2's frame rule, D24(c)/D40).
//
// WHY THIS FILE IS SEPARATE FROM versification.ts
//
// The mapping engine is `proskomma-core`. Importing only its four versification
// functions still costs 916,835 B minified (233,345 B gzipped) — roughly the
// size of the whole rest of the app — because the package publishes as one
// prebuilt bundle. So the import here is DYNAMIC, and this module is the only
// place that touches it. Vite code-splits it into its own chunk, which a
// project never downloads unless it actually needs a frame conversion
// [decided 2026-08-24 — owner ruling, Q1 option (d)].
//
// The whole unfoldingWord resource suite is in the `eng` frame — helps and
// original-language texts alike (measured: 194,080 tN references, 58,834 TWL
// references, 1,189 original-language chapters, zero contradictions). `eng` is
// also the default project scheme. So the common case short-circuits before the
// dynamic import is ever reached, and the default project loads none of this.
import {
  isSchemeName,
  normalizeScheme,
  sameFrame,
  unplaceableReason,
  type SchemeDoc,
  type SchemeName,
  type UnplaceableReason,
} from './versification';

/** proskomma-core's versification surface, as much of it as we call. The
 * package ships no types, so this is the loose-honest shape per the
 * `vendor.d.ts` discipline. */
interface VersificationToolkit {
  /** Builds per-book, per-chapter succinct mapping tables from a mappedVerses
   * table. It calls preSuccinctVerseMapping itself, so pass the RAW table. */
  succinctifyVerseMappings: (mappedVerses: Record<string, string[]>) => Record<
    string,
    Record<string, unknown>
  >;
  /** Inverts a mappedVerses table. REQUIRES the array value form — handed a
   * string it iterates the string's characters and silently returns a corrupt
   * table. `normalizeScheme` is what makes this call safe. */
  reverseVersification: (doc: { mappedVerses: Record<string, string[]> }) => {
    reverseMappedVerses: Record<string, string[]>;
  };
  /** Returns [bookCode, [[chapter, verse], ...]]. The inner array may hold more
   * than one entry under the fork's many-to-many form. */
  mapVerse: (
    succinctChapter: unknown,
    book: string,
    chapter: number,
    verse: number,
  ) => [string, [number, number][]] | null;
}

let toolkitPromise: Promise<VersificationToolkit> | null = null;

/** Load the mapping engine, once per session. Only ever reached for a genuine
 * cross-frame conversion — see the file header. */
const toolkit = async (): Promise<VersificationToolkit> => {
  // A rejected import must NOT stay cached: the chunk fetch can fail
  // transiently (network blip, server restart mid-session), and a cached
  // rejection would break every later mapping until page reload. Clear the
  // cache on failure and rethrow, so the next call retries the import.
  toolkitPromise ??= import('proskomma-core')
    .then(
      (m) =>
        (m as unknown as { utils: { versification: VersificationToolkit } }).utils.versification,
    )
    .catch((e) => {
      toolkitPromise = null;
      throw e;
    });
  return toolkitPromise;
};

/** Exposed for tests only: forget the cached module so a test can assert the
 * short-circuit path never loads it. */
export const forgetToolkit = (): void => {
  toolkitPromise = null;
};

// ---------------------------------------------------------------------------
// Compiled tables
// ---------------------------------------------------------------------------

/** The two directions a scheme participates in. `mappedVerses` maps a scheme's
 * own references INTO `org`, so `org` is the pivot for every conversion: go
 * forward through the source scheme, then backward through the target. */
interface SchemeTables {
  toOrg: Record<string, Record<string, unknown>>;
  fromOrg: Record<string, Record<string, unknown>>;
}

const compiled = new Map<SchemeName, SchemeTables>();

const compile = async (name: SchemeName, doc: SchemeDoc): Promise<SchemeTables> => {
  const cached = compiled.get(name);
  if (cached) return cached;
  const V = await toolkit();
  // normalizeScheme FIRST: reverseVersification corrupts the string form.
  const normalized = normalizeScheme(doc);
  const table = (normalized.mappedVerses ?? {}) as Record<string, string[]>;
  const tables: SchemeTables = {
    toOrg: V.succinctifyVerseMappings(table),
    fromOrg: V.succinctifyVerseMappings(
      V.reverseVersification({ mappedVerses: table }).reverseMappedVerses,
    ),
  };
  compiled.set(name, tables);
  return tables;
};

/** Exposed for tests only: drop compiled tables between cases. */
export const forgetCompiledSchemes = (): void => compiled.clear();

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export interface MappedReference {
  book: string;
  chapter: number;
  /** A number for a single verse; the exact span string ("9-10") for a span —
   * the §5.2 identity-key convention, which never Number()-coerces. */
  verse: number | string;
}

export type MapOutcome =
  | { ok: true; reference: MappedReference; mapped: boolean }
  | {
      ok: false;
      reason: UnplaceableReason;
      /** Target-frame positions the failed mapping actually reached. These are
       * diagnostic only — never identities — and let a partial-scope caller
       * avoid reporting drops that are outside its project scope. */
      candidates?: MappedReference[];
    };

export interface MapRequest {
  /** The frame the reference is currently in. The whole uW suite is `eng`. */
  from: SchemeName | null;
  /** The project's frame, from `resolveProjectScheme`. */
  to: SchemeName | null;
  book: string;
  chapter: number;
  /** A number, a decimal string, or an exact span string ("9-10"). */
  verse: number | string;
  /** Scheme documents, keyed by name. Supply at least `from` and `to`. */
  schemes: Partial<Record<SchemeName, SchemeDoc>>;
}

const applyOne = (
  V: VersificationToolkit,
  succinct: Record<string, Record<string, unknown>>,
  book: string,
  chapter: number,
  verse: number,
): [string, [number, number][]] => {
  const chapterTable = succinct[book.toUpperCase()]?.[String(chapter)];
  if (!chapterTable) return [book.toUpperCase(), [[chapter, verse]]];
  return V.mapVerse(chapterTable, book.toUpperCase(), chapter, verse) ?? [
    book.toUpperCase(),
    [[chapter, verse]],
  ];
};

/** Where one source verse landed: a book, a chapter, and every target verse it
 * maps onto. `verses` normally holds one entry. It holds several when the target
 * scheme's REVERSE table is one-to-many — two source verses that collapse onto
 * one pivot verse invert into one pivot verse expanding to several targets. That
 * happens in real data (measured on `en_tn@v90`: 1 case for `rsc`, 6 for `rso`,
 * 37 for `vul`). */
interface Landing {
  book: string;
  chapter: number;
  verses: number[];
}

/** Map one single verse through the org pivot.
 *
 * The FORWARD hop is always single-valued: a scheme's own `mappedVerses` names
 * one target per source range. Only the reverse hop can fan out, so a fan-out at
 * the forward hop means the data is shaped in a way this code has never seen,
 * and it refuses rather than picking. */
const hop = async (
  from: SchemeName,
  to: SchemeName,
  schemes: Partial<Record<SchemeName, SchemeDoc>>,
  book: string,
  chapter: number,
  verse: number,
): Promise<Landing | UnplaceableReason> => {
  const sourceDoc = schemes[from];
  const targetDoc = schemes[to];
  if (!sourceDoc || !targetDoc) return 'unknown-frame';

  const V = await toolkit();
  const forward = await compile(from, sourceDoc);
  const backward = await compile(to, targetDoc);

  const [orgBook, orgPairs] = applyOne(V, forward.toOrg, book, chapter, verse);
  if (orgPairs.length !== 1) return 'ambiguous';
  const [orgChapter, orgVerse] = orgPairs[0];

  const [outBook, outPairs] = applyOne(V, backward.fromOrg, orgBook, orgChapter, orgVerse);
  if (outPairs.length === 0) return 'ambiguous';

  // A fan-out is usable only when every target sits in ONE chapter. Verses in
  // two chapters cannot be one reference, and picking one would be a guess.
  const chapters = new Set(outPairs.map(([c]) => c));
  if (chapters.size !== 1) return 'ambiguous';

  return {
    book: outBook,
    chapter: outPairs[0][0],
    verses: [...new Set(outPairs.map(([, v]) => v))].sort((a, b) => a - b),
  };
};

/** Are these verses a single unbroken run? Only then can a fan-out be written as
 * one span [decided 2026-08-24 — owner ruling: "contiguous should be treated as
 * a span"]. A gapped set (5 and 8) is left ambiguous: a span would silently
 * claim the verses between them. */
const contiguous = (verses: number[]): boolean =>
  verses.every((v, i) => i === 0 || v === verses[i - 1] + 1);

const candidatesOf = (landings: Landing[]): MappedReference[] =>
  landings.flatMap((landing) =>
    landing.verses.map((verse) => ({
      book: landing.book,
      chapter: landing.chapter,
      verse,
    })),
  );

/** Parse a §5.2 verse field. A span keeps its exact string form. */
/** The widest span reference the mapper will enumerate. Exported for the
 * regression test. Generous — the largest real chapter (PSA 119) has 176
 * verses, so no genuine span comes near it — but FINITE, which is the point:
 * the span loop's work must be bounded by the reference, not by the scheme's
 * uncapped maxVerses values. */
export const MAX_SPAN_VERSES = 1000;

const parseVerse = (
  verse: number | string,
): { kind: 'single'; v: number } | { kind: 'span'; a: number; b: number } | null => {
  if (typeof verse === 'number') return Number.isSafeInteger(verse) ? { kind: 'single', v: verse } : null;
  const span = /^(\d+)-(\d+)$/.exec(verse);
  if (span) return { kind: 'span', a: Number(span[1]), b: Number(span[2]) };
  return /^\d+$/.test(verse) ? { kind: 'single', v: Number(verse) } : null;
};

/** Convert a reference into the target frame.
 *
 * The result is used as the §5.2 identity key AND the §8.5 journal register
 * key — written once, never re-derived — so this function refuses rather than
 * guesses. Every `ok: false` reason is a measured outcome of mapping the real
 * `eng` corpus into the other schemes, not a defensive hypothetical:
 *
 *   verse-zero        eng PSA 116:10 -> rsc PSA 115:0
 *   past-chapter-end  eng ACT 19:41  -> rsc, whose ACT 19 ends at 40
 *   no-chapter        eng EST 1:1    -> vul, which has no EST chapter 1
 *   span-split        eng PSA 16:10-11 -> vul PSA 16:10 and PSA 15:10
 *                     (note: BACKWARDS — endpoint order cannot be assumed)
 *   ambiguous         the fork's many-to-many form; no shipped scheme yet
 *   unknown-frame     the project's scheme could not be established
 */
export const mapReference = async (request: MapRequest): Promise<MapOutcome> => {
  const { from, to, book, chapter, verse, schemes } = request;

  // The short-circuit. Not an optimization: composing eng -> org -> eng loses
  // 3 verses of the 66-book canon that unmapped code handles correctly, so an
  // eng project must not compose at all. This also returns BEFORE the dynamic
  // import, so the default project never downloads the engine.
  //
  // The short-circuit passes the reference through UNVALIDATED, on purpose.
  // Real resource rows carry verse forms mapping arithmetic cannot handle —
  // measured on en_tn v89: 110 PSA `N:front` superscription notes, comma lists
  // (`5:1,3,8,12`), letter forms (`1:1a`) — and the pre-#33 pipeline derived,
  // displayed and journaled all of them. A same-frame project needs no
  // arithmetic, so rejecting them here would drop real checks from the default
  // eng project and orphan the decisions already journaled against those keys.
  // Delimiter safety for journal identities is the grammar's job (§8.5), not
  // this function's.
  if (sameFrame(from, to)) {
    return { ok: true, reference: { book: book.toUpperCase(), chapter, verse }, mapped: false };
  }

  // A cross-frame reference that does not parse is a fault in the RESOURCE ROW,
  // not in the project's versification — report it as such so the dropped-checks
  // note sends the reader to the right place (review finding R-E33-4). A valid
  // chapter is always an integer number (refPart yields a number for plain
  // digits, a string otherwise); only the verse may be a span. Both parts get
  // one verdict here, before any mapping arithmetic (review finding R-E33-5).
  const parsed = parseVerse(verse);
  const validPositive = (part: number): boolean => Number.isSafeInteger(part) && part >= 1;
  const malformedVerse =
    !parsed ||
    (parsed.kind === 'single'
      ? !validPositive(parsed.v)
      : !validPositive(parsed.a) ||
        !validPositive(parsed.b) ||
        parsed.a > parsed.b ||
        // Span-WORK bound (2026-08-25 follow-up review): the span loop below
        // awaits one hop per source verse, and scheme maxVerses values are
        // deliberately uncapped (any positive safe integer), so the reference
        // itself must bound the work — a served scheme plus a row like
        // `1:1-1000000000` would otherwise pass every guard and enumerate
        // forever. No real chapter exceeds 176 verses (PSA 119), so this is a
        // property of the REFERENCE: wider than any chapter can be = a fault
        // in the resource row, refused before any iteration.
        parsed.b - parsed.a + 1 > MAX_SPAN_VERSES);
  if (!validPositive(chapter) || malformedVerse) {
    return { ok: false, reason: 'malformed-reference' };
  }
  if (!isSchemeName(from) || !isSchemeName(to)) return { ok: false, reason: 'unknown-frame' };

  const targetDoc = schemes[to];
  if (!targetDoc) return { ok: false, reason: 'unknown-frame' };

  if (parsed.kind === 'single') {
    const out = await hop(from, to, schemes, book, chapter, parsed.v);
    if (typeof out === 'string') return { ok: false, reason: out };
    // A fan-out that is one unbroken run becomes a span, so the check survives
    // [owner ruling 2026-08-24]. A gapped fan-out stays ambiguous: writing it as
    // a span would claim the verses in the gap.
    if (out.verses.length > 1 && !contiguous(out.verses)) {
      return { ok: false, reason: 'ambiguous', candidates: candidatesOf([out]) };
    }
    return finish(targetDoc, out);
  }

  // Map EVERY source verse in a span. Endpoint-only mapping is unsafe: real
  // mappings can reorder or skip an interior verse while both endpoints still
  // land in one chapter. For example en_tn PSA 11:1-3 -> vul PSA 10:1,3,4;
  // expanding only the endpoint extremes fabricated verse 2 and journaled the
  // check under an identity the mapping never produced.
  const sourceDoc = schemes[from];
  if (!sourceDoc) return { ok: false, reason: 'unknown-frame' };
  for (const endpoint of [parsed.a, parsed.b]) {
    const bad = unplaceableReason(sourceDoc, book, chapter, endpoint);
    if (bad) return { ok: false, reason: bad };
  }

  const landings: Landing[] = [];
  for (let sourceVerse = parsed.a; sourceVerse <= parsed.b; sourceVerse += 1) {
    const landing = await hop(from, to, schemes, book, chapter, sourceVerse);
    if (typeof landing === 'string') return { ok: false, reason: landing };
    landings.push(landing);
  }

  const candidates = candidatesOf(landings);
  const loci = new Set(landings.map((landing) => `${landing.book}\u0000${landing.chapter}`));
  if (loci.size !== 1) return { ok: false, reason: 'span-split', candidates };

  const verses = [...new Set(landings.flatMap((landing) => landing.verses))].sort(
    (a, b) => a - b,
  );
  if (!contiguous(verses)) return { ok: false, reason: 'ambiguous', candidates };

  return finish(targetDoc, {
    book: landings[0].book,
    chapter: landings[0].chapter,
    verses,
  });
};

/** Validate a landing against the target scheme and render it as a §5.2 verse
 * field: a number for one verse, the exact span string for a run. Every verse in
 * the run must exist — a span whose far end runs past the chapter is not a
 * shorter span, it is an unplaceable reference. */
const finish = (targetDoc: SchemeDoc, landing: Landing): MapOutcome => {
  for (const v of landing.verses) {
    const bad = unplaceableReason(targetDoc, landing.book, landing.chapter, v);
    if (bad) return { ok: false, reason: bad, candidates: candidatesOf([landing]) };
  }
  const lo = landing.verses[0];
  const hi = landing.verses[landing.verses.length - 1];
  return {
    ok: true,
    reference: {
      book: landing.book,
      chapter: landing.chapter,
      verse: lo === hi ? lo : `${lo}-${hi}`,
    },
    mapped: true,
  };
};
