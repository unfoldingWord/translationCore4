// Reconcile & seeding — BURRITO-SPEC §8.8 reference implementation (spec 1.8).
import { decompose } from './skeleton.mjs';
import { slotKeysOf } from './fold.mjs';
import { makeClock } from './hlc.mjs';
import { splitDecisionKey } from './grammar.mjs';

// Out-of-band edit: committed file differs from the fold projection.
// Slot set unchanged → linear-supersede text.*.set seed events.
// Slot set changed → ONE self-contained text.structure.apply (§8.5): the on-disk USFM
// supplies every destination text; the mapping is the conservative identity-where-possible
// one; everything unmappable gets invalidate-retain/orphan-review, never a guessed re-key.
// `opts.seed`: the §8.3 seed marker to stamp. Defaults to the §8.8 out-of-band
// marker (this function's original single caller). Issue #62's EXPLICIT structural
// edit op builds the same conservative event from user-supplied USFM — same
// transitions, same complete dispositions — but it is an in-app action, not
// migrated/imported data, so it passes `seed: null` to omit the marker. One
// builder for both, so the app cannot drift from the reference (§8.8 discipline).
export const reconcileUsfm = (book, committedUsfm, foldOut, clock, actor, opts = {}) => {
  const { skeleton, verses } = decompose(committedUsfm);
  const projected = foldOut.books[book];
  const events = [];
  const batch = clock.issue();
  // Spread-props, never `seed: undefined` — an own key holding undefined does not
  // survive a JSON round trip and the schema refuses such an event.
  const seedProps =
    opts.seed === undefined
      ? { seed: { source: 'out-of-band-usfm', batch } }
      : opts.seed
        ? { seed: opts.seed }
        : {};
  const oldSkeleton = projected ? decompose(projected.usfm).skeleton : null;
  const oldSlots = oldSkeleton ? slotKeysOf(oldSkeleton) : [];
  const newSlots = slotKeysOf(skeleton);
  const slotsChanged = JSON.stringify(oldSlots) !== JSON.stringify(newSlots);

  // A committed book the journal does not project is not a structural EDIT, it is a book
  // that has to come into being: §8.8 seeding says state without a journal becomes seed
  // events. Emitting `text.structure.apply` for it would be a rootless structural event,
  // which §8.5 refuses — `book.add` is the only rootless structural op, and a re-add after
  // a `book.remove` chains to that removal.
  if (!projected) {
    events.push({ v: 1, op: 'book.add', actor, ts: clock.issue(),
      base: foldOut.headsTs[`book|${book}`] ?? null, ...seedProps, book, scope: [], skeleton, initialVerses: verses });
    return events;
  }

  if (slotsChanged) {
    const transitions = {};
    for (const k of newSlots) {
      const sources = [];
      const headTs = foldOut.headsTs[`text|${book}|${k}`];
      if (oldSlots.includes(k) && headTs) sources.push({ key: k, ts: headTs }); // identity where possible
      transitions[k] = { text: verses[k], sources };
    }
    // COMPLETE conservative dispositions: every LIVE text, alignment, decision and
    // verse-targeted note record on a removed key — invalidate-retain/orphan-review only,
    // never a guessed re-key (§8.8; #65 v2).
    //
    // ROUND 9 (D-F3): built from the fold's LIVE HEAD sets, not from its PROJECTED
    // records. The fold computes its affected set from live heads — which include
    // quarantined (prior-generation) and losing-fork heads — so a reconcile that
    // enumerated `headsTs`/`notes`/`decisions` (the projection) systematically emitted an
    // INCOMPLETE event, which the fold then refused as `incomplete` FOREVER: an
    // out-of-band USFM edit of such a book could never be journaled at all. One set, read
    // by both sides.
    const dispositions = [];
    const liveOn = (key) => foldOut.liveHeads?.[key] || [];
    const claimed = new Set();
    for (const k of newSlots) for (const s of transitions[k].sources) claimed.add(`${s.key}|${s.ts}`);
    for (const k of oldSlots) {
      if (newSlots.includes(k)) continue; // removed slot — conservative handling only
      for (const h of liveOn(`text|${book}|${k}`))
        if (!claimed.has(`${k}|${h.ts}`)) dispositions.push({ surface: 'text', key: k, ts: h.ts, action: 'orphan-review' });
      for (const h of liveOn(`align|${book}|${k}`))
        dispositions.push({ surface: 'alignment', key: k, ts: h.ts, action: 'orphan-review' });
      for (const dk of Object.keys(foldOut.liveHeads || {})) {
        if (!dk.startsWith('dec|')) continue;
        // decompose with the ONE §5.2 key splitter (grammar.mjs) — never by index
        const { bookId, chapter, verse } = splitDecisionKey(dk.slice(4));
        if (bookId !== book.toLowerCase() || `${chapter}:${verse}` !== k) continue;
        for (const h of liveOn(dk))
          dispositions.push({ surface: 'decision', key: dk.slice(4), ts: h.ts, action: 'invalidate-retain' });
      }
      for (const n of foldOut.liveNotes || []) {
        const tg = n.target;
        if (tg && tg.book === book && `${tg.chapter}:${tg.verse}` === k)
          dispositions.push({ surface: 'note', ts: n.ts, action: 'orphan-review' });
      }
    }
    events.push({ v: 1, op: 'text.structure.apply', actor, ts: clock.issue(),
      base: foldOut.headsTs[`skel|${book}`] ?? null, ...seedProps, book, skeleton, transitions, dispositions });
    return events;
  }

  if (decompose(projected.usfm).skeleton !== skeleton) {
    events.push({ v: 1, op: 'text.skeleton.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`skel|${book}`], ...seedProps, book, skeleton });
  }
  for (const [vkey, text] of Object.entries(verses)) {
    if (projected.verses[vkey] === text) continue;
    const [chapter, verse] = vkey.split(':');
    // NEVER rootless (§8.5): a slot's verse head exists from the `book.add` that created
    // the slot, so `base: null` here would be a writer defect the fold retains and never
    // projects. A slot that projects the `___` stub has no live verse head of its own —
    // its observed state is the SKELETON head, which is what this write actually saw.
    events.push({ v: 1, op: 'text.verse.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`text|${book}|${vkey}`] ?? foldOut.headsTs[`skel|${book}`], ...seedProps,
      book, chapter, verse, text });
  }
  return events;
};

// Seeding is universal (§8.8/D50): state without a journal becomes seed events, and it
// covers EVERY surface a real project holds — books with their ACTUAL per-book scope,
// text, complete §5.1 alignment records (sourceVersion, invalid, …), decisions, resource
// pins, settings, project metadata, and versification.
// source: 'creation' for the creation segment, 'sidecar-migration' for Phase-1 migration.
// book.add is self-contained (§8.5): one event carries scope + skeleton + initialVerses.
// `books` values are `{usfm, scope}` (a bare USFM string means whole-book scope `[]`).
export const seedFromSidecars = ({ actor, books = {}, decisionFiles = {}, alignmentFiles = {}, resources = null, settings = null, meta = null, vrs = null, source = 'sidecar-migration' }) => {
  const events = [];
  let seedPhysical = Date.parse('2020-01-01T00:00:00.000Z');
  const clock = makeClock(actor, () => seedPhysical);
  const issueAt = (isoOrNull) => {
    if (isoOrNull) {
      const t = Date.parse(isoOrNull);
      if (Number.isFinite(t)) seedPhysical = Math.max(seedPhysical, t);
    }
    return clock.issue();
  };
  const seed = { source, batch: issueAt(null) };

  if (vrs) events.push({ v: 1, op: 'project.vrs.set', actor, ts: issueAt(null), base: null, seed,
    name: vrs.name, bytes: vrs.bytes });
  const generationOf = {}; // book -> the seed's own book.add ts (§8.5 generation root)
  for (const [book, entry] of Object.entries(books)) {
    const { usfm, scope } = typeof entry === 'string' ? { usfm: entry, scope: [] } : entry;
    const { skeleton, verses } = decompose(usfm);
    const ts = issueAt(null);
    generationOf[book] = ts;
    events.push({ v: 1, op: 'book.add', actor, ts, base: null, seed,
      book, scope, skeleton, initialVerses: verses });
  }
  if (resources) {
    for (const set of Object.keys(resources.languageSets || {}))
      for (const slot of Object.keys(resources.languageSets[set]))
        events.push({ v: 1, op: 'resource.pin.set', actor, ts: issueAt(null), base: null, seed,
          slot: `languageSets.${set}.${slot}`, entry: resources.languageSets[set][slot] });
    for (const group of Object.keys(resources.resources || {}))
      for (const tk of Object.keys(resources.resources[group]))
        events.push({ v: 1, op: 'resource.pin.set', actor, ts: issueAt(null), base: null, seed,
          slot: `resources.${group}.${tk}`, entry: resources.resources[group][tk] });
    for (const extra of resources.extraScripture || [])
      events.push({ v: 1, op: 'resource.pin.set', actor, ts: issueAt(null), base: null, seed,
        slot: `extraScripture.${extra.id}`, entry: extra });
  }
  if (settings) {
    for (const key of Object.keys(settings)) {
      if (key === 'schemaVersion') continue; // the projection supplies it (§5.4)
      events.push({ v: 1, op: 'settings.set', actor, ts: issueAt(null), base: null, seed,
        path: key, value: settings[key] });
    }
  }
  if (meta) {
    for (const [path, value] of Object.entries(meta))
      events.push({ v: 1, op: 'project.meta.set', actor, ts: issueAt(null), base: null, seed, path, value });
  }
  // seeded records stamp `generation` = the seed's own book.add ts (§8.5/§8.8)
  for (const [toolId, file] of Object.entries(decisionFiles)) {
    for (const decision of file.decisions) {
      const book = String(decision.contextId.reference.bookId).toUpperCase();
      events.push({ v: 1, op: 'check.decision.set', actor, ts: issueAt(decision.modifiedTimestamp),
        base: null, seed, toolId, generation: generationOf[book], decision });
    }
  }
  for (const [book, file] of Object.entries(alignmentFiles)) {
    for (const [chapter, verses] of Object.entries(file.chapters)) {
      for (const [verse, rec] of Object.entries(verses)) {
        // spread the COMPLETE §5.1 record — sourceVersion, invalid, and any future
        // additive-optional field ride through the journal unchanged
        events.push({ v: 1, op: 'align.verse.set', actor, ts: issueAt(null), base: null, seed,
          book, chapter, verse, generation: generationOf[book], ...rec });
      }
    }
  }
  return events;
};
