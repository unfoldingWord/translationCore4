// Checkpoint projections — BURRITO-SPEC §8.7 reference implementation (spec 1.8).
// Every derived shared file is a deterministic function of the fold output; unjournaled
// ingredient classes (ingredients/audio/, §8.5) are never regenerated and never divergence.

const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';

// §5.3 resources.json from folded pins (§8.5 slot grammar). Key order is the §5.3
// document's own order; extraScripture keeps the order of each id's first pin event
// (the fold's pins object preserves first-set insertion order).
const LS_SLOTS = ['gatewayLanguage', 'translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
export const projectResources = (pins) => {
  const doc = { schemaVersion: 2 };
  const languageSets = {};
  for (const set of ['primary', 'fallback']) {
    const out = {};
    for (const slot of LS_SLOTS) {
      const v = pins[`languageSets.${set}.${slot}`];
      if (v !== undefined) out[slot] = v;
    }
    if (Object.keys(out).length) languageSets[set] = out;
  }
  if (Object.keys(languageSets).length) doc.languageSets = languageSets;
  const resources = {};
  for (const group of ['originalLanguage', 'lexicon']) {
    const out = {};
    for (const t of ['nt', 'ot']) {
      const v = pins[`resources.${group}.${t}`];
      if (v !== undefined) out[t] = v;
    }
    if (Object.keys(out).length) resources[group] = out;
  }
  if (Object.keys(resources).length) doc.resources = resources;
  const extra = [];
  for (const slot of Object.keys(pins)) // insertion order = first pin event order
    if (slot.startsWith('extraScripture.')) extra.push(pins[slot]);
  if (extra.length) doc.extraScripture = extra;
  return serialize(doc);
};

// §5.4 settings.json from folded dotted paths (removal already folded to absence).
export const projectSettings = (settings) => {
  const doc = { schemaVersion: 1 };
  for (const dotted of Object.keys(settings)) {
    let cur = doc;
    const parts = dotted.split('.');
    for (const p of parts.slice(0, -1)) cur = (cur[p] ||= {});
    cur[parts[parts.length - 1]] = settings[dotted];
  }
  return serialize(doc);
};

// §5.1 alignment sidecar mirror for one book.
export const projectAlignments = (foldOut, book) => {
  const chapters = {};
  const perBook = foldOut.alignments[book] || {};
  for (const vkey of Object.keys(perBook).sort()) {
    const [chapter, verse] = [vkey.slice(0, vkey.indexOf(':')), vkey.slice(vkey.indexOf(':') + 1)];
    ((chapters[chapter] ||= {})[verse]) = perBook[vkey];
  }
  return serialize({ schemaVersion: 1, book, chapters });
};

// §8.5: unjournaled ingredient classes — canonical on disk, outside the vocabulary.
export const isUnjournaledIngredient = (ipath) => ipath.startsWith('audio/');

// The §8.7 regeneration set: every journal-derived shared file, as {ipath: bytes}.
// Unjournaled classes are structurally absent — checkpoints cannot touch them.
export const derivedProjections = (foldOut) => {
  const out = {};
  for (const book of Object.keys(foldOut.books)) {
    out[`${book}.usfm`] = foldOut.books[book].usfm;
    if (foldOut.alignments[book]) out[`checking/alignments/${book}.json`] = projectAlignments(foldOut, book);
  }
  out['checking/resources.json'] = projectResources(foldOut.pins);
  out['checking/settings.json'] = projectSettings(foldOut.settings);
  if (foldOut.vrs) out['vrs.json'] = foldOut.vrs.bytes;
  return out;
};

// §8.8 divergence classification over EVERY derived shared file: a committed byte that
// differs from the projection is out-of-band (reconcile or stop — never silent overwrite);
// unjournaled ingredient classes are tolerated, never divergence.
export const classifyDivergence = (diskFiles, projections) => {
  const tolerated = [], diverged = [], clean = [];
  for (const ipath of Object.keys(diskFiles)) {
    if (isUnjournaledIngredient(ipath)) { tolerated.push(ipath); continue; }
    if (!(ipath in projections)) { diverged.push(ipath); continue; }
    (diskFiles[ipath] === projections[ipath] ? clean : diverged).push(ipath);
  }
  return { tolerated, diverged, clean };
};
