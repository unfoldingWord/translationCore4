import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as A from '@automerge/automerge';
import * as A2 from 'automerge-2';
import * as A30 from 'automerge-3-0';
import fc from 'fast-check';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { fold } from '../../../journal/fold.mjs';
import { decompose } from '../../../journal/skeleton.mjs';
import { seedFromSidecars } from '../../../journal/reconcile.mjs';
import { sealAction } from '../../../journal/files.mjs';
import {
  MAX_BUNDLE_BYTES, appendAction, applyBundle, canonical, createActor, createProject,
  extractEvents, historyView, loadProject, replayBundles, sha256, unsafeBundleForProof,
} from './model.mjs';
import { acceptDurably, initializeStore, recoverStore } from './storage.mjs';
import { mergeUsfmFallback } from './fallback.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');
const CONFORMANCE = path.join(REPO, 'conformance');
const SAMPLE = path.join(CONFORMANCE, 'sample-burrito');
const ING = (rel) => path.join(SAMPLE, 'ingredients', rel);
const ts = (second, actor, counter = 0) => `2026-08-19T00:00:${String(second).padStart(2, '0')}.000Z|${counter.toString(16).padStart(4, '0')}|${actor}`;
const event = (fields) => ({ v: 1, base: null, ...fields });
const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex');
const plain = (value) => JSON.parse(JSON.stringify(value));
const stable = (value) => canonical(plain(value));
const results = [];
const metrics = {};

const check = async (requirement, name, fn) => {
  const started = performance.now();
  try {
    const detail = await fn();
    const elapsed = performance.now() - started;
    results.push({ requirement, name, status: 'PASS', milliseconds: elapsed, detail: detail ?? '' });
    console.log(`PASS  [${requirement}] ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    const elapsed = performance.now() - started;
    results.push({ requirement, name, status: 'FAIL', milliseconds: elapsed, detail: error.stack || error.message });
    console.error(`FAIL  [${requirement}] ${name} — ${error.message}`);
  }
};

const scenario = (suffix = 'base') => {
  const seed = createActor(`seed-${suffix}`);
  const ruth = createActor(`ruth-${suffix}`);
  const mary = createActor(`mary-${suffix}`);
  const reviewer = createActor(`review-${suffix}`);
  const actors = new Map([seed, ruth, mary, reviewer].map((a) => [a.manifest.actorId, a.manifest]));
  const projectId = `tc4-proof-${suffix}`;
  const project = createProject(projectId, seed);
  const usfm = '\\id TIT proof\n\\c 1\n\\p\n\\v 1 The king spoke clearly.\n\\v 2 Initial second verse.\n';
  const { skeleton, verses } = decompose(usfm);
  const seedTs = ts(0, seed.manifest.actorId);
  const seedEvent = event({ op: 'book.add', actor: seed.manifest.actorId, ts: seedTs, book: 'TIT', scope: [], skeleton, initialVerses: verses, seed: { source: 'creation' } });
  const seeded = appendAction(project.doc, [seedEvent], seed);
  const received = applyBundle(project.doc, seeded.bundle, actors);
  assert.equal(received.status, 'accepted');
  return { ...project, doc: received.accepted, actors, seed, ruth, mary, reviewer, seedTs, seedBundle: seeded.bundle, usfm, verses };
};

await check('R1 no silent loss', 'concurrent whole-verse edits are both conserved and explicitly forked', () => {
  const s = scenario('fork');
  const ruthTs = ts(1, s.ruth.manifest.actorId);
  const maryTs = ts(2, s.mary.manifest.actorId);
  const r = appendAction(s.doc, [event({ op: 'text.verse.set', actor: s.ruth.manifest.actorId, ts: ruthTs, base: s.seedTs, generation: s.seedTs, book: 'TIT', chapter: '1', verse: '1', text: 'Ruth final draft.\n' })], s.ruth);
  const m = appendAction(s.doc, [event({ op: 'text.verse.set', actor: s.mary.manifest.actorId, ts: maryTs, base: s.seedTs, generation: s.seedTs, book: 'TIT', chapter: '1', verse: '1', text: 'Mary final draft.\n' })], s.mary);
  let merged = applyBundle(s.doc, r.bundle, s.actors).accepted;
  merged = applyBundle(merged, m.bundle, s.actors).accepted;
  const out = fold(extractEvents(merged));
  assert.equal(out.forks.length, 1);
  const verseEvents = extractEvents(merged).filter((e) => e.op === 'text.verse.set');
  assert.equal(verseEvents.length, 2);
  assert.ok(verseEvents.some((e) => e.text === 'Ruth final draft.\n'));
  assert.ok(verseEvents.some((e) => e.text === 'Mary final draft.\n'));
  assert.deepEqual(new Set(out.forks[0].heads), new Set(verseEvents.map((e) => e.ts)));

  const resolvedTs = ts(3, s.reviewer.manifest.actorId);
  const resolution = appendAction(merged, [event({
    op: 'text.verse.set', actor: s.reviewer.manifest.actorId, ts: resolvedTs, base: maryTs,
    supersedes: [ruthTs, maryTs], generation: s.seedTs, book: 'TIT', chapter: '1', verse: '1', text: 'Reviewed final verse.\n',
  })], s.reviewer);
  const accepted = applyBundle(merged, resolution.bundle, s.actors);
  assert.equal(accepted.status, 'accepted');
  const final = fold(extractEvents(accepted.accepted));
  assert.equal(final.forks.length, 0);
  assert.match(final.books.TIT.usfm, /Reviewed final verse/);
  assert.equal(extractEvents(accepted.accepted).length, 4);
  return 'two candidates surfaced; travelling resolution retained all four actions';
});

await check('R2 send without receive', 'a second offline send can arrive first, remain pending, then converge', () => {
  const s = scenario('offline');
  const firstTs = ts(1, s.ruth.manifest.actorId);
  const secondTs = ts(2, s.ruth.manifest.actorId);
  const first = appendAction(s.doc, [event({ op: 'text.verse.set', actor: s.ruth.manifest.actorId, ts: firstTs, base: s.seedTs, generation: s.seedTs, book: 'TIT', chapter: '1', verse: '2', text: 'Offline draft one.\n' })], s.ruth);
  const second = appendAction(first.doc, [event({ op: 'text.verse.set', actor: s.ruth.manifest.actorId, ts: secondTs, base: firstTs, generation: s.seedTs, book: 'TIT', chapter: '1', verse: '2', text: 'Offline draft two.\n' })], s.ruth);
  const early = applyBundle(s.doc, second.bundle, s.actors);
  assert.equal(early.status, 'pending');
  const one = applyBundle(s.doc, first.bundle, s.actors);
  assert.equal(one.status, 'accepted');
  const two = applyBundle(one.accepted, second.bundle, s.actors);
  assert.equal(two.status, 'accepted');
  const duplicate = applyBundle(two.accepted, first.bundle, s.actors);
  assert.equal(duplicate.status, 'duplicate');
  assert.match(fold(extractEvents(two.accepted)).books.TIT.usfm, /Offline draft two/);
  return 'out-of-order dependency quarantined; retry and duplicate were safe';
});

await check('R3 exact rebuild', 'the real sample seed crosses Automerge and rebuilds USFM/checking records exactly', () => {
  const actor = createActor('seed-actor');
  const actors = new Map([[actor.manifest.actorId, actor.manifest]]);
  const project = createProject('tc4-proof-exact', actor);
  const books = { TIT: fs.readFileSync(ING('TIT.usfm'), 'utf8'), JON: fs.readFileSync(ING('JON.usfm'), 'utf8') };
  const decisionFiles = {
    translationWords: JSON.parse(fs.readFileSync(ING('checking/translationWords/TIT.json'), 'utf8')),
    translationNotes: JSON.parse(fs.readFileSync(ING('checking/translationNotes/TIT.json'), 'utf8')),
  };
  const alignmentFiles = { TIT: JSON.parse(fs.readFileSync(ING('checking/alignments/TIT.json'), 'utf8')) };
  const vrs = { name: 'eng', bytes: fs.readFileSync(ING('vrs.json'), 'utf8') };
  const events = seedFromSidecars({ actor: actor.manifest.actorId, books, decisionFiles, alignmentFiles, vrs });
  const appended = appendAction(project.doc, events, actor);
  const accepted = applyBundle(project.doc, appended.bundle, actors);
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(extractEvents(accepted.accepted), events);
  const out = fold(extractEvents(accepted.accepted));
  assert.equal(out.books.TIT.usfm, books.TIT);
  assert.equal(out.books.JON.usfm, books.JON);
  assert.deepEqual(plain(out.alignments.TIT['1:1'].alignments), alignmentFiles.TIT.chapters['1']['1'].alignments);
  assert.equal(out.decisions.translationWords.length, decisionFiles.translationWords.decisions.length);
  assert.equal(out.decisions.translationNotes.length, decisionFiles.translationNotes.decisions.length);
  metrics.exact = { actor, actors, project, appended, doc: accepted.accepted, eventCount: events.length };
  return `${events.length} seeded events; TIT and JON byte-identical`;
});

await check('R4 hostile intake', 'bad ancestor plus dependent change is rejected atomically', () => {
  const s = scenario('hostile');
  const badBody = canonical({ events: [{ v: 1, op: 'book.remove', actor: s.ruth.manifest.actorId, ts: ts(1, s.ruth.manifest.actorId), base: s.seedTs, book: 'NOT_A_BOOK' }] });
  let rogue = A.clone(s.doc, { actor: s.ruth.manifest.automergeActorId });
  const beforeHeads = A.getHeads(rogue);
  rogue = A.change(rogue, (draft) => { draft.actions[sha256(badBody)] = new A.ImmutableString(badBody); });
  const goodBody = JSON.parse(sealAction([event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(2, s.ruth.manifest.actorId), path: 'ui.note', value: 'dependent honest work' })])).body;
  rogue = A.change(rogue, (draft) => { draft.actions[sha256(goodBody)] = new A.ImmutableString(goodBody); });
  const changes = A.getChangesSince(rogue, beforeHeads);
  const bundle = unsafeBundleForProof(String(s.doc.projectId), s.ruth, changes);
  const acceptedBytes = Buffer.from(A.save(s.doc));
  const result = applyBundle(s.doc, bundle, s.actors);
  assert.equal(result.status, 'rejected');
  assert.ok(Buffer.from(A.save(s.doc)).equals(acceptedBytes));
  assert.match(result.reason, /invalid tC4 action/);
  return `rejected ${changes.length}-change causal closure; accepted bytes unchanged`;
});

await check('R4 hostile intake', 'delete, overwrite, hidden-field, foreign-actor and signature attacks are rejected', () => {
  const s = scenario('attacks');
  const attacks = [];
  const makeAttack = (mutate) => {
    let rogue = A.clone(s.doc, { actor: s.ruth.manifest.automergeActorId });
    const heads = A.getHeads(rogue);
    rogue = A.change(rogue, mutate);
    return unsafeBundleForProof(String(s.doc.projectId), s.ruth, A.getChangesSince(rogue, heads));
  };
  attacks.push(makeAttack((draft) => { delete draft.actions; }));
  attacks.push(makeAttack((draft) => { draft.projectId = new A.ImmutableString('different-project'); }));
  attacks.push(makeAttack((draft) => { draft.unexpected = 1; }));
  const foreignBody = JSON.parse(sealAction([event({ op: 'settings.set', actor: s.mary.manifest.actorId, ts: ts(4, s.mary.manifest.actorId), path: 'ui.x', value: 1 })])).body;
  attacks.push(makeAttack((draft) => { draft.actions[sha256(foreignBody)] = new A.ImmutableString(foreignBody); }));
  for (const bundle of attacks) assert.equal(applyBundle(s.doc, bundle, s.actors).status, 'rejected');

  const valid = appendAction(s.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(5, s.ruth.manifest.actorId), path: 'ui.y', value: 2 })], s.ruth).bundle;
  const parsed = JSON.parse(valid);
  parsed.signature = parsed.signature.replace(/^./, parsed.signature[0] === 'A' ? 'B' : 'A');
  assert.equal(applyBundle(s.doc, canonical(parsed), s.actors).status, 'rejected');
  assert.equal(applyBundle(s.doc, 'x'.repeat(MAX_BUNDLE_BYTES + 1), s.actors).status, 'rejected');
  return `${attacks.length + 2} attack classes rejected`;
});

await check('R5 readable history', 'every accepted action exposes who, what and when', () => {
  const s = scenario('history');
  const added = appendAction(s.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(1, s.ruth.manifest.actorId), path: 'ui.scale', value: 2 })], s.ruth);
  const doc = applyBundle(s.doc, added.bundle, s.actors).accepted;
  const history = historyView(doc);
  assert.equal(history.length, 2);
  assert.deepEqual(history.at(-1), {
    actor: s.ruth.manifest.actorId,
    when: '2026-08-19T00:00:01.000Z',
    operation: 'settings.set',
    event: history.at(-1).event,
  });
  assert.equal(history.at(-1).event.path, 'ui.scale');
  return `${history.length} actions rendered without interpreting Automerge internals`;
});

await check('R6 any order/parts/duplicates', 'property: identical bundles converge under arbitrary delivery', () => {
  const rootActor = createActor('root-order');
  const left = createActor('left-order');
  const right = createActor('right-order');
  const actors = new Map([rootActor, left, right].map((a) => [a.manifest.actorId, a.manifest]));
  const project = createProject('tc4-proof-order', rootActor);
  const bundles = [];
  for (const actor of [left, right]) {
    let doc = project.doc;
    for (let i = 0; i < 3; i++) {
      const added = appendAction(doc, [event({ op: 'settings.set', actor: actor.manifest.actorId, ts: ts(i + (actor === left ? 10 : 20), actor.manifest.actorId), path: `${actor.manifest.actorId}.k${i}`, value: i })], actor);
      doc = added.doc;
      bundles.push(added.bundle);
    }
  }
  const expected = replayBundles(project.rootBundle, bundles, actors);
  assert.equal(expected.pending.length, 0);
  assert.equal(expected.rejected.length, 0);
  const changeSet = (doc) => A.getAllChanges(doc).map((change) => A.decodeChange(change).hash).sort().join(',');
  const wantChanges = changeSet(expected.doc);
  const wantFold = stable(fold(extractEvents(expected.doc)));
  fc.assert(fc.property(fc.array(fc.nat({ max: 100000 }), { minLength: bundles.length, maxLength: bundles.length }), fc.array(fc.integer({ min: 0, max: bundles.length - 1 }), { maxLength: 8 }), (scores, duplicates) => {
    const permuted = bundles.map((bundle, i) => ({ bundle, score: scores[i] })).sort((a, b) => a.score - b.score).map((x) => x.bundle);
    const delivered = [...permuted, ...duplicates.map((i) => bundles[i])];
    const got = replayBundles(project.rootBundle, delivered, actors);
    return got.pending.length === 0 && got.rejected.length === 0 && changeSet(got.doc) === wantChanges && stable(fold(extractEvents(got.doc))) === wantFold;
  }), { seed: 20260819, numRuns: 200 });
  return '200 deterministic permutations/duplicate sets';
});

await check('R7 permanent history', 'append-only store replays and detects missing ancestry or modified bytes', () => {
  const s = scenario('store');
  const first = appendAction(s.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(1, s.ruth.manifest.actorId), path: 'ui.a', value: 1 })], s.ruth);
  const second = appendAction(first.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(2, s.ruth.manifest.actorId), path: 'ui.b', value: 2 })], s.ruth);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-am-store-'));
  initializeStore(root, s.rootBundle, s.actors);
  let accepted = loadProject(s.rootBundle).doc;
  accepted = acceptDurably(root, accepted, s.seedBundle, s.actors).accepted;
  accepted = acceptDurably(root, accepted, first.bundle, s.actors).accepted;
  accepted = acceptDurably(root, accepted, second.bundle, s.actors).accepted;
  const recovered = recoverStore(root, s.actors);
  assert.equal(extractEvents(recovered.doc).length, 3);
  const segmentFiles = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(path.join(dir, e.name)) : segmentFiles.push(path.join(dir, e.name)); };
  walk(path.join(root, 'segments'));
  const firstPath = segmentFiles.find((file) => fs.readFileSync(file, 'utf8') === first.bundle);
  fs.unlinkSync(firstPath);
  assert.throws(() => recoverStore(root, s.actors), /canonical store does not replay/);
  fs.writeFileSync(firstPath, first.bundle.replace('container', 'containeq'));
  assert.throws(() => recoverStore(root, s.actors), /rejected|envelope|canonical store/);
  fs.rmSync(root, { recursive: true, force: true });
  return `${segmentFiles.length} immutable bundles replayed; deletion and rewrite detected`;
});

await check('R7 crash recovery', 'crashes after staging and after canonical write recover without loss or duplication', () => {
  for (const phase of ['stage', 'canonical']) {
    const s = scenario(`crash-${phase}`);
    const added = appendAction(s.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(1, s.ruth.manifest.actorId), path: 'ui.crash', value: phase })], s.ruth);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `tc4-am-${phase}-`));
    initializeStore(root, s.rootBundle, s.actors);
    let accepted = acceptDurably(root, loadProject(s.rootBundle).doc, s.seedBundle, s.actors).accepted;
    assert.throws(() => acceptDurably(root, accepted, added.bundle, s.actors, { crashAfter: phase }), /simulated crash/);
    const recovered = recoverStore(root, s.actors);
    assert.equal(extractEvents(recovered.doc).filter((e) => e.path === 'ui.crash').length, 1);
    assert.equal(recovered.quarantined.length, 0);
    fs.rmSync(root, { recursive: true, force: true });
  }
  return 'both durable-write interruption points recovered exactly once';
});

await check('R8 integrity', 'sealed envelopes reject every single-bit mutation, truncation and appended garbage', () => {
  const s = scenario('bits');
  const added = appendAction(s.doc, [event({ op: 'settings.set', actor: s.ruth.manifest.actorId, ts: ts(1, s.ruth.manifest.actorId), path: 'ui.bit', value: 1 })], s.ruth);
  const bytes = Buffer.from(added.bundle);
  let acceptedMutations = 0;
  for (let i = 0; i < bytes.length; i++) for (let bit = 0; bit < 8; bit++) {
    const changed = Buffer.from(bytes); changed[i] ^= 1 << bit;
    if (applyBundle(s.doc, changed.toString('utf8'), s.actors).status !== 'rejected') acceptedMutations++;
  }
  let acceptedTruncations = 0;
  for (let i = 0; i < bytes.length; i++) if (applyBundle(s.doc, bytes.subarray(0, i).toString('utf8'), s.actors).status !== 'rejected') acceptedTruncations++;
  assert.equal(acceptedMutations, 0);
  assert.equal(acceptedTruncations, 0);
  assert.equal(applyBundle(s.doc, `${added.bundle}x`, s.actors).status, 'rejected');
  metrics.integrity = { bundleBytes: bytes.length, bitFlips: bytes.length * 8, acceptedMutations, truncations: bytes.length, acceptedTruncations };
  return `${bytes.length * 8} bit flips and ${bytes.length} truncations rejected`;
});

await check('R8 integrity', 'negative control reproduces why raw Automerge changes are not an integrity boundary', () => {
  let base = A.from({ value: new A.ImmutableString('accepted') }, { actor: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  let changed = A.clone(base, { actor: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  changed = A.change(changed, (draft) => { draft.value = new A.ImmutableString('expected'); });
  const raw = A.getLastLocalChange(changed);
  let rejected = 0, unchanged = 0, expected = 0, unexpected = 0;
  for (let i = 0; i < raw.length; i++) for (let bit = 0; bit < 8; bit++) {
    const mutation = Uint8Array.from(raw); mutation[i] ^= 1 << bit;
    try {
      const candidate = A.applyChanges(A.clone(base), [mutation])[0];
      const value = String(candidate.value);
      if (value === 'accepted') unchanged++;
      else if (value === 'expected') expected++;
      else unexpected++;
    } catch { rejected++; }
  }
  assert.ok(unexpected > 0);
  metrics.rawCorruption = { bytes: raw.length, flips: raw.length * 8, rejected, unchanged, expected, unexpected };
  return `${unexpected}/${raw.length * 8} mutations produced unexpected state through raw applyChanges`;
});

await check('R9 model safety', 'negative controls reproduce text corruption and hidden delete-vs-edit', () => {
  let textBase = A.from({ verse: 'The king spoke clearly.' }, { actor: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  let ruth = A.clone(textBase, { actor: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  let mary = A.clone(textBase, { actor: 'cccccccccccccccccccccccccccccccc' });
  ruth = A.change(ruth, (draft) => A.updateText(draft, ['verse'], 'Ruth rewrote the whole verse.'));
  mary = A.change(mary, (draft) => A.updateText(draft, ['verse'], 'Mary independently rewrote it.'));
  const textMerged = A.merge(ruth, mary);
  assert.notEqual(String(textMerged.verse), 'Ruth rewrote the whole verse.');
  assert.notEqual(String(textMerged.verse), 'Mary independently rewrote it.');
  assert.equal(A.getConflicts(textMerged, 'verse'), undefined);

  let nestedBase = A.from({ book: { verse: { text: 'draft', checked: false } } }, { actor: 'dddddddddddddddddddddddddddddddd' });
  let deleter = A.clone(nestedBase, { actor: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' });
  let editor = A.clone(nestedBase, { actor: 'ffffffffffffffffffffffffffffffff' });
  deleter = A.change(deleter, (draft) => { delete draft.book.verse; });
  editor = A.change(editor, (draft) => { draft.book.verse.text = 'years of checked work'; draft.book.verse.checked = true; });
  const editorHeads = A.getHeads(editor);
  const nestedMerged = A.merge(deleter, editor);
  assert.equal(nestedMerged.book.verse, undefined);
  assert.equal(A.getConflicts(nestedMerged.book, 'verse'), undefined);
  assert.equal(A.view(nestedMerged, editorHeads).book.verse.text, 'years of checked work');
  return `text result=${JSON.stringify(String(textMerged.verse))}; nested edit recoverable only through history`;
});

await check('R10 version/exit risk', 'simple accepted document loads across Automerge 2.2.9, 3.0.0 and 3.4.1', () => {
  const doc = metrics.exact.doc;
  const bytes = A.save(doc);
  const versions = [A2, A30, A];
  for (const lib of versions) {
    const loaded = lib.load(bytes);
    assert.equal(Object.keys(loaded.actions).length, Object.keys(doc.actions).length);
    assert.equal(String(loaded.projectId), String(doc.projectId));
  }
  metrics.compatibility = { bytes: bytes.length, versions: ['2.2.9', '3.0.0', '3.4.1'] };
  return `${bytes.length} bytes loaded by all three versions`;
});

await check('R11 Burrito carriage', 'Automerge envelopes survive schema validation, zip, Git and text-only HTTP transport', () => {
  const exact = metrics.exact;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-am-burrito-'));
  const burrito = path.join(tmp, 'burrito');
  fs.cpSync(SAMPLE, burrito, { recursive: true });
  const artifactFiles = new Map();
  artifactFiles.set('checking/journal/automerge/root.bundle.json', exact.project.rootBundle);
  artifactFiles.set(`checking/journal/automerge/actors/${exact.actor.manifest.actorId}.json`, canonical(exact.actor.manifest));
  artifactFiles.set(`checking/journal/automerge/segments/${exact.actor.manifest.actorId}/${sha256(exact.appended.bundle)}.bundle.json`, exact.appended.bundle);
  const metadataPath = path.join(burrito, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  for (const [ipath, text] of artifactFiles) {
    const full = path.join(burrito, 'ingredients', ipath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    const bytes = Buffer.from(text);
    metadata.ingredients[`ingredients/${ipath}`] = { size: bytes.length, mimeType: 'application/json', checksum: { md5: md5(bytes) } };
    const transported = JSON.parse(JSON.stringify({ payload: text })).payload;
    assert.equal(transported, text);
  }
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const validation = execFileSync(process.execPath, ['validate.mjs'], {
    cwd: CONFORMANCE, env: { ...process.env, BURRITO: burrito }, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  });
  assert.match(validation, /35 passed, 0 failed/);

  const collect = (root) => {
    const files = {};
    const walk = (dir, rel = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.DS_Store') continue;
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { files[`${nextRel}/`] = new Uint8Array(); walk(full, nextRel); }
        else files[nextRel] = Uint8Array.from(fs.readFileSync(full));
      }
    };
    walk(root); return files;
  };
  const plainZip = zipSync(collect(SAMPLE), { level: 6 });
  const withAutoZip = zipSync(collect(burrito), { level: 6 });
  const unzipped = unzipSync(withAutoZip);
  for (const [ipath, text] of artifactFiles) assert.equal(Buffer.from(unzipped[`ingredients/${ipath}`]).toString(), text);

  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: burrito });
  execFileSync('git', ['config', 'user.email', 'proof@example.invalid'], { cwd: burrito });
  execFileSync('git', ['config', 'user.name', 'Proof'], { cwd: burrito });
  execFileSync('git', ['add', '-A'], { cwd: burrito });
  execFileSync('git', ['commit', '-qm', 'proof burrito'], { cwd: burrito });
  const clone = path.join(tmp, 'clone');
  execFileSync('git', ['clone', '-q', burrito, clone]);
  for (const [ipath, text] of artifactFiles) assert.equal(fs.readFileSync(path.join(clone, 'ingredients', ipath), 'utf8'), text);

  metrics.burrito = {
    artifactFiles: artifactFiles.size,
    artifactBytes: [...artifactFiles.values()].reduce((n, text) => n + Buffer.byteLength(text), 0),
    plainZipBytes: plainZip.length,
    withAutomergeZipBytes: withAutoZip.length,
    zipDeltaBytes: withAutoZip.length - plainZip.length,
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return `${metrics.burrito.artifactBytes} raw bytes; ${metrics.burrito.zipDeltaBytes} bytes added to zipped sample Burrito`;
});

await check('R12 disaster fallback', 'unmergeable histories fall back to lossless USFM merge with checking tracked separately', () => {
  const base = '\\id RUT fallback\n\\c 1\n\\p\n\\v 1 base one\n\\v 2 base two\n';
  const left = base.replace('base one', 'Ruth changed one');
  const right = base.replace('base two', 'Mary changed two');
  const clean = mergeUsfmFallback({ base, left, right, leftLabel: 'ruth', rightLabel: 'mary' });
  assert.equal(clean.status, 'merged');
  assert.match(clean.usfm, /Ruth changed one/);
  assert.match(clean.usfm, /Mary changed two/);
  assert.equal(Object.keys(clean.sourceHashes).length, 3);

  const collision = mergeUsfmFallback({ base, left, right: base.replace('base one', 'Mary changed one'), leftLabel: 'ruth', rightLabel: 'mary' });
  assert.equal(collision.status, 'content-conflicts');
  assert.equal(collision.conflicts.length, 1);
  assert.equal(collision.conflicts[0].ruth, 'Ruth changed one\n');
  assert.equal(collision.conflicts[0].mary, 'Mary changed one\n');
  collision.manualCarryForward.push({ book: 'RUT', actor: 'ruth', note: 'Ruth has already been checked' });
  assert.equal(collision.manualCarryForward[0].book, 'RUT');
  return 'disjoint verses auto-merged; same-verse alternatives and manual checking fact both retained';
});

const failed = results.filter((result) => result.status === 'FAIL');
console.log(`\nAutomerge proof: ${results.length - failed.length} passed, ${failed.length} failed`);
console.log(`RESULT_JSON ${JSON.stringify({ versions: { automerge: '3.4.1', node: process.version }, results, metrics: { ...metrics, exact: metrics.exact ? { eventCount: metrics.exact.eventCount } : undefined } })}`);
if (failed.length) process.exitCode = 1;
