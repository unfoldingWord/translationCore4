// derive.ts — the app-level derive-and-merge module (ARCHITECTURE §3.3, §7.5; AD-2).
// Behavioral reference: sample-burrito-validation/validate.mjs sections 3 and 7.
// Parity contract (S-0c / C0.4): the same inputs must give the same numbers as the
// harness. The client derives check lists and progress at load and never stores
// them authoritatively (BURRITO-SPEC §4.2).
import { doesReferenceContain } from 'bible-reference-range';
import { mapReference } from './mapReference';
import type { SchemeDoc, SchemeName, UnplaceableReason } from './versification';
import type { Tool } from './resolve';
import { tokenize } from 'string-punctuation-tokenizer';
import { usfmjs } from './vendor';

// ---------- targetBible derivation (harness section 3; FR-13 precursor) ----------

/** One usfm-js verse object (loose-honest, per the vendor.d.ts discipline). */
export interface VerseObject {
  type?: string;
  tag?: string;
  text?: string;
  [key: string]: unknown;
}

export interface DerivedVerse {
  verseObjects: VerseObject[];
  [key: string]: unknown;
}

/** Whole-book usfm-js output. Verse keys are the exact usfm-js strings: a span
 * verse is keyed "9-10" and Number("9-10") is NaN — never coerce the keys
 * (BURRITO-SPEC §4.1/§5.2). */
export interface DerivedBook {
  chapters: { [chapter: string]: { [verse: string]: DerivedVerse } };
  headers: Array<{ tag?: string; content?: string; [key: string]: unknown }>;
}

/** Parse a whole draft book. The whole-book parse yields `chapters` + `headers`;
 * only the chunk parse yields `verses` (PLATFORM-NOTES #4 [VERIFIED]). */
export const deriveTargetBible = (bookUsfm: string): DerivedBook =>
  usfmjs.toJSON(bookUsfm) as unknown as DerivedBook;

// ---------- check-item shapes (BURRITO-SPEC §5.2) ----------

export interface CheckReference {
  bookId: string;
  chapter: number | string;
  verse: number | string;
  [key: string]: unknown;
}

export interface CheckContextId {
  checkId: string;
  reference: CheckReference;
  tool: string;
  groupId: string;
  quote: unknown;
  quoteString: string;
  occurrence: number;
  [key: string]: unknown;
}

/** One check item. A freshly derived item carries `false` in every decision
 * field; a stored decision carries the real values (§5.2). */
export interface CheckItem {
  contextId: CheckContextId;
  selections: unknown[] | false;
  comments: unknown;
  reminders: unknown;
  nothingToSelect: unknown;
  verseEdits: unknown;
  invalidated: unknown;
  [key: string]: unknown;
}

// ---------- TSV → items (harness section 7 row mapping) ----------

/** Parse one reference part. Plain digits become numbers (the harness behavior
 * for its numeric fixtures); a span such as "9-10" stays a string — Number()
 * coercion of span keys is the banned bug class (§5.2). */
const refPart = (s: string): number | string => (/^\d+$/.test(s) ? Number(s) : s);

/** Versioned TSV parsing (BURRITO-SPEC §4.2 "versioned TSV parsing" — AD-2):
 * the header row is the version contract. A resource whose header differs from
 * the expected column set is a different (newer/older) TSV schema and MUST be
 * rejected, not guess-parsed. */
export const TWL_HEADER = 'Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink';
export const TN_HEADER = 'Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote';

const tsvRows = (tsv: string, expectedHeader: string, resourceLabel: string): string[][] => {
  const lines = tsv.split('\n').filter((row) => row.trim() !== '');
  const header = (lines[0] ?? '').replace(/\r$/, '');
  if (header !== expectedHeader) {
    throw new Error(
      `unversioned/unknown ${resourceLabel} TSV header: "${header.slice(0, 80)}" — ` +
        `expected "${expectedHeader}". Refusing to guess-parse (§4.2 versioned parsing).`,
    );
  }
  return lines.slice(1).map((row) => row.split('\t').map((cell) => cell.replace(/\r$/, '')));
};

/** Derive check items from a TWL TSV
 * (columns: Reference / ID / Tags / OrigWords / Occurrence / TWLink).
 * `category` is the TWLink article folder: kt | names | other. */
export const deriveTwlItems = (twlTsv: string, bookId: string): CheckItem[] =>
  tsvRows(twlTsv, TWL_HEADER, 'TWL').map((cells) => {
    const [ref, id, , origWords, occurrence, link] = cells;
    const [chapter, verse] = ref.split(':').map(refPart);
    const linkParts = link.split('/');
    // Real-data quirk (en_twl v86): some TWLink values carry a ".md" suffix
    // (e.g. .../names/paul.md). The slug is the article id — strip it.
    const groupId = (linkParts.pop() ?? '').replace(/\.md\r?$/, '');
    return {
      contextId: {
        checkId: id,
        reference: { bookId, chapter, verse },
        tool: 'translationWords',
        groupId,
        quote: origWords,
        quoteString: origWords,
        occurrence: Number(occurrence),
      },
      category: linkParts.pop() ?? '',
      selections: false,
      comments: false,
      reminders: false,
      nothingToSelect: false,
      verseEdits: false,
      invalidated: false,
    };
  });

// ---------- tN TSV → items (7 columns; real en_tn/es-419_tn shape) ----------

/** The tC3 tN category map: thematic check category ← tA module slug.
 * Data source: tC3's translationNotes category grouping (mirrored in
 * pankosmia/uw-client-checks `T_NOTES_CATEGORIES`, read 2026-08-03). Slugs not
 * in the map default to "other" — the map predates newer tA modules (e.g.
 * figs-yousingular, translate-blessing appear in en_tn v86 but not here). */
export const TN_CATEGORY_MAP: { [category: string]: string[] } = {
  discourse: [
    'figs-declarative', 'figs-events', 'figs-exclamations', 'figs-exmetaphor',
    'figs-imperative', 'figs-parables', 'figs-pastforfuture', 'figs-quotations',
    'figs-quotesinquotes', 'figs-sentences', 'translate-versebridge',
    'writing-background', 'writing-connectingwords', 'writing-endofstory',
    'writing-intro', 'writing-newevent', 'writing-participants', 'writing-poetry',
    'writing-proverbs', 'writing-quotations',
  ],
  numbers: ['translate-fraction', 'translate-numbers', 'translate-ordinal'],
  figures: [
    'figs-apostrophe', 'figs-doublenegatives', 'figs-doublet', 'figs-ellipsis',
    'figs-euphemism', 'figs-hendiadys', 'figs-hyperbole', 'figs-idiom',
    'figs-irony', 'figs-litotes', 'figs-merism', 'figs-metaphor', 'figs-metonymy',
    'figs-parallelism', 'figs-personification', 'figs-rquestion', 'figs-simile',
    'figs-synecdoche', 'figs-quotemarks',
  ],
  culture: [
    'figs-explicit', 'figs-go', 'translate-bdistance', 'translate-bmoney',
    'translate-bvolume', 'translate-hebrewmonths', 'translate-names',
    'translate-bweight', 'translate-symaction', 'translate-unknown',
    'writing-symlanguage',
  ],
  grammar: [
    'figs-abstractnouns', 'figs-activepassive', 'figs-distinguish',
    'figs-exclusive', 'figs-123person', 'figs-they', 'figs-you', 'figs-we',
    'figs-genericnoun', 'figs-hypo', 'figs-inclusive', 'figs-nominaladj',
    'figs-possession', 'figs-pronouns', 'figs-rpronouns', 'figs-gendernotations',
    'grammar-connect-logic-goal', 'grammar-connect-exceptions',
    'grammar-connect-logic-contrast', 'grammar-connect-logic-result',
  ],
  other: [
    'guidelines-sonofgodprinciples', 'translate-manuscripts',
    'translate-textvariants', 'translate-transliterate',
  ],
};

const groupToCategory: Map<string, string> = new Map(
  Object.entries(TN_CATEGORY_MAP).flatMap(([cat, groups]) =>
    groups.map((g): [string, string] => [g, cat]),
  ),
);

/** Thematic category for a tA module slug; unmapped slugs are "other". */
export const categoryForTn = (groupId: string): string => groupToCategory.get(groupId) ?? 'other';

export interface TnQuoteWord {
  word: string;
  occurrence: number;
}

/** tN quote → word-occurrence array (§5.2: tN quote MUST stay an array).
 * The TSV quote separates discontinuous spans with "&"; the "&" token is a
 * marker, never a word. `occurrence` is the ordinal of that word within the
 * quote (verse-level occurrence resolution is the alignment-aware layer's job,
 * not derivable from the TSV row alone). */
export const tnQuoteWords = (quote: string): TnQuoteWord[] => {
  const seen: { [word: string]: number } = {};
  return quote
    .split(/\s+/)
    .filter((w) => w !== '' && w !== '&')
    .map((word) => {
      seen[word] = (seen[word] ?? 0) + 1;
      return { word, occurrence: seen[word] };
    });
};

/** Derive check items from a tN TSV
 * (columns: Reference / ID / Tags / SupportReference / Quote / Occurrence / Note).
 * A row without a SupportReference is a plain note, not a check — skipped
 * (tC3 semantics: the tN tool groups by tA module; the reference client does
 * the same). `groupId` is the SupportReference's tA module slug. */
export const deriveTnItems = (tnTsv: string, bookId: string): CheckItem[] =>
  tsvRows(tnTsv, TN_HEADER, 'tN')
    .filter((cells) => (cells[3] ?? '') !== '')
    .map((cells) => {
      const [ref, id, , supportReference, quote, occurrence, note] = cells;
      const [chapter, verse] = ref.split(':').map(refPart);
      const groupId = supportReference.replace(/\/+$/, '').split('/').pop() ?? '';
      return {
        contextId: {
          checkId: id,
          occurrenceNote: note ?? '',
          reference: { bookId, chapter, verse },
          tool: 'translationNotes',
          groupId,
          quote: tnQuoteWords(quote),
          quoteString: quote,
          occurrence: Number(occurrence),
        },
        category: categoryForTn(groupId),
        selections: false,
        comments: false,
        reminders: false,
        nothingToSelect: false,
        verseEdits: false,
        invalidated: false,
      };
    });

// ---------- cross-language re-attach (D17, BURRITO-SPEC §5.2) ----------

export interface ReattachResult {
  saved: CheckItem;
  /** The derived item the decision re-attached to; absent when unplaceable. */
  to?: CheckItem;
  /** True when no unique match exists — left unplaced, never guessed. The
   * caller decides its fate; a resolution change invalidates it (D36). */
  unplaced?: boolean;
}

const crossKey = (c: CheckContextId): string =>
  [
    c.reference.bookId,
    String(c.reference.chapter),
    String(c.reference.verse),
    c.quoteString,
    c.occurrence,
  ].join('|');

/** Merge saved decisions into a freshly derived list, in two passes.
 *
 * Pass 1 is the identity key: when the resource is unchanged, every stored
 * decision matches its twin exactly. Pass 2 is D17's cross-language fallback,
 * applied ONLY to decisions pass 1 could not place — (reference + original
 * quote + occurrence) with the groupId tiebreak, ambiguity left unattached.
 *
 * Doing both passes unconditionally matters: whether a file's stored `resource`
 * record still matches the pins must NOT change how its decisions are matched.
 * Making the strategy conditional meant a file could re-attach a decision on
 * one visit and drop it on the next, purely because the record had been
 * stamped in between. `orphaned` counts what neither pass could place, and
 * `unplaced` is those same decisions by identity — the caller that has to
 * REWRITE the file (a gateway change) needs to know WHICH ones, not how many. */
export const mergeAndReattach = (
  derived: CheckItem[],
  saved: CheckItem[],
): { items: CheckItem[]; orphaned: number; unplaced: CheckItem[]; placed: Set<CheckItem> } => {
  const byKey = new Map(saved.map((d) => [mergeKey(d.contextId), d]));
  const placedSaved = new Set<CheckItem>();
  // Output items that carry a saved decision. `carryOver` uses this to keep
  // records BY PROVENANCE rather than by inspecting fields — see the F5 note
  // in carryOver.ts. Object identity is stable: an item added here is the exact
  // reference returned in `items`.
  const placed = new Set<CheckItem>();
  let items = derived.map((item) => {
    const hit = byKey.get(mergeKey(item.contextId));
    if (!hit) return item;
    placedSaved.add(hit);
    // D36: the decision describes a check that exists again, so a stale
    // invalidation from an earlier resource must not survive the re-pin.
    // Returning the saved record wholesale kept `invalidated: true` forever.
    //
    // B22: re-key to the CURRENT resource's context. The saved record carries
    // the OLD resource's `contextId` (its `occurrenceNote`, `glQuote`, tool),
    // and mergeKey does not include those — so an exact identity match can still
    // pair a saved decision with a derived item whose note/context differs. D36
    // says the resource is the primary key: keep the human decision (selections,
    // status, comments, reminders) but adopt the DERIVED item's `contextId`, so
    // the check the user sees is the new resource's, never a stale note.
    let out: CheckItem;
    if (hit.invalidated) {
      // `status: "invalid"` was set BY the invalidation of a formerly-VALID
      // decision (§5.2), so it clears with the invalidation. A `"todo"` the
      // user set is preserved through the cycle (carryOver keeps it on
      // invalidation, and it is not `"invalid"`, so it is not cleared here).
      out = {
        ...hit,
        invalidated: false,
        ...(hit.status === 'invalid' ? { status: undefined } : {}),
        contextId: item.contextId,
      };
    } else {
      out = { ...hit, contextId: item.contextId };
    }
    placed.add(out);
    return out;
  });

  const unmatched = saved.filter((d) => !placedSaved.has(d));
  if (unmatched.length > 0) {
    const results = reattachAcrossResource(unmatched, items);
    const carried = new Map<string, CheckItem>();
    const unplaced: CheckItem[] = [];
    for (const r of results) {
      if (r.to) carried.set(r.to.contextId.checkId, r.saved);
      else unplaced.push(r.saved);
    }
    items = items.map((d) => {
      const from = carried.get(d.contextId.checkId);
      if (!from) return d;
      // Keep the DERIVED contextId (it belongs to the current resource) and
      // carry only the human decision across.
      const out = { ...d, ...from, contextId: d.contextId };
      placed.add(out);
      return out;
    });
    return { items, orphaned: unplaced.length, unplaced, placed };
  }
  return { items, orphaned: 0, unplaced: [], placed };
};

/** Two original-language quotes name the same span? Compared through the tested
 * uW tokenizer (string-punctuation-tokenizer) so punctuation, whitespace and
 * normalization differences never cause a false mismatch, while a genuinely
 * different span (a longer/shorter selection) still differs. Discontinuous "&"
 * segments are compared segment-by-segment so a gap is not silently collapsed.
 * This is the §5.2 "quoteString verification" a same-checkId reattach must pass
 * (B18) — done with the ecosystem's proven quote code, not a naive string ===. */
export const sameOrigQuote = (a: string, b: string): boolean => {
  const norm = (q: string): string =>
    q
      .split('&')
      .map((seg) => tokenize({ text: seg.trim() }).join(' '))
      .join(' & ');
  return norm(a) === norm(b);
};

/** Re-attach saved decisions after a resolution/language change (D17): when
 * `checkId` no longer matches, fall back to (reference + original-language
 * quote + occurrence); tiebreak by `groupId` (the language-independent slug —
 * tN: the SupportReference tA module; tW: the TWLink slug). A still-ambiguous
 * decision is left unplaced — it is never auto-attached (D36). */
export const reattachAcrossResource = (
  saved: CheckItem[],
  derived: CheckItem[],
): ReattachResult[] => {
  const byId = new Map(derived.map((d) => [d.contextId.checkId, d]));
  return saved.map((s) => {
    const idMatch = byId.get(s.contextId.checkId);
    // §5.2: quoteString verification is PART of the match — a checkId whose quote
    // the resource changed is a materially different check, not the saved one
    // (B18). Take the checkId shortcut ONLY when the ORIGINAL-LANGUAGE quote also
    // agrees; otherwise fall through to the (reference + quote + occurrence)
    // fallback, which a changed quote also fails → the decision is left unplaced
    // (D36), never carried onto the new quote.
    if (idMatch && sameOrigQuote(idMatch.contextId.quoteString, s.contextId.quoteString)) {
      return { saved: s, to: idMatch };
    }
    let candidates = derived.filter((d) => crossKey(d.contextId) === crossKey(s.contextId));
    if (candidates.length > 1) {
      candidates = candidates.filter((d) => d.contextId.groupId === s.contextId.groupId);
    }
    return candidates.length === 1 ? { saved: s, to: candidates[0] } : { saved: s, unplaced: true };
  });
};

// ---------- merge-by-key (harness section 7) ----------

/** Stable identity key for the derive+merge re-attach. Chapter and verse join
 * as their exact string forms, so span verses key consistently. */
export const mergeKey = (c: CheckContextId): string =>
  [
    c.checkId,
    String(c.reference.chapter),
    String(c.reference.verse),
    c.quoteString,
    c.occurrence,
  ].join('|');

/** Re-attach stored decisions to freshly derived items by stable key. A stored
 * decision replaces its derived twin; an unmatched item stays fresh (§4.2). */
export const mergeSavedDecisions = (derived: CheckItem[], saved: CheckItem[]): CheckItem[] => {
  const savedByKey = new Map(saved.map((d) => [mergeKey(d.contextId), d]));
  return derived.map((item) => savedByKey.get(mergeKey(item.contextId)) ?? item);
};

// ---------- scope filter (BURRITO-SPEC §3 rules 4-5, §4.2 — D26) ----------

/** Per-book scope ranges — the metadata `currentScope` shape, e.g.
 * `{ TIT: ["1:1-2:5"], JON: [] }`. `[]` = whole book. */
export type ProjectScope = { [bookCode: string]: string[] };

export const scopeRangesFor = (scope: ProjectScope, bookCode: string): string[] =>
  scope[bookCode] ?? [];

/** True when chapter:verse falls inside the scope ranges. `[]` = whole book.
 * Range grammar: C | C-C | C:V | C:V-V | C:V-C:V (§3 rules 4-5).
 *
 * Containment is delegated to `bible-reference-range` (`doesReferenceContain`) —
 * the well-tested uW/tC3 range engine. Hand-rolled parsing kept re-introducing
 * edge-case bugs: a `C:V-V` range end read as a chapter (F6), and an ITEM verse
 * SPAN "23-24" coerced by `Number()` to NaN and admitted regardless of scope
 * (B19). The library handles verse spans, letter-suffixed partial verses, and
 * cross-chapter ranges. The harness `refInScope` (validate.mjs §7) uses the same
 * library, so the parity contract (S-0c) holds. */
export const refInScope = (
  ranges: string[],
  chapter: number | string,
  verse: number | string,
): boolean => {
  if (ranges.length === 0) return true; // [] = whole book
  const ref = `${chapter}:${verse}`; // item ref; `verse` may be a span like "23-24"
  return ranges.some((r) => doesReferenceContain(r, ref));
};

/** §4.2 (D26): derivation filters check items to the project scope. The progress
 * denominator is the in-scope derived total, never the whole book. */
export const filterToScope = (items: CheckItem[], ranges: string[]): CheckItem[] =>
  items.filter((it) =>
    refInScope(ranges, it.contextId.reference.chapter, it.contextId.reference.verse),
  );

// ---------- the pipeline + progress (harness section 7) ----------

/** Derive → scope-filter → merge: the harness section-7 pipeline as one call.
 *
 * NOTE this is the SAME-FRAME pipeline. It performs no versification mapping,
 * so it is correct only when the resource frame equals the project frame — the
 * `eng`/`eng` case, which is the default and covers the whole unfoldingWord
 * suite. For any other project scheme use `deriveForProject`, which maps first.
 * The harness drives this one directly. */
export const deriveCheckItems = (
  twlTsv: string,
  bookId: string,
  saved: CheckItem[] = [],
  scopeRanges: string[] = [],
): CheckItem[] =>
  mergeSavedDecisions(filterToScope(deriveTwlItems(twlTsv, bookId), scopeRanges), saved);

// ---------- the project pipeline: map into the project frame first (#15) ------

/** An item the project's versification frame has no home for. It is dropped
 * from the check list rather than journaled with a reference the project does
 * not contain — see `UnplaceableReason` for what each case is. */
export interface UnplaceableItem {
  item: CheckItem;
  reason: UnplaceableReason;
}

export interface ProjectDeriveResult {
  items: CheckItem[];
  /** Non-empty only for a cross-frame project. Surface it; never swallow it. */
  unplaceable: UnplaceableItem[];
  /** True when a frame conversion actually ran. False for the same-frame path. */
  mapped: boolean;
}

/** Map every derived item's reference into the project's versification frame,
 * THEN scope-filter, THEN merge saved decisions (issue #15).
 *
 * The order is the requirement, not a preference. The mapped reference is what
 * the §5.2 identity key and the §8.5 journal register key are built from, and
 * the journal is append-only — so the mapping must happen before scope checks,
 * before merge, and before anything is written. Mapping a reference that has
 * already been stored is not a repair; it is a second, conflicting identity.
 *
 * The whole unfoldingWord suite is `eng`-framed and `eng` is the default project
 * scheme, so the common path is a same-frame short-circuit that touches no
 * reference and never loads the mapping engine. */
export const deriveForProject = async (params: {
  tsv: string;
  tool: Tool;
  bookId: string;
  /** The resource's frame. The unfoldingWord suite is `eng` throughout. */
  from: SchemeName | null;
  /** The project's frame, from `resolveProjectScheme`. */
  to: SchemeName | null;
  schemes: Partial<Record<SchemeName, SchemeDoc>>;
  saved?: CheckItem[];
  scopeRanges?: string[];
}): Promise<ProjectDeriveResult> => {
  const { tsv, tool, bookId, from, to, schemes, saved = [], scopeRanges = [] } = params;
  const derived =
    tool === 'translationNotes' ? deriveTnItems(tsv, bookId) : deriveTwlItems(tsv, bookId);

  const items: CheckItem[] = [];
  const unplaceable: UnplaceableItem[] = [];
  let mappedAny = false;

  for (const item of derived) {
    const reference = item.contextId.reference;
    const outcome = await mapReference({
      from,
      to,
      book: reference.bookId,
      chapter: reference.chapter as number,
      verse: reference.verse,
      schemes,
    });
    if (!outcome.ok) {
      unplaceable.push({ item, reason: outcome.reason });
      continue;
    }
    if (!outcome.mapped) {
      items.push(item);
      continue;
    }
    mappedAny = true;
    items.push({
      ...item,
      contextId: {
        ...item.contextId,
        reference: {
          // §5.2: bookId stays lowercase (tC3 convention); the mapper works in
          // upper case because that is what maxVerses and mapVerse use.
          bookId: outcome.reference.book.toLowerCase(),
          chapter: outcome.reference.chapter,
          verse: outcome.reference.verse,
        },
      },
    });
  }

  return {
    items: mergeSavedDecisions(filterToScope(items, scopeRanges), saved),
    unplaceable,
    mapped: mappedAny,
  };
};

/** Is this item triaged? A VALID mark (target selections, or an explicit
 * nothing-to-select) or an INVALID mark (the rendering was reviewed and
 * rejected) both count; "To do" does not. §5.2 (D36): a carry-over
 * `invalidated` flag is NOT a decision — a book that was 100% against the old
 * resource is honestly less than 100% now. This is the SINGLE definition of
 * "decided": both the progress meter (progressOf) and the check-list item
 * markers read it, so the count and the list can never disagree (B23). */
export const isDecided = (i: CheckItem): boolean =>
  i.invalidated !== true &&
  (i.selections !== false || i.nothingToSelect === true || i.status === 'invalid');

/** Progress reconstruction: decided items over the in-scope derived total. */
export const progressOf = (items: CheckItem[]): { decided: number; total: number } => ({
  decided: items.filter(isDecided).length,
  total: items.length,
});
