// Book decomposition: skeleton + verse slots — BURRITO-SPEC §8.4 reference implementation.
// Verse content = every byte after "\v <key> " up to the next "\v " or "\c " marker (or EOF).
// Skeleton = everything else, with each verse's content replaced by SLOT+key+SLOT.
// INVARIANT (J2): recompose(decompose(usfm)) is byte-identical to the input.

// The slot delimiter and the region-boundary marker are stated ONCE, in grammar.mjs —
// the codec scans for them here and the schema refuses them inside journaled verse
// content there, so the two can never disagree about where a content slot ends.
import { SLOT, VERSE_BOUNDARY_RE } from './grammar.mjs';
export { SLOT };

// The slot keys of a skeleton, in document order (shared by the fold and the schema).
export const slotKeysOf = (skeleton) =>
  [...skeleton.matchAll(new RegExp(`${SLOT}([^${SLOT}]+)${SLOT}`, 'g'))].map((m) => m[1]);

// Matches "\v <key> " where key is digits or a digit span like 4-5 (string keys, §5.2 rules).
// The marker (incl. the single following space) belongs to the skeleton.
const VERSE_MARKER = /\\v[ \t]+(\d+(?:-\d+)?)[ \t]/g;
const NEXT_BOUNDARY = new RegExp(VERSE_BOUNDARY_RE.source, 'g'); // next verse/chapter marker starts a new region

export const decompose = (usfm) => {
  if (usfm.includes(SLOT)) throw new Error('source contains reserved U+0001');
  let skeleton = '';
  const verses = {}; // "<chapter>:<verseKey>" -> content bytes
  let chapter = '0'; // front matter pseudo-chapter (no \c seen yet)
  let i = 0;
  while (i < usfm.length) {
    VERSE_MARKER.lastIndex = i;
    const vm = VERSE_MARKER.exec(usfm);
    // track chapters between here and the next verse marker (or EOF)
    const sliceEnd = vm ? vm.index : usfm.length;
    const between = usfm.slice(i, sliceEnd);
    for (const cm of between.matchAll(/\\c[ \t]+(\d+)/g)) chapter = cm[1];
    skeleton += between;
    if (!vm) break;
    // skeleton keeps the marker itself (incl. its trailing space)
    const markerEnd = VERSE_MARKER.lastIndex;
    const key = vm[1];
    skeleton += usfm.slice(vm.index, markerEnd);
    // verse content runs to the next \v or \c marker (or EOF)
    NEXT_BOUNDARY.lastIndex = markerEnd;
    const nb = NEXT_BOUNDARY.exec(usfm);
    const contentEnd = nb ? nb.index : usfm.length;
    const vkey = `${chapter}:${key}`;
    if (vkey in verses) throw new Error(`duplicate verse key ${vkey}`);
    verses[vkey] = usfm.slice(markerEnd, contentEnd);
    skeleton += SLOT + vkey + SLOT;
    i = contentEnd;
  }
  return { skeleton, verses };
};

export const recompose = (skeleton, verses) =>
  skeleton.replace(new RegExp(`${SLOT}([^${SLOT}]+)${SLOT}`, 'g'), (_, vkey) => {
    if (!(vkey in verses)) throw new Error(`no content for verse slot ${vkey}`);
    return verses[vkey];
  });
