import crypto from 'node:crypto';
import { zipSync } from 'fflate';
import { fold } from '../../../conformance/journal/fold.mjs';
import { makeClock } from '../../../conformance/journal/hlc.mjs';
import { decompose } from '../../../conformance/journal/skeleton.mjs';
import { sealAction } from '../../../conformance/journal/files.mjs';

const ACTIONS = Number(process.env.ACTIONS || 50000);
const VERSES = 1292;
const actor = 'bench-actor';
const source = ['\\id ISA benchmark'];
const verseKeys = [];
for (let i = 0; i < VERSES; i++) {
  const chapter = Math.floor(i / 50) + 1; const verse = (i % 50) + 1;
  if (verse === 1) source.push(`\\c ${chapter}`);
  source.push(`\\v ${verse} seed-${i}`); verseKeys.push(`${chapter}:${verse}`);
}
const { skeleton, verses } = decompose(`${source.join('\n')}\n`);
const seedTs = '2026-01-01T00:00:00.000Z|0000|bench-actor';
const seed = { v: 1, op: 'book.add', actor, ts: seedTs, base: null, book: 'ISA', scope: [], skeleton, initialVerses: verses, seed: { source: 'creation' } };
const events = [seed]; const segments = [Buffer.from(sealAction([seed]))];
const heads = new Map(verseKeys.map((key) => [key, seedTs]));
let now = Date.parse('2026-01-01T00:00:01.000Z'); const clock = makeClock(actor, () => now);
const started = performance.now();
for (let i = 0; i < ACTIONS; i++) {
  now += 1; const key = verseKeys[i % verseKeys.length]; const [chapter, verse] = key.split(':'); const stamp = clock.issue();
  const text = `${crypto.createHash('sha256').update(String(i)).digest('hex').slice(0, 40)} action-${i}\n`;
  const ev = { v: 1, op: 'text.verse.set', actor, ts: stamp, base: heads.get(key), generation: seedTs, book: 'ISA', chapter, verse, text };
  heads.set(key, stamp); events.push(ev); segments.push(Buffer.from(sealAction([ev])));
}
const sealMs = performance.now() - started;
const foldStart = performance.now(); const out = fold(events); const foldMs = performance.now() - foldStart;
if (out.forks.length) throw new Error('custom benchmark forked');
const zipStart = performance.now();
const zipBytes = zipSync(Object.fromEntries(segments.map((bytes, i) => [`segments/${i}.json`, bytes])), { level: 6 }).length;
const zipMs = performance.now() - zipStart;
console.log(JSON.stringify({ actions: ACTIONS + 1, verses: VERSES, sealMs, actionsPerSecond: ACTIONS / (sealMs / 1000), foldMs, envelopeBytes: segments.reduce((n, b) => n + b.length, 0), zipBytes, zipMs, heapUsedBytes: process.memoryUsage().heapUsed }));
