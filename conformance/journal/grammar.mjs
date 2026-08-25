// Value grammars — BURRITO-SPEC §2 / §3 rule 4 / §5.2 / §8.1 / §8.2 / §8.5.
//
// THE single source of truth for every constrained primitive in the format. A primitive
// that is validated for TYPE but not for GRAMMAR and then flows into a STRUCTURAL
// POSITION — a filesystem path, an identity key, a prototype-chain traversal, or Burrito
// metadata — is the defect class this module closes (review round 8). Every constrained
// value gets exactly ONE named validator here; schema.mjs calls these and nothing
// hand-rolls a check again.
//
// This module is a LEAF: it imports nothing, so every other journal module may depend on
// it. Each validator returns an error STRING (for the schema's message chains) or null.

// ---------- type predicates (shared vocabulary, defined once) ----------
export const isStr = (v) => typeof v === 'string';
export const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// ---------- §8.4 reserved characters (defined ONCE, here) ----------
// U+0001 is the slot delimiter of the §8.4 decomposition and `\v `/`\c ` are the markers
// that START a new content region. skeleton.mjs builds its boundary scanner from these
// exact constants, and the schema refuses them inside journaled verse content from the
// same source — so the codec and the grammar can never disagree about what a boundary is.
export const SLOT = '';
export const VERSE_BOUNDARY_RE = /\\[vc][ \t]/;

// ---------- I-4: Unicode NFC (§8.5) ----------
// Writers normalize the text they journal. IDENTITY-bearing values are the exception:
// they are REFUSED when they are not already NFC, because silently transforming an
// identity is worse than refusing it (it splits or merges records with no fork, no
// report, and no way back). `isNfc` is true for non-strings so callers may apply it
// uniformly to a mixed field.
export const isNfc = (v) => !isStr(v) || v.normalize('NFC') === v;
export const nfcError = (v) =>
  isNfc(v) ? null : 'is not Unicode NFC — refuse (I-4: writers normalize before they hash or write)';
export const toNfc = (v) => (isStr(v) ? v.normalize('NFC') : v);

// ---------- §8.2 time: the ISO instant, the actor slug, and the ts built from them ----------
// The three grammars nest, so each is stated ONCE and reused: TS_RE is BUILT from
// ISO_RE + ACTOR_RE rather than restating their charsets (which is how the actor-slug
// rule came to exist twice — in TS_RE and in makeClock).
const src = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '');
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/; // fixed-width UTC ms
export const ACTOR_RE = /^[a-z0-9-]{4,32}$/;                            // §8.1 install slug
export const TS_RE = new RegExp(`^(${src(ISO_RE)})\\|([0-9a-f]{4})\\|(${src(ACTOR_RE)})$`);

// A CHARSET is not a CALENDAR. `2026-13-45T25:70:99.999Z` matches ISO_RE and parses to
// NaN; `2026-02-30` parses two days late, so string order and instant order disagree.
// Either one silently breaks the §8.2 clock ratchet (it compares against NaN and no-ops,
// leaving the local clock permanently behind). The instant MUST therefore round-trip
// through Date unchanged — that is the definition of a real calendar instant, and it is
// exactly what makes `compareTs` (string order) agree with `parseTs` (instant order).
export const isCalendarInstant = (v) => {
  if (!isStr(v) || !ISO_RE.test(v)) return false;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) && d.toISOString() === v;
};

export const isTs = (v) => isStr(v) && TS_RE.test(v) && isCalendarInstant(v.slice(0, v.indexOf('|')));
export const tsError = (v) =>
  isTs(v) ? null
  : isStr(v) && TS_RE.test(v)
    ? `"${v}" carries no real calendar instant (§8.2 — the ISO part MUST round-trip through Date)`
    : `"${v}" is not an §8.2 HLC ts (fixed-width ISO | 4-hex | [a-z0-9-]{4,32})`;
export const isActorSlug = (v) => isStr(v) && ACTOR_RE.test(v);
export const actorSlugError = (v) =>
  isActorSlug(v) ? null : `"${v}" is not an §8.1 actor slug [a-z0-9-]{4,32}`;
export const isoInstantError = (v) =>
  isCalendarInstant(v) ? null : `"${v}" is not a fixed-width ISO-8601 UTC calendar instant (§8.2)`;

// ---------- JSON round-trip safety (the writer-symmetry precondition) ----------
// A sealed action is JSON text: whatever does not survive JSON.stringify → JSON.parse
// unchanged makes the writer's own reader disagree with the writer. Refusing those
// values at the schema is the CLASS fix for "seals, then fails its own validateSegment"
// — one recursive rule instead of a per-number check at every numeric field.
export const jsonSafeNumberError = (v, { integer = false } = {}) =>
  typeof v !== 'number' ? `is not a number`
  : !Number.isFinite(v) ? `is not finite (NaN/Infinity serialize to JSON null)`
  : Object.is(v, -0) ? `is negative zero (serializes to 0)`
  : integer && !Number.isInteger(v) ? `is not an integer (I-2)`
  : null;

// §8.1: an event is a bounded JSON document. Depth is bounded so that EVERY recursive
// consumer of a schema-valid event is bounded too — a hostile 47 KB segment (1% of the
// 4 MiB cap) used to blow the stack inside the validator itself, so `validateSegment`
// THREW instead of returning a verdict, `onInvalid` never fired, and the honest actor's
// own segments became unreadable. A verdict, never a crash: the guard is INSIDE the
// recursion, so the walk stops at the bound and reports.
export const MAX_JSON_DEPTH = 64;
// §8.5 dotted paths address object keys; a path deeper than the document bound addresses
// nothing. Bounding the segment count at the grammar is what stops a 20,000-segment path
// from folding and then crashing every future checkpoint forever (poisoned history).
export const MAX_PATH_SEGMENTS = MAX_JSON_DEPTH;

// A plain JSON container: an ordinary object literal or a null-prototype one. Date, Map,
// Set, RegExp and typed arrays are `typeof "object"` but do NOT survive a JSON round trip
// unchanged — `Set`/`Map` serialize to `{}`, which is TOTAL data loss, silently.
const isPlainJsonObject = (v) => {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};
const kindOf = (v) => (v && v.constructor && v.constructor.name) || 'object';

export const jsonRoundTripError = (value, at = '', depth = 0) => {
  if (depth > MAX_JSON_DEPTH)
    return `${at || 'value'} nests deeper than the §8.1 limit of ${MAX_JSON_DEPTH} levels`;
  const t = typeof value;
  if (t === 'number') { const e = jsonSafeNumberError(value); return e ? `${at || 'value'} ${e}` : null; }
  if (t === 'function' || t === 'symbol' || t === 'bigint') return `${at || 'value'} is a ${t} (not JSON)`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return `${at}[${i}] is undefined (serializes to JSON null)`;
      const e = jsonRoundTripError(value[i], `${at}[${i}]`, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (value !== null && t === 'object') {
    if (!isPlainJsonObject(value))
      return `${at || 'value'} is a ${kindOf(value)} — not a plain JSON object (it does not survive a JSON round trip unchanged)`;
    for (const k of Object.keys(value)) {
      // An own `__proto__` key survives JSON but NOT an ordinary object copy: `p[k] = v`
      // runs the prototype setter and swallows the field. Every consumer that copies a
      // record field-by-field would go blind on it, so the format refuses the key.
      if (k === '__proto__')
        return `${at ? `${at}.` : ''}__proto__ is a prototype-polluting own key — refuse (§8.1)`;
      if (value[k] === undefined) continue; // an absent field, both before and after JSON
      const e = jsonRoundTripError(value[k], at ? `${at}.${k}` : k, depth + 1);
      if (e) return e;
    }
  }
  return null;
};

// The I-4 key rule, applied to the whole event graph: every OBJECT KEY is identity —
// `initialVerses` slot keys, `transitions` destinations, settings sub-keys — so a key is
// REFUSED when it is not NFC rather than normalized (normalizing a key can collide it
// with a sibling and destroy the sibling's value silently).
export const nfcKeysError = (value, at = '', depth = 0) => {
  if (depth > MAX_JSON_DEPTH) return null; // depth is jsonRoundTripError's verdict to give
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const e = nfcKeysError(value[i], `${at}[${i}]`, depth + 1);
      if (e) return e;
    }
    return null;
  }
  if (isObj(value)) {
    for (const k of Object.keys(value)) {
      if (!isNfc(k)) return `key "${k}"${at ? ` at ${at}` : ''} ${nfcError(k)}`;
      const e = nfcKeysError(value[k], at ? `${at}.${k}` : k, depth + 1);
      if (e) return e;
    }
  }
  return null;
};

// ---------- §2 book codes (the eng canon) ----------
// The UPPERCASE 3-character USFM codes of the eng canon, in canon order. §2: codes MUST
// be in the eng canon; non-canonical books are not allowed (D26). This list is the
// harness's copy of the product's `src/data/bookNames.ts` keys — the journal suite
// asserts the two agree (drift guard), because the harness is a standalone package.
export const BOOK_CODES = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI',
  '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG',
  'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC',
  'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT', 'MRK', 'LUK', 'JHN', 'ACT',
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
  'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];
export const BOOK_IDS = new Set(BOOK_CODES);
const BOOK_IDS_LOWER = new Set(BOOK_CODES.map((c) => c.toLowerCase()));

// §2: `<BOOK>` — the UPPERCASE code. Every `book` field flows into an ingredient path
// (`<BOOK>.usfm`, `checking/alignments/<BOOK>.json`), so this grammar is path-safety.
export const bookIdError = (v) =>
  !isStr(v) ? 'is not a string'
  : !BOOK_IDS.has(v) ? `"${v}" is not an UPPERCASE §2 canonical USFM book code (eng canon, D26)`
  : null;

// §5.2: `contextId.reference.bookId` uses the lowercase form of the same canonical set.
export const bookIdLowerError = (v) =>
  !isStr(v) ? 'is not a string'
  : !BOOK_IDS_LOWER.has(v) ? `"${v}" is not a lowercase §5.2 canonical USFM book code (eng canon, D26)`
  : null;

// ---------- §5.2 tool ids ----------
// The closed set §5.2 names for `v: 1` (translationQuestions is reserved, post-Phase-1).
// A toolId flows into `checking/<toolId>/<BOOK>.json`, so the closed set IS path safety.
export const TOOL_IDS = new Set(['translationWords', 'translationNotes']);
export const toolIdError = (v) =>
  !isStr(v) ? 'is not a string'
  : !TOOL_IDS.has(v) ? `"${v}" is not a §5.2 toolId (translationWords | translationNotes)`
  : null;

// ---------- §5.2 identity keys ----------
// The five-part form checkId|bookId|chapter|verse|occurrence. `|` is the identity
// delimiter and `:` is the register-key delimiter (`<chapter>:<verse>`), so a part
// carrying either would make the serialized key ambiguous — which is exactly how a
// serializer and its validator drift apart. DELIMITER-FREE, NON-EMPTY parts make
// serializer/validator symmetry provable (the round-8 property test).
export const IDENTITY_DELIMITER = '|';
export const REGISTER_DELIMITER = ':';
export const identityPartError = (v) => {
  if (typeof v === 'number') { const e = jsonSafeNumberError(v); if (e) return e; }
  else if (!isStr(v)) return 'must be a string or a number';
  const s = String(v);
  if (s === '') return 'is empty';
  if (s.includes(IDENTITY_DELIMITER)) return `contains the §5.2 identity delimiter "${IDENTITY_DELIMITER}"`;
  if (s.includes(REGISTER_DELIMITER)) return `contains the register-key delimiter "${REGISTER_DELIMITER}"`;
  return null;
};

// THE serializer. Its output is valid BY CONSTRUCTION — because the serializer CHECKS
// its own precondition. A bare join launders `-0` into `"0"`, an array into its comma
// form, an object into `"[object Object]"` and a boolean into `"true"`, each of which
// then passes identityKeyError as a well-formed-looking key. Every other consumer
// re-checks at its own boundary; this one does too, so the serializer can never emit a
// string its own validator would reject.
const IDENTITY_COMPONENTS = ['checkId', 'reference.bookId', 'reference.chapter', 'reference.verse', 'occurrence'];
export const identityKeyOf = (contextId) => {
  if (!isObj(contextId) || !isObj(contextId.reference))
    throw new Error('identityKeyOf: a §5.2 contextId with a reference object is required — refuse to serialize');
  const r = contextId.reference;
  const parts = [contextId.checkId, r.bookId, r.chapter, r.verse, contextId.occurrence];
  for (let i = 0; i < parts.length; i++) {
    const e = identityPartError(parts[i]);
    if (e) throw new Error(`identityKeyOf: ${IDENTITY_COMPONENTS[i]} ${e} — refuse to serialize an ambiguous §5.2 identity key`);
  }
  return parts.join(IDENTITY_DELIMITER);
};

export const identityKeyError = (s) => {
  if (!isStr(s)) return 'is not a string';
  const parts = s.split(IDENTITY_DELIMITER);
  if (parts.length !== 5)
    return `is not the five-part §5.2 form checkId|bookId|chapter|verse|occurrence (${parts.length} part${parts.length === 1 ? '' : 's'})`;
  for (const p of parts) { const e = identityPartError(p); if (e) return `has a §5.2 identity part that ${e}`; }
  return null;
};
export const identityKeyParts = (s) => {
  const [checkId, bookId, chapter, verse, occurrence] = s.split(IDENTITY_DELIMITER);
  return { checkId, bookId, chapter, verse, occurrence };
};

// The toolId-prefixed decision key (`toolId|checkId|bookId|chapter|verse|occurrence`) —
// the form disposition keys use and the fold's `dec|` register keys carry.
export const decisionKeyError = (s) => {
  if (!isStr(s)) return 'is not a string';
  const i = s.indexOf(IDENTITY_DELIMITER);
  if (i < 1) return 'is missing the toolId prefix';
  const te = toolIdError(s.slice(0, i));
  if (te) return `toolId ${te}`;
  const ie = identityKeyError(s.slice(i + 1));
  return ie ? ie : null;
};
export const splitDecisionKey = (s) => {
  const i = s.indexOf(IDENTITY_DELIMITER);
  return { toolId: s.slice(0, i), identityKey: s.slice(i + 1), ...identityKeyParts(s.slice(i + 1)) };
};

// ---------- §8.5 note targets and the re-key destination bound to their KIND ----------
// A note target is exactly one of a verse or a DECISION KEY, and the two destination
// grammars are disjoint. A re-key that ignores the KIND rewrote a VERSE-targeted note to
// an identity-key string — producing `{book, chapter: "x1|tit|1|2|1", verse: ""}`, a
// target the schema itself rejects. ONE predicate, so the schema and the fold apply the
// same rule at their own boundaries.
//
// Round 9: the decision-key form is the TOOLID-PREFIXED one — the same string the fold's
// `dec|` registers carry and disposition keys name. A bare five-part §5.2 identity key
// names a check position, not a decision: two tools may hold a decision at the SAME
// position, so a note targeting the bare key could not say which decision it annotates.
// ONE decision-key grammar, everywhere a decision is named.
export const noteTargetKind = (target) =>
  !isObj(target) ? null
  : isStr(target.decisionKey) ? 'decisionKey'
  : (target.book != null && target.chapter != null && target.verse != null) ? 'verse'
  : null;

export const noteRekeyError = (target, to, newSlots = []) => {
  const kind = noteTargetKind(target);
  if (kind === null) return 'names a note whose target is neither a verse nor a decision key';
  if (!isStr(to)) return 're-key destination is not a string';
  if (kind === 'verse')
    return newSlots.includes(to) ? null
      : `re-key destination "${to}" is not a target slot of the mapping — a VERSE-targeted note re-keys to a verse slot, never to a decision key (§8.5)`;
  const e = decisionKeyError(to);
  return e ? `re-key destination "${to}" ${e} — a decisionKey-targeted note re-keys to a toolId-prefixed decision key` : null;
};

// ---------- §8.4 verse slot keys ----------
// The key form the §8.4 decomposition produces: `<chapter>:<verseKey>`, where a verse key
// is decimal or a span (`4-5`). Used for `initialVerses` keys, alignment register keys,
// and disposition targets.
export const VERSE_SLOT_RE = /^\d+:\d+(-\d+)?$/;
export const verseSlotError = (v) =>
  !isStr(v) ? 'is not a string'
  : !VERSE_SLOT_RE.test(v) ? `"${v}" is not a §8.4 verse slot key (<chapter>:<verse> or <chapter>:<v>-<v>)`
  : null;

// ---------- §3 rule 4 scope ranges ----------
// The range grammar is exactly `C`, `C-C`, `C:V`, `C:V-V`, `C:V-C:V` — nothing else.
export const SCOPE_RANGE_RE = /^(\d+(-\d+)?|\d+:\d+(-\d+(:\d+)?)?)$/;
export const scopeRangeError = (v) =>
  !isStr(v) ? 'is not a string'
  : !SCOPE_RANGE_RE.test(v) ? `"${v}" is not a §3 rule 4 range (C | C-C | C:V | C:V-V | C:V-C:V)`
  : null;
// A scope VALUE: `[]` means the whole book; otherwise an array of range strings.
export const scopeError = (v) => {
  if (!Array.isArray(v)) return 'is not an array ([] = whole book, §3 rule 4)';
  for (const r of v) { const e = scopeRangeError(r); if (e) return `scope entry ${e}`; }
  return null;
};

// ---------- dotted paths (settings.set / project.meta.set) ----------
// A dotted path addresses object keys in a projected JSON document, so a path segment is
// a WRITE TARGET on an object. `__proto__`, `prototype` and `constructor` reach the
// prototype chain instead of the document — prototype pollution. They are refused here,
// once, for every op that carries a path. (checkpoint.mjs refuses them AGAIN at the
// setter — defense in depth, §8.7.)
export const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
// §8.5: derived/fixed metadata roots a project.meta.set may never target.
export const META_RESERVED_ROOTS = new Set(['format', 'ingredients', 'type', 'meta']);

export const dottedPathError = (v, { reservedRoots = null } = {}) => {
  if (!isStr(v)) return 'is not a string';
  if (v === '') return 'is empty';
  const parts = v.split('.');
  if (parts.length > MAX_PATH_SEGMENTS)
    return `"${v.slice(0, 30)}…" has ${parts.length} segments — more than the §8.5 limit of ${MAX_PATH_SEGMENTS}`;
  for (const p of parts) {
    if (p === '') return `"${v}" has an empty path segment`;
    if (FORBIDDEN_PATH_SEGMENTS.has(p))
      return `"${v}" targets the prototype chain via "${p}" — refuse (prototype pollution)`;
  }
  if (reservedRoots && reservedRoots.has(parts[0])) return `targets reserved root "${v}"`;
  return null;
};

// §8.5: the pin slot grammar is the §5.3 document's own paths — anything else refuses.
export const PIN_SLOT_RE = /^(languageSets\.(primary|fallback)\.(gatewayLanguage|translationNotes|translationWordsLinks|translationWords|translationAcademy)|resources\.(originalLanguage|lexicon)\.(nt|ot)|extraScripture\.[A-Za-z0-9_-]+)$/;
export const pinSlotError = (v) =>
  isStr(v) && PIN_SLOT_RE.test(v) ? null : `"${v}" is not a §5.3 slot`;

// §5.3 ENTRY shape. The slot was validated but the entry never was, so `"not-an-object"`
// and `42` reached the projected `resources.json` verbatim. The entry is a §5.3 document
// value, so it carries the §5.3 document's own shape — ONE validator, shared by the op
// and by any projection input.
export const SHA_RE = /^[0-9a-f]{40}$/;                 // §5.3 REQUIRED commit sha (D58)
export const PIN_BOOK_RE = /^[A-Z0-9]{3}$/;             // §5.3 OPTIONAL per-pin coverage (D41)
// §5.3 whole-collection form: a resource that is not book-partitioned (the tw
// articles — the platform reports its coverage as 'BIBLE') records `books`
// as EXACTLY this single-element list, meaning "covers every book". The marker
// never mixes with book codes: a mixed list has no defined meaning.
export const WHOLE_COLLECTION = 'BIBLE';
const pinStringField = (e, k, { required }) => {
  if (e[k] === undefined) return required ? `without ${k}` : null;
  if (!isStr(e[k]) || e[k] === '') return `${k} is not a non-empty string`;
  return null;
};
export const pinEntryError = (slot, entry) => {
  if (!isObj(entry)) return 'is not a §5.3 entry object';
  const isGatewayLanguage = isStr(slot) && slot.endsWith('.gatewayLanguage');
  const isExtra = isStr(slot) && slot.startsWith('extraScripture.');
  // `gatewayLanguage` names a language, not a repo: {languageId, owner}.
  // D58: the sha IS the pin's identity (release tags are not enforced
  // upstream — anyone can name a tag anything); `version` is an OPTIONAL
  // display label, non-empty when present.
  const fields = isGatewayLanguage
    ? [['languageId', true], ['owner', true]]
    : [['repoPath', true], ['sha', true], ['version', false], ['flavor', true], ...(isExtra ? [['id', true]] : [])];
  for (const [k, required] of fields) { const e = pinStringField(entry, k, { required }); if (e) return e; }
  if (entry.sha !== undefined && !(isStr(entry.sha) && SHA_RE.test(entry.sha)))
    return 'sha is not 40 lowercase hex (§5.3)';
  if (!isGatewayLanguage && entry.books !== undefined) {
    if (!Array.isArray(entry.books)) return 'books is not an array (§5.3)';
    // The whole-collection form is EXACTLY ['BIBLE'] — the marker mixed into a
    // book list has no defined meaning and refuses.
    const isWholeCollection = entry.books.length === 1 && entry.books[0] === WHOLE_COLLECTION;
    if (!isWholeCollection) {
      const badBook = entry.books.find((book) => !isStr(book) || !PIN_BOOK_RE.test(book));
      if (badBook !== undefined)
        return `books contains ${JSON.stringify(badBook)}, not an uppercase 3-character book code or the whole-collection form ["BIBLE"] (§5.3)`;
    }
  }
  if (isExtra && entry.id !== slot.slice('extraScripture.'.length))
    return `extraScripture entry id "${entry.id}" does not match its slot "${slot}"`;
  return null;
};

// ---------- §8.4 journaled verse content ----------
// `text.verse.set.text` carries ONE content slot. A slot that itself contains a `\v ` or
// `\c ` marker is not one slot: the next decompose SILENTLY RE-PARTITIONS the committed
// book into different slots, and the §5.1 plain-text extraction (I-3) stops at the
// embedded marker, so the smuggled bytes live outside the validity hash. U+0001 is the
// slot delimiter itself. All three are refused at the schema.
export const journaledTextError = (v) => {
  if (!isStr(v)) return 'is not a string';
  if (v.includes(SLOT)) return 'contains the reserved §8.4 slot delimiter U+0001';
  const m = VERSE_BOUNDARY_RE.exec(v);
  if (m) return `contains the §8.4 region marker "${m[0].trimEnd()}" — one event carries exactly ONE content slot`;
  return null;
};

// ---------- §2 ingredient paths ----------
// "An ingredient path (the `ipath`) MUST NOT have a segment that is empty, that starts
// with `.`, or that contains any of: ..  ~  \  &  *  +  |  space  ?  #  %  {  }  <  >  $
// !  '" (§2, verified against pankosmia-web `utils/paths.rs`). Enforcing it makes every
// derived key path-safe by grammar — `..` traversal included.
const IPATH_FORBIDDEN = ['..', '~', '\\', '&', '*', '+', '|', ' ', '?', '#', '%', '{', '}', '<', '>', '$', '!', "'"];
// Round 9: the §2 character list is a list of PUNCTUATION. It says nothing about the
// characters that are not printable at all, and a path is read by humans, by a shell,
// and by Windows. Each rule below closes a way a legal-looking segment stops meaning
// what it looks like:
//   • C0/C1 controls and NUL — a NUL truncates the name in every C API the platform
//     reaches through; CR/LF forge a line in any log or manifest that lists paths;
//   • bidi controls — they REORDER the rendered name, so a reviewer reads a different
//     path than the one on disk;
//   • Windows reserved device names — `CON`, `NUL`, `COM1`… name a DEVICE, not a file,
//     with or without an extension, so the write silently goes nowhere;
//   • a trailing dot or space — Windows strips it, so two distinct §2 paths collide.
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;
const BIDI_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
export const ipathError = (v) => {
  if (!isStr(v)) return 'is not a string';
  if (v === '') return 'is empty';
  for (const seg of v.split('/')) {
    if (seg === '') return `"${v}" has an empty §2 path segment`;
    if (seg.startsWith('.')) return `"${v}" has a §2 path segment starting with "." ("${seg}")`;
    for (const bad of IPATH_FORBIDDEN)
      if (seg.includes(bad))
        return `"${v}" has a §2-forbidden character ${bad === ' ' ? '"space"' : `"${bad}"`} in segment "${seg}"`;
    const ctl = CONTROL_RE.exec(seg);
    if (ctl) return `"${v}" has a control character U+${ctl[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} in a path segment`;
    if (BIDI_RE.test(seg)) return `"${v}" has a bidirectional control character in a path segment (the rendered name would not be the name on disk)`;
    if (WINDOWS_DEVICE_RE.test(seg)) return `"${v}" names the Windows reserved device "${seg}"`;
    if (seg.endsWith('.')) return `"${v}" has a path segment ending in "." ("${seg}")`;
  }
  return null;
};
