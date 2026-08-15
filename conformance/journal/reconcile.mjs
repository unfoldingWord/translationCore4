// Reconcile & seeding — BURRITO-SPEC §8.8 reference implementation (spec 1.8).
import { decompose } from './skeleton.mjs';
import { slotKeysOf } from './fold.mjs';
import { makeClock } from './hlc.mjs';

// Out-of-band edit: committed file differs from the fold projection.
// Slot set unchanged → linear-supersede text.*.set seed events.
// Slot set changed → ONE self-contained text.structure.apply (§8.5): the on-disk USFM
// supplies every destination text; the mapping is the conservative identity-where-possible
// one; everything unmappable gets invalidate-retain/orphan-review, never a guessed re-key.
export const reconcileUsfm = (book, committedUsfm, foldOut, clock, actor) => {
  const { skeleton, verses } = decompose(committedUsfm);
  const projected = foldOut.books[book];
  const events = [];
  const batch = clock.issue();
  const seed = { source: 'out-of-band-usfm', batch };
  const oldSkeleton = projected ? decompose(projected.usfm).skeleton : null;
  const oldSlots = oldSkeleton ? slotKeysOf(oldSkeleton) : [];
  const newSlots = slotKeysOf(skeleton);
  const slotsChanged = JSON.stringify(oldSlots) !== JSON.stringify(newSlots);

  if (slotsChanged) {
    const transitions = {};
    for (const k of newSlots) {
      const sources = [];
      const headTs = foldOut.headsTs[`text|${book}|${k}`];
      if (oldSlots.includes(k) && headTs) sources.push({ key: k, ts: headTs }); // identity where possible
      transitions[k] = { text: verses[k], sources };
    }
    // COMPLETE conservative dispositions: every live alignment, decision, and
    // verse-targeted note on a removed key — invalidate-retain/orphan-review only,
    // never a guessed re-key (§8.8; #65 v2).
    const dispositions = [];
    for (const k of oldSlots) {
      if (newSlots.includes(k)) continue; // removed slot — conservative handling only
      const alignTs = foldOut.headsTs[`align|${book}|${k}`];
      if (alignTs) dispositions.push({ surface: 'alignment', key: k, ts: alignTs, action: 'orphan-review' });
      for (const dk of Object.keys(foldOut.headsTs)) {
        if (!dk.startsWith('dec|')) continue;
        const parts = dk.split('|'); // dec|tool|checkId|bookId|chapter|verse|occurrence
        if (parts[3] !== book.toLowerCase() || `${parts[4]}:${parts[5]}` !== k) continue;
        dispositions.push({ surface: 'decision', key: dk.slice(4), ts: foldOut.headsTs[dk], action: 'invalidate-retain' });
      }
      for (const n of foldOut.notes) {
        const tg = n.target;
        if (tg && tg.book === book && `${tg.chapter}:${tg.verse}` === k)
          dispositions.push({ surface: 'note', ts: n.ts, action: 'orphan-review' });
      }
    }
    events.push({ v: 1, op: 'text.structure.apply', actor, ts: clock.issue(),
      base: foldOut.headsTs[`skel|${book}`] ?? null, seed, book, skeleton, transitions, dispositions });
    return events;
  }

  if (!projected || decompose(projected.usfm).skeleton !== skeleton) {
    events.push({ v: 1, op: 'text.skeleton.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`skel|${book}`] ?? null, seed, book, skeleton });
  }
  for (const [vkey, text] of Object.entries(verses)) {
    if (projected && projected.verses[vkey] === text) continue;
    const [chapter, verse] = vkey.split(':');
    events.push({ v: 1, op: 'text.verse.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`text|${book}|${vkey}`] ?? null, seed,
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
  for (const [book, entry] of Object.entries(books)) {
    const { usfm, scope } = typeof entry === 'string' ? { usfm: entry, scope: [] } : entry;
    const { skeleton, verses } = decompose(usfm);
    events.push({ v: 1, op: 'book.add', actor, ts: issueAt(null), base: null, seed,
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
  for (const [toolId, file] of Object.entries(decisionFiles)) {
    for (const decision of file.decisions) {
      events.push({ v: 1, op: 'check.decision.set', actor, ts: issueAt(decision.modifiedTimestamp),
        base: null, seed, toolId, decision });
    }
  }
  for (const [book, file] of Object.entries(alignmentFiles)) {
    for (const [chapter, verses] of Object.entries(file.chapters)) {
      for (const [verse, rec] of Object.entries(verses)) {
        // spread the COMPLETE §5.1 record — sourceVersion, invalid, and any future
        // additive-optional field ride through the journal unchanged
        events.push({ v: 1, op: 'align.verse.set', actor, ts: issueAt(null), base: null, seed,
          book, chapter, verse, ...rec });
      }
    }
  }
  return events;
};
