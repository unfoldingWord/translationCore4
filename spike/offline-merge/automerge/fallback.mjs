import { decompose, recompose } from '../../../conformance/journal/skeleton.mjs';
import { sha256 } from './model.mjs';

// Disaster recovery, not journal reconstruction. It conserves both source files and
// produces a new USFM baseline; checking provenance is deliberately carried separately.
export const mergeUsfmFallback = ({ base, left, right, leftLabel = 'left', rightLabel = 'right' }) => {
  const sourceHashes = { base: sha256(base), [leftLabel]: sha256(left), [rightLabel]: sha256(right) };
  const b = decompose(base); const l = decompose(left); const r = decompose(right);
  if (l.skeleton !== b.skeleton || r.skeleton !== b.skeleton) {
    return { status: 'structure-conflict', sourceHashes, sources: { base, [leftLabel]: left, [rightLabel]: right } };
  }
  const verses = {}; const conflicts = [];
  for (const key of new Set([...Object.keys(b.verses), ...Object.keys(l.verses), ...Object.keys(r.verses)])) {
    const bv = b.verses[key]; const lv = l.verses[key]; const rv = r.verses[key];
    if (lv === rv) verses[key] = lv;
    else if (lv === bv) verses[key] = rv;
    else if (rv === bv) verses[key] = lv;
    else {
      verses[key] = bv;
      conflicts.push({ key, base: bv, [leftLabel]: lv, [rightLabel]: rv });
    }
  }
  return {
    status: conflicts.length ? 'content-conflicts' : 'merged',
    sourceHashes,
    usfm: recompose(b.skeleton, verses),
    conflicts,
    // This record is intentionally not guessed from an unmergeable journal.
    manualCarryForward: [],
  };
};
