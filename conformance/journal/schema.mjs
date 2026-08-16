// Declarative event & action schema — BURRITO-SPEC §8.1/§8.3/§8.5 (the round-5
// simplification). ONE validator for the sealed-event vocabulary, applied identically
// by the writer (sealAction), by segment validation and intake (validateSegment), and
// by the fold — writer-symmetric by construction, total over malformed input (element
// nulls included). SHAPE lives here; semantic rules (liveness, chains, applicability,
// affected sets) stay in the fold.
import { slotKeysOf } from './skeleton.mjs';

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

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
  if (!isStr(d.ts)) return 'disposition without a record ts';
  if ((d.surface === 'alignment' || d.surface === 'decision') && !isStr(d.key))
    return `disposition (${d.surface}) without a key`;
  if (d.action === 're-key') {
    if (!isStr(d.to)) return 're-key disposition without a destination (to)';
    if (d.surface !== 'note' && !newSlots.includes(d.to))
      return `re-key disposition destination "${d.to}" is not a target slot of the mapping`;
    if (d.surface === 'note' && !newSlots.includes(d.to) && !d.to.includes('|'))
      return `note re-key destination "${d.to}" is neither a target slot nor a §5.2 identity key`;
  }
  if (d.action === 'replace' && !isObj(d.post))
    return 'replace disposition without the complete post-state (post)';
  return null;
};

// Per-op payload validators (the §8.5 table, one row each). Return an error string or null.
const OPS = {
  'text.verse.set': (e) =>
    !isStr(e.book) ? 'text.verse.set without book'
    : e.chapter == null || e.verse == null ? 'text.verse.set without chapter/verse'
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
        if (!isObj(src) || !isStr(src.key) || !isStr(src.ts))
          return `text.structure.apply transition "${dest}" carries a malformed source reference`;
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
    : null,
  'book.remove': (e) => (!isStr(e.book) ? 'book.remove without book' : null),
  'align.verse.set': (e) =>
    !isStr(e.book) ? 'align.verse.set without book'
    : e.chapter == null || e.verse == null ? 'align.verse.set without chapter/verse'
    : !Array.isArray(e.alignments) ? 'align.verse.set without an alignments array'
    : !Array.isArray(e.wordBank) ? 'align.verse.set without a wordBank array'
    : !isStr(e.targetVerseMd5) ? 'align.verse.set without targetVerseMd5 (I-3)'
    : null,
  'check.decision.set': (e) =>
    !isStr(e.toolId) ? 'check.decision.set without toolId'
    : !isObj(e.decision) || !isObj(e.decision.contextId) ? 'check.decision.set without a §5.2 decision record'
    : null,
  'note.add': (e) => {
    const tg = e.target;
    if (!isObj(tg)) return 'note.add target must be a {book, chapter, verse} or {decisionKey} object';
    const isVerse = tg.book != null && tg.chapter != null && tg.verse != null;
    const isDec = isStr(tg.decisionKey);
    if (isVerse === isDec) return 'note.add target must be exactly one of {book, chapter, verse} or {decisionKey}';
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

// Validate ONE event: envelope, actor binding, generation stamp, per-op payload.
export const validateEvent = (e) => {
  if (!isObj(e)) return 'event is not an object (event-shape)';
  if (e.v !== 1) return `unknown envelope version v=${e.v}`;
  if (!OPS[e.op]) return `unrecognized op "${e.op}"`;
  if (!isStr(e.ts) || e.ts.split('|').length !== 3) return `event ts "${e.ts}" is not an HLC string (§8.2)`;
  if (!isStr(e.actor)) return 'event without actor';
  if (e.ts.split('|')[2] !== e.actor)
    return `actor binding violated: event actor "${e.actor}" ≠ ts actor "${e.ts.split('|')[2]}"`;
  if (GENERATION_OPS.has(e.op) && e.generation === undefined)
    return `${e.op} without a generation stamp — §8.5 requires every writer (seeding included) to stamp the book's generation root`;
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
