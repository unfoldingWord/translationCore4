import crypto from 'node:crypto';
import zlib from 'node:zlib';
import * as A from '@automerge/automerge';
import { zipSync } from 'fflate';
import { fold } from '../../../journal/fold.mjs';
import { makeClock } from '../../../journal/hlc.mjs';
import { decompose } from '../../../journal/skeleton.mjs';
import { sealAction } from '../../../journal/files.mjs';
import {
  appendAction, appendActionChange, applyBundle, bundleChanges, createActor, createProject, extractEvents, loadProject,
} from './model.mjs';

const ACTIONS = Number(process.env.ACTIONS || 10000);
const INDIVIDUAL = process.env.INDIVIDUAL !== '0';
const COMPARE_CUSTOM = process.env.COMPARE_CUSTOM !== '0';
const VERSES = 1292;
const actor = createActor('bench-actor');
const actors = new Map([[actor.manifest.actorId, actor.manifest]]);
const project = createProject('tc4-proof-benchmark', actor);
const source = ['\\id ISA benchmark'];
const verseKeys = [];
for (let i = 0; i < VERSES; i++) {
  const chapter = Math.floor(i / 50) + 1;
  const verse = (i % 50) + 1;
  if (verse === 1) source.push(`\\c ${chapter}`);
  source.push(`\\v ${verse} seed-${i}`);
  verseKeys.push(`${chapter}:${verse}`);
}
const { skeleton, verses } = decompose(`${source.join('\n')}\n`);
const seedTs = '2026-01-01T00:00:00.000Z|0000|bench-actor';
const seed = { v: 1, op: 'book.add', actor: actor.manifest.actorId, ts: seedTs, base: null, book: 'ISA', scope: [], skeleton, initialVerses: verses, seed: { source: 'creation' } };
let doc = project.doc;
const allEvents = [seed];
const customSizes = [];
const automergeSizes = [];
const customSample = [];
const automergeSample = [];
const customFiles = [];
const automergeFiles = [];
const rawChanges = [];
let added = INDIVIDUAL ? appendAction(doc, [seed], actor) : appendActionChange(doc, [seed], actor);
doc = added.doc;
rawChanges.push(added.change);
const sealedSeed = sealAction([seed]);
customSizes.push(Buffer.byteLength(sealedSeed));
if (INDIVIDUAL) automergeSizes.push(Buffer.byteLength(added.bundle));
customSample.push(Buffer.from(sealedSeed));
if (INDIVIDUAL) automergeSample.push(Buffer.from(added.bundle));
customFiles.push(Buffer.from(sealedSeed));
if (INDIVIDUAL) automergeFiles.push(Buffer.from(added.bundle));
const heads = new Map(verseKeys.map((key) => [key, seedTs]));
let now = Date.parse('2026-01-01T00:00:01.000Z');
const clock = makeClock(actor.manifest.actorId, () => now);
const started = performance.now();
for (let i = 0; i < ACTIONS; i++) {
  now += 1;
  const key = verseKeys[i % verseKeys.length];
  const [chapter, verse] = key.split(':');
  const stamp = clock.issue();
  const text = `${crypto.createHash('sha256').update(String(i)).digest('hex').slice(0, 40)} action-${i}\n`;
  const ev = { v: 1, op: 'text.verse.set', actor: actor.manifest.actorId, ts: stamp, base: heads.get(key), generation: seedTs, book: 'ISA', chapter, verse, text };
  heads.set(key, stamp);
  allEvents.push(ev);
  const custom = COMPARE_CUSTOM ? sealAction([ev]) : null;
  if (custom) customSizes.push(Buffer.byteLength(custom));
  added = INDIVIDUAL ? appendAction(doc, [ev], actor) : appendActionChange(doc, [ev], actor);
  doc = added.doc;
  rawChanges.push(added.change);
  if (INDIVIDUAL) automergeSizes.push(Buffer.byteLength(added.bundle));
  if (custom) customFiles.push(Buffer.from(custom));
  if (INDIVIDUAL) automergeFiles.push(Buffer.from(added.bundle));
  if (customSample.length < 1000) {
    if (custom) customSample.push(Buffer.from(custom));
    if (INDIVIDUAL) automergeSample.push(Buffer.from(added.bundle));
  }
  if ((i + 1) % 10000 === 0) console.error(`progress ${i + 1}/${ACTIONS} ${(performance.now() - started).toFixed(0)}ms`);
}
const createMs = performance.now() - started;
const saveStart = performance.now();
const save = A.save(doc);
const saveMs = performance.now() - saveStart;
const loadStart = performance.now();
const loaded = A.load(save);
const loadMs = performance.now() - loadStart;
const historyStart = performance.now();
const extracted = extractEvents(loaded);
const historyMs = performance.now() - historyStart;
const foldStart = performance.now();
const folded = fold(extracted);
const foldMs = performance.now() - foldStart;
if (folded.forks.length !== 0 || extracted.length !== ACTIONS + 1) throw new Error('benchmark state failed correctness check');

const zipSample = (samples, prefix) => {
  const files = {};
  for (let i = 0; i < samples.length; i++) files[`${prefix}/${i}.json`] = samples[i];
  return zipSync(files, { level: 6 }).length;
};

// Receiver applies large contribution batches, never one full-history fold per action.
const changes = rawChanges;
let receiver = loadProject(project.rootBundle).doc;
const receiveStart = performance.now();
let batches = 0;
const groupedBundles = [];
for (let i = 0; i < changes.length; i += 4000)
  groupedBundles.push(bundleChanges(String(doc.projectId), actor, changes.slice(i, i + 4000)));
for (const bundle of groupedBundles) {
  const result = applyBundle(receiver, bundle, actors);
  if (result.status !== 'accepted') throw new Error(`receiver batch ${batches} ${result.status}: ${result.reason || ''}`);
  receiver = result.accepted;
  batches++;
}
const receiveMs = performance.now() - receiveStart;
if (extractEvents(receiver).length !== ACTIONS + 1) throw new Error('receiver lost actions');

const sum = (values) => values.reduce((a, b) => a + b, 0);
const report = {
  automerge: '3.4.1',
  actions: ACTIONS + 1,
  verses: VERSES,
  createMs,
  actionsPerSecond: ACTIONS / (createMs / 1000),
  saveBytes: save.length,
  saveGzipBytes: zlib.gzipSync(save).length,
  saveMs,
  loadMs,
  historyMs,
  foldMs,
  receiveBatches: batches,
  receiveMs,
  customEnvelopeBytes: COMPARE_CUSTOM ? sum(customSizes) : null,
  automergeEnvelopeBytes: INDIVIDUAL ? sum(automergeSizes) : null,
  envelopeRatio: INDIVIDUAL && COMPARE_CUSTOM ? sum(automergeSizes) / sum(customSizes) : null,
  groupedAutomergeEnvelopeBytes: sum(groupedBundles.map((bundle) => Buffer.byteLength(bundle))),
  groupedEnvelopeRatio: COMPARE_CUSTOM ? sum(groupedBundles.map((bundle) => Buffer.byteLength(bundle))) / sum(customSizes) : null,
  groupedAutomergeZipBytes: zipSync(Object.fromEntries(groupedBundles.map((bundle, i) => [`grouped/${i}.json`, Buffer.from(bundle)])), { level: 6 }).length,
  customZipBytes: COMPARE_CUSTOM ? zipSample(customFiles, 'custom') : null,
  automergeIndividualZipBytes: INDIVIDUAL ? zipSample(automergeFiles, 'automerge') : null,
  first1000CustomZipBytes: zipSample(customSample, 'custom'),
  first1000AutomergeZipBytes: INDIVIDUAL ? zipSample(automergeSample, 'automerge') : null,
  heapUsedBytes: process.memoryUsage().heapUsed,
};
console.log(JSON.stringify(report));
