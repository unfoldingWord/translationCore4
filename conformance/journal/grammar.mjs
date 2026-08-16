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

// ---------- §8.2 time: the ISO instant, the actor slug, and the ts built from them ----------
// The three grammars nest, so each is stated ONCE and reused: TS_RE is BUILT from
// ISO_RE + ACTOR_RE rather than restating their charsets (which is how the actor-slug
// rule came to exist twice — in TS_RE and in makeClock).
const src = (re) => re.source.replace(/^\^/, '').replace(/\$$/, '');
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/; // fixed-width UTC ms
export const ACTOR_RE = /^[a-z0-9-]{4,32}$/;                            // §8.1 install slug
export const TS_RE = new RegExp(`^(${src(ISO_RE)})\\|([0-9a-f]{4})\\|(${src(ACTOR_RE)})$`);

export const isTs = (v) => isStr(v) && TS_RE.test(v);
export const tsError = (v) =>
  isTs(v) ? null : `"${v}" is not an §8.2 HLC ts (fixed-width ISO | 4-hex | [a-z0-9-]{4,32})`;
export const isActorSlug = (v) => isStr(v) && ACTOR_RE.test(v);
export const actorSlugError = (v) =>
  isActorSlug(v) ? null : `"${v}" is not an §8.1 actor slug [a-z0-9-]{4,32}`;
export const isoInstantError = (v) =>
  isStr(v) && ISO_RE.test(v) ? null : `"${v}" is not a fixed-width ISO-8601 UTC instant (§8.2)`;

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

export const jsonRoundTripError = (value, at = '') => {
  const t = typeof value;
  if (t === 'number') { const e = jsonSafeNumberError(value); return e ? `${at || 'value'} ${e}` : null; }
  if (t === 'function' || t === 'symbol' || t === 'bigint') return `${at || 'value'} is a ${t} (not JSON)`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return `${at}[${i}] is undefined (serializes to JSON null)`;
      const e = jsonRoundTripError(value[i], `${at}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (isObj(value)) {
    for (const k of Object.keys(value)) {
      if (value[k] === undefined) continue; // an absent field, both before and after JSON
      const e = jsonRoundTripError(value[k], at ? `${at}.${k}` : k);
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

// THE serializer. Its output is valid BY CONSTRUCTION whenever the components passed
// identityPartError — which is what the schema enforces at every producing site.
export const identityKeyOf = (contextId) =>
  [contextId.checkId, contextId.reference.bookId, contextId.reference.chapter,
   contextId.reference.verse, contextId.occurrence].join(IDENTITY_DELIMITER);

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

// ---------- §2 ingredient paths ----------
// "An ingredient path (the `ipath`) MUST NOT have a segment that is empty, that starts
// with `.`, or that contains any of: ..  ~  \  &  *  +  |  space  ?  #  %  {  }  <  >  $
// !  '" (§2, verified against pankosmia-web `utils/paths.rs`). Enforcing it makes every
// derived key path-safe by grammar — `..` traversal included.
const IPATH_FORBIDDEN = ['..', '~', '\\', '&', '*', '+', '|', ' ', '?', '#', '%', '{', '}', '<', '>', '$', '!', "'"];
export const ipathError = (v) => {
  if (!isStr(v)) return 'is not a string';
  if (v === '') return 'is empty';
  for (const seg of v.split('/')) {
    if (seg === '') return `"${v}" has an empty §2 path segment`;
    if (seg.startsWith('.')) return `"${v}" has a §2 path segment starting with "." ("${seg}")`;
    for (const bad of IPATH_FORBIDDEN)
      if (seg.includes(bad))
        return `"${v}" has a §2-forbidden character ${bad === ' ' ? '"space"' : `"${bad}"`} in segment "${seg}"`;
  }
  return null;
};
