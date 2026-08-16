// Declarative event & action schema — BURRITO-SPEC §8.1/§8.3/§8.5 (the round-5
// simplification). ONE validator for the sealed-event vocabulary, applied identically
// by the writer (sealAction), by segment validation and intake (validateSegment), and
// by the fold — writer-symmetric by construction, total over malformed input (element
// nulls included). SHAPE lives here; semantic rules (liveness, chains, applicability,
// affected sets) stay in the fold.
import { slotKeysOf } from './skeleton.mjs';
import { isTs } from './hlc.mjs';

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => isStr(v) || typeof v === 'number'; // identity-key parts (chapter, verse, occurrence)

// ONE §5.1 alignment-record validator (round 7) — SHARED by align.verse.set events and
// structural replace post-states (§8.5). Every field the fold dereferences has a rule:
// chapter/verse build the register key, targetVerseMd5 carries I-3, alignments/wordBank
// are the record body.
const alignmentRecordError = (r) =>
  !isObj(r) ? 'is not an object'
  : !isScalar(r.chapter) || !isScalar(r.verse) ? 'chapter/verse must be a string or number'
  : !Array.isArray(r.alignments) ? 'without an alignments array'
  : !Array.isArray(r.wordBank) ? 'without a wordBank array'
  : !isStr(r.targetVerseMd5) ? 'without targetVerseMd5 (I-3)'
  : null;

// ONE §5.2 decision-record validator (round 7) — SHARED by check.decision.set events and
// structural replace post-states. Every field the fold dereferences has a rule:
// contextId.checkId + occurrence + reference.{bookId, chapter, verse} form the identity
// key; bookId also resolves the record's book (generation quarantine, affected sets).
const decisionRecordError = (d) => {
  if (!isObj(d)) return 'is not an object';
  const c = d.contextId;
  if (!isObj(c)) return 'without a contextId object';
  if (!isStr(c.checkId)) return 'contextId.checkId must be a string';
  if (!isScalar(c.occurrence)) return 'contextId.occurrence must be a string or number';
  const r = c.reference;
  if (!isObj(r)) return 'without a contextId.reference object';
  if (!isStr(r.bookId)) return 'contextId.reference.bookId must be a string';
  if (!isScalar(r.chapter) || !isScalar(r.verse)) return 'contextId.reference.chapter/verse must be a string or number';
  return null;
};
// §8.3 seed provenance enum
const SEED_SOURCES = new Set(['creation', 'sidecar-migration', 'out-of-band-usfm', 'tc3-import']);

// §8.5: derived/fixed metadata roots a project.meta.set may never target.
export const META_RESERVED_ROOTS = new Set(['format', 'ingredients', 'type', 'meta']);
// §8.5: the pin slot grammar is the §5.3 document's own paths — anything else refuses.
export const PIN_SLOT_RE = /^(languageSets\.(primary|fallback)\.(gatewayLanguage|translationNotes|translationWordsLinks|translationWords|translationAcademy)|resources\.(originalLanguage|lexicon)\.(nt|ot)|extraScripture\.[A-Za-z0-9_-]+)$/;

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
  if (d.action === 're-key') {
    if (!isStr(d.to)) return 're-key disposition without a destination (to)';
    if (d.surface !== 'note' && !newSlots.includes(d.to))
      return `re-key disposition destination "${d.to}" is not a target slot of the mapping`;
    if (d.surface === 'note' && !newSlots.includes(d.to) && !d.to.includes('|'))
      return `note re-key destination "${d.to}" is neither a target slot nor a §5.2 identity key`;
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
      const c = d.post.contextId; const r = c.reference;
      const identity = [c.checkId, r.bookId, r.chapter, r.verse, c.occurrence].map(String);
      const target = String(d.key).split('|').slice(1);
      if (JSON.stringify(identity) !== JSON.stringify(target))
        return `decision replace post identity [${identity.join('|')}] mismatches the disposition target "${d.key}"`;
    }
  }
  return null;
};

// Per-op payload validators (the §8.5 table, one row each). Return an error string or null.
const OPS = {
  'text.verse.set': (e) =>
    !isStr(e.book) ? 'text.verse.set without book'
    : !isScalar(e.chapter) || !isScalar(e.verse) ? 'text.verse.set chapter/verse must be a string or number'
    : !isStr(e.text) ? 'text.verse.set without text'
    : null,
  'text.skeleton.set': (e) =>
    !isStr(e.book) ? 'text.skeleton.set without book'
    : !isStr(e.skeleton) ? 'text.skeleton.set without skeleton'
    : null,
  'text.structure.apply': (e) => {
    if (!isStr(e.book)) return 'text.structure.apply without book';
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
        if (!isObj(src) || !isStr(src.key) || !isTs(src.ts))
          return `text.structure.apply transition "${dest}" carries a malformed source reference (key + §8.2 HLC ts required)`;
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
  'book.add': (e) =>
    !isStr(e.book) ? 'book.add without book'
    : !isStr(e.skeleton) ? 'book.add without a skeleton (§8.5 self-contained)'
    : !Array.isArray(e.scope) ? 'book.add without a scope array (§8.5)'
    : e.initialVerses !== undefined && !isObj(e.initialVerses) ? 'book.add initialVerses must be an object'
    : e.initialVerses !== undefined && Object.values(e.initialVerses).some((v) => !isStr(v))
      ? 'book.add initialVerses values must be strings (projected verse content)'
    : null,
  'book.remove': (e) => (!isStr(e.book) ? 'book.remove without book' : null),
  'align.verse.set': (e) => {
    if (!isStr(e.book)) return 'align.verse.set without book';
    const err = alignmentRecordError(e); // the SAME §5.1 validator replace post-states use
    return err ? `align.verse.set ${err} — must carry a complete §5.1 record` : null;
  },
  'check.decision.set': (e) => {
    if (!isStr(e.toolId)) return 'check.decision.set without toolId';
    const err = decisionRecordError(e.decision); // the SAME §5.2 validator replace post-states use
    return err ? `check.decision.set decision ${err} — must carry a complete §5.2 record` : null;
  },
  'note.add': (e) => {
    const tg = e.target;
    if (!isObj(tg)) return 'note.add target must be a {book, chapter, verse} or {decisionKey} object';
    const isVerse = tg.book != null && tg.chapter != null && tg.verse != null;
    const isDec = isStr(tg.decisionKey);
    if (isVerse === isDec) return 'note.add target must be exactly one of {book, chapter, verse} or {decisionKey}';
    if (isVerse && (!isStr(tg.book) || !isScalar(tg.chapter) || !isScalar(tg.verse)))
      return 'note.add verse target must carry {book: string, chapter/verse: string or number}';
    if (!isStr(e.text)) return 'note.add without text';
    return null;
  },
  'resource.pin.set': (e) =>
    !PIN_SLOT_RE.test(String(e.slot)) ? `resource.pin.set slot "${e.slot}" is not a §5.3 slot`
    : e.removed !== true && e.entry === undefined ? 'resource.pin.set without entry (or removed: true)'
    : null,
  'project.meta.set': (e) =>
    !isStr(e.path) ? 'project.meta.set without path'
    : META_RESERVED_ROOTS.has(e.path.split('.')[0]) ? `project.meta.set targets reserved root "${e.path}"`
    : e.removed !== true && e.value === undefined ? 'project.meta.set without value (or removed: true)'
    : null,
  'settings.set': (e) =>
    !isStr(e.path) ? 'settings.set without path'
    : e.removed !== true && e.value === undefined ? 'settings.set without value (or removed: true)'
    : null,
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
  if (!isTs(e.ts)) return `event ts "${e.ts}" is not an §8.2 HLC string (fixed-width ISO | 4-hex | [a-z0-9-]{4,32})`;
  if (!isStr(e.actor)) return 'event without actor';
  if (e.ts.split('|')[2] !== e.actor)
    return `actor binding violated: event actor "${e.actor}" ≠ ts actor "${e.ts.split('|')[2]}"`;
  if (e.base !== undefined && e.base !== null && !isTs(e.base))
    return `event base "${e.base}" must be null or an §8.2 HLC ts`;
  if (e.supersedes !== undefined && (!Array.isArray(e.supersedes) || e.supersedes.some((s) => !isTs(s))))
    return 'event supersedes must be an array of §8.2 HLC ts';
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
