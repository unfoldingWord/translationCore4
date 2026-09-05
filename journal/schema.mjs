// Declarative event & action schema — BURRITO-SPEC §8.1/§8.3/§8.5 (the round-5
// simplification). ONE validator for the sealed-event vocabulary, applied identically
// by the writer (sealAction), by segment validation and intake (validateSegment), and
// by the fold — writer-symmetric by construction, total over malformed input (element
// nulls included). SHAPE lives here; semantic rules (liveness, chains, applicability,
// affected sets) stay in the fold.
//
// Round 8: every CONSTRAINED PRIMITIVE is validated by its named grammar in
// grammar.mjs — the one value-grammar module. This file composes those grammars into
// per-op payload rules and hand-rolls no character test of its own. A primitive checked
// for TYPE but not for GRAMMAR, flowing into a structural position (a path, an identity
// key, a prototype-chain traversal, Burrito metadata), was the defect class of round 8.
import { slotKeysOf } from './skeleton.mjs';
import {
  isStr, isObj, isTs, tsError, identityKeyOf, identityKeyError, identityPartError, decisionKeyError,
  bookIdError, bookIdLowerError, toolIdError, verseSlotError, scopeError, dottedPathError,
  pinSlotError, pinEntryError, journaledTextError, jsonSafeNumberError, jsonRoundTripError,
  nfcError, nfcKeysError, toNfc, MAX_JSON_DEPTH, META_RESERVED_ROOTS, PIN_SLOT_RE,
} from './grammar.mjs';

// Re-exported for importers that already read the identity-key pair from the schema.
export { identityKeyOf, identityKeyError, META_RESERVED_ROOTS, PIN_SLOT_RE };

// ---------- §8.4 skeletons: the SLOT KEYS are a grammar, not free text ----------
// A skeleton was type-checked (isStr) and never key-checked, so `slotKeysOf` derived
// whatever the string contained. A `__proto__` slot recomposed to `[object Object]` and
// PERMANENTLY destroyed the verse in committed USFM; `../../etc/passwd` and `1:1|x`
// (the identity delimiter) rode the same hole. Duplicate keys collapsed silently. The
// keys carry the SAME §8.4 slot grammar every other verse key carries — ONE rule, so
// the three ops that accept a skeleton cannot drift apart.
const skeletonError = (skeleton) => {
  if (!isStr(skeleton)) return 'is not a string';
  const keys = slotKeysOf(skeleton);
  const seen = new Set();
  for (const k of keys) {
    const e = verseSlotError(k);
    if (e) return `carries a slot key that ${e}`;
    if (seen.has(k)) return `carries the duplicate slot key "${k}" — one slot key names one verse head (§8.4)`;
    seen.add(k);
  }
  return null;
};

// The register key a (chapter, verse) pair forms: `<chapter>:<verse>` (§8.4 slot key).
// ONE rule for every op that keys a record by verse — text, alignment, decision, note.
const verseRefError = (chapter, verse) => {
  const c = identityPartError(chapter); if (c) return `chapter ${c}`;
  const v = identityPartError(verse);   if (v) return `verse ${v}`;
  return verseSlotError(`${chapter}:${verse}`);
};

// ONE §5.1 alignment-record validator (round 7) — SHARED by align.verse.set events and
// structural replace post-states (§8.5). Every field the fold dereferences has a rule:
// chapter/verse build the register key, targetVerseMd5 carries I-3, alignments/wordBank
// are the record body.
const alignmentRecordError = (r) => {
  if (!isObj(r)) return 'is not an object';
  const k = verseRefError(r.chapter, r.verse);
  if (k) return `chapter/verse do not form a §8.4 register key — ${k}`;
  if (!Array.isArray(r.alignments)) return 'without an alignments array';
  if (!Array.isArray(r.wordBank)) return 'without a wordBank array';
  if (!isStr(r.targetVerseMd5)) return 'without targetVerseMd5 (I-3)';
  return null;
};

// ONE §5.2 decision-record validator (round 7) — SHARED by check.decision.set events and
// structural replace post-states. Every field the fold dereferences has a rule:
// contextId.checkId + occurrence + reference.{bookId, chapter, verse} form the identity
// key (§5.2), so each part carries the identity-part grammar (non-empty, delimiter-free)
// — which is what makes identityKeyOf's output valid BY CONSTRUCTION.
const decisionRecordError = (d) => {
  if (!isObj(d)) return 'is not an object';
  const c = d.contextId;
  if (!isObj(c)) return 'without a contextId object';
  const ck = identityPartError(c.checkId);
  if (ck) return `contextId.checkId ${ck}`;
  // I-2: occurrence is an integer (and an integer survives JSON unchanged)
  const oc = jsonSafeNumberError(c.occurrence, { integer: true });
  if (oc) return `contextId.occurrence ${oc}`;
  const r = c.reference;
  if (!isObj(r)) return 'without a contextId.reference object';
  const b = bookIdLowerError(r.bookId);
  if (b) return `contextId.reference.bookId ${b}`;
  const k = verseRefError(r.chapter, r.verse);
  if (k) return `contextId.reference.chapter/verse do not form a §8.4 register key — ${k}`;
  return null;
};
// §8.3 seed provenance enum
const SEED_SOURCES = new Set(['creation', 'sidecar-migration', 'out-of-band-usfm', 'tc3-import']);

// §8.5 disposition schema: surface and action are closed enums; re-key requires a
// destination among the mapping's targets (or a §5.2 identity key, for notes);
// replace requires the complete post-state.
// Round 9: `text` is a disposition surface. Verse TEXT on a slot a structural action
// REMOVES was the one dependent record class with no disposition and no orphan backstop:
// it went silently absent and then resurfaced as a zombie fork when the slot returned.
// A slot whose content is CARRIED FORWARD is named by a transition `source`; a slot whose
// content is DROPPED needs an explicit statement, exactly like an alignment. `re-key` and
// `replace` are therefore not text dispositions — the transitions already say that.
const DISP_SURFACES = new Set(['text', 'alignment', 'decision', 'note']);
const DISP_ACTIONS = new Set(['re-key', 'replace', 'invalidate-retain', 'orphan-review']);
const KEYED_SURFACES = new Set(['text', 'alignment', 'decision']);
const dispositionError = (d, newSlots) => {
  if (!isObj(d)) return 'disposition is not an object';
  if (!DISP_SURFACES.has(d.surface)) return `disposition surface "${d && d.surface}" is not one of text|alignment|decision|note`;
  if (!DISP_ACTIONS.has(d.action)) return `disposition action "${d.action}" is not one of re-key|replace|invalidate-retain|orphan-review`;
  if (!isTs(d.ts)) return `disposition record reference "${d.ts}" is not an §8.2 HLC ts`;
  if (KEYED_SURFACES.has(d.surface) && !isStr(d.key))
    return `disposition (${d.surface}) without a key`;
  if (d.surface === 'text' || d.surface === 'alignment') {
    // the key IS the register key — the same §8.4 slot grammar everywhere
    const err = verseSlotError(d.key);
    if (err) return `disposition (${d.surface}) key ${err}`;
  }
  if (d.surface === 'text' && (d.action === 're-key' || d.action === 'replace'))
    return `text disposition action "${d.action}" is not allowed — text carried FORWARD is named by a transition source; a text disposition states only that the slot's content is DROPPED (invalidate-retain | orphan-review, §8.5)`;
  if (d.surface === 'decision') {
    // the key is toolId + the §5.2 identity-key string — the same grammar everywhere
    const err = decisionKeyError(d.key);
    if (err) return `disposition (decision) key "${d.key}" ${err} — must be toolId|checkId|bookId|chapter|verse|occurrence`;
  }
  if (d.action === 're-key') {
    if (!isStr(d.to)) return 're-key disposition without a destination (to)';
    if (d.surface !== 'note' && !newSlots.includes(d.to))
      return `re-key disposition destination "${d.to}" is not a target slot of the mapping`;
    if (d.surface === 'note' && !newSlots.includes(d.to)) {
      const err = decisionKeyError(d.to); // the same decision-key grammar the registers carry
      if (err) return `note re-key destination "${d.to}" is neither a target slot nor a decision key (${err})`;
    }
  }
  if (d.action === 'replace') {
    // §8.5: the post-state is a VALIDATED, complete record whose identity is
    // consistent with the disposition's target — never a free-form object.
    if (d.surface === 'note') return 'replace is not a note disposition — notes are grow-only in v1';
    if (!isObj(d.post)) return 'replace disposition without the complete post-state (post)';
    if (d.surface === 'alignment') {
      // the SAME §5.1 validator the direct op uses (round 7 unification)
      const err = alignmentRecordError(d.post);
      if (err) return `alignment replace post must be a complete §5.1 record — post ${err}`;
      if (`${d.post.chapter}:${d.post.verse}` !== d.key)
        return `alignment replace post identity "${d.post.chapter}:${d.post.verse}" mismatches the disposition target "${d.key}"`;
    }
    if (d.surface === 'decision') {
      // the SAME §5.2 validator the direct op uses (round 7 unification)
      const err = decisionRecordError(d.post);
      if (err) return `decision replace post must be a complete §5.2 record — post ${err}`;
      // identity via the ONE serializer — the same string the fold keys on
      const identity = identityKeyOf(d.post.contextId);
      const target = d.key.slice(d.key.indexOf('|') + 1);
      if (identity !== target)
        return `decision replace post identity [${identity}] mismatches the disposition target "${d.key}"`;
    }
  }
  return null;
};

// Per-op payload validators (the §8.5 table, one row each). Return an error string or null.
// Every `book` field carries the §2 canonical book grammar: it becomes an ingredient path
// (`<BOOK>.usfm`, `checking/alignments/<BOOK>.json`) at checkpoint (§8.7).
const OPS = {
  'text.verse.set': (e) => {
    const b = bookIdError(e.book); if (b) return `text.verse.set book ${b}`;
    const k = verseRefError(e.chapter, e.verse);
    if (k) return `text.verse.set chapter/verse do not form a §8.4 register key — ${k}`;
    if (!isStr(e.text)) return 'text.verse.set without text';
    // R-8.5.6 (D68): `generation` is OPTIONAL here — the base chain carries the
    // generation (R-8.5.15). A present stamp's grammar is checked once for every op below.
    const t = journaledTextError(e.text);
    return t ? `text.verse.set text ${t}` : null;
  },
  'text.skeleton.set': (e) => {
    const b = bookIdError(e.book); if (b) return `text.skeleton.set book ${b}`;
    const s = skeletonError(e.skeleton);
    return s ? `text.skeleton.set skeleton ${s}` : null;
  },
  'text.structure.apply': (e) => {
    const b = bookIdError(e.book); if (b) return `text.structure.apply book ${b}`;
    const sk = skeletonError(e.skeleton);
    if (sk) return `text.structure.apply skeleton ${sk}`;
    if (!isObj(e.transitions)) return 'text.structure.apply without transitions';
    if (!Array.isArray(e.dispositions)) return 'text.structure.apply without dispositions';
    const newSlots = slotKeysOf(e.skeleton);
    // transitions cover exactly the new skeleton's slots; each with stated text + sources
    const tKeys = Object.keys(e.transitions);
    if (JSON.stringify([...tKeys].sort()) !== JSON.stringify([...newSlots].sort()))
      return 'text.structure.apply transitions must cover exactly the new skeleton\'s slots';
    const claimed = new Set();
    for (const dest of tKeys) {
      const tr = e.transitions[dest];
      if (!isObj(tr) || !isStr(tr.text) || !Array.isArray(tr.sources ?? []))
        return `text.structure.apply transition "${dest}" must state its final text`;
      const tt = journaledTextError(tr.text); // a destination text IS journaled verse content
      if (tt) return `text.structure.apply transition "${dest}" text ${tt}`;
      for (const src of tr.sources || []) {
        if (!isObj(src) || !isTs(src.ts))
          return `text.structure.apply transition "${dest}" carries a malformed source reference (key + §8.2 HLC ts required)`;
        const sk = verseSlotError(src.key); // a source key IS a §8.4 register key
        if (sk) return `text.structure.apply transition "${dest}" source key ${sk}`;
        const c = `${src.key}|${src.ts}`;
        if (claimed.has(c)) return `text.structure.apply claims source ${c} twice`;
        claimed.add(c);
      }
    }
    // §8.5: at most ONE disposition per record — duplicates/conflicts are malformed
    const dispIds = new Set();
    for (const d of e.dispositions) {
      const err = dispositionError(d, newSlots);
      if (err) return `text.structure.apply ${err}`;
      const id = `${d.surface}|${d.key ?? ''}|${d.ts}`;
      if (dispIds.has(id)) return `text.structure.apply carries duplicate/conflicting dispositions for ${id}`;
      dispIds.add(id);
    }
    return null;
  },
  'book.add': (e) => {
    const b = bookIdError(e.book); if (b) return `book.add book ${b}`;
    const sk = skeletonError(e.skeleton);
    if (sk) return `book.add skeleton ${sk} (§8.5 self-contained)`;
    const s = scopeError(e.scope);
    if (s) return `book.add scope ${s}`; // §3 rule 4 — the value projects into currentScope
    if (e.initialVerses !== undefined) {
      if (!isObj(e.initialVerses)) return 'book.add initialVerses must be an object';
      // §8.5: initialVerses maps SLOT KEYS of the supplied skeleton to initial content —
      // a key that is not a slot of this skeleton names no verse head and never projects.
      const slots = new Set(slotKeysOf(e.skeleton));
      for (const [k, v] of Object.entries(e.initialVerses)) {
        if (!slots.has(k)) return `book.add initialVerses key "${k}" is not a slot of the supplied skeleton (§8.5)`;
        if (!isStr(v)) return 'book.add initialVerses values must be strings (projected verse content)';
        const t = journaledTextError(v); // initial content IS journaled verse content
        if (t) return `book.add initialVerses["${k}"] ${t}`;
      }
    }
    return null;
  },
  'book.remove': (e) => {
    const b = bookIdError(e.book);
    return b ? `book.remove book ${b}` : null;
  },
  'align.verse.set': (e) => {
    const b = bookIdError(e.book); if (b) return `align.verse.set book ${b}`;
    const err = alignmentRecordError(e); // the SAME §5.1 validator replace post-states use
    return err ? `align.verse.set ${err} — must carry a complete §5.1 record` : null;
  },
  'check.decision.set': (e) => {
    const t = toolIdError(e.toolId); // closed set — it becomes checking/<toolId>/<BOOK>.json
    if (t) return `check.decision.set toolId ${t}`;
    const err = decisionRecordError(e.decision); // the SAME §5.2 validator replace post-states use
    return err ? `check.decision.set decision ${err} — must carry a complete §5.2 record` : null;
  },
  'note.add': (e) => {
    const tg = e.target;
    if (!isObj(tg)) return 'note.add target must be a {book, chapter, verse} or {decisionKey} object';
    const isVerse = tg.book != null && tg.chapter != null && tg.verse != null;
    const isDec = isStr(tg.decisionKey);
    if (isVerse === isDec) return 'note.add target must be exactly one of {book, chapter, verse} or {decisionKey}';
    if (isVerse) {
      const b = bookIdError(tg.book); if (b) return `note.add target book ${b}`;
      const k = verseRefError(tg.chapter, tg.verse);
      if (k) return `note.add target chapter/verse do not form a §8.4 register key — ${k}`;
    }
    if (isDec) {
      // the ONE decision-key grammar: toolId|checkId|bookId|chapter|verse|occurrence.
      // A bare five-part §5.2 identity key names a check POSITION, which two tools may
      // both hold — so it could not say WHICH decision the note annotates (round 9).
      const err = decisionKeyError(tg.decisionKey);
      if (err) return `note.add decisionKey "${tg.decisionKey}" ${err}`;
    }
    if (!isStr(e.text)) return 'note.add without text';
    return null;
  },
  'resource.pin.set': (e) => {
    const s = pinSlotError(e.slot);
    if (s) return `resource.pin.set slot ${s}`;
    if (e.removed === true) return null;
    if (e.entry === undefined) return 'resource.pin.set without entry (or removed: true)';
    // The slot was validated and the ENTRY never was, so `"not-an-object"` and `42`
    // reached the projected resources.json verbatim. ONE §5.3 entry validator.
    const en = pinEntryError(e.slot, e.entry);
    return en ? `resource.pin.set entry ${en}` : null;
  },
  'project.meta.set': (e) => {
    // the dotted path is a WRITE TARGET in metadata.json — §8.5 reserved roots AND the
    // prototype-chain segments are refused by the ONE dotted-path grammar
    const p = dottedPathError(e.path, { reservedRoots: META_RESERVED_ROOTS });
    if (p) return `project.meta.set path ${p}`;
    return e.removed !== true && e.value === undefined ? 'project.meta.set without value (or removed: true)' : null;
  },
  'settings.set': (e) => {
    const p = dottedPathError(e.path);
    if (p) return `settings.set path ${p}`;
    return e.removed !== true && e.value === undefined ? 'settings.set without value (or removed: true)' : null;
  },
  'project.vrs.set': (e) =>
    !isStr(e.name) ? 'project.vrs.set without name'
    : !isStr(e.bytes) ? 'project.vrs.set carries no raw bytes'
    // §8.5: "`v: 1` writers emit it only within the creation/seed segment." The rule was
    // stated and never enforced, so an ordinary later event sealed and folded and only
    // the register's first-value rule stood between it and a silent frame replacement.
    // The seed marker IS the enforceable form of "creation/seed only".
    : !isObj(e.seed) || !VRS_SEED_SOURCES.has(e.seed.source)
      ? `project.vrs.set outside a creation/seed segment — §8.5 allows it only with seed.source ∈ ${[...VRS_SEED_SOURCES].join('|')}`
    : null,
};

// The schema's known-op set (R-8.5.1: there are no other ops in `v: 1`). Exported so the
// suite can assert set-equality with the §8.5 table instead of trusting this file.
export const KNOWN_OPS = Object.freeze(Object.keys(OPS));

// ---------- §8.5 payload fields: what a head's IDENTITY is made of (round 9) ----------
// The fold auto-merges live heads with byte-identical payloads (§8.6 step 3). It built
// that payload by SUBTRACTING the eight known envelope keys, so any other top-level field
// counted as payload — and an additive-optional field (which §9 says readers must
// tolerate without a version bump) made otherwise IDENTICAL heads FORK, manufacturing a
// review item out of nothing. Fork identity is therefore built by ADDITION, from the
// op's own §8.5 payload row.
//
// `align.verse.set` is the deliberate exception and carries `null`: its payload IS the
// open §5.1 record, spread at the top level (`sourceVersion`, `invalid`, and any future
// additive field ride through the journal unchanged and DO reach the projected record),
// so for that op an unknown top-level field is record content, not envelope, and two
// heads that differ in it are genuinely different records.
export const PAYLOAD_FIELDS = {
  'text.verse.set': ['book', 'chapter', 'verse', 'text'],
  'text.skeleton.set': ['book', 'skeleton'],
  'book.add': ['book', 'scope', 'skeleton', 'initialVerses'],
  'book.remove': ['book'],
  'text.structure.apply': ['book', 'skeleton', 'transitions', 'dispositions'],
  'align.verse.set': null, // open §5.1 record — see above
  'check.decision.set': ['toolId', 'decision', 'generation'],
  'note.add': ['target', 'text', 'generation'],
  'resource.pin.set': ['slot', 'entry', 'removed'],
  'project.meta.set': ['path', 'value', 'removed'],
  'settings.set': ['path', 'value', 'removed'],
  'project.vrs.set': ['name', 'bytes'],
};

// §8.5: the versification frame is set when the project comes into being — at creation,
// at Phase-1 migration, or at tC3 import. `out-of-band-usfm` is a TEXT reconcile source
// and never seeds a frame.
const VRS_SEED_SOURCES = new Set(['creation', 'sidecar-migration', 'tc3-import']);

// §8.5: these ops MUST carry the causal `generation` stamp — unconditionally.
// Exported: journal/fold.mjs anchors by the stamp for exactly this set (R-8.5.6, D68).
export const GENERATION_OPS = new Set(['align.verse.set', 'check.decision.set', 'note.add']);

// ---------- I-4 (§8.5): ONE write chokepoint, and ONE list of what it may not touch ----
// Invariant I-4 said "writers MUST normalize" and no writer did. The rule now has an
// implementation, and the implementation states WHICH values are transformed and which
// are refused:
//   • IDENTITY-bearing values (below) and every object KEY are REFUSED when they are not
//     already NFC. Silently transforming an identity splits or merges records with no
//     fork, no report and no way back — a refusal the writer can see is strictly better.
//   • Everything else a writer journals is NORMALIZED on seal (files.mjs `sealAction`).
// `project.vrs.set.bytes` is listed as identity because §8.7 projects it VERBATIM: a
// normalization there would change a file the format promises is byte-exact.
const IDENTITY_PATHS = {
  'text.verse.set': ['book', 'chapter', 'verse'],
  'text.skeleton.set': ['book'],
  'book.add': ['book'],
  'book.remove': ['book'],
  'text.structure.apply': [
    'book', 'transitions.*.sources.*.key', 'transitions.*.sources.*.ts',
    'dispositions.*.key', 'dispositions.*.to', 'dispositions.*.ts',
    'dispositions.*.post.chapter', 'dispositions.*.post.verse', 'dispositions.*.post.targetVerseMd5',
    'dispositions.*.post.contextId.checkId', 'dispositions.*.post.contextId.quote',
    'dispositions.*.post.contextId.quoteString', 'dispositions.*.post.contextId.groupId',
    'dispositions.*.post.contextId.reference.bookId', 'dispositions.*.post.contextId.reference.chapter',
    'dispositions.*.post.contextId.reference.verse',
  ],
  'align.verse.set': ['book', 'chapter', 'verse', 'targetVerseMd5'],
  'check.decision.set': [
    'toolId', 'decision.contextId.checkId', 'decision.contextId.quote',
    'decision.contextId.quoteString', 'decision.contextId.groupId',
    'decision.contextId.reference.bookId', 'decision.contextId.reference.chapter',
    'decision.contextId.reference.verse',
  ],
  'note.add': ['target.book', 'target.chapter', 'target.verse', 'target.decisionKey'],
  'resource.pin.set': ['slot'],
  'project.meta.set': ['path'],
  'settings.set': ['path'],
  'project.vrs.set': ['name', 'bytes'],
};
// The envelope is identity in full: every field of it is either a ts, an actor slug or a
// closed enum, so nothing in it is ever rewritten.
const ENVELOPE_IDENTITY = ['v', 'op', 'actor', 'ts', 'base', 'batch', 'generation', 'supersedes.*', 'seed.source', 'seed.batch'];

const matchesPattern = (segs, pattern) => {
  const pat = pattern.split('.');
  return pat.length === segs.length && pat.every((p, i) => p === '*' || p === segs[i]);
};
const isIdentityValue = (op, segs) =>
  ENVELOPE_IDENTITY.some((p) => matchesPattern(segs, p)) ||
  (IDENTITY_PATHS[op] || []).some((p) => matchesPattern(segs, p));

// Collect the values an identity pattern addresses ('*' = any own key or array index).
const valuesAt = (root, pattern) => {
  let cur = [root];
  for (const s of pattern.split('.')) {
    const next = [];
    for (const v of cur) {
      if (v == null || typeof v !== 'object') continue;
      if (s === '*') for (const k of Object.keys(v)) next.push(v[k]);
      else if (Object.hasOwn(v, s)) next.push(v[s]);
    }
    cur = next;
  }
  return cur;
};
const identityNfcError = (e) => {
  for (const p of IDENTITY_PATHS[e.op] || [])
    for (const v of valuesAt(e, p)) { const err = nfcError(v); if (err) return `${e.op} ${p} ${err}`; }
  return null;
};

// The I-4 transform, applied ONCE, at the seal (files.mjs). Own keys are copied as own
// keys — never by `out[k] = v`, which would swallow a `__proto__` field the schema is
// about to refuse.
export const normalizeEvent = (e) => {
  const walk = (v, segs, depth) => {
    if (depth > MAX_JSON_DEPTH) return v; // bounded like every other walk (§8.1)
    if (isStr(v)) return isIdentityValue(e && e.op, segs) ? v : toNfc(v);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...segs, String(i)], depth + 1));
    if (isObj(v)) {
      const out = {};
      for (const k of Object.keys(v))
        Object.defineProperty(out, k, { value: walk(v[k], [...segs, k], depth + 1), enumerable: true, writable: true, configurable: true });
      return out;
    }
    return v;
  };
  return isObj(e) ? walk(e, [], 0) : e;
};

// Validate ONE event: envelope (every field the fold dereferences has a shape rule —
// ts-shaped fields carry the EXACT §8.2 grammar, actor-slug charset included, so a
// ts can never smuggle a filesystem path), actor binding, generation stamp, per-op
// payload. Total over malformed input: a wrong-typed field is a clean rejection.
export const validateEvent = (e) => {
  if (!isObj(e)) return 'event is not an object (event-shape)';
  if (e.v !== 1) return `unknown envelope version v=${e.v}`;
  if (!OPS[e.op]) return `unrecognized op "${e.op}"`;
  // A sealed action is JSON TEXT. A value that does not survive JSON.stringify →
  // JSON.parse unchanged (NaN, Infinity, -0, an undefined array element) makes the
  // writer's own reader disagree with the writer — the round-8 asymmetry class.
  // ONE recursive rule, before any field-level check.
  const jr = jsonRoundTripError(e);
  if (jr) return `event does not survive a JSON round trip: ${jr}`;
  // I-4 (§8.5): every object KEY is identity, at every depth — refuse, never rewrite.
  const nk = nfcKeysError(e);
  if (nk) return `event carries a non-NFC key (I-4): ${nk}`;
  if (!isTs(e.ts)) return `event ts ${tsError(e.ts)}`;
  if (!isStr(e.actor)) return 'event without actor';
  if (e.ts.split('|')[2] !== e.actor)
    return `actor binding violated: event actor "${e.actor}" ≠ ts actor "${e.ts.split('|')[2]}"`;
  if (e.base !== undefined && e.base !== null && !isTs(e.base))
    return `event base "${e.base}" must be null or an §8.2 HLC ts`;
  // §8.3: `base` names the event whose state this op OBSERVED, so it happened BEFORE.
  // A forward-pointing base is causally impossible; it also defeats the ancestry cache
  // and reaches the fold as a RangeError on schema-valid input. Layer 1 closes it.
  if (isStr(e.base) && !(e.base < e.ts))
    return `event base "${e.base}" is not strictly earlier than its own ts "${e.ts}" — a base names an event this one observed (§8.3)`;
  if (e.supersedes !== undefined && (!Array.isArray(e.supersedes) || e.supersedes.some((s) => !isTs(s))))
    return 'event supersedes must be an array of §8.2 HLC ts';
  if (Array.isArray(e.supersedes) && e.supersedes.includes(e.ts))
    return 'event supersedes must not name the event\'s own ts — self-supersession is malformed (§8.3)';
  if (e.batch !== undefined && !isTs(e.batch))
    return `event batch "${e.batch}" must be an §8.2 HLC ts`;
  if (e.seed !== undefined) {
    if (!isObj(e.seed) || !SEED_SOURCES.has(e.seed.source))
      return 'event seed must be {source: creation|sidecar-migration|out-of-band-usfm|tc3-import, batch?}';
    if (e.seed.batch !== undefined && !isTs(e.seed.batch)) return 'seed.batch must be an §8.2 HLC ts';
  }
  if (GENERATION_OPS.has(e.op) && e.generation === undefined)
    return `${e.op} without a generation stamp — §8.5 requires every writer (seeding included) to stamp the book's generation root`;
  if (e.generation !== undefined && !isTs(e.generation))
    return `generation "${e.generation}" must be the rooting book.add's §8.2 HLC ts`;
  // I-4 (§8.5): the identity-bearing values are refused when they are not NFC — the one
  // class of value a writer may not silently rewrite.
  const nf = identityNfcError(e);
  if (nf) return `event carries a non-NFC identity value (I-4): ${nf}`;
  return OPS[e.op](e);
};

// Validate ONE action (§8.1 shape + every event's schema): non-empty, element shape,
// strictly ascending ts, one actor. Returns an error/reason string or null.
export const validateAction = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 'empty-events';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!isObj(e) || !isStr(e.ts)) return 'event-shape';
    if (i > 0 && !(e.ts > events[i - 1].ts)) return 'ts-order';
    if (e.actor !== events[0].actor) return 'multi-actor';
  }
  for (const e of events) {
    const err = validateEvent(e);
    if (err) return `event-schema: ${err}`;
  }
  return null;
};
