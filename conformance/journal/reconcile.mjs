// Reconcile & seeding — BURRITO-SPEC §8.8 reference implementation.
import { decompose } from './skeleton.mjs';
import { makeClock } from './hlc.mjs';

// Out-of-band edit: committed file differs from the fold projection.
// Emit seeded linear-supersede events (base = current live head ts per key).
export const reconcileUsfm = (book, committedUsfm, foldOut, clock, actor) => {
  const { skeleton, verses } = decompose(committedUsfm);
  const projected = foldOut.books[book];
  const events = [];
  const batch = clock.issue();
  const seed = { source: 'out-of-band-usfm', batch };
  if (!projected || decompose(projected.usfm).skeleton !== skeleton) {
    events.push({ v: 1, op: 'text.skeleton.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`skel|${book}`] ?? null, seed, book, skeleton, skeletonMd5: null });
  }
  for (const [vkey, text] of Object.entries(verses)) {
    if (projected && projected.verses[vkey] === text) continue;
    const [chapter, verse] = vkey.split(':');
    events.push({ v: 1, op: 'text.verse.set', actor, ts: clock.issue(),
      base: foldOut.headsTs[`text|${book}|${vkey}`] ?? null, seed,
      book, chapter, verse, text, textMd5: null });
  }
  return events;
};

// Phase-1 migration: sidecar records -> seeded events (§8.8).
// modifiedTimestamp maps into the ts physical part; HLC counter breaks ties.
export const seedFromSidecars = ({ actor, books, decisionFiles, alignmentFiles }) => {
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
  const seed = { source: 'sidecar-migration', batch: issueAt(null) };

  for (const [book, usfm] of Object.entries(books)) {
    events.push({ v: 1, op: 'book.add', actor, ts: issueAt(null), base: null, seed, book });
    const { skeleton, verses } = decompose(usfm);
    events.push({ v: 1, op: 'text.skeleton.set', actor, ts: issueAt(null), base: null, seed, book, skeleton, skeletonMd5: null });
    for (const [vkey, text] of Object.entries(verses)) {
      const [chapter, verse] = vkey.split(':');
      events.push({ v: 1, op: 'text.verse.set', actor, ts: issueAt(null), base: null, seed, book, chapter, verse, text, textMd5: null });
    }
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
        events.push({ v: 1, op: 'align.verse.set', actor, ts: issueAt(null), base: null, seed,
          book, chapter, verse, alignments: rec.alignments, wordBank: rec.wordBank, targetVerseMd5: rec.targetVerseMd5 });
      }
    }
  }
  return events;
};
