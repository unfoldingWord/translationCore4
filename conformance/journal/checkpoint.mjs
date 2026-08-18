// Checkpoint projections — BURRITO-SPEC §8.7 reference implementation (spec 1.8).
// Every derived shared file is a deterministic function of the fold output; unjournaled
// ingredient classes (ingredients/audio/, §8.5) are never regenerated and never divergence.
//
// LAYER 2 of the round-8 hardening (defense in depth — the round-6 traversal-guard
// pattern, generalized). The schema's value grammars (grammar.mjs) already refuse a
// malformed book code or dotted path at seal AND at fold. This module refuses them
// AGAIN, independently, at the two structural positions they would reach:
//   • EVERY projection key is resolved against the destination root and refused if it
//     escapes — books, decision sidecars, everything. The fold's keys are never trusted.
//   • EVERY dotted-path setter traverses with own-property checks into null-prototype
//     containers, so a malformed path cannot reach a prototype even with validation off.
import path from 'path';
import { ipathError, dottedPathError, MAX_JSON_DEPTH } from './grammar.mjs';

const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';

// §8.7/§2: the destination root of every projected file. A projection key is an ipath
// (the part under `ingredients/`), so it MUST resolve strictly inside that root and MUST
// satisfy the §2 ingredient-path constraints. This holds independent of the schema.
const PROJECTION_ROOT = '/ingredients';
export const projectionKey = (ipath) => {
  const err = ipathError(ipath);
  if (err) throw new Error(`projection key ${err} — refuse to project (§2/§8.7)`);
  const resolved = path.posix.resolve(PROJECTION_ROOT, ipath);
  if (!resolved.startsWith(`${PROJECTION_ROOT}/`) || resolved.slice(PROJECTION_ROOT.length + 1) !== ipath)
    throw new Error(`projection key "${ipath}" does not resolve strictly inside the checkpoint destination root — refuse to project (§8.7)`);
  return ipath;
};
// Assign under a guarded key. Every write into a projection set goes through this.
// The set is documented as EXHAUSTIVE, so it is built in a null-prototype container: an
// ordinary `{}` runs the prototype setter for a `__proto__` key and DROPS the entry
// silently — an "exhaustive" set that quietly lost a member. `derivedProjections` and
// `projectDecisions` both start their sets with `emptySet()` for the same reason.
export const emptySet = () => Object.create(null);
const emit = (out, ipath, bytes) => { out[projectionKey(ipath)] = bytes; };

// A null-prototype deep copy: the projected document has NO prototype to pollute, at any
// depth. JSON.stringify serializes null-prototype objects exactly like ordinary ones.
// The depth bound is layer 2 of the §8.1 depth rule: the schema already refuses a value
// nested deeper than MAX_JSON_DEPTH, and this walk refuses it AGAIN so a checkpoint can
// never be crashed by a document that reached it with validation off.
const nullProto = (v, depth = 0) => {
  if (depth > MAX_JSON_DEPTH)
    throw new Error(`projected value nests deeper than the §8.1 limit of ${MAX_JSON_DEPTH} levels — refuse to project`);
  if (Array.isArray(v)) return v.map((x) => nullProto(x, depth + 1));
  if (v == null || typeof v !== 'object') return v;
  const out = Object.create(null);
  for (const k of Object.keys(v)) out[k] = nullProto(v[k], depth + 1);
  return out;
};
const owns = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ONE dotted-path setter/deleter pair for every projected document (§5.4 settings.json,
// §8.7 metadata.json overlay). The path grammar is re-checked here — a caller that
// skipped the schema still cannot reach a prototype — and every container the traversal
// creates or descends is own-property checked.
const pathParts = (dotted) => {
  const err = dottedPathError(dotted);
  if (err) throw new Error(`projected path ${err} — refuse to project (§8.5/§8.7)`);
  return dotted.split('.');
};
const setDeep = (doc, dotted, value) => {
  const parts = pathParts(dotted);
  let cur = doc;
  for (const p of parts.slice(0, -1)) {
    if (!owns(cur, p) || cur[p] == null || typeof cur[p] !== 'object') cur[p] = Object.create(null);
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
};
const deleteDeep = (doc, dotted) => {
  const parts = pathParts(dotted);
  let cur = doc;
  for (const p of parts.slice(0, -1)) {
    if (!owns(cur, p) || cur[p] == null || typeof cur[p] !== 'object') return;
    cur = cur[p];
  }
  delete cur[parts[parts.length - 1]];
};

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
  // §5.3/D17: `languageSets` MUST contain exactly the keys `primary` and `fallback`. A
  // PARTIAL pin state (one set pinned, the other not yet) used to project a document that
  // violates that rule and ship it as a valid checkpoint. §8.7 says an implementation MUST
  // refuse rather than emit an incomplete derived set — so it refuses here.
  const setNames = Object.keys(languageSets);
  if (setNames.length === 1)
    throw new Error(`checking/resources.json would carry only the "${setNames[0]}" language set — §5.3 (D17) requires exactly primary AND fallback; refuse to project an incomplete checkpoint (§8.7)`);
  if (setNames.length) doc.languageSets = languageSets;
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
  const doc = Object.create(null);
  doc.schemaVersion = 1;
  for (const dotted of Object.keys(settings)) setDeep(doc, dotted, nullProto(settings[dotted]));
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
  const out = emptySet();
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
      // the (tool, book) pair comes from folded records — resolve it, never trust it
      emit(out, `checking/${tool}/${book}.json`, serialize(doc));
    }
  }
  return out;
};

// metadata.json at checkpoint (§8.7): the base document (whose ingredients table the
// server rescan owns) + reconstructed type.flavorType.currentScope from folded scope
// state + the project.meta.set overlay (removals DELETE from the base).
export const projectMetadata = (foldOut, baseMetadata) => {
  // the base document is copied into null-prototype containers, so the overlay below
  // has no prototype to reach even if a path grammar were bypassed upstream
  const doc = nullProto(JSON.parse(JSON.stringify(baseMetadata)));
  setDeep(doc, 'type.flavorType.currentScope', nullProto(foldOut.scope));
  for (const [dotted, value] of Object.entries(foldOut.projectMeta)) setDeep(doc, dotted, nullProto(value));
  for (const dotted of foldOut.projectMetaRemoved || []) deleteDeep(doc, dotted);
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
  // The versification frame is a MANDATORY input too, for any project that has a book.
  // §4.3: the platform writes `vrs.json` at creation and `maxVerses` MUST cover every book
  // in `currentScope`; §8.8 seeding covers versification. It was the one member of the
  // "exhaustive" set emitted CONDITIONALLY, with no guard — so a journal with no
  // `project.vrs.set` shipped a silently smaller checkpoint, and divergence detection
  // (which enumerates from this set) never mentioned the missing file.
  if (!foldOut.vrs && Object.keys(foldOut.books).length)
    throw new Error('derivedProjections requires a folded project.vrs.set frame once the project has a book — the checkpoint projects ingredients/vrs.json (§4.3/§8.7); refuse to return an incomplete checkpoint');
  const out = emptySet();
  for (const book of Object.keys(foldOut.books)) {
    // the book code is a FOLD key flowing into a filesystem path — resolved, never trusted
    emit(out, `${book}.usfm`, foldOut.books[book].usfm);
    if (foldOut.alignments[book]) emit(out, `checking/alignments/${book}.json`, projectAlignments(foldOut, book));
  }
  for (const [ipath, bytes] of Object.entries(projectDecisions(foldOut, resolutions))) emit(out, ipath, bytes);
  emit(out, 'checking/resources.json', projectResources(foldOut.pins));
  emit(out, 'checking/settings.json', projectSettings(foldOut.settings));
  if (foldOut.vrs) emit(out, 'vrs.json', foldOut.vrs.bytes);
  emit(out, 'metadata.json', projectMetadata(foldOut, baseMetadata));
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
    // own-property membership, never `in`: `in` walks the PROTOTYPE chain, so a file
    // named for an Object.prototype member would be judged present in a set that does
    // not contain it — the "absent on disk is divergence too" rule read off the wrong set.
    if (!Object.hasOwn(projections, ipath) || !Object.hasOwn(diskFiles, ipath)) { diverged.push(ipath); continue; }
    (diskFiles[ipath] === projections[ipath] ? clean : diverged).push(ipath);
  }
  return { tolerated, diverged, clean };
};
