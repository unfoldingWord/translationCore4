#!/usr/bin/env node
// bench-fold.mjs — issue #80: measure the size and the speed cost of the journal.
//
// The benchmark folds a synthetic aligned New Testament journal through the REAL
// reference fold (journal/fold.mjs — the same module the production client imports,
// issue #62). It reports:
//   1. the full fold time for the aligned-NT journal;
//   2. the three known cost centres (issue #80):
//      C1 — one usfm-js parse per alignment head at projection (verseTextMd5);
//      C2 — a scan of all heads for each mapped key inside text.structure.apply;
//      C3 — a scan of all heads for each book at projection;
//   3. the open() full-scan baseline deferred from #62: one sealed action segment
//      per event, read + validated + folded, as a function of journal length.
//
// The corpus is built from REAL material, never from invented shapes:
//   - verse counts: fixtures/vrs/eng.json (the org versification), NT books only;
//   - verse text: the Spanish TIT verse texts of sample-burrito (cycled);
//   - alignment records: the complete §5.1 records of sample-burrito TIT (cycled),
//     with targetVerseMd5 recomputed against the cycled text so every alignment is
//     VALID at projection — the fold pays the same parse either way, and a clean
//     corpus proves the generator against the fold (no forks, no retained heads).
//
// Usage:  node bench-fold.mjs [--quick | --bible]
//   --quick: 1 repetition, 5 books, small open() curve — a smoke run, not a record.
//   --bible: the CHECKED WHOLE BIBLE — all 66 books, aligned, PLUS one
//            check.decision.set for every real translationNotes and
//            translationWords check (fixtures/check-density.json: per-book row
//            counts from en_tn/en_twl v89). One event = one save = one segment.
// Timings are medians over repetitions (3 by default). Record results in
// docs/evidence/ with the machine, the commit and the date (issue #80).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { fold, verseTextMd5, slotKeysOf } from './journal/fold.mjs';
import { decompose, SLOT } from './journal/skeleton.mjs';
import { makeClock } from './journal/hlc.mjs';
import { writeActionSegment, readUnion, actorDirFor } from './journal/files.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK = process.argv.includes('--quick');
const BIBLE = process.argv.includes('--bible');
const REPS = QUICK ? 1 : 3;
const ACTOR = 'bench-a';

// Canonical book order (§2 book ids).
const OT_ALL = [
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI',
  '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP',
  'HAG', 'ZEC', 'MAL',
];
const NT_ALL = [
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL',
  '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
  '3JN', 'JUD', 'REV',
];
const NT = BIBLE ? [...OT_ALL, ...NT_ALL] : QUICK ? NT_ALL.slice(0, 5) : NT_ALL;
const CORPUS_LABEL = BIBLE ? 'checked whole Bible' : 'aligned NT';
// Real per-book check counts (en_tn/en_twl v89) — the --bible decision densities.
const density = BIBLE
  ? JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/check-density.json'), 'utf8'))
  : null;

// ---------- real material ----------
const vrs = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/vrs/eng.json'), 'utf8'));
const titUsfm = fs.readFileSync(path.join(HERE, 'sample-burrito/ingredients/TIT.usfm'), 'utf8');
const titAlign = JSON.parse(
  fs.readFileSync(path.join(HERE, 'sample-burrito/ingredients/checking/alignments/TIT.json'), 'utf8'),
);
const titVerses = decompose(titUsfm).verses;
// (text, §5.1 record) pairs — only verses that carry BOTH real text and a real record
const material = [];
for (const [ch, byVerse] of Object.entries(titAlign.chapters)) {
  for (const [v, record] of Object.entries(byVerse)) {
    const text = titVerses[`${ch}:${v}`];
    if (typeof text === 'string' && text.trim() !== '' && !text.includes('___')) {
      material.push({ text, record });
    }
  }
}
if (material.length === 0) throw new Error('no usable TIT material — corpus cannot be built');

// ---------- corpus: one aligned-NT journal ----------
// Per book: one book.add (skeleton from eng.vrs), one text.verse.set per verse (a
// drafting write on the book.add base), one align.verse.set per verse (rootless first
// write with the mandatory generation stamp) — the D50 model: each event is one save.
const clock = makeClock(ACTOR);
const books = []; // {book, bookAddTs, skeleton, slots, textTs: Map, texts: Map, events: []}
let materialIdx = 0;
for (const book of NT) {
  const chapters = vrs.maxVerses[book];
  if (!chapters) throw new Error(`eng.vrs has no maxVerses for ${book}`);
  let skeleton = `\\id ${book} bench corpus\n\\h ${book}\n\\mt ${book}\n`;
  const slots = [];
  chapters.forEach((maxV, ci) => {
    skeleton += `\\c ${ci + 1}\n\\p\n`;
    for (let v = 1; v <= Number(maxV); v++) {
      const key = `${ci + 1}:${v}`;
      slots.push(key);
      skeleton += `\\v ${v} ${SLOT}${key}${SLOT}`;
    }
  });
  const events = [];
  const bookAddTs = clock.issue();
  events.push({ v: 1, op: 'book.add', actor: ACTOR, ts: bookAddTs, base: null, book, scope: [], skeleton });
  const textTs = new Map();
  const texts = new Map();
  const alignEvents = [];
  for (const key of slots) {
    const { text, record } = material[materialIdx % material.length];
    materialIdx += 1;
    const [chapter, verse] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const ts = clock.issue();
    textTs.set(key, ts);
    texts.set(key, text);
    events.push({ v: 1, op: 'text.verse.set', actor: ACTOR, ts, base: bookAddTs, book, chapter, verse, text });
    alignEvents.push({
      v: 1, op: 'align.verse.set', actor: ACTOR, ts: clock.issue(), base: null,
      generation: bookAddTs, book, chapter, verse,
      alignments: record.alignments, wordBank: record.wordBank,
      sourceVersion: record.sourceVersion, targetVerseMd5: verseTextMd5(text),
    });
  }
  events.push(...alignEvents);
  // --bible: one check.decision.set per REAL check (en_tn/en_twl v89 row counts),
  // spread round-robin over the book's verses. checkId is unique per (tool, book),
  // so every decision is its own §5.2 register key — one save each, like the client.
  if (density) {
    for (const toolId of ['translationNotes', 'translationWords']) {
      const n = density[toolId][book] ?? 0;
      const prefix = toolId === 'translationNotes' ? 'tn' : 'tw';
      for (let i = 0; i < n; i++) {
        const key = slots[i % slots.length];
        const [chapter, verse] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        events.push({
          v: 1, op: 'check.decision.set', actor: ACTOR, ts: clock.issue(), base: null,
          generation: bookAddTs, toolId,
          decision: {
            contextId: { checkId: `${prefix}${i}`, occurrence: 1,
              reference: { bookId: book.toLowerCase(), chapter, verse } },
            selections: [{ text: 'palabra', occurrence: 1, occurrences: 1 }],
            nothingToSelect: false,
          },
        });
      }
    }
  }
  books.push({ book, bookAddTs, skeleton, slots, textTs, texts, events });
}

// Three event sets, used by DIFFERENT controls (PR #96 review, finding 2):
//   allAligned    — the whole corpus (the measured fold);
//   allMinusAlign — the corpus WITHOUT align.verse.set only (the C1 control:
//                   decisions stay in, so the difference attributes to alignment
//                   projection alone);
//   allNoAlign    — text + structure only (the C2/C3 base: a small union whose
//                   head-key count is stated with the result).
const CONTENT_OPS = new Set(['align.verse.set', 'check.decision.set']);
const eventsOf = (bs, { aligned }) =>
  bs.flatMap((b) => (aligned ? b.events : b.events.filter((e) => !CONTENT_OPS.has(e.op))));
const allAligned = eventsOf(books, { aligned: true });
const allMinusAlign = books.flatMap((b) => b.events.filter((e) => e.op !== 'align.verse.set'));
const allNoAlign = eventsOf(books, { aligned: false });
const verseCount = books.reduce((n, b) => n + b.slots.length, 0);
const decisionCount = allAligned.filter((e) => e.op === 'check.decision.set').length;

// ---------- a text.structure.apply with M mapped keys (cost centre C2) ----------
// CONSTANT-SHAPE variants (PR #96 review, finding 3): every variant RENAMES the
// first M slots of the book (verse v → v+500 in its chapter) and carries every
// other slot as an identity transition. M=0 is the pure identity apply. All
// variants therefore have the SAME slot count, the SAME transition count and the
// SAME texts — only the mapped-key set (renamed sources ≠ their destinations)
// differs, which is exactly the per-mapped-key scan C2 measures. On the
// text-only union no alignment or decision head exists, so the affected set is
// empty and dispositions stay [].
const buildRenameApply = (b, m) => {
  const renamed = new Map(); // old slot key -> new slot key
  for (let i = 0; i < m && i < b.slots.length; i++) {
    const k = b.slots[i];
    const c = k.slice(0, k.indexOf(':'));
    const v = k.slice(k.indexOf(':') + 1);
    renamed.set(k, `${c}:${Number(v) + 500}`);
  }
  let skeleton = b.skeleton;
  for (const [oldK, newK] of renamed) skeleton = skeleton.replace(`${SLOT}${oldK}${SLOT}`, `${SLOT}${newK}${SLOT}`);
  const transitions = {};
  for (const k of b.slots) {
    const dest = renamed.get(k) ?? k;
    transitions[dest] = { text: b.texts.get(k), sources: [{ key: k, ts: b.textTs.get(k) }] };
  }
  return {
    event: { v: 1, op: 'text.structure.apply', actor: ACTOR, ts: clock.issue(), base: b.bookAddTs,
      book: b.book, skeleton, transitions, dispositions: [] },
    mapped: renamed.size,
  };
};

// ---------- timing ----------
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const bench = (fn) => {
  const runs = [];
  let out;
  for (let i = 0; i < REPS; i++) {
    const t0 = process.hrtime.bigint();
    out = fn();
    runs.push(ms(t0));
  }
  runs.sort((a, b) => a - b);
  return { median: runs[Math.floor(runs.length / 2)], runs, out };
};
const f1 = (x) => x.toFixed(1);

// ---------- header ----------
// The stamp must identify the CODE that ran, not just the checked-out commit
// (PR #96 review, finding 4): a dirty tree gets a visible marker, and a record
// made from a dirty run is not a valid evidence baseline.
const rev = (() => {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: HERE }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: HERE }).toString().trim();
    return dirty ? `${head}-DIRTY (not a valid evidence baseline)` : head;
  } catch { return 'unknown'; }
})();
console.log('bench-fold — issue #80');
console.log(`date: ${new Date().toISOString()}  commit: ${rev}  node: ${process.version}`);
console.log(`machine: ${os.cpus()[0].model} (${os.cpus().length} cores), ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}`);
console.log(`mode: ${QUICK ? 'QUICK (smoke run — not a record)' : `full (${REPS} repetitions, median)`}${BIBLE ? ' — checked whole Bible' : ''}`);
console.log(`corpus: ${NT.length} books, ${verseCount} verses, ${decisionCount} check decisions, ${allAligned.length} events total, ${allNoAlign.length} events (text-only)`);
console.log('');

// ---------- sanity: the corpus folds CLEAN ----------
{
  const r = fold(allAligned);
  const dirty = ['forks', 'invalid', 'retained', 'pendingStructural', 'vrsRejected', 'supersedeRefused']
    .filter((k) => r[k].length > 0);
  if (dirty.length) throw new Error(`corpus does not fold clean: ${dirty.join(', ')} non-empty`);
  if (Object.keys(r.books).length !== NT.length) throw new Error('corpus lost a book at projection');
}

// ---------- 1. full aligned-NT fold ----------
const full = bench(() => fold(allAligned));
console.log(`[fold] ${CORPUS_LABEL} (${allAligned.length} events, ${verseCount} alignment heads, ${decisionCount} decisions): ${f1(full.median)} ms  (runs: ${full.runs.map(f1).join(', ')})`);

// BENCH_FOLD_ONLY=1 stops after the full fold — for CPU profiling of the fold alone
// (node --cpu-prof bench-fold.mjs --bible), without the open() phase in the profile.
if (process.env.BENCH_FOLD_ONLY) process.exit(0);

// ---------- 2. C1 — one usfm-js parse per alignment head at projection ----------
const allTexts = books.flatMap((b) => [...b.texts.values()]);
const c1 = bench(() => { for (const t of allTexts) verseTextMd5(t); });
const minusAlignFold = bench(() => fold(allMinusAlign));
const noAlignFold = bench(() => fold(allNoAlign));
console.log(`[C1] verseTextMd5 over the ${allTexts.length} projected alignment texts: ${f1(c1.median)} ms  (${(c1.median / allTexts.length).toFixed(3)} ms/parse)`);
console.log(`[C1] control — same fold minus align.verse.set ONLY (${allMinusAlign.length} events, decisions kept): ${f1(minusAlignFold.median)} ms  (alignment projection cost by difference: ${f1(full.median - minusAlignFold.median)} ms)`);
// The alignment loop also runs `slotKeysOf(skeleton).includes(vkey)` per head (fold.mjs,
// §8.6 orphan backstop) — a fresh regex walk of the WHOLE book skeleton for every head.
// Measured separately so the difference above can be attributed, not guessed at.
const c1b = bench(() => {
  for (const b of books) for (const k of b.slots) slotKeysOf(b.skeleton).includes(k);
});
console.log(`[C1] breakdown — slotKeysOf(skeleton).includes(vkey) per alignment head: ${f1(c1b.median)} ms over ${verseCount} heads`);

// ---------- 3. C2 — heads scan per mapped key in text.structure.apply ----------
const headKeys = (r) => Object.keys(r.liveHeads).length;
const baseKeys = headKeys(noAlignFold.out);
const mLow = 0; // identity apply — same shape, zero mapped keys
const mHigh = QUICK ? 20 : 500; // 500: large enough that the scan clears the run-to-run noise floor (~10 ms)
const applyLow = buildRenameApply(books[0], mLow);
const applyHigh = buildRenameApply(books[0], mHigh);
const foldWithApply = (apply) => {
  const r = fold([...allNoAlign, apply.event]);
  if (r.pendingStructural.length) throw new Error('C2 apply did not apply — pendingStructural non-empty');
  return r;
};
const c2Low = bench(() => foldWithApply(applyLow));
const c2High = bench(() => foldWithApply(applyHigh));
const perKey = (c2High.median - c2Low.median) / (applyHigh.mapped - applyLow.mapped);
console.log(`[C2] text-only union: ${allNoAlign.length} events, ${baseKeys} head keys; base fold ${f1(noAlignFold.median)} ms`);
console.log(`[C2] + one constant-shape rename apply, ${applyLow.mapped} mapped keys: ${f1(c2Low.median)} ms; ${applyHigh.mapped} mapped keys: ${f1(c2High.median)} ms`);
console.log(`[C2] marginal scan cost: ${perKey.toFixed(3)} ms per mapped key over ${baseKeys} head keys (${((perKey / baseKeys) * 1e6).toFixed(1)} ns per mapped-key×head)`);

// ---------- 4. C3 — scan of all heads for each book at projection ----------
console.log('[C3] text-only fold vs book count (the per-book projection scan is O(books × head keys)):');
const cuts = [...new Set([Math.ceil(NT.length / 4), Math.ceil(NT.length / 2), NT.length])];
for (const n of cuts) {
  const evs = eventsOf(books.slice(0, n), { aligned: false });
  const r = bench(() => fold(evs));
  console.log(`[C3]   ${String(n).padStart(2)} books, ${String(evs.length).padStart(5)} events, ${String(headKeys(r.out)).padStart(5)} head keys: ${f1(r.median)} ms`);
}

// ---------- 5. open() full-scan baseline (#62) — REFERENCE READER, a LOWER BOUND ----
// The client's open() lists and reads EVERY segment of every actor, validates each
// (validateSegment), and folds the union — O(all segments) per open(). Model: one
// sealed action segment per event (D50: one save = one segment), on local disk,
// through the SYNCHRONOUS filesystem reference reader (readUnion).
// This is NOT the production open path (PR #96 review, finding 1): the client
// fetches each segment with one sequentially-awaited HTTP request
// (ServerApi.readIngredient), plus replay/inventory/recovery work in
// JournalingStore.open — so the production open costs MORE than this baseline by
// roughly (per-request HTTP round trip × segment count). Record the transport
// term separately against a live rig.
const tmpRoot = fs.mkdtempSync(path.join(process.env.BENCH_TMPDIR || os.tmpdir(), 'bench-fold-'));
const journalDir = path.join(tmpRoot, 'journal');
const actorDir = actorDirFor(journalDir, ACTOR);
const checkpoints = (QUICK ? [200, 500] : BIBLE ? [8000, 32000, 128000] : [1000, 2000, 4000, 8000])
  .filter((n) => n < allAligned.length)
  .concat(allAligned.length);
console.log(`[open] full-scan baseline — REFERENCE READER (fs), a LOWER BOUND on the production HTTP open path; one segment per event, ${REPS} repetition(s) per size (read+validate, then +fold):`);
try {
  let written = 0;
  const byTs = [...allAligned].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  for (const n of checkpoints) {
    const t0 = process.hrtime.bigint();
    for (; written < n; written++) writeActionSegment(actorDir, [byTs[written]]);
    const writeMs = ms(t0);
    const scan = bench(() => readUnion(journalDir));
    const scanFold = bench(() => fold(readUnion(journalDir)));
    console.log(`[open]   ${String(n).padStart(6)} segments: scan ${f1(scan.median)} ms, scan+fold ${f1(scanFold.median)} ms  (write of last batch: ${f1(writeMs)} ms)`);
  }
  // on-disk journal size at full length — content bytes; the filesystem block
  // overhead (one block per small file) comes on top of this
  const segDir = path.join(actorDir, 'segments');
  let diskBytes = 0;
  for (const f of fs.readdirSync(segDir)) diskBytes += fs.statSync(path.join(segDir, f)).size;
  console.log(`[open] on-disk journal: ${written} segments, ${diskBytes.toLocaleString('en-US')} bytes (${(diskBytes / 2 ** 20).toFixed(1)} MiB content; avg ${(diskBytes / written).toFixed(0)} B/segment)`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('');
console.log('done. Record these numbers in docs/evidence/ with the machine, the commit and the date (issue #80).');
