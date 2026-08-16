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

// §5.2 decision sidecar mirrors, one per (tool, book). The file-level `resource`
// resolution record is derive-time state (D30 — recomputed against the pins at
// checkpoint), not journal state: the caller passes it as `resolutions[tool][BOOK]`.
export const projectDecisions = (foldOut, resolutions = {}) => {
  const out = {};
  for (const tool of Object.keys(foldOut.decisions)) {
    const byBook = {};
    for (const d of foldOut.decisions[tool])
      (byBook[d.contextId.reference.bookId.toUpperCase()] ||= []).push(d);
    for (const book of Object.keys(byBook)) {
      const doc = { schemaVersion: 1, tool, book };
      const resource = resolutions?.[tool]?.[book];
      // §5.2/D30: the resolution record is REQUIRED derive-time state — a decision file
      // without `resource` is an incomplete checkpoint, never emitted silently.
      if (resource === undefined)
        throw new Error(`missing resolution record for (${tool}, ${book}) — §5.2 requires \`resource\` (D30); refuse to emit an incomplete checkpoint`);
      doc.resource = resource;
      doc.decisions = byBook[book];
      out[`checking/${tool}/${book}.json`] = serialize(doc);
    }
  }
  return out;
};

// metadata.json at checkpoint (§8.7): the base document (whose ingredients table the
// server rescan owns) + reconstructed type.flavorType.currentScope from folded scope
// state + the project.meta.set overlay (removals DELETE from the base).
export const projectMetadata = (foldOut, baseMetadata) => {
  const doc = JSON.parse(JSON.stringify(baseMetadata));
  const setPath = (obj, dotted, value) => {
    const parts = dotted.split('.');
    let cur = obj;
    for (const p of parts.slice(0, -1)) cur = (cur[p] ||= {});
    cur[parts[parts.length - 1]] = value;
  };
  const deletePath = (obj, dotted) => {
    const parts = dotted.split('.');
    let cur = obj;
    for (const p of parts.slice(0, -1)) { if (cur == null || typeof cur !== 'object') return; cur = cur[p]; }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  };
  setPath(doc, 'type.flavorType.currentScope', foldOut.scope);
  for (const [dotted, value] of Object.entries(foldOut.projectMeta)) setPath(doc, dotted, value);
  for (const dotted of foldOut.projectMetaRemoved || []) deletePath(doc, dotted);
  return serialize(doc);
};

// §8.5: unjournaled ingredient classes — canonical on disk, outside the vocabulary.
export const isUnjournaledIngredient = (ipath) => ipath.startsWith('audio/');

// The §8.7 regeneration set: EVERY journal-derived shared file, as {ipath: bytes} —
// USFM per book, alignment + decision sidecar mirrors, resources.json, settings.json,
// vrs.json, and metadata.json. The set is EXHAUSTIVE, so its inputs are MANDATORY:
// a missing baseMetadata (or a missing per-(tool, book) resolution — see
// projectDecisions) THROWS. An incomplete checkpoint is never returned (§8.7).
// Unjournaled classes are structurally absent — checkpoints cannot touch them.
export const derivedProjections = (foldOut, { baseMetadata = null, resolutions = {} } = {}) => {
  if (!baseMetadata)
    throw new Error('derivedProjections requires baseMetadata — the checkpoint regenerates metadata.json (§8.7); refuse to return an incomplete checkpoint');
  const out = {};
  for (const book of Object.keys(foldOut.books)) {
    out[`${book}.usfm`] = foldOut.books[book].usfm;
    if (foldOut.alignments[book]) out[`checking/alignments/${book}.json`] = projectAlignments(foldOut, book);
  }
  Object.assign(out, projectDecisions(foldOut, resolutions));
  out['checking/resources.json'] = projectResources(foldOut.pins);
  out['checking/settings.json'] = projectSettings(foldOut.settings);
  if (foldOut.vrs) out['vrs.json'] = foldOut.vrs.bytes;
  out['metadata.json'] = projectMetadata(foldOut, baseMetadata);
  return out;
};

// §8.8 divergence classification over EVERY derived shared file. Enumeration starts
// from the fold's expected set, not from what happens to be on disk: a projected file
// that is ABSENT on disk (deleted out-of-band) is divergence too. A committed byte that
// differs from the projection is out-of-band (reconcile or stop — never silent
// overwrite); unjournaled ingredient classes are tolerated, never divergence.
export const classifyDivergence = (diskFiles, projections) => {
  const tolerated = [], diverged = [], clean = [];
  for (const ipath of new Set([...Object.keys(projections), ...Object.keys(diskFiles)])) {
    if (isUnjournaledIngredient(ipath)) { tolerated.push(ipath); continue; }
    if (!(ipath in projections) || !(ipath in diskFiles)) { diverged.push(ipath); continue; }
    (diskFiles[ipath] === projections[ipath] ? clean : diverged).push(ipath);
  }
  return { tolerated, diverged, clean };
};
