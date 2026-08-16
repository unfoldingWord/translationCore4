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
  isStr, isObj, isTs, identityKeyOf, identityKeyError, identityPartError, decisionKeyError,
  bookIdError, bookIdLowerError, toolIdError, verseSlotError, scopeError, dottedPathError,
  pinSlotError, jsonSafeNumberError, jsonRoundTripError, META_RESERVED_ROOTS, PIN_SLOT_RE,
} from './grammar.mjs';

// Re-exported for importers that already read the identity-key pair from the schema.
export { identityKeyOf, identityKeyError, META_RESERVED_ROOTS, PIN_SLOT_RE };

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
const DISP_SURFACES = new Set(['alignment', 'decision', 'note']);
const DISP_ACTIONS = new Set(['re-key', 'replace', 'invalidate-retain', 'orphan-review']);
const dispositionError = (d, newSlots) => {
  if (!isObj(d)) return 'disposition is not an object';
  if (!DISP_SURFACES.has(d.surface)) return `disposition surface "${d && d.surface}" is not one of alignment|decision|note`;
  if (!DISP_ACTIONS.has(d.action)) return `disposition action "${d.action}" is not one of re-key|replace|invalidate-retain|orphan-review`;
  if (!isTs(d.ts)) return `disposition record reference "${d.ts}" is not an §8.2 HLC ts`;
  if ((d.surface === 'alignment' || d.surface === 'decision') && !isStr(d.key))
    return `disposition (${d.surface}) without a key`;
  if (d.surface === 'alignment') {
    // the key IS the alignment register key — the same §8.4 slot grammar everywhere
    const err = verseSlotError(d.key);
    if (err) return `disposition (alignment) key ${err}`;
  }
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
      const err = identityKeyError(d.to); // the same §5.2 grammar as every identity-key string
      if (err) return `note re-key destination "${d.to}" is neither a target slot nor a §5.2 identity key (${err})`;
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
    return !isStr(e.text) ? 'text.verse.set without text' : null;
  },
  'text.skeleton.set': (e) => {
    const b = bookIdError(e.book); if (b) return `text.skeleton.set book ${b}`;
    return !isStr(e.skeleton) ? 'text.skeleton.set without skeleton' : null;
  },
  'text.structure.apply': (e) => {
    const b = bookIdError(e.book); if (b) return `text.structure.apply book ${b}`;
    if (!isStr(e.skeleton)) return 'text.structure.apply without skeleton';
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
    if (!isStr(e.skeleton)) return 'book.add without a skeleton (§8.5 self-contained)';
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
      const err = identityKeyError(tg.decisionKey); // the ONE §5.2 identity-key grammar
      if (err) return `note.add decisionKey "${tg.decisionKey}" ${err}`;
    }
    if (!isStr(e.text)) return 'note.add without text';
    return null;
  },
  'resource.pin.set': (e) => {
    const s = pinSlotError(e.slot);
    if (s) return `resource.pin.set slot ${s}`;
    return e.removed !== true && e.entry === undefined ? 'resource.pin.set without entry (or removed: true)' : null;
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
    : null,
};

// §8.5: these ops MUST carry the causal `generation` stamp — unconditionally.
const GENERATION_OPS = new Set(['align.verse.set', 'check.decision.set', 'note.add']);

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
  if (!isTs(e.ts)) return `event ts "${e.ts}" is not an §8.2 HLC string (fixed-width ISO | 4-hex | [a-z0-9-]{4,32})`;
  if (!isStr(e.actor)) return 'event without actor';
  if (e.ts.split('|')[2] !== e.actor)
    return `actor binding violated: event actor "${e.actor}" ≠ ts actor "${e.ts.split('|')[2]}"`;
  if (e.base !== undefined && e.base !== null && !isTs(e.base))
    return `event base "${e.base}" must be null or an §8.2 HLC ts`;
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
