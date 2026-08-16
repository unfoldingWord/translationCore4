// Journal conformance suite — BURRITO-SPEC §8 / Appendix A (J1–J30), spec 1.8 (the D48
// flip change set). Properties use fast-check with a FIXED seed for reproducibility.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { makeClock, parseTs } from './journal/hlc.mjs';
import { SLOT, decompose, recompose } from './journal/skeleton.mjs';
import { fold, verseTextMd5, slotKeysOf } from './journal/fold.mjs';
import { reconcileUsfm, seedFromSidecars } from './journal/reconcile.mjs';
import {
  sealAction, writeActionSegment, validateSegment, validateActorDoc, segmentName,
  readSegments, readUnion, SEGMENT_LIMIT,
} from './journal/files.mjs';
import * as filesAll from './journal/files.mjs';
const republishSegment = filesAll.republishSegment
  || (() => { throw new Error('republishSegment not implemented'); });
import {
  projectResources, projectSettings, projectAlignments, derivedProjections,
  classifyDivergence, isUnjournaledIngredient,
} from './journal/checkpoint.mjs';

const require = createRequire(import.meta.url);
const fc = require('fast-check');

const SEED = 20260707;
const FC = { seed: SEED, numRuns: 200 };
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const deepEq = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
const sort = (o) => Array.isArray(o) ? o.map(sort)
  : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])])) : o;
const BURRITO = path.resolve('./sample-burrito');
const ING = (p) => path.join(BURRITO, 'ingredients', p);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const prop = (name, arb, predicate) => {
  const r = fc.check(fc.property(arb, predicate), FC);
  check(name, !r.failed, r.failed ? `counterexample (seed ${SEED}): ${JSON.stringify(r.counterexample).slice(0, 140)}` : `${FC.numRuns} runs, seed ${SEED}`);
};
const mkEvent = (o) => ({ v: 1, base: null, ...o });

// deterministic PRNG shuffle (for non-fc shuffles)
const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffled = (arr, rng) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- J1: HLC ----------
{
  let t = 1000;
  const c = makeClock('actor-a', () => t);
  const t1 = c.issue(); const t2 = c.issue(); t += 5; const t3 = c.issue();
  check('J1: same-ms issues increment counter; advance resets', t1 < t2 && t2 < t3 && parseTs(t2).counter === 1 && parseTs(t3).counter === 0);
  const far = '2030-01-01T00:00:00.000Z|00ff|actor-b';
  c.ratchet(far);
  const t4 = c.issue();
  check('J1: receive-ratchet — next issue sorts after everything seen', t4 > far, t4);
  const o = makeClock('actor-a', () => 2000);
  let last = ''; for (let i = 0; i <= 0x10000; i++) last = o.issue();
  check('J1: counter overflow bumps physical ms and resets counter', parseTs(last).physical === 2001 && parseTs(last).counter === 0);
  prop('J1: property — issue order ≡ string sort order across interleaved clocks',
    fc.array(fc.record({ actor: fc.constantFrom(0, 1), advance: fc.nat({ max: 3 }) }), { minLength: 1, maxLength: 60 }),
    (cmds) => {
      let now = 5000; const clocks = [makeClock('actor-a', () => now), makeClock('actor-b', () => now)];
      const issued = [];
      for (const { actor, advance } of cmds) { now += advance; const ts = clocks[actor].issue(); clocks[1 - actor].ratchet(ts); issued.push(ts); }
      const sorted = [...issued].sort();
      return new Set(issued).size === issued.length && issued.every((ts, i) => ts === sorted[i]);
    });
}

// ---------- J2: skeleton codec ----------
{
  check('J2: SLOT is U+0001 (encoding sanity)', SLOT.length === 1 && SLOT.charCodeAt(0) === 1);
  const fixtures = {
    'sample TIT.usfm': fs.readFileSync(ING('TIT.usfm'), 'utf8'),
    'sample JON.usfm': fs.readFileSync(ING('JON.usfm'), 'utf8'),
    'aligned (zaln inside verse)': '\\id TIT test\n\\c 1\n\\p\n\\v 1 \\zaln-s |x-strong="G39720" x-content="Παῦλος"\\*\\w Pablo|x-occurrence="1" x-occurrences="1"\\w*\\zaln-e\\*, siervo.\n\\v 2 plain\n',
    'span keys (\\v 4-5)': '\\id TIT test\n\\c 1\n\\p\n\\v 1 uno\n\\v 4-5 cuatro y cinco\n\\v 6 seis\n',
    'structure-rich': '\\id JON test\n\\h Jonás\n\\toc1 Jonás\n\\mt Jonás\n\\c 1\n\\s5 título\n\\p\n\\v 1 primero\n\\q1 poesía\n\\q2 más\n\\p\n\\v 2 segundo \\f + \\ft nota\\f* final\n\\c 2\n\\p\n\\v 1 capítulo dos\n',
    'ts-chunked (imported file carrying \\ts\\* milestones)': '\\id TIT test\n\\c 1\n\\ts\\*\n\\p\n\\v 1 Pablo siervo de Dios,\n\\v 2 con esperanza de vida eterna,\n\\ts\\*\n\\p\n\\v 3 a su debido tiempo,\n\\v 4 a Tito, verdadero hijo.\n\\ts\\*\n\\p\n\\v 5 Por esta causa te dejé en Creta,\n',
  };
  for (const [name, f] of Object.entries(fixtures)) {
    const { skeleton, verses } = decompose(f);
    check(`J2: byte-identical recompose — ${name}`, recompose(skeleton, verses) === f, `${Object.keys(verses).length} verses`);
  }
  let rejected = false; try { decompose('\\id X\n\\v 1 bad' + SLOT); } catch { rejected = true; }
  check('J2: U+0001 in source is rejected', rejected);
  const base = fixtures['structure-rich'];
  prop('J2: property — mutate any verse, recompose still exact',
    fc.record({ idx: fc.nat({ max: 4 }), text: fc.stringMatching(/^[ -\[\]-~áéíñ]{0,40}$/) }),
    ({ idx, text }) => {
      const { skeleton, verses } = decompose(base);
      const keys = Object.keys(verses); const k = keys[idx % keys.length];
      const mutated = { ...verses, [k]: text + '\n' };
      const out = recompose(skeleton, mutated);
      const round = decompose(out);
      return round.verses[k] === text + '\n' && recompose(round.skeleton, round.verses) === out;
    });
}

// ---------- shared scenario builder ----------
const buildSeed = () => {
  const books = { TIT: fs.readFileSync(ING('TIT.usfm'), 'utf8'), JON: fs.readFileSync(ING('JON.usfm'), 'utf8') };
  const decisionFiles = {
    translationWords: JSON.parse(fs.readFileSync(ING('checking/translationWords/TIT.json'), 'utf8')),
    translationNotes: JSON.parse(fs.readFileSync(ING('checking/translationNotes/TIT.json'), 'utf8')),
  };
  const alignmentFiles = { TIT: JSON.parse(fs.readFileSync(ING('checking/alignments/TIT.json'), 'utf8')) };
  return { events: seedFromSidecars({ actor: 'seed-actor', books, decisionFiles, alignmentFiles }), books, decisionFiles, alignmentFiles };
};

// ---------- J3: fold determinism (property) ----------
{
  const genEvents = fc.array(
    fc.record({
      actor: fc.constantFrom(0, 1), advance: fc.nat({ max: 2 }),
      kind: fc.constantFrom('verse', 'pin', 'meta', 'note', 'decision'),
      key: fc.nat({ max: 2 }), val: fc.stringMatching(/^[0-9a-f]{0,6}$/), linear: fc.boolean(),
    }), { minLength: 1, maxLength: 40 }
  ).map((cmds) => {
    let now = 9000; const actors = ['actor-a', 'actor-b'];
    const clocks = actors.map((a) => makeClock(a, () => now));
    const lastByKey = {};
    const skeleton = `\\id TIT\n\\c 1\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
    const events = [mkEvent({ op: 'book.add', actor: 'actor-a', ts: '2026-01-01T00:00:00.000Z|0000|actor-a', book: 'TIT', scope: [], skeleton, initialVerses: {} })];
    for (const c of cmds) {
      now += c.advance; const actor = actors[c.actor]; const ts = clocks[c.actor].issue(); clocks[1 - c.actor].ratchet(ts);
      let e;
      if (c.kind === 'verse') e = { op: 'text.verse.set', book: 'TIT', chapter: '1', verse: String(c.key + 1), text: c.val + '\n' };
      else if (c.kind === 'pin') e = { op: 'resource.pin.set', slot: `extraScripture.s${c.key}`, entry: { v: c.val } };
      else if (c.kind === 'meta') e = { op: 'project.meta.set', path: `p.${c.key}`, value: c.val };
      else if (c.kind === 'note') e = { op: 'note.add', generation: events[0].ts, target: { book: 'TIT', chapter: '1', verse: String(c.key + 1) }, text: c.val };
      else e = { op: 'check.decision.set', toolId: 'translationWords', generation: events[0].ts, decision: { contextId: { checkId: `c${c.key}`, reference: { bookId: 'tit', chapter: 1, verse: c.key + 1 }, occurrence: 1 }, selections: false, note: c.val } };
      const kkey = c.kind + c.key;
      events.push(mkEvent({ ...e, actor, ts, base: c.linear ? lastByKey[kkey] ?? null : null }));
      lastByKey[kkey] = ts;
    }
    return events;
  });
  prop('J3: property — fold(events) ≡ fold(shuffle) ≡ fold(partition union) ≡ fold(+duplicates)', genEvents, (events) => {
    const rng = mulberry32(SEED);
    const a = fold(events);
    const b = fold(shuffled(events, rng));
    const cut = Math.floor(events.length / 2);
    const c = fold([...events.slice(cut), ...events.slice(0, cut)]);
    const d = fold([...events, ...events.slice(0, 3)]);
    return deepEq(a, b) && deepEq(a, c) && deepEq(a, d);
  });
}

// ---------- J4–J7, J13, J14 unit tests over one scenario ----------
{
  const S = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (ms, c, a) => `2026-02-01T00:00:0${ms}.000Z|000${c}|${a}`;
  const seedEvts = [
    E('book.add', 'actor-a', t(0, 0, 'actor-a'), null, { book: 'TIT', scope: [], skeleton: S, initialVerses: {} }),
    E('text.verse.set', 'actor-a', t(1, 0, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', text: 'uno\n' }),
    E('text.verse.set', 'actor-a', t(1, 1, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '2', text: 'dos\n' }),
  ];
  const base11 = t(1, 0, 'actor-a');

  const lin = fold([...seedEvts, E('text.verse.set', 'actor-a', t(2, 0, 'actor-a'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'uno v2\n' })]);
  check('J4: LWW linear — later event with base=head replaces', lin.books.TIT.verses['1:1'] === 'uno v2\n' && lin.forks.length === 0);

  const forkA = E('text.verse.set', 'actor-a', t(3, 0, 'actor-a'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'versión A\n' });
  const forkB = E('text.verse.set', 'actor-b', t(3, 1, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'versión B\n' });
  const forked = fold([...seedEvts, forkA, forkB]);
  check('J5: fork detected — same base, different actors+payloads; provisional = max ts, surfaced',
    forked.forks.length === 1 && forked.forks[0].provisional === forkB.ts && forked.books.TIT.verses['1:1'] === 'versión B\n',
    JSON.stringify(forked.forks[0]?.heads));
  const twin = fold([...seedEvts, forkA, { ...forkB, text: 'versión A\n' }]);
  check('J5: identical-content fork auto-merges (distinct events by identity, no review item)', twin.forks.length === 0 && twin.books.TIT.verses['1:1'] === 'versión A\n');

  const resolve = E('text.verse.set', 'actor-c', t(4, 0, 'actor-c'), forkB.ts, { supersedes: [forkA.ts, forkB.ts], book: 'TIT', chapter: '1', verse: '1', text: 'resuelta\n' });
  const resolved = fold([...seedEvts, forkA, forkB, resolve]);
  check('J6: supersedes both heads resolves the fork', resolved.forks.length === 0 && resolved.books.TIT.verses['1:1'] === 'resuelta\n');
  const continueOnly = fold([...seedEvts, forkA, forkB, E('text.verse.set', 'actor-b', t(4, 1, 'actor-b'), t(1, 1, 'actor-a'), { book: 'TIT', chapter: '1', verse: '2', text: 'x\n' }), E('text.verse.set', 'actor-b', t(5, 0, 'actor-b'), forkB.ts, { book: 'TIT', chapter: '1', verse: '1', text: 'B sigue\n' })]);
  check('J6: a plain continuing edit advances its branch but does NOT resolve the fork',
    continueOnly.forks.length === 1 && continueOnly.forks[0].heads.length === 2 && continueOnly.books.TIT.verses['1:1'] === 'B sigue\n',
    JSON.stringify(continueOnly.forks[0]?.heads));

  const alignOk = E('align.verse.set', 'actor-c', t(6, 0, 'actor-c'), null, { book: 'TIT', chapter: '1', verse: '1', generation: seedEvts[0].ts, alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  const st1 = fold([...seedEvts, alignOk]);
  const st2 = fold([...seedEvts, alignOk, E('text.verse.set', 'actor-b', t(7, 0, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'cambiada\n' })]);
  const st3 = fold([...seedEvts, alignOk, E('text.verse.set', 'actor-b', t(7, 0, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'cambiada\n' }), E('align.verse.set', 'actor-b', t(8, 0, 'actor-b'), alignOk.ts, { book: 'TIT', chapter: '1', verse: '1', generation: seedEvts[0].ts, alignments: [], wordBank: [], targetVerseMd5: md5('cambiada') })]);
  check('J7: I-3 composition — valid → text edit invalidates → re-align revalidates',
    st1.invalid.length === 0 && st2.invalid.length === 1 && st3.invalid.length === 0,
    `invalid counts ${st1.invalid.length}/${st2.invalid.length}/${st3.invalid.length}`);

  check('J13: duplicate identical events are a no-op', deepEq(fold([...seedEvts, forkA, forkA, forkA]), fold([...seedEvts, forkA])));
  let dupThrew = false; try { fold([...seedEvts, forkA, { ...forkA, text: 'otro\n' }]); } catch { dupThrew = true; }
  check('J13: same ts + different content refuses (corrupt union)', dupThrew);
  let vThrew = ''; try { fold([mkEvent({ op: 'text.verse.set', actor: 'x-actor', ts: t(0, 0, 'x-actor'), v: 2 })]); } catch (e) { vThrew = e.message; }
  let opThrew = ''; try { fold([mkEvent({ op: 'text.verse.merge', actor: 'x-actor', ts: t(0, 0, 'x-actor') })]); } catch (e) { opThrew = e.message; }
  check('J14: unknown v / unknown op refuse with clear messages', vThrew.includes('version') && opThrew.includes('unrecognized op'), `"${vThrew.slice(0, 40)}" / "${opThrew.slice(0, 40)}"`);
}

// ---------- J14b (round 6): the schema is TOTAL over the envelope — every field the fold
//   dereferences has a shape rule; malformed input gets a clean rejection, never a crash ----------
{
  const okTs = (s, a = 'actor-a') => `2026-08-14T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const baseEvent = { v: 1, op: 'settings.set', actor: 'actor-a', ts: okTs(1), base: null, path: 'ui.x', value: 1 };
  const skel1 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const rows = [
    ['supersedes is not an array (the reviewer\'s crash)', { ...baseEvent, supersedes: { not: 'an array' } }],
    ['supersedes entry is not a ts', { ...baseEvent, supersedes: ['not-a-ts'] }],
    ['base is a number', { ...baseEvent, base: 42 }],
    ['base is a non-ts string', { ...baseEvent, base: 'yesterday' }],
    ['batch is an object', { ...baseEvent, batch: {} }],
    ['seed is a string', { ...baseEvent, seed: 'creation' }],
    ['seed.source outside the §8.3 enum', { ...baseEvent, seed: { source: 'time-travel', batch: okTs(0) } }],
    ['generation is null', { v: 1, op: 'note.add', actor: 'actor-a', ts: okTs(2), base: null, generation: null, target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'x' }],
    ['generation is a non-ts string', { v: 1, op: 'note.add', actor: 'actor-a', ts: okTs(2), base: null, generation: 'gen-1', target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'x' }],
    ['ts counter outside lowercase hex', { ...baseEvent, ts: '2026-08-14T00:00:01.000Z|ZZZZ|actor-a' }],
    ['ts actor slug outside [a-z0-9-]{4,32}', { v: 1, op: 'settings.set', actor: 'Actor_A', ts: '2026-08-14T00:00:01.000Z|0000|Actor_A', base: null, path: 'ui.x', value: 1 }],
    ['structural source ts is a number', { v: 1, op: 'text.structure.apply', actor: 'actor-a', ts: okTs(3), base: okTs(1),
      book: 'TIT', skeleton: skel1, transitions: { '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: 42 }] } }, dispositions: [] }],
    ['disposition ts is not a ts', { v: 1, op: 'text.structure.apply', actor: 'actor-a', ts: okTs(3), base: okTs(1),
      book: 'TIT', skeleton: skel1, transitions: { '1:1': { text: 'uno\n', sources: [] } },
      dispositions: [{ surface: 'alignment', key: '1:1', ts: 'whenever', action: 'orphan-review' }] }],
  ];
  const CRASHY = /Cannot read|is not iterable|is not a function|undefined is not/i;
  let allClean = true; const details = [];
  for (const [label, ev] of rows) {
    let sealMsg = ''; let foldMsg = '';
    try { sealAction([ev]); } catch (e) { sealMsg = e.message; }
    try { fold([ev]); } catch (e) { foldMsg = e.message; }
    const clean = sealMsg !== '' && foldMsg !== '' && !CRASHY.test(sealMsg) && !CRASHY.test(foldMsg);
    if (!clean) { allClean = false; details.push(`${label}: seal="${sealMsg.slice(0, 40)}" fold="${foldMsg.slice(0, 40)}"`); }
  }
  check('J14b: every wrong-typed envelope/ts-shaped field is refused CLEANLY at seal AND at fold — no raw TypeError, no silent pass',
    allClean, details.join(' · '));
}

// ---------- J14c (round 7): the schema is TOTAL over PER-OP PAYLOADS too — one shared
//   §5.1/§5.2 record validator; every payload field the fold dereferences has a rule ----------
{
  const okTs = (s, a = 'actor-a') => `2026-08-14T01:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const skel1 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  // the reviewer's event: seals fine, then the fold crashes reading contextId.reference.bookId
  const reviewers = { v: 1, op: 'check.decision.set', actor: 'actor-a', ts: okTs(1), base: null,
    generation: okTs(0), toolId: 'translationWords', decision: { contextId: {} } };
  let sealMsg0 = ''; let foldMsg0 = '';
  try { sealAction([reviewers]); } catch (e) { sealMsg0 = e.message; }
  try { fold([reviewers]); } catch (e) { foldMsg0 = e.message; }
  const CRASHY = /Cannot read|is not iterable|is not a function|undefined is not|toUpperCase/i;
  check('J14c: the reviewer\'s event — a decision with an EMPTY contextId — is refused AT SEAL (and cleanly at fold), never sealed-then-crashed',
    sealMsg0 !== '' && foldMsg0 !== '' && !CRASHY.test(sealMsg0) && !CRASHY.test(foldMsg0),
    `seal="${sealMsg0.slice(0, 50)}" fold="${foldMsg0.slice(0, 50)}"`);
  // wrong-typed payload table, one row per op family — every field the fold dereferences
  const dec = (over) => ({ v: 1, op: 'check.decision.set', actor: 'actor-a', ts: okTs(1), base: null,
    generation: okTs(0), toolId: 'translationWords',
    decision: { contextId: { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: '1', verse: '2' }, ...over } } });
  const rows = [
    ['check.decision.set reference.bookId is a number (fold crash: .toUpperCase)',
      dec({ reference: { bookId: 7, chapter: '1', verse: '2' } })],
    ['check.decision.set contextId without checkId (silent "undefined" identity key)', dec({ checkId: undefined })],
    ['check.decision.set contextId without occurrence', dec({ occurrence: undefined })],
    ['check.decision.set reference.chapter is an object', dec({ reference: { bookId: 'tit', chapter: {}, verse: '2' } })],
    ['text.verse.set chapter is an object (silent "[object Object]" key)',
      { v: 1, op: 'text.verse.set', actor: 'actor-a', ts: okTs(2), base: null, book: 'TIT', chapter: {}, verse: '1', text: 'x\n' }],
    ['text.verse.set verse is an object',
      { v: 1, op: 'text.verse.set', actor: 'actor-a', ts: okTs(2), base: null, book: 'TIT', chapter: '1', verse: {}, text: 'x\n' }],
    ['align.verse.set chapter is an object',
      { v: 1, op: 'align.verse.set', actor: 'actor-a', ts: okTs(3), base: null, generation: okTs(0),
        book: 'TIT', chapter: {}, verse: '1', alignments: [], wordBank: [], targetVerseMd5: md5('x') }],
    ['note.add verse-target book is an object',
      { v: 1, op: 'note.add', actor: 'actor-a', ts: okTs(4), base: null, generation: okTs(0),
        target: { book: {}, chapter: '1', verse: '1' }, text: 'n' }],
    ['note.add verse-target chapter is an object',
      { v: 1, op: 'note.add', actor: 'actor-a', ts: okTs(4), base: null, generation: okTs(0),
        target: { book: 'TIT', chapter: {}, verse: '1' }, text: 'n' }],
    ['book.add initialVerses value is a number (projected verse would not be a string)',
      { v: 1, op: 'book.add', actor: 'actor-a', ts: okTs(5), base: null,
        book: 'TIT', scope: [], skeleton: skel1, initialVerses: { '1:1': 42 } }],
  ];
  let allClean = true; const details = [];
  for (const [label, ev] of rows) {
    let sealMsg = ''; let foldMsg = '';
    try { sealAction([ev]); } catch (e) { sealMsg = e.message; }
    try { fold([ev]); } catch (e) { foldMsg = e.message; }
    const clean = sealMsg !== '' && foldMsg !== '' && !CRASHY.test(sealMsg) && !CRASHY.test(foldMsg);
    if (!clean) { allClean = false; details.push(`${label}: seal="${sealMsg.slice(0, 40)}" fold="${foldMsg.slice(0, 40)}"`); }
  }
  check('J14c: every wrong-typed PER-OP payload field the fold dereferences is refused CLEANLY at seal AND at fold — no raw TypeError, no silent pass',
    allClean, details.join(' · '));
}

// ---------- J8: out-of-band reconcile ----------
{
  const { events } = buildSeed();
  const out = fold(events);
  const edited = out.books.TIT.usfm.replace('Pablo, siervo de Dios', 'Saulo, siervo de Dios');
  const clock = makeClock('reconciler', () => Date.parse('2026-07-07T12:00:00.000Z'));
  const recEvents = reconcileUsfm('TIT', edited, out, clock, 'reconciler');
  const after = fold([...events, ...recEvents]);
  check('J8: reconcile emits seeded supersede; fold equals the edited file', recEvents.length === 1 && recEvents[0].seed.source === 'out-of-band-usfm' && after.books.TIT.usfm === edited && after.forks.length === 0);
  const concurrent = mkEvent({ op: 'text.verse.set', actor: 'actor-z', ts: '2026-07-07T11:59:00.000Z|0000|actor-z', base: out.headsTs['text|TIT|1:1'], book: 'TIT', chapter: '1', verse: '1', text: 'edición concurrente\n' });
  const clash = fold([...events, ...recEvents, concurrent]);
  check('J8: concurrent journal edit on the same verse surfaces as a fork (never silent)', clash.forks.some((f) => f.key === 'text|TIT|1:1'));
  check('J8: alignment invalidation composes with reconcile (edited verse alignment goes stale)', after.invalid.some((i) => i.book === 'TIT' && i.verse === '1:1'));
}

// ---------- J9 + J10: convergence & sneakernet via real sealed segments ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-journal-'));
  const { events } = buildSeed();
  const out0 = fold(events);
  const eA = mkEvent({ op: 'text.verse.set', actor: 'device-aa', ts: '2026-07-07T13:00:00.000Z|0000|device-aa', base: out0.headsTs['text|TIT|1:2'], book: 'TIT', chapter: '1', verse: '2', text: 'con la esperanza EDITADA A\n' });
  const eB = mkEvent({ op: 'text.verse.set', actor: 'device-bb', ts: '2026-07-07T13:00:01.000Z|0000|device-bb', base: out0.headsTs['text|TIT|1:3'], book: 'TIT', chapter: '1', verse: '3', text: 'EDITADA B\n' });
  const J = (d) => path.join(tmp, d, 'journal');
  for (const d of ['deviceA', 'deviceB', 'integrator']) fs.mkdirSync(J(d), { recursive: true });
  writeActionSegment(path.join(J('deviceA'), 'seed-actor'), events); // the seed action, one sealed segment
  execSync(`cp -R "${path.join(J('deviceA'), 'seed-actor')}" "${path.join(J('deviceB'), 'seed-actor')}"`);
  writeActionSegment(path.join(J('deviceA'), 'device-aa'), [eA]);
  writeActionSegment(path.join(J('deviceB'), 'device-bb'), [eB]);
  // sneakernet: copy both actor dirs into integrator
  for (const [d, a] of [['deviceA', 'seed-actor'], ['deviceA', 'device-aa'], ['deviceB', 'device-bb']])
    execSync(`cp -R "${path.join(J(d), a)}" "${path.join(J('integrator'), a)}"`);
  const foldA = fold([...readUnion(J('deviceA')), ...readUnion(J('deviceB'))]);
  const foldI = fold(readUnion(J('integrator')));
  const foldM = fold([...events, eA, eB]);
  check('J9: three-device disjoint edits converge — identical bytes, zero forks',
    foldI.books.TIT.usfm === foldM.books.TIT.usfm && foldI.forks.length === 0 && foldI.books.TIT.usfm.includes('EDITADA A') && foldI.books.TIT.usfm.includes('EDITADA B'));
  check('J10: sneakernet (file copy union) ≡ in-memory union ≡ cross-device read', deepEq(foldA, foldI) && deepEq(foldI, foldM));

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J12: end-to-end git — sealed segments + fold + derived-file regeneration ----------
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j12-'));
  const git = (args, cwd = T) => execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString();
  const { events } = buildSeed();
  const writeCheckpoint = (dir, evts) => {
    const out = fold(evts);
    fs.mkdirSync(path.join(dir, 'ingredients'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ingredients/TIT.usfm'), out.books.TIT.usfm);
    return out;
  };
  git('init -q .'); git('config user.email t@t'); git('config user.name T');
  fs.writeFileSync(path.join(T, '.gitattributes'), 'ingredients/*.usfm merge=ours\nmetadata.json merge=ours\n');
  const jdir = (actor) => path.join(T, 'ingredients/checking/journal', actor);
  writeActionSegment(jdir('seed-actor'), events);
  writeCheckpoint(T, readUnion(path.join(T, 'ingredients/checking/journal')));
  git('add -A'); git('commit -qm base');
  const out0 = fold(readUnion(path.join(T, 'ingredients/checking/journal')));

  git('checkout -qb actor-a');
  writeActionSegment(jdir('device-aa'), [mkEvent({ op: 'text.verse.set', actor: 'device-aa', ts: '2026-07-07T14:00:00.000Z|0000|device-aa', base: out0.headsTs['text|TIT|1:2'], book: 'TIT', chapter: '1', verse: '2', text: 'A cambió v2\n' })]);
  writeCheckpoint(T, readUnion(path.join(T, 'ingredients/checking/journal')));
  git('add -A'); git('commit -qm "checkpoint A"');

  git('checkout -q main 2>/dev/null || git checkout -q master', T); git('checkout -qb actor-b HEAD~0');
  git('checkout -q actor-b');
  writeActionSegment(jdir('device-bb'), [mkEvent({ op: 'text.verse.set', actor: 'device-bb', ts: '2026-07-07T14:00:01.000Z|0000|device-bb', base: out0.headsTs['text|TIT|1:3'], book: 'TIT', chapter: '1', verse: '3', text: 'B cambió v3\n' })]);
  writeCheckpoint(T, readUnion(path.join(T, 'ingredients/checking/journal')));
  git('add -A'); git('commit -qm "checkpoint B"');

  git('checkout -q actor-a');
  let conflicted = false;
  try { git('merge --no-edit actor-b'); } catch { conflicted = true; }
  const status = execSync('git status --porcelain', { cwd: T }).toString();
  check('J12: naive merge of two checkpoints conflicts on the derived USFM', conflicted && /^UU ingredients\/TIT.usfm/m.test(status), status.trim().split('\n')[0]);
  // resolve either side wholesale, regenerate post-union, commit (§8.7)
  git('checkout --ours ingredients/TIT.usfm');
  const union = readUnion(path.join(T, 'ingredients/checking/journal'));
  const regen = writeCheckpoint(T, union);
  git('add -A'); git('commit -qm "integrate (regenerated post-union)"');
  const parents = git('log -1 --format=%P').trim().split(' ');
  const finalUsfm = fs.readFileSync(path.join(T, 'ingredients/TIT.usfm'), 'utf8');
  check('J12: resolve-either-side + regenerate → two-parent commit; both edits present; bytes = fold(union)',
    parents.length === 2 && finalUsfm === regen.books.TIT.usfm && finalUsfm.includes('A cambió v2') && finalUsfm.includes('B cambió v3') && regen.forks.length === 0);
  const journals = fs.readdirSync(path.join(T, 'ingredients/checking/journal')).sort();
  check('J12: both actors\' journals present after integration', deepEq(journals, ['device-aa', 'device-bb', 'seed-actor']));
  fs.rmSync(T, { recursive: true, force: true });
}

// ---------- J15: Phase-1 sidecar seed migration (golden vs the real sample) ----------
{
  const { events, decisionFiles, alignmentFiles, books } = buildSeed();
  const out = fold(events);
  check('J15: seeded fold reproduces the committed USFM byte-exactly', out.books.TIT.usfm === books.TIT && out.books.JON.usfm === books.JON);
  const wantTw = decisionFiles.translationWords.decisions;
  const gotTw = out.decisions.translationWords || [];
  const wantTn = decisionFiles.translationNotes.decisions;
  const gotTn = out.decisions.translationNotes || [];
  check('J15: decisions round-trip exactly (records deep-equal, counts match)',
    gotTw.length === wantTw.length && gotTn.length === wantTn.length &&
    wantTw.every((d) => gotTw.some((g) => deepEq(g, d))) && wantTn.every((d) => gotTn.some((g) => deepEq(g, d))),
    `${gotTw.length}+${gotTn.length} decisions`);
  const wantAl = alignmentFiles.TIT.chapters['1']['1'];
  const gotAl = out.alignments.TIT?.['1:1'];
  check('J15: alignment records round-trip exactly (incl. targetVerseMd5)',
    !!gotAl && deepEq(gotAl.alignments, wantAl.alignments) && deepEq(gotAl.wordBank, wantAl.wordBank) && gotAl.targetVerseMd5 === wantAl.targetVerseMd5);
  check('J15: migrated alignments are valid against the folded text (I-3 carries over)', out.invalid.length === 0, `${out.invalid.length} invalid`);
}

// ---------- J15 (full state): fold(seed) == state, byte-for-byte, on a PARTIAL-SCOPE fixture ----------
// Seeding must reproduce a real project: actual per-book scope, resource pins, settings,
// project metadata, and complete §5.1 alignment records (sourceVersion, invalid, …).
try {
  const sample = JSON.parse(fs.readFileSync(ING('checking/resources.json'), 'utf8'));
  const LS = ['gatewayLanguage', 'translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
  const ordered = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';

  // The fixture: a partial-scope project (TIT 1:1-1:3 only), authored independently.
  const usfm = '\\id TIT proyecto parcial\n\\h Tito\n\\mt Tito\n\\c 1\n\\p\n\\v 1 Pablo, siervo de Dios,\n\\v 2 con esperanza de vida eterna,\n\\v 3 a su debido tiempo manifestó su palabra,\n';
  const scope = ['1:1-1:3'];
  const alignRec = {
    alignments: [{ topWords: [{ word: 'Παῦλος', strong: 'G39720', lemma: 'Παῦλος', morph: 'Gr,N,,,,,NMS,', occurrence: 1, occurrences: 1 }], bottomWords: [{ word: 'Pablo', occurrence: 1, occurrences: 1 }] }],
    wordBank: [{ word: 'siervo', occurrence: 1, occurrences: 1 }],
    invalid: false,
    targetVerseMd5: verseTextMd5('Pablo, siervo de Dios,\n'),
    sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34',
  };
  // an INVALIDATED alignment (stale hash, invalid: true) — real projects carry these,
  // and the firing-tests principle demands the fixture exercise them
  const alignRecInvalid = {
    alignments: [],
    wordBank: [],
    invalid: true,
    targetVerseMd5: verseTextMd5('un texto viejo que ya no existe\n'),
    sourceVersion: 'dcs::unfoldingWord/el-x-koine_ugnt@v0.33',
  };
  const twResource = { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37', languageSet: 'primary' };
  const decision = {
    contextId: { checkId: 't1g7', occurrenceNote: '', reference: { bookId: 'tit', chapter: 1, verse: 1 }, tool: 'translationWords', groupId: 'god', quote: 'Θεοῦ', quoteString: 'Θεοῦ', glQuote: '', occurrence: 1 },
    category: 'kt', selections: [{ text: 'Dios', occurrence: 1, occurrences: 1 }], comments: false, reminders: false,
    nothingToSelect: false, verseEdits: false, invalidated: false, status: 'valid',
    modifiedTimestamp: '2026-07-02T14:21:07.000Z',
  };
  // an INVALIDATED decision (D36 carry-over shape) — retained state, part of real projects
  const decisionInvalid = {
    contextId: { checkId: 'w2k9', occurrenceNote: '', reference: { bookId: 'tit', chapter: 1, verse: 2 }, tool: 'translationWords', groupId: 'hope', quote: 'ἐλπίδι', quoteString: 'ἐλπίδι', glQuote: '', occurrence: 1 },
    category: 'kt', selections: false, comments: false, reminders: false,
    nothingToSelect: false, verseEdits: false, invalidated: true, status: 'invalid',
    modifiedTimestamp: '2026-07-03T09:00:00.000Z',
  };
  const settingsDoc = { schemaVersion: 1, checkCategories: { translationWords: ['kt', 'names'] }, ui: { paneSettings: [{ bibleId: 'targetBible', languageId: 'es-419' }], toolsSettings: {} } };
  const resourcesDoc = {
    schemaVersion: 2,
    languageSets: { primary: ordered(sample.languageSets.primary, LS), fallback: ordered(sample.languageSets.fallback, LS) },
    resources: { originalLanguage: ordered(sample.resources.originalLanguage, ['nt', 'ot']), lexicon: ordered(sample.resources.lexicon, ['nt', 'ot']) },
    extraScripture: sample.extraScripture,
  };
  const vrsBytes = fs.readFileSync(ING('vrs.json'), 'utf8');
  const baseMetadata = {
    format: 'scripture burrito',
    meta: { version: '1.0.0', category: 'source', normalization: 'NFC' },
    identification: { name: { en: 'Old Name' } },
    type: { flavorType: { name: 'scripture', flavor: { name: 'textTranslation' }, currentScope: {} } },
  };
  // The fixture's expected on-disk state, authored independently of the projection code:
  const expectedMetadata = serialize({
    format: 'scripture burrito',
    meta: { version: '1.0.0', category: 'source', normalization: 'NFC' },
    identification: { name: { en: 'Proyecto Parcial' } },
    type: { flavorType: { name: 'scripture', flavor: { name: 'textTranslation' }, currentScope: { TIT: ['1:1-1:3'] } } },
  });
  const state = {
    'TIT.usfm': usfm,
    'checking/alignments/TIT.json': serialize({ schemaVersion: 1, book: 'TIT', chapters: { 1: { 1: alignRec, 2: alignRecInvalid } } }),
    'checking/translationWords/TIT.json': serialize({ schemaVersion: 1, tool: 'translationWords', book: 'TIT', resource: twResource, decisions: [decision, decisionInvalid] }),
    'checking/resources.json': serialize(resourcesDoc),
    'checking/settings.json': serialize(settingsDoc),
    'vrs.json': vrsBytes,
    'metadata.json': expectedMetadata,
  };

  const seedEvents = seedFromSidecars({
    actor: 'seed-actor',
    books: { TIT: { usfm, scope } },
    decisionFiles: { translationWords: { decisions: [decision, decisionInvalid] } },
    alignmentFiles: { TIT: { chapters: { 1: { 1: alignRec, 2: alignRecInvalid } } } },
    resources: resourcesDoc,
    settings: settingsDoc,
    meta: { 'identification.name.en': 'Proyecto Parcial' },
    vrs: { name: 'eng', bytes: vrsBytes },
    source: 'creation',
  });
  const out = fold(seedEvents);
  const projections = derivedProjections(out, { baseMetadata, resolutions: { translationWords: { TIT: twResource } } });
  const mismatches = Object.keys(state).filter((p) => projections[p] !== state[p]);
  const extras = Object.keys(projections).filter((p) => !(p in state));
  check('J15 (full state): fold(seed) reproduces EVERY derived file of the partial-scope fixture byte-for-byte (scope, pins, settings, metadata, full §5.1 alignment fields — INVALIDATED records included)',
    mismatches.length === 0 && extras.length === 0,
    JSON.stringify({ mismatches, extras }));
  check('J15 (full state): the seeded scope is the fixture\'s actual partial scope, not a hardcoded whole-book default',
    deepEq(out.scope, { TIT: ['1:1-1:3'] }), JSON.stringify(out.scope));
  check('J15 (full state): the seeded alignment record carries all §5.1 fields (sourceVersion, invalid) through the fold',
    out.alignments.TIT?.['1:1']?.sourceVersion === alignRec.sourceVersion && out.alignments.TIT?.['1:1']?.invalid === false,
    JSON.stringify(Object.keys(out.alignments.TIT?.['1:1'] || {})));
  check('J15 (full state): the invalidated records seed and fold correctly — the stale alignment is reported by I-3, the invalidated decision is retained',
    out.alignments.TIT?.['1:2']?.invalid === true &&
    out.invalid.some((i) => i.book === 'TIT' && i.verse === '1:2') &&
    out.decisions.translationWords.some((d) => d.invalidated === true),
    JSON.stringify(out.invalid));
  // ...and they pass through a structural action with retention intact
  const skelR = usfm.replace('\\v 2 ', '\\v 9 '); // renumber 1:2 → 1:9 in the authored USFM
  const { skeleton: skelRnew } = decompose(skelR);
  const structTs = '2026-08-13T00:00:00.000Z|0000|seed-actor';
  const structEv = mkEvent({ op: 'text.structure.apply', actor: 'seed-actor', ts: structTs, base: out.headsTs['skel|TIT'], book: 'TIT',
    skeleton: skelRnew,
    transitions: {
      '1:1': { text: 'Pablo, siervo de Dios,\n', sources: [{ key: '1:1', ts: out.headsTs['text|TIT|1:1'] }] },
      '1:9': { text: 'con esperanza de vida eterna,\n', sources: [{ key: '1:2', ts: out.headsTs['text|TIT|1:2'] }] },
      '1:3': { text: 'a su debido tiempo manifestó su palabra,\n', sources: [{ key: '1:3', ts: out.headsTs['text|TIT|1:3'] }] },
    },
    dispositions: [
      { surface: 'alignment', key: '1:2', ts: out.headsTs['align|TIT|1:2'], action: 're-key', to: '1:9' },
      { surface: 'decision', key: 'translationWords|w2k9|tit|1|2|1', ts: out.headsTs['dec|translationWords|w2k9|tit|1|2|1'], action: 're-key', to: '1:9' },
    ] });
  const afterStruct = fold([...seedEvents, structEv]);
  check('J15 (full state): invalidated records pass through a structural action with retention intact — re-keyed, flags preserved, nothing dropped',
    afterStruct.pendingStructural.length === 0 &&
    afterStruct.alignments.TIT?.['1:9']?.invalid === true && !afterStruct.alignments.TIT?.['1:2'] &&
    afterStruct.decisions.translationWords.some((d) => d.invalidated === true && String(d.contextId.reference.verse) === '9'),
    JSON.stringify({ pending: afterStruct.pendingStructural, align: Object.keys(afterStruct.alignments.TIT || {}) }));
} catch (e) {
  check('J15 (full state): fold(seed) reproduces EVERY derived file of the partial-scope fixture byte-for-byte (scope, pins, settings, metadata, full §5.1 alignment fields — INVALIDATED records included)', false, e.message);
  check('J15 (full state): the seeded scope is the fixture\'s actual partial scope, not a hardcoded whole-book default', false, e.message);
  check('J15 (full state): the seeded alignment record carries all §5.1 fields (sourceVersion, invalid) through the fold', false, e.message);
  check('J15 (full state): the invalidated records seed and fold correctly — the stale alignment is reported by I-3, the invalidated decision is retained', false, e.message);
  check('J15 (full state): invalidated records pass through a structural action with retention intact — re-keyed, flags preserved, nothing dropped', false, e.message);
}

// ---------- J16: drafting by section vs checking by verse (\ts\* = presentation only; target text never carries it — §4.1/§8.4a). Fixtures model IMPORTED files + section-save batching. ----------
{
  const F = '\\id TIT test\n\\c 1\n\\ts\\*\n\\p\n\\v 1 Pablo siervo de Dios,\n\\v 2 con esperanza de vida eterna,\n\\ts\\*\n\\p\n\\v 3 a su debido tiempo,\n\\v 4 a Tito, verdadero hijo.\n\\ts\\*\n\\p\n\\v 5 Por esta causa te dejé en Creta,\n';
  const { skeleton, verses } = decompose(F);
  check('J16: imported \\ts\\* round-trips — chapter-opening in skeleton; boundaries in preceding verse content',
    skeleton.includes('\\ts\\*') && verses['1:2'].includes('\\ts\\*') && verses['1:4'].includes('\\ts\\*') && !verses['1:1'].includes('\\ts\\*'),
    JSON.stringify(verses['1:2']));

  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-03-01T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const seedEvts = [
    E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton, initialVerses: {} }),
    ...Object.entries(verses).map(([vkey, text], i) => {
      const [chapter, verse] = vkey.split(':');
      return E('text.verse.set', 'drafter-a', t(1, i, 'drafter-a'), null, { book: 'TIT', chapter, verse, text });
    }),
  ];
  const base12 = t(1, 1, 'drafter-a'); // verse 1:2's seed event

  // milestone-only edit: move the section boundary out of 1:2 (re-chunking), words unchanged
  const align12 = E('align.verse.set', 'checker-c', t(2, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: seedEvts[0].ts, alignments: [], wordBank: [], targetVerseMd5: verseTextMd5(verses['1:2']) });
  const milestoneMove = E('text.verse.set', 'drafter-a', t(3, 0, 'drafter-a'), base12, { book: 'TIT', chapter: '1', verse: '2', text: 'con esperanza de vida eterna,\n' });
  const wordEdit = E('text.verse.set', 'drafter-a', t(4, 0, 'drafter-a'), milestoneMove.ts, { book: 'TIT', chapter: '1', verse: '2', text: 'con esperanza VIVA de vida eterna,\n\\ts\\*\n\\p\n' });
  const afterMove = fold([...seedEvts, align12, milestoneMove]);
  const afterWords = fold([...seedEvts, align12, milestoneMove, wordEdit]);
  check('J16: structure-only edit (stripping an imported \\ts\\*) does NOT invalidate the verse\'s alignment (I-3 on plain text)',
    afterMove.invalid.length === 0 && !afterMove.books.TIT.verses['1:2'].includes('\\ts\\*'),
    `invalid=${afterMove.invalid.length}`);
  check('J16: a word edit on the same verse DOES invalidate', afterWords.invalid.length === 1);

  // section save = per-verse events sharing a batch; concurrent verse edit forks; batch groups the review
  const batchTs = t(5, 0, 'drafter-a');
  const sectionSave = [
    E('text.verse.set', 'drafter-a', t(5, 0, 'drafter-a'), t(1, 2, 'drafter-a'), { batch: batchTs, book: 'TIT', chapter: '1', verse: '3', text: 'a su tiempo REDRAFTED,\n' }),
    E('text.verse.set', 'drafter-a', t(5, 1, 'drafter-a'), t(1, 3, 'drafter-a'), { batch: batchTs, book: 'TIT', chapter: '1', verse: '4', text: 'a Tito REDRAFTED.\n\\ts\\*\n\\p\n' }),
  ];
  const concurrent = E('text.verse.set', 'checker-c', t(5, 2, 'checker-c'), t(1, 2, 'drafter-a'), { book: 'TIT', chapter: '1', verse: '3', text: 'a su debido tiempo (checked),\n' });
  const merged = fold([...seedEvts, ...sectionSave, concurrent]);
  const fork = merged.forks.find((f) => f.key === 'text|TIT|1:3');
  const forkBatches = fork ? fork.heads.map((ts) => [...seedEvts, ...sectionSave, concurrent].find((e) => e.ts === ts)?.batch || null) : [];
  check('J16: section save is per-verse events sharing a batch; only the double-edited verse forks',
    merged.forks.length === 1 && !!fork && merged.books.TIT.verses['1:4'].includes('REDRAFTED'),
    `forks=${merged.forks.map((f) => f.key).join(',')}`);
  check('J16: fork heads carry the batch id — review queue can group per-verse forks by section action',
    forkBatches.includes(batchTs), JSON.stringify(forkBatches));
}

// ---------- J17: remaining-definitions closure — settings.set, meta reserved roots, orphaned alignments, NFC (I-4) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-04-01T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const S = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const seedEvts = [
    E('book.add', 'actor-a', t(0, 0, 'actor-a'), null, { book: 'TIT', scope: [], skeleton: S, initialVerses: {} }),
    E('text.verse.set', 'actor-a', t(1, 0, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', text: 'uno\n' }),
    E('text.verse.set', 'actor-a', t(1, 1, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '2', text: 'dos\n' }),
  ];

  // settings.set: LWW per path, projected into fold output
  const s1 = E('settings.set', 'actor-a', t(2, 0, 'actor-a'), null, { path: 'checkCategories.translationWords', value: ['kt'] });
  const s2 = E('settings.set', 'actor-b', t(3, 0, 'actor-b'), s1.ts, { path: 'checkCategories.translationWords', value: ['kt', 'names'] });
  const s3 = E('settings.set', 'actor-a', t(3, 1, 'actor-a'), null, { path: 'ui.paneSettings', value: [{ bibleId: 'targetBible' }] });
  const withSettings = fold([...seedEvts, s1, s2, s3]);
  check('J17: settings.set — LWW per path; §5.4 state projects from the fold (no shared mutable settings.json)',
    deepEq(withSettings.settings['checkCategories.translationWords'], ['kt', 'names']) && 'ui.paneSettings' in withSettings.settings,
    JSON.stringify(withSettings.settings['checkCategories.translationWords']));

  // project.meta.set reserved roots refuse — incl. type (never written by meta events, §8.5)
  let refused = '';
  try { fold([...seedEvts, E('project.meta.set', 'actor-a', t(4, 0, 'actor-a'), null, { path: 'ingredients.evil', value: {} })]); }
  catch (e) { refused = e.message; }
  let refusedType = '';
  try { fold([...seedEvts, E('project.meta.set', 'actor-a', t(4, 0, 'actor-a'), null, { path: 'type.flavorType.currentScope', value: { TIT: [] } })]); }
  catch (e) { refusedType = e.message; }
  check('J17: project.meta.set targeting a reserved root (ingredients/format/type/meta) refuses with a clear message',
    refused.includes('reserved root') && refusedType.includes('reserved root'), `"${refused.slice(0, 60)}"`);
  const okMeta = fold([...seedEvts, E('project.meta.set', 'actor-a', t(4, 1, 'actor-a'), null, { path: 'identification.name.en', value: 'Renamed' })]);
  check('J17: project.meta.set on an allowed path still folds', okMeta.projectMeta['identification.name.en'] === 'Renamed');

  // orphaned alignment: the alignment arrives AFTER the structural event (concurrent
  // offline actor), so the structural event could not disposition it — the §8.6 orphan
  // backstop reports it in invalid[]
  const align2 = E('align.verse.set', 'actor-b', t(7, 0, 'actor-b'), null, { book: 'TIT', chapter: '1', verse: '2', generation: seedEvts[0].ts, alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const dropV2 = E('text.structure.apply', 'actor-a', t(6, 0, 'actor-a'), t(0, 0, 'actor-a'), {
    book: 'TIT', skeleton: `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`,
    transitions: { '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: t(1, 0, 'actor-a') }] } },
    dispositions: [],
  });
  const okBefore = fold([...seedEvts, align2]);
  const orphaned = fold([...seedEvts, align2, dropV2]);
  check('J17: alignment on a removed verse slot is orphaned → invalid[] regardless of matching hash',
    okBefore.invalid.length === 0 && orphaned.invalid.length === 1 && orphaned.invalid[0].orphaned === true,
    JSON.stringify(orphaned.invalid[0] || null));

  // I-4 motivation: NFC vs NFD bytes of identical-looking text hash differently
  const nfc = 'Jesucristo é'.normalize('NFC'), nfd = 'Jesucristo é'.normalize('NFD');
  check('J17: I-4 motivation — NFC and NFD forms of identical text produce different md5 (why writers MUST normalize)',
    nfc !== nfd && md5(nfc) !== md5(nfd));

  // note.add target shapes per §8.5 accumulate without folding
  const n1 = E('note.add', 'actor-a', t(7, 0, 'actor-a'), null, { generation: seedEvts[0].ts, target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'nota de verso' });
  const n2 = E('note.add', 'actor-b', t(7, 1, 'actor-b'), null, { generation: seedEvts[0].ts, target: { decisionKey: 't1g7|tit|1|1|1' }, text: 'nota de decisión' });
  const withNotes = fold([...seedEvts, n1, n2]);
  check('J17: note.add — both target shapes accumulate grow-only (no LWW, no deletion)',
    withNotes.notes.length === 2 && withNotes.notes[0].target.verse === '1' && withNotes.notes[1].target.decisionKey.startsWith('t1g7'));
}

// ---------- J18: marries Pankosmia's transport to the journal (sealed segments as the
//   on-disk artifact — the only stream form). Mirrors their PullFromDownloaded choreography. ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j18-'));
  const git = (args, cwd) => execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString();
  const init = (dir) => { fs.mkdirSync(dir, { recursive: true }); git('init -q -b main .', dir); git('config user.email t@t', dir); git('config user.name T', dir); };
  const commitAll = (dir, m) => { git('add -A', dir); git(`commit -qm ${m}`, dir); };
  const cp = (src, dst) => execSync(`cp -R "${src}" "${dst}"`);
  const ts = (s, a) => `2026-05-01T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const merges = (scratch, fromDir) => { // mirrors pull-repo editable → scratch
    git(`remote add editable "${fromDir}"`, scratch); git('fetch -q editable', scratch);
    try { git('merge --no-edit editable/main', scratch); return { conflict: false }; }
    catch { return { conflict: true }; }
  };

  // (A) transport over disjoint per-actor journals — two translators edit the SAME book concurrently
  const skeleton = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const j = (dir, actor, evs) => { const d = path.join(dir, 'ingredients/checking/journal', actor); for (const e of evs) writeActionSegment(d, [mkEvent(e)]); };
  const seedLines = [
    { op: 'book.add', actor: 'seed', ts: ts(0, 'seed'), book: 'TIT', scope: [], skeleton, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n', '1:3': 'tres\n' } },
  ];
  const base = path.join(tmp, 'base'); init(base); j(base, 'seed', seedLines); commitAll(base, 'base');
  const downloaded = path.join(tmp, 'downloaded'); cp(base, downloaded);
  j(downloaded, 'actor-a', [{ op: 'text.verse.set', actor: 'actor-a', ts: ts(5, 'actor-a'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos (A)\n' }]);
  commitAll(downloaded, 'A-edits-1_2');
  const local = path.join(tmp, 'local'); cp(base, local);
  j(local, 'actor-b', [{ op: 'text.verse.set', actor: 'actor-b', ts: ts(5, 'actor-b'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres (B)\n' }]);
  commitAll(local, 'B-edits-1_3');
  const scratch = path.join(tmp, 'scratch'); cp(downloaded, scratch);
  const jr = merges(scratch, local);
  const unmerged = git('ls-files -u', scratch).trim();
  const foldScratch = fold(readUnion(path.join(scratch, 'ingredients/checking/journal')));
  check('J18: Pankosmia transport over disjoint journals — scratch merge is CLEAN (their conflict-abort never fires)',
    jr.conflict === false && unmerged === '');
  check('J18: converged — both translators\' concurrent same-book edits present, zero forks',
    foldScratch.books.TIT.verses['1:2'] === 'dos (A)\n' && foldScratch.books.TIT.verses['1:3'] === 'tres (B)\n' && foldScratch.forks.length === 0);

  // (B) contrast: the SAME transport on a shared whole-file same-line edit → conflict (what their model aborts on)
  const wbase = path.join(tmp, 'wbase'); init(wbase); fs.writeFileSync(path.join(wbase, 'TIT.usfm'), '\\v 1 uno\n\\v 2 dos\n\\v 3 tres\n'); commitAll(wbase, 'wbase');
  const wdl = path.join(tmp, 'wdl'); cp(wbase, wdl); fs.writeFileSync(path.join(wdl, 'TIT.usfm'), '\\v 1 uno\n\\v 2 dos (A)\n\\v 3 tres\n'); commitAll(wdl, 'A');
  const wlocal = path.join(tmp, 'wlocal'); cp(wbase, wlocal); fs.writeFileSync(path.join(wlocal, 'TIT.usfm'), '\\v 1 uno\n\\v 2 dos (B)\n\\v 3 tres\n'); commitAll(wlocal, 'B');
  const wscratch = path.join(tmp, 'wscratch'); cp(wdl, wscratch);
  const wr = merges(wscratch, wlocal);
  check('J18: SAME transport on a shared whole-file same-line edit DOES conflict — the case their model aborts on, and the journal removes',
    wr.conflict === true);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J19: repeat publication without receiving main — sealed-segment publications. ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j19-'));
  const git = (args, cwd) => execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString();
  const init = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    git('init -q -b main .', dir);
    git('config user.email t@t', dir);
    git('config user.name T', dir);
  };
  const cp = (src, dst) => fs.cpSync(src, dst, { recursive: true });
  const commitAll = (dir, message) => {
    git('add -A', dir);
    git(`commit -qm "${message}"`, dir);
  };
  const ts = (s, actor) => `2026-06-01T00:00:${String(s).padStart(2, '0')}.000Z|0000|${actor}`;
  const segRel = (actor, ev) => `ingredients/checking/journal/${actor}/segments/${segmentName(ev.ts)}`;
  // Publications are immutable sealed segments: one new segment per action, existing files untouched.
  const publish = (dir, actor, events) =>
    writeActionSegment(path.join(dir, 'ingredients/checking/journal', actor), events.map(mkEvent));
  const project = (dir) => {
    const out = fold(readUnion(path.join(dir, 'ingredients/checking/journal')));
    fs.mkdirSync(path.join(dir, 'ingredients'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ingredients/TIT.usfm'), out.books.TIT.usfm);
    const actors = fs.readdirSync(path.join(dir, 'ingredients/checking/journal')).sort();
    fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify({ derivedFromActors: actors }) + '\n');
    return out;
  };
  let scratchSeq = 0;
  const integrate = (main, publication, branch, label) => {
    const before = git('rev-parse HEAD', main).trim();
    const scratch = path.join(tmp, `scratch-${++scratchSeq}-${label}`);
    cp(main, scratch);
    const remote = `incoming-${label}`;
    git(`remote add ${remote} "${publication}"`, scratch);
    git(`fetch -q ${remote} ${branch}`, scratch);
    try {
      git('merge --no-edit FETCH_HEAD', scratch);
    } catch {
      return { conflict: true, before, after: git('rev-parse HEAD', main).trim(), scratch };
    }
    const out = project(scratch);
    if (git('status --porcelain', scratch).trim()) commitAll(scratch, `regenerate ${label}`);
    const updates = `updates-${label}`;
    git(`remote add ${updates} "${scratch}"`, main);
    git(`fetch -q ${updates}`, main);
    git(`merge --ff-only ${updates}/main`, main);
    return { conflict: false, before, after: git('rev-parse HEAD', main).trim(), scratch, out };
  };

  const skeleton = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const seed = [
    { op: 'book.add', actor: 'seed', ts: ts(0, 'seed'), book: 'TIT', scope: [], skeleton, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n', '1:3': 'tres\n' } },
  ];
  const a1 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(5, 'actor-a'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A1\n' };
  const a2 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(7, 'actor-a'), base: ts(5, 'actor-a'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A2\n' };
  const b1 = { op: 'text.verse.set', actor: 'actor-b', ts: ts(6, 'actor-b'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres B1\n' };

  const base = path.join(tmp, 'base'); init(base); publish(base, 'seed', seed); project(base); commitAll(base, 'base');
  const main = path.join(tmp, 'integration-main'); cp(base, main);
  const workingA = path.join(tmp, 'working-a'); cp(base, workingA);
  const pubA = path.join(tmp, 'publication-a'); cp(base, pubA); git('checkout -qb actor-a', pubA);
  const pubB = path.join(tmp, 'publication-b'); cp(base, pubB); git('checkout -qb actor-b', pubB);

  // A1 is a full local checkpoint, then mirrored into A's publication history as a journal-only delta.
  publish(workingA, 'actor-a', [a1]); project(workingA); commitAll(workingA, 'A1 full working checkpoint');
  publish(pubA, 'actor-a', [a1]); commitAll(pubA, 'publish A1');
  const pubA1 = git('rev-parse HEAD', pubA).trim();
  const a1Paths = git('diff --name-only HEAD^ HEAD', pubA).trim().split('\n').filter(Boolean);
  const iA1 = integrate(main, pubA, 'actor-a', 'a1');

  // B submits while A remains offline from main.
  publish(pubB, 'actor-b', [b1]); commitAll(pubB, 'publish B1');
  const b1Paths = git('diff --name-only HEAD^ HEAD', pubB).trim().split('\n').filter(Boolean);
  const iB1 = integrate(main, pubB, 'actor-b', 'b1');

  // A continues from A1 without receiving B1. Its working projection diverges, but publication does not.
  publish(workingA, 'actor-a', [a2]); project(workingA); commitAll(workingA, 'A2 full working checkpoint while offline');
  publish(pubA, 'actor-a', [a2]); commitAll(pubA, 'publish A2 while offline');
  const a2Paths = git(`diff --name-only ${pubA1} HEAD`, pubA).trim().split('\n').filter(Boolean);

  check('J19: actor publication commits add only their owned sealed segments (existing segments untouched)',
    deepEq(a1Paths, [segRel('actor-a', a1)]) &&
    deepEq(a2Paths, [segRel('actor-a', a2)]) &&
    deepEq(b1Paths, [segRel('actor-b', b1)]),
    JSON.stringify({ a1Paths, a2Paths, b1Paths }));
  check('J19: A1 then B1 integrate through disposable scratch and regenerate cleanly',
    !iA1.conflict && !iB1.conflict && iB1.out.books.TIT.verses['1:2'] === 'dos A1\n' && iB1.out.books.TIT.verses['1:3'] === 'tres B1\n',
    JSON.stringify({ a1Conflict: iA1.conflict, b1Conflict: iB1.conflict, verses: iB1.out?.books?.TIT?.verses }));

  // Demonstrate why the full working projection is never the transport branch.
  const badScratch = path.join(tmp, 'bad-full-working-merge'); cp(main, badScratch);
  git(`remote add bad-working "${workingA}"`, badScratch); git('fetch -q bad-working', badScratch);
  let badConflict = false; try { git('merge --no-edit bad-working/main', badScratch); } catch { badConflict = true; }
  check('J19: merging the full offline working checkpoint would conflict after main regenerated',
    badConflict && /^UU (ingredients\/TIT\.usfm|metadata\.json)/m.test(git('status --porcelain', badScratch)),
    JSON.stringify({ badConflict, status: git('status --porcelain', badScratch) }));

  const iA2 = integrate(main, pubA, 'actor-a', 'a2');
  const finalFold = fold(readUnion(path.join(main, 'ingredients/checking/journal')));
  check('J19: A2 re-submits without receiving B1 — integration is clean and A2+B1 survive',
    !iA2.conflict && finalFold.forks.length === 0 &&
    finalFold.books.TIT.verses['1:2'] === 'dos A2\n' && finalFold.books.TIT.verses['1:3'] === 'tres B1\n',
    JSON.stringify({ conflict: iA2.conflict, forks: finalFold.forks, verses: finalFold.books.TIT.verses }));

  // Receive is rebuild-and-swap: validate a replacement from current main + own publication;
  // do not merge main into the diverged full working projection.
  const oldWorkingHead = git('rev-parse HEAD', workingA).trim();
  const receiveScratch = path.join(tmp, 'receive-a'); cp(main, receiveScratch);
  git(`remote add own-publication "${pubA}"`, receiveScratch); git('fetch -q own-publication actor-a', receiveScratch);
  git('merge --no-edit FETCH_HEAD', receiveScratch);
  const receivedFold = project(receiveScratch);
  const replacement = path.join(tmp, 'working-a-replacement'); cp(receiveScratch, replacement);
  check('J19: receive validates a rebuilt replacement before swap; old working repo is untouched and replacement has the union',
    git('rev-parse HEAD', workingA).trim() === oldWorkingHead &&
    !fs.readFileSync(path.join(workingA, 'ingredients/TIT.usfm'), 'utf8').includes('B1') &&
    receivedFold.books.TIT.verses['1:2'] === 'dos A2\n' && receivedFold.books.TIT.verses['1:3'] === 'tres B1\n' &&
    fs.readFileSync(path.join(replacement, 'ingredients/TIT.usfm'), 'utf8').includes('tres B1'),
    JSON.stringify({ oldUnchanged: git('rev-parse HEAD', workingA).trim() === oldWorkingHead, verses: receivedFold.books.TIT.verses }));

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J20: intake is zero-trust even when git merges cleanly. Scratch validation rejects
//   non-journal changes, edits to another actor's stream, truncation/rewrite of accepted
//   bytes, modification of accepted sealed segments, and invalid incoming segments (§8.1). ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j20-'));
  const git = (args, cwd) => execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString();
  const init = (dir) => {
    fs.mkdirSync(dir, { recursive: true }); git('init -q -b main .', dir);
    git('config user.email t@t', dir); git('config user.name T', dir);
  };
  const commitAll = (dir, message) => { git('add -A', dir); git(`commit -qm "${message}"`, dir); };
  const cp = (src, dst) => fs.cpSync(src, dst, { recursive: true });
  const write = (dir, rel, body) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  const snapshot = (dir) => {
    const out = new Map();
    const walk = (abs, rel = '') => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const child = path.join(abs, entry.name);
        if (entry.isDirectory()) walk(child, childRel); else out.set(childRel, fs.readFileSync(child));
      }
    };
    walk(dir); return out;
  };
  // WHITELIST-ONLY intake (§8.7): the only path shapes a contribution may add or touch
  // under its own actor directory are (a) NEW valid sealed segments whose filename
  // matches their first event ts, and (b) a well-formed actor.json naming that actor.
  // Everything else — arbitrary files, JSONL streams, modified segments, deletions —
  // is rejected.
  const validateIntake = (beforeDir, scratchDir, actor) => {
    const before = snapshot(beforeDir); const after = snapshot(scratchDir); const errors = [];
    const actorRoot = `ingredients/checking/journal/${actor}/`;
    const journalRoot = 'ingredients/checking/journal/';
    for (const rel of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(rel); const b = after.get(rel);
      const same = a && b && a.equals(b);
      if (same) continue;
      if (!rel.startsWith(actorRoot)) {
        errors.push(rel.startsWith(journalRoot) ? `foreign-actor:${rel}` : `shared-path:${rel}`);
        continue;
      }
      if (!b) { errors.push(`deleted:${rel}`); continue; }
      const sub = rel.slice(actorRoot.length);
      if (sub.startsWith('segments/') && sub.endsWith('.action.json') && !sub.slice('segments/'.length).includes('/')) {
        // §8.1: accepted segments are immutable; a new incoming segment MUST validate
        // and its filename MUST match its first event's ts.
        if (a) { errors.push(`segment-modified:${rel}`); continue; }
        const r = validateSegment(b.toString('utf8'));
        if (!r.ok) { errors.push(`segment-invalid:${rel}:${r.reason}`); continue; }
        if (r.events.some((e) => e.actor !== actor)) { errors.push(`segment-foreign-actor:${rel}`); continue; }
        if (sub.slice('segments/'.length) !== segmentName(r.events[0].ts)) errors.push(`segment-misnamed:${rel}`);
        continue;
      }
      if (sub === 'actor.json') {
        // the ONE shared actor-metadata validator (round 7) — the same one the live
        // transport intake applies: shape validated, actorId must match the directory
        const a = validateActorDoc(b.toString('utf8'), actor);
        if (!a.ok) errors.push(`actor-json-invalid:${rel}:${a.reason}`);
        continue;
      }
      errors.push(`not-whitelisted:${rel}`);
    }
    return errors;
  };
  const mergeToScratch = (base, publication, branch, label) => {
    const scratch = path.join(tmp, `scratch-${label}`); cp(base, scratch);
    git(`remote add incoming-${label} "${publication}"`, scratch);
    git(`fetch -q incoming-${label} ${branch}`, scratch);
    git('merge --no-edit FETCH_HEAD', scratch);
    return scratch;
  };

  const goodSeg = sealAction([mkEvent({ op: 'settings.set', actor: 'actor-a', ts: '2026-06-02T00:00:01.000Z|0000|actor-a', path: 'ui.x', value: 1 })]);
  const seedSeg = sealAction([mkEvent({ op: 'settings.set', actor: 'seed', ts: '2026-06-02T00:00:00.000Z|0000|seed', path: 'ui.seed', value: 0 })]);
  const base = path.join(tmp, 'base'); init(base);
  write(base, `ingredients/checking/journal/seed/segments/${segmentName('2026-06-02T00:00:00.000Z|0000|seed')}`, seedSeg);
  write(base, `ingredients/checking/journal/actor-a/segments/${segmentName('2026-06-02T00:00:01.000Z|0000|actor-a')}`, goodSeg);
  write(base, 'ingredients/TIT.usfm', '\\v 1 accepted\n');
  write(base, 'metadata.json', '{"projection":"accepted"}\n');
  commitAll(base, 'accepted main');
  const mainHead = git('rev-parse HEAD', base).trim();
  const mainProjection = fs.readFileSync(path.join(base, 'ingredients/TIT.usfm'), 'utf8');

  const badShared = path.join(tmp, 'bad-shared'); cp(base, badShared); git('checkout -qb actor-a', badShared);
  write(badShared, 'metadata.json', '{"projection":"forged"}\n'); commitAll(badShared, 'touch shared derived');
  const sharedScratch = mergeToScratch(base, badShared, 'actor-a', 'shared');
  const sharedErrors = validateIntake(base, sharedScratch, 'actor-a');
  check('J20: intake rejects a clean git merge that changes any shared/non-journal path',
    sharedErrors.some((e) => e === 'shared-path:metadata.json'), JSON.stringify(sharedErrors));

  const badHistory = path.join(tmp, 'bad-history'); cp(base, badHistory); git('checkout -qb actor-a', badHistory);
  write(badHistory, `ingredients/checking/journal/actor-a/segments/${segmentName('2026-06-02T00:00:01.000Z|0000|actor-a')}`, goodSeg.slice(0, 40));
  write(badHistory, `ingredients/checking/journal/seed/segments/${segmentName('2026-06-02T00:00:00.000Z|0000|seed')}`, seedSeg + ' ');
  commitAll(badHistory, 'rewrite accepted history');
  const historyScratch = mergeToScratch(base, badHistory, 'actor-a', 'history');
  const historyErrors = validateIntake(base, historyScratch, 'actor-a');
  check('J20: intake rejects truncation/rewrite of accepted segments and foreign-actor edits; accepted main remains byte-identical',
    historyErrors.some((e) => e.startsWith('segment-modified:')) &&
    historyErrors.some((e) => e.startsWith('foreign-actor:')) &&
    git('rev-parse HEAD', base).trim() === mainHead && fs.readFileSync(path.join(base, 'ingredients/TIT.usfm'), 'utf8') === mainProjection,
    JSON.stringify(historyErrors));

  // sealed-segment intake law: accepted segments immutable; incoming segments must validate
  const badSegs = path.join(tmp, 'bad-segs'); cp(base, badSegs); git('checkout -qb actor-a', badSegs);
  write(badSegs, `ingredients/checking/journal/actor-a/segments/${segmentName('2026-06-02T00:00:01.000Z|0000|actor-a')}`, goodSeg.replace('ui.x', 'ui.y'));
  write(badSegs, `ingredients/checking/journal/actor-a/segments/${segmentName('2026-06-02T00:00:02.000Z|0000|actor-a')}`, '{"container":1,"body":"{\\"events\\":[]}","sha256":"0000"}');
  commitAll(badSegs, 'tamper accepted segment + push invalid segment');
  const segScratch = mergeToScratch(base, badSegs, 'actor-a', 'segs');
  const segErrors = validateIntake(base, segScratch, 'actor-a');
  check('J20: intake rejects modification of an accepted sealed segment and any invalid incoming segment (§8.1 asymmetric rule, incoming side)',
    segErrors.some((e) => e.startsWith('segment-modified:')) && segErrors.some((e) => e.startsWith('segment-invalid:')) &&
    git('rev-parse HEAD', base).trim() === mainHead,
    JSON.stringify(segErrors));

  // intake is WHITELIST-ONLY: known path shapes (valid new segments, well-formed
  // actor.json) are explicitly allowed; EVERYTHING else under the contributing actor's
  // directory is rejected — arbitrary new files, JSONL streams, malformed actor.json.
  const badMisc = path.join(tmp, 'bad-misc'); cp(base, badMisc); git('checkout -qb actor-a', badMisc);
  write(badMisc, 'ingredients/checking/journal/actor-a/notes.txt', 'arbitrary payload\n');
  write(badMisc, 'ingredients/checking/journal/actor-a/JON.00001.jsonl', '{"v":1}\n'); // a JSONL stream is not a format shape at all (one stream form, §8.1)
  write(badMisc, 'ingredients/checking/journal/actor-a/actor.json', '{"actorId":"someone-else"}'); // malformed shape + wrong actor
  write(badMisc, 'ingredients/checking/journal/actor-a/segments/README.md', 'not a segment');
  commitAll(badMisc, 'smuggle non-whitelisted files');
  const miscScratch = mergeToScratch(base, badMisc, 'actor-a', 'misc');
  const miscErrors = validateIntake(base, miscScratch, 'actor-a');
  check('J20: whitelist-only intake — an arbitrary new file under the actor directory is rejected',
    miscErrors.some((e) => e.includes('notes.txt')) && miscErrors.some((e) => e.includes('segments/README.md')),
    JSON.stringify(miscErrors));
  check('J20: whitelist-only intake — a JSONL stream is rejected like any other non-whitelisted file (one stream form: sealed segments)',
    miscErrors.some((e) => e.startsWith('not-whitelisted:') && e.includes('JON.00001.jsonl')), JSON.stringify(miscErrors));
  check('J20: whitelist-only intake — a malformed actor.json is rejected (shape validated, actorId must match the directory)',
    miscErrors.some((e) => e.includes('actor.json')), JSON.stringify(miscErrors));
  // the allowed shapes still pass: a valid new segment + a well-formed actor.json
  const goodNew = path.join(tmp, 'good-new'); cp(base, goodNew); git('checkout -qb actor-a', goodNew);
  write(goodNew, `ingredients/checking/journal/actor-a/segments/${segmentName('2026-06-02T00:00:03.000Z|0000|actor-a')}`,
    sealAction([mkEvent({ op: 'settings.set', actor: 'actor-a', ts: '2026-06-02T00:00:03.000Z|0000|actor-a', path: 'ui.z', value: 3 })]));
  write(goodNew, 'ingredients/checking/journal/actor-a/actor.json',
    JSON.stringify({ schemaVersion: 1, actorId: 'actor-a', displayName: 'A', createdAt: '2026-06-01T00:00:00.000Z' }) + '\n');
  commitAll(goodNew, 'valid publication');
  const goodScratch = mergeToScratch(base, goodNew, 'actor-a', 'good');
  const goodErrors = validateIntake(base, goodScratch, 'actor-a');
  check('J20: whitelist-only intake — a valid new sealed segment and a well-formed actor.json are explicitly allowed',
    goodErrors.length === 0, JSON.stringify(goodErrors));

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J21: text.structure.apply — all-or-nothing structural actions (#65, D48) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-01T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel3 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 9 ${SLOT}1:9${SLOT}\\v 10 ${SLOT}1:10${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, {
    book: 'TIT', scope: [], skeleton: skel3,
    initialVerses: { '1:1': 'uno\n', '1:9': 'nueve\n', '1:10': 'diez\n' },
  });
  const skelSpan = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 9-10 ${SLOT}1:9-10${SLOT}`;
  const spanCreate = E('text.structure.apply', 'drafter-a', t(1, 0, 'drafter-a'), add.ts, {
    book: 'TIT', skeleton: skelSpan,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:9-10': { text: 'nueve y diez\n', sources: [{ key: '1:9', ts: add.ts }, { key: '1:10', ts: add.ts }] },
    },
    dispositions: [],
  });
  const created = fold([add, spanCreate]);
  check('J21: span create (9,10 → 9-10) — one atomic event; merged text stated, never inferred',
    created.pendingStructural.length === 0 && created.forks.length === 0 &&
    created.books.TIT.verses['1:9-10'] === 'nueve y diez\n' && !('1:9' in created.books.TIT.verses) &&
    created.books.TIT.usfm.includes('\\v 9-10 nueve y diez'),
    JSON.stringify(Object.keys(created.books.TIT.verses)));

  const spanBreak = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), spanCreate.ts, {
    book: 'TIT', skeleton: skel3,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: spanCreate.ts }] },
      '1:9': { text: 'nueve\n', sources: [{ key: '1:9-10', ts: spanCreate.ts }] },
      '1:10': { text: 'diez\n', sources: [] },
    },
    dispositions: [],
  });
  const broken = fold([add, spanCreate, spanBreak]);
  check('J21: span break (9-10 → 9,10) — the split text is stated per destination slot',
    broken.pendingStructural.length === 0 && broken.books.TIT.verses['1:9'] === 'nueve\n' && broken.books.TIT.verses['1:10'] === 'diez\n' && !('1:9-10' in broken.books.TIT.verses));

  // renumber with alignment re-key + I-3 honesty, and a mid-chain verse edit as source
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel2r = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add2 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const align2 = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: add2.ts, alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const renumber = (text) => E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text, sources: [{ key: '1:2', ts: add2.ts }] },
    },
    dispositions: [{ surface: 'alignment', key: '1:2', ts: align2.ts, action: 're-key', to: '1:3' }],
  });
  const renumSame = fold([add2, align2, renumber('dos\n')]);
  const renumWord = fold([add2, align2, renumber('dos CAMBIADO\n')]);
  check('J21: renumber (2 → 3) re-keys the alignment; unchanged words stay valid (I-3 on the moved verse)',
    !!renumSame.alignments.TIT?.['1:3'] && !renumSame.alignments.TIT?.['1:2'] && renumSame.invalid.length === 0,
    JSON.stringify(renumSame.invalid));
  check('J21: renumber with changed words invalidates honestly (I-3 still binds after the move)',
    !!renumWord.alignments.TIT?.['1:3'] && renumWord.invalid.some((i) => i.verse === '1:3'));

  // missing source → incomplete; pre-operation state projects unchanged
  const ghostRef = E('text.structure.apply', 'drafter-a', t(3, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: '2026-08-01T00:00:09.000Z|0000|ghost-gg' }] },
    },
    dispositions: [],
  });
  const incomplete = fold([add2, ghostRef]);
  check('J21: a missing source reference reports incomplete; the pre-operation state projects unchanged (no stubs, no partial projection)',
    incomplete.pendingStructural.length === 1 && incomplete.pendingStructural[0].status === 'incomplete' &&
    incomplete.books.TIT.verses['1:2'] === 'dos\n' && !('1:3' in incomplete.books.TIT.verses),
    JSON.stringify(incomplete.pendingStructural));

  // stale source head (a concurrent verse edit replaced it) → conflicted; pre-op state unchanged
  const concurrentEdit = E('text.verse.set', 'checker-c', t(1, 5, 'checker-c'), add2.ts, { book: 'TIT', chapter: '1', verse: '2', text: 'dos (editada)\n' });
  const staleStruct = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] }, // observed head is stale now
    },
    dispositions: [],
  });
  const conflicted = fold([add2, concurrentEdit, staleStruct]);
  check('J21: a stale source head (concurrent verse edit) reports conflicted; the pre-operation state (with the edit) projects unchanged',
    conflicted.pendingStructural.length === 1 && conflicted.pendingStructural[0].status === 'conflicted' &&
    conflicted.books.TIT.verses['1:2'] === 'dos (editada)\n' && !('1:3' in conflicted.books.TIT.verses),
    JSON.stringify(conflicted.pendingStructural));

  // malformed events refuse the fold
  let noSlot = ''; let missingTr = ''; let dupClaim = '';
  try {
    fold([add2, E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
      book: 'TIT', skeleton: skel2r,
      transitions: { '1:1': { text: 'uno\n', sources: [] }, '1:3': { text: 'dos\n', sources: [] }, '1:4': { text: 'extra\n', sources: [] } },
      dispositions: [] })]);
  } catch (e) { noSlot = e.message; }
  try {
    fold([add2, E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
      book: 'TIT', skeleton: skel2r, transitions: { '1:1': { text: 'uno\n', sources: [] } }, dispositions: [] })]);
  } catch (e) { missingTr = e.message; }
  try {
    fold([add2, E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
      book: 'TIT', skeleton: skel2r,
      transitions: { '1:1': { text: 'uno\n', sources: [{ key: '1:2', ts: add2.ts }] }, '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] } },
      dispositions: [] })]);
  } catch (e) { dupClaim = e.message; }
  check('J21: malformed structural events refuse the fold (transition outside the skeleton; a slot without a transition; one source claimed twice)',
    noSlot.includes('transitions must cover exactly') && missingTr.includes('transitions must cover exactly') && dupClaim.includes('twice'),
    `"${dupClaim.slice(0, 50)}"`);

  // permutation determinism incl. partial arrival
  const full = [add2, align2, renumber('dos\n')];
  const rng = mulberry32(SEED + 21);
  check('J21: fold determinism under permutation holds with structural events',
    deepEq(fold(full), fold(shuffled(full, rng))) && deepEq(fold([add2, ghostRef]), fold(shuffled([add2, ghostRef], rng))));

  // dispositions must be COMPLETE: every live alignment, decision, and verse-targeted
  // note on a mapped source key needs exactly one disposition — otherwise incomplete
  const note12 = E('note.add', 'checker-c', t(1, 8, 'checker-c'), null, { generation: add2.ts, target: { book: 'TIT', chapter: '1', verse: '2' }, text: 'nota sobre 1:2' });
  const noNoteDisp = fold([add2, align2, note12, renumber('dos\n')]); // renumber dispositions cover the alignment only
  check('J21: a structural event that omits a disposition for a live verse-targeted note on a mapped key is refused as incomplete; pre-op state projects',
    noNoteDisp.pendingStructural.length === 1 && noNoteDisp.pendingStructural[0].status === 'incomplete' &&
    noNoteDisp.books.TIT.verses['1:2'] === 'dos\n' && !('1:3' in noNoteDisp.books.TIT.verses),
    JSON.stringify(noNoteDisp.pendingStructural));
  const dec12 = E('check.decision.set', 'checker-c', t(1, 9, 'checker-c'), null, { toolId: 'translationWords', generation: add2.ts,
    decision: { contextId: { checkId: 'c9', reference: { bookId: 'tit', chapter: '1', verse: '2' }, occurrence: 1 }, selections: false } });
  const noDecDisp = fold([add2, align2, dec12, renumber('dos\n')]);
  check('J21: a structural event that omits a disposition for a live decision on a mapped key is refused as incomplete; pre-op state projects',
    noDecDisp.pendingStructural.length === 1 && noDecDisp.pendingStructural[0].status === 'incomplete' &&
    noDecDisp.books.TIT.verses['1:2'] === 'dos\n' && !('1:3' in noDecDisp.books.TIT.verses),
    JSON.stringify(noDecDisp.pendingStructural));
  // duplicate/conflicting dispositions for one record are malformed — refused
  let dupDisp = '';
  try {
    fold([add2, align2, E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
      book: 'TIT', skeleton: skel2r,
      transitions: {
        '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
        '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] },
      },
      dispositions: [
        { surface: 'alignment', key: '1:2', ts: align2.ts, action: 're-key', to: '1:3' },
        { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'invalidate-retain' },
      ],
    })]);
  } catch (e) { dupDisp = e.message; }
  check('J21: duplicate/conflicting dispositions for one record refuse the fold (malformed event)',
    dupDisp.includes('disposition'), `"${dupDisp.slice(0, 60)}"`);
}

// ---------- J21c (review round 2): invalidated records and decisionKey-targeted notes are affected records too ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-11T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel2r = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add2 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });

  // finding 1: an INVALIDATED alignment (invalid: true) on a mapped key is retained
  // state (D36), not dead state — omitting its disposition must refuse the event
  const alignInv = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: add2.ts, alignments: [], wordBank: [], invalid: true, targetVerseMd5: md5('stale-text') });
  const renumberNoDisp = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] },
    },
    dispositions: [],
  });
  const omitted = fold([add2, alignInv, renumberNoDisp]);
  check('J21c: omitting a disposition for an INVALIDATED alignment on a mapped key refuses the event (invalidated records are retained state, D36)',
    omitted.pendingStructural.length === 1 && omitted.pendingStructural[0].status === 'incomplete' &&
    omitted.books.TIT.verses['1:2'] === 'dos\n' && !('1:3' in omitted.books.TIT.verses),
    JSON.stringify(omitted.pendingStructural));
  const decInv = E('check.decision.set', 'checker-c', t(1, 1, 'checker-c'), null, { toolId: 'translationWords', generation: add2.ts,
    decision: { contextId: { checkId: 'c7', reference: { bookId: 'tit', chapter: '1', verse: '2' }, occurrence: 1 }, selections: false, invalidated: true, status: 'invalid' } });
  const omittedDec = fold([add2, decInv, renumberNoDisp]);
  check('J21c: omitting a disposition for an INVALIDATED decision on a mapped key refuses the event',
    omittedDec.pendingStructural.length === 1 && omittedDec.pendingStructural[0].status === 'incomplete',
    JSON.stringify(omittedDec.pendingStructural));
  // ...and a dispositioned invalidated record survives the re-key STILL marked invalid
  const renumberDisp = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] },
    },
    dispositions: [{ surface: 'alignment', key: '1:2', ts: alignInv.ts, action: 're-key', to: '1:3' }],
  });
  const rekeyedInv = fold([add2, alignInv, renumberDisp]);
  check('J21c: a re-keyed invalidated alignment survives under the new key with invalid: true preserved',
    rekeyedInv.pendingStructural.length === 0 && rekeyedInv.alignments.TIT?.['1:3']?.invalid === true && !rekeyedInv.alignments.TIT?.['1:2'],
    JSON.stringify(rekeyedInv.alignments.TIT?.['1:3']));

  // finding 2: a decisionKey-targeted note on a re-keyed decision is part of the
  // affected set — without a disposition the event is refused; with a re-key
  // disposition the note projects under the NEW identity
  const dec2 = E('check.decision.set', 'checker-c', t(1, 2, 'checker-c'), null, { toolId: 'translationWords', generation: add2.ts,
    decision: { contextId: { checkId: 'c8', reference: { bookId: 'tit', chapter: '1', verse: '2' }, occurrence: 1 }, selections: false, invalidated: false, status: 'todo' } });
  const oldDecKey = 'c8|tit|1|2|1';
  const noteOnDec = E('note.add', 'checker-c', t(1, 3, 'checker-c'), null, { generation: add2.ts, target: { decisionKey: oldDecKey }, text: 'nota sobre decisión' });
  const structDecOnly = (extraDispositions) => E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] },
    },
    dispositions: [
      { surface: 'decision', key: `translationWords|c8|tit|1|2|1`, ts: dec2.ts, action: 're-key', to: '1:3' },
      ...extraDispositions,
    ],
  });
  const noteOmitted = fold([add2, dec2, noteOnDec, structDecOnly([])]);
  check('J21c: re-keying a decision that has a decisionKey-targeted note WITHOUT a note disposition refuses the event (the note is an affected record)',
    noteOmitted.pendingStructural.length === 1 && noteOmitted.pendingStructural[0].status === 'incomplete',
    JSON.stringify(noteOmitted.pendingStructural));
  const newDecKey = 'c8|tit|1|3|1';
  const noteRekeyed = fold([add2, dec2, noteOnDec, structDecOnly([
    { surface: 'note', ts: noteOnDec.ts, action: 're-key', to: newDecKey },
  ])]);
  check('J21c: with a re-key disposition the decisionKey-targeted note projects under the NEW decision identity, never the retired one',
    noteRekeyed.pendingStructural.length === 0 &&
    noteRekeyed.notes.some((n) => n.target.decisionKey === newDecKey) &&
    !noteRekeyed.notes.some((n) => n.target.decisionKey === oldDecKey),
    JSON.stringify(noteRekeyed.notes.map((n) => n.target)));
  // ...but an invalidate-retain decision KEEPS its identity — its decisionKey-targeted
  // note stays valid and needs no disposition (reconcile compatibility)
  const structDecRetain = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add2.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add2.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add2.ts }] },
    },
    dispositions: [{ surface: 'decision', key: `translationWords|c8|tit|1|2|1`, ts: dec2.ts, action: 'invalidate-retain' }],
  });
  const retainKeepsNote = fold([add2, dec2, noteOnDec, structDecRetain]);
  check('J21c: an invalidate-retain decision keeps its identity — its decisionKey-targeted note needs no disposition and still projects',
    retainKeepsNote.pendingStructural.length === 0 && retainKeepsNote.notes.some((n) => n.target.decisionKey === oldDecKey),
    JSON.stringify(retainKeepsNote.pendingStructural));
}

// ---------- J21b: reconcile emits COMPLETE conservative dispositions (§8.8 + #65 v2) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-01T01:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const add2 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const align2 = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: add2.ts, alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const dec2 = E('check.decision.set', 'checker-c', t(1, 1, 'checker-c'), null, { toolId: 'translationWords', generation: add2.ts,
    decision: { contextId: { checkId: 'c2', reference: { bookId: 'tit', chapter: '1', verse: '2' }, occurrence: 1 }, selections: false, invalidated: false, status: 'todo' } });
  const note2 = E('note.add', 'checker-c', t(1, 2, 'checker-c'), null, { generation: add2.ts, target: { book: 'TIT', chapter: '1', verse: '2' }, text: 'nota' });
  const events = [add2, align2, dec2, note2];
  const out = fold(events);
  // out-of-band structure change: verse 2 removed from the committed file
  const edited = '\\id TIT\n\\c 1\n\\p\n\\v 1 uno\n';
  const clock = makeClock('reconciler', () => Date.parse('2026-08-01T02:00:00.000Z'));
  const recEvents = reconcileUsfm('TIT', edited, out, clock, 'reconciler');
  const structEv = recEvents.find((e) => e.op === 'text.structure.apply');
  const after = fold([...events, ...recEvents]);
  check('J21b: reconcile emits dispositions for the alignment, the decision, AND the verse-targeted note on a removed key — the structural event applies (complete)',
    !!structEv &&
    structEv.dispositions.some((d) => d.surface === 'alignment') &&
    structEv.dispositions.some((d) => d.surface === 'decision') &&
    structEv.dispositions.some((d) => d.surface === 'note') &&
    after.pendingStructural.length === 0 && after.books.TIT.usfm === edited,
    JSON.stringify(structEv?.dispositions || recEvents.map((e) => e.op)));
  check('J21b: reconcile dispositions are conservative — invalidate-retain/orphan-review, never a guessed re-key',
    !!structEv && structEv.dispositions.every((d) => d.action === 'invalidate-retain' || d.action === 'orphan-review'),
    JSON.stringify(structEv?.dispositions));
  check('J21b: after the conservative reconcile the decision is retained invalidated, never deleted (D36)',
    (after.decisions.translationWords || []).length === 1 && after.decisions.translationWords[0].invalidated === true);
}

// ---------- J21d (review round 4): dispositions are CONSTRAINED to the affected set (§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-01T02:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel2r = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const align11 = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '1', generation: add.ts, alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  // the reviewer's case: the mapping touches only 1:2 → 1:3, but the event carries an
  // orphan-review disposition for the UNRELATED live 1:1 alignment
  const rogue = E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
    },
    dispositions: [{ surface: 'alignment', key: '1:1', ts: align11.ts, action: 'orphan-review' }],
  });
  let refused = ''; let out = null;
  try { out = fold([add, align11, rogue]); } catch (e) { refused = e.message; }
  check('J21d: a disposition referencing a record OUTSIDE the computed affected set is refused whole (all-or-nothing) — structural actions cannot consume unrelated records',
    refused.includes('affected'),
    refused ? `"${refused.slice(0, 80)}"` : `applied: align 1:1 projects=${!!out?.alignments.TIT?.['1:1']}, retained=${JSON.stringify(out?.retained)}`);
  check('J21d: the unrelated 1:1 alignment still projects (the rogue event never applied)',
    refused !== '' || !!out?.alignments.TIT?.['1:1'],
    refused ? 'refused pre-application' : JSON.stringify(out?.alignments.TIT));
  // a rogue NOTE disposition (note on an unmapped verse) is refused the same way
  const note11 = E('note.add', 'checker-c', t(1, 1, 'checker-c'), null, { generation: add.ts, target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'nota sobre 1:1' });
  const rogueNote = { ...rogue, ts: t(2, 1, 'drafter-a'), dispositions: [{ surface: 'note', ts: note11.ts, action: 'orphan-review' }] };
  let refusedN = ''; let outN = null;
  try { outN = fold([add, note11, rogueNote]); } catch (e) { refusedN = e.message; }
  check('J21d: a rogue note disposition (unmapped verse) is refused the same way; the note survives',
    refusedN.includes('affected') && (outN === null),
    refusedN ? `"${refusedN.slice(0, 60)}"` : `note projected=${outN?.notes.length}`);
}

// ---------- J21e (review round 5): the disposition SCHEMA binds — enum + required fields (§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-01T03:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel2r = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const align2 = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: add.ts, alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const structWith = (disposition) => E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add.ts, {
    book: 'TIT', skeleton: skel2r,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
    },
    dispositions: [disposition],
  });
  const cases = [
    ['unknown action "delete" (the reviewer\'s case — was consumed and retained under reason "delete")',
      { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'delete' }],
    ['unknown action "obliterate"',
      { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'obliterate' }],
    ['re-key without a destination',
      { surface: 'alignment', key: '1:2', ts: align2.ts, action: 're-key' }],
    ['re-key with a destination outside the mapping\'s targets',
      { surface: 'alignment', key: '1:2', ts: align2.ts, action: 're-key', to: '9:9' }],
    ['replace without the complete post-state',
      { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'replace' }],
    ['unknown surface',
      { surface: 'margin-note', key: '1:2', ts: align2.ts, action: 'orphan-review' }],
  ];
  for (const [label, d] of cases) {
    let refused = ''; let out = null;
    try { out = fold([add, align2, structWith(d)]); } catch (e) { refused = e.message; }
    check(`J21e: disposition schema violation is refused whole — ${label}`,
      refused.includes('disposition'),
      refused ? `"${refused.slice(0, 70)}"` : `applied: align projects=${JSON.stringify(out?.alignments.TIT)}, retained=${JSON.stringify(out?.retained)}`);
  }
  // a schema-valid disposition still applies
  const good = fold([add, align2, structWith({ surface: 'alignment', key: '1:2', ts: align2.ts, action: 're-key', to: '1:3' })]);
  check('J21e: a schema-valid disposition still applies (re-key to a mapping target)',
    !!good.alignments.TIT?.['1:3'] && good.pendingStructural.length === 0, JSON.stringify(good.alignments.TIT));
}

// ---------- J21f (round 6): replace.post is a VALIDATED post-state (§5.1/§5.2 shapes,
//   identity-consistent with the disposition's target); note replacement is rejected ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-01T04:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel2 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel2r = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel2, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const align2 = E('align.verse.set', 'checker-c', t(1, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', generation: add.ts, alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const note2 = E('note.add', 'checker-c', t(1, 1, 'checker-c'), null, { generation: add.ts, target: { book: 'TIT', chapter: '1', verse: '2' }, text: 'nota' });
  const structWith = (dispositions, extraNotes = []) => [add, align2, ...extraNotes,
    E('text.structure.apply', 'drafter-a', t(2, 0, 'drafter-a'), add.ts, {
      book: 'TIT', skeleton: skel2r,
      transitions: {
        '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
        '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
      },
      dispositions,
    })];
  const cases = [
    ['alignment replace with an EMPTY post (the reproduced undefined:undefined)',
      [{ surface: 'alignment', key: '1:2', ts: align2.ts, action: 'replace', post: {} }]],
    ['alignment replace whose post identity mismatches the disposition target',
      [{ surface: 'alignment', key: '1:2', ts: align2.ts, action: 'replace', post: { chapter: '9', verse: '9', alignments: [], wordBank: [], targetVerseMd5: md5('dos') } }]],
  ];
  for (const [label, dispositions] of cases) {
    let refused = ''; let out = null;
    try { out = fold(structWith(dispositions)); } catch (e) { refused = e.message; }
    check(`J21f: ${label} is refused whole`,
      refused.includes('replace'),
      refused ? `"${refused.slice(0, 70)}"` : `applied: ${JSON.stringify(out?.alignments.TIT)}`);
  }
  // decision replace with mismatched identity
  const dec2 = E('check.decision.set', 'checker-c', t(1, 2, 'checker-c'), null, { toolId: 'translationWords', generation: add.ts,
    decision: { contextId: { checkId: 'c1', reference: { bookId: 'tit', chapter: '1', verse: '2' }, occurrence: 1 }, selections: false, invalidated: false, status: 'todo' } });
  let decRefused = ''; let decOut = null;
  try {
    decOut = fold([add, dec2, structWith([
      { surface: 'decision', key: 'translationWords|c1|tit|1|2|1', ts: dec2.ts, action: 'replace',
        post: { contextId: { checkId: 'OTHER', reference: { bookId: 'jon', chapter: '3', verse: '9' }, occurrence: 2 }, selections: false } },
    ])[2]]);
  } catch (e) { decRefused = e.message; }
  check('J21f: decision replace whose post identity mismatches the §5.2 target is refused whole',
    decRefused.includes('replace'),
    decRefused ? `"${decRefused.slice(0, 70)}"` : `applied: ${JSON.stringify(decOut?.decisions)}`);
  // note replacement contradicts the grow-only model — REJECTED in v1
  let noteRefused = '';
  try { fold(structWith([
    { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'orphan-review' },
    { surface: 'note', ts: note2.ts, action: 'replace', post: { text: 'sustituta' } },
  ], [note2])); } catch (e) { noteRefused = e.message; }
  check('J21f: note replacement is REJECTED — notes are grow-only in v1 (replace contradicts their model)',
    noteRefused.includes('grow-only') || noteRefused.includes('replace'),
    `"${noteRefused.slice(0, 70)}"`);
  // a COMPLETE, identity-consistent alignment replace still applies
  const good = fold(structWith([
    { surface: 'alignment', key: '1:2', ts: align2.ts, action: 'replace',
      post: { chapter: '1', verse: '2', alignments: [], wordBank: [], targetVerseMd5: md5('dos') } },
  ]));
  check('J21f: a complete §5.1 post-state with consistent identity still applies',
    !!good.alignments.TIT?.['1:2'] && good.pendingStructural.length === 0,
    JSON.stringify(good.alignments.TIT));
}

// ---------- J22: structural lineage — branch-local effects, retention, sequential chains (#65 ruling) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-02T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const add = E('book.add', 'seed-x', t(0, 0, 'seed-x'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const skelTo = (n) => `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v ${n} ${SLOT}1:${n}${SLOT}`;
  const struct = (actor, ts, base, n, srcTs) => E('text.structure.apply', actor, ts, base, {
    book: 'TIT', skeleton: skelTo(n),
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: srcTs }] },
      [`1:${n}`]: { text: 'dos\n', sources: [{ key: '1:2', ts: srcTs }] },
    },
    dispositions: [],
  });
  const E1 = struct('actor-a', t(1, 0, 'actor-a'), add.ts, 3, add.ts); // renumber 1:2 → 1:3
  const E2 = struct('actor-b', t(2, 0, 'actor-b'), add.ts, 4, add.ts); // concurrent renumber 1:2 → 1:4

  const forked = fold([add, E1, E2]);
  check('J22: concurrent structural actions fork on the skeleton key — both heads live, review-queue material',
    forked.forks.some((f) => f.key === 'skel|TIT') && forked.pendingStructural.length === 0,
    JSON.stringify(forked.forks.map((f) => f.key)));
  check('J22: fork effects are branch-local — the winner projects its own move only; the losing branch\'s move never leaks',
    '1:4' in forked.books.TIT.verses && !('1:3' in forked.books.TIT.verses) && forked.books.TIT.verses['1:1'] === 'uno\n',
    JSON.stringify(Object.keys(forked.books.TIT.verses)));
  check('J22: the losing branch\'s post-images are retained for review, not silently dropped',
    forked.retained.some((r) => r.ts === E1.ts), JSON.stringify(forked.retained.slice(0, 4)));

  // edits on BOTH sides of the structural fork before resolution
  const eA = E('text.verse.set', 'actor-a', t(3, 0, 'actor-a'), E1.ts, { book: 'TIT', chapter: '1', verse: '3', text: 'tres A\n' });
  const eB = E('text.verse.set', 'actor-b', t(4, 0, 'actor-b'), E2.ts, { book: 'TIT', chapter: '1', verse: '4', text: 'cuatro B\n' });
  const bothSides = fold([add, E1, E2, eA, eB]);
  check('J22: edits on both sides of a structural fork — each descendant projects only under its own ancestor',
    bothSides.books.TIT.verses['1:4'] === 'cuatro B\n' && !('1:3' in bothSides.books.TIT.verses),
    JSON.stringify(bothSides.books.TIT.verses));
  check('J22: the losing branch\'s descendants remain retained for review (excluded by ancestry, not guesswork)',
    bothSides.retained.some((r) => r.ts === eA.ts), JSON.stringify(bothSides.retained.slice(0, 6)));

  // sequential structure changes: a chain of two text.structure.apply is ordinary head lineage
  const E1b = struct('actor-a', t(5, 0, 'actor-a'), E2.ts, 5, E2.ts); // continues E2's branch: 1:4 → 1:5
  const chained = fold([add, E1, E2, eA, eB, { ...E1b, transitions: {
    '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: E2.ts }] },
    '1:5': { text: 'cuatro B\n', sources: [{ key: '1:4', ts: eB.ts }] },
  }, skeleton: skelTo(5) }]);
  check('J22: sequential structure changes chain as ordinary head lineage (the second bases on the first; descendants follow)',
    chained.pendingStructural.length === 0 && chained.books.TIT.verses['1:5'] === 'cuatro B\n' && !('1:4' in chained.books.TIT.verses),
    JSON.stringify(Object.keys(chained.books.TIT.verses)));

  // note retention across a renumber: re-key disposition rewrites the target by originating ts;
  // an undispositioned note survives untouched (grow-only — notes are permanent)
  const n1 = E('note.add', 'checker-c', t(0, 5, 'checker-c'), null, { generation: add.ts, target: { book: 'TIT', chapter: '1', verse: '2' }, text: 'nota sobre dos' });
  const n2 = E('note.add', 'checker-c', t(0, 6, 'checker-c'), null, { generation: add.ts, target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'nota sobre uno' });
  const E3 = E('text.structure.apply', 'actor-a', t(1, 0, 'actor-a'), add.ts, {
    book: 'TIT', skeleton: skelTo(3),
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
    },
    dispositions: [{ surface: 'note', ts: n1.ts, action: 're-key', to: '1:3' }],
  });
  const withNotes = fold([add, n1, n2, E3]);
  check('J22: note retention across a renumber — the dispositioned note re-keys to the new verse; the other note survives unchanged',
    withNotes.notes.length === 2 &&
    withNotes.notes.some((n) => n.text === 'nota sobre dos' && n.target.verse === '3') &&
    withNotes.notes.some((n) => n.text === 'nota sobre uno' && n.target.verse === '1'),
    JSON.stringify(withNotes.notes.map((n) => n.target)));

  // slot-changing text.skeleton.set is refused — the escape hatch is closed (#65 v2)
  let refusedSkel = '';
  try { fold([add, E('text.skeleton.set', 'actor-a', t(1, 0, 'actor-a'), add.ts, { book: 'TIT', skeleton: skelTo(3) })]); }
  catch (e) { refusedSkel = e.message; }
  const okSkel = fold([add, E('text.skeleton.set', 'actor-a', t(1, 0, 'actor-a'), add.ts, { book: 'TIT', skeleton: `\\id TIT edited header\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` })]);
  check('J22: slot-changing text.skeleton.set refuses (use text.structure.apply); a slot-preserving header edit still folds',
    refusedSkel.includes('slot set') && okSkel.books.TIT.usfm.startsWith('\\id TIT edited header'),
    `"${refusedSkel.slice(0, 60)}"`);

  // the chain rule (round-5 simplification): a skeleton edit is an ordinary chain link —
  // base is REQUIRED (the first skeleton comes from book.add), and an unknown base is
  // PENDING until it arrives (fold determinism per event-SET, never per arrival order)
  const skel1 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const add1 = E('book.add', 'seed-x', t(6, 0, 'seed-x'), null, { book: 'TIT', scope: [], skeleton: skel1, initialVerses: { '1:1': 'uno\n' } });
  let noBase = '';
  try {
    fold([add1, E('text.skeleton.set', 'actor-b', t(7, 0, 'actor-b'), null, { book: 'TIT', skeleton: `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}` })]);
  } catch (e) { noBase = e.message; }
  check('J22: text.skeleton.set with a NULL base is refused — the chain link must name its predecessor head',
    noBase.includes('requires base'), `"${noBase.slice(0, 60)}"`);
  const laterEdit = E('text.skeleton.set', 'actor-b', t(8, 0, 'actor-b'), t(7, 5, 'actor-c'), { book: 'TIT', skeleton: `\\id TIT via c\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}` });
  const pendingOut = fold([add1, laterEdit]);
  check('J22: an UNKNOWN base is pending until it arrives — the pre-event state projects, nothing is guessed',
    pendingOut.pendingStructural.length === 1 && pendingOut.pendingStructural[0].detail[0].startsWith('unknown-base') &&
    !pendingOut.books.TIT.usfm.startsWith('\\id TIT via c'),
    JSON.stringify(pendingOut.pendingStructural));
  const missingLink = E('text.skeleton.set', 'actor-c', t(7, 5, 'actor-c'), add1.ts, { book: 'TIT', skeleton: `\\id TIT by c\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}` });
  const arrived = fold([add1, laterEdit, missingLink]);
  check('J22: when the missing base arrives, the pending link folds — determinism is per event-SET',
    arrived.pendingStructural.length === 0 && arrived.books.TIT.usfm.startsWith('\\id TIT via c') &&
    arrived.books.TIT.verses['1:1'] === 'uno\n',
    JSON.stringify({ pending: arrived.pendingStructural, verses: arrived.books.TIT.verses }));
}

// ---------- J22b (review round 4): a stale KNOWN base is no escape from the topology rule (§8.4) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-02T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skelA = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skelB = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skelA, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const renumber = E('text.structure.apply', 'drafter-a', t(1, 0, 'drafter-a'), add.ts, {
    book: 'TIT', skeleton: skelB,
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
    },
    dispositions: [],
  });
  // the reviewer's reversal: the SAME actor submits a later skeleton event based on the
  // ORIGINAL add — slot-preserving relative to its historical base, slot-CHANGING
  // relative to the current projected skeleton
  const stale = E('text.skeleton.set', 'drafter-a', t(2, 0, 'drafter-a'), add.ts, { book: 'TIT', skeleton: skelA });
  let refused = ''; let reversed = null;
  try { reversed = fold([add, renumber, stale]); } catch (e) { refused = e.message; }
  check('J22b: a stale KNOWN-base text.skeleton.set that reverses a structural change is REFUSED — the comparison binds to the CURRENT projected skeleton, never the historical base',
    refused.includes('structure.apply'),
    refused ? `"${refused.slice(0, 80)}"` : `reversed silently: slots=${JSON.stringify(Object.keys(reversed?.books.TIT.verses || {}))}, forks=${reversed?.forks.length}, pending=${reversed?.pendingStructural.length}`);
  // a genuinely slot-preserving edit (header change) with the SAME stale base still folds
  const headerEdit = E('text.skeleton.set', 'drafter-a', t(3, 0, 'drafter-a'), renumber.ts, { book: 'TIT', skeleton: `\\id TIT edited\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}` });
  const ok = fold([add, renumber, headerEdit]);
  check('J22b: a slot-preserving skeleton edit against the current topology still folds (the rule blocks topology reversal, not header edits)',
    ok.books.TIT.usfm.startsWith('\\id TIT edited') && Object.keys(ok.books.TIT.verses).sort().join(',') === '1:1,1:3',
    JSON.stringify(Object.keys(ok.books.TIT.verses)));

  // round-5 simplification: the CHAIN RULE closes the class. A skeleton edit inherits
  // its base head's structural ancestry like any other link, so the round-5 finding-1
  // byte losses (stale-base header edit stubbing 1:3; missing-base edit stubbing both
  // verses — both reproduced red at 3824d9f) are structurally impossible: the only
  // accepted skeleton.sets are chain links from a named predecessor head.
  const skelBEdited = `\\id TIT header-v2\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  // a slot-preserving edit on a SAME-ACTOR stale base is a writer defect — refused
  // (this was the byte-loss red case: 1:3 projected ___ under ancestry reconstruction)
  let staleSlotPreserving = '';
  try { fold([add, renumber, E('text.skeleton.set', 'drafter-a', t(4, 0, 'drafter-a'), add.ts, { book: 'TIT', skeleton: `\\id TIT header-v2\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` })]); }
  catch (e) { staleSlotPreserving = e.message; }
  check('J22b: a same-actor skeleton edit based past the actor\'s own later head is refused — no branch can silently lose the structural post-images',
    staleSlotPreserving.includes('stale'), `"${staleSlotPreserving.slice(0, 70)}"`);
  // the byte invariant on the ACCEPTED (chain-linked) edit: every verse byte-identical
  const before = fold([add, renumber]).books.TIT.verses;
  const after = fold([add, renumber, E('text.skeleton.set', 'drafter-a', t(4, 3, 'drafter-a'), renumber.ts, { book: 'TIT', skeleton: skelBEdited })]).books.TIT.verses;
  check('J22b: byte-invariant — an accepted (chain-linked) skeleton.set leaves every verse projection byte-identical',
    deepEq(before, after) && after['1:3'] === 'dos\n', JSON.stringify({ before, after }));
  // CROSS-actor same-base competition is an EXPLICIT fork (§8.3), never silent: B's
  // header edit and A's structural action both based the same head — both branches stay
  // coherent (each projects its own chain's bytes), the conflict is surfaced
  const headerB = E('text.skeleton.set', 'checker-b', t(4, 4, 'checker-b'), add.ts, { book: 'TIT', skeleton: `\\id TIT B header\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` });
  const forked = fold([add, renumber, headerB]);
  const skelFork = forked.forks.find((f) => f.key === 'skel|TIT');
  check('J22b: a cross-actor same-base skeleton edit FORKS explicitly (surfaced, provisional, branch-coherent) — never silently applied, never silently dropped',
    !!skelFork && skelFork.heads.length === 2 &&
    (forked.books.TIT.verses['1:2'] === 'dos\n' || forked.books.TIT.verses['1:3'] === 'dos\n'),
    JSON.stringify({ forks: forked.forks, verses: forked.books.TIT.verses }));
}

// ---------- J22c (round 6): pending propagates TRANSITIVELY — a descendant of a pending
//   skeleton link is pending, not accepted (§8.4/§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-02T01:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });
  const ghost = t(0, 5, 'ghost-gg'); // never arrives
  // A: skeleton edit on an UNKNOWN base — pending. B bases on A: A exists in the union,
  // but it was never ACCEPTED — B must pend too, not win a fork and stub every verse.
  const A = E('text.skeleton.set', 'ghost-gg', t(1, 0, 'ghost-gg'), ghost, { book: 'TIT', skeleton: `\\id TIT via ghost\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` });
  const B = E('text.skeleton.set', 'checker-b', t(2, 0, 'checker-b'), A.ts, { book: 'TIT', skeleton: `\\id TIT via B\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` });
  const out = fold([add, A, B]);
  check('J22c: a skeleton edit based on a PENDING link pends too — it never becomes a head, and the projection is unchanged (verse bytes intact)',
    out.pendingStructural.length === 2 &&
    !out.books.TIT.usfm.startsWith('\\id TIT via B') &&
    out.books.TIT.verses['1:1'] === 'uno\n' && out.books.TIT.verses['1:2'] === 'dos\n',
    JSON.stringify({ pending: out.pendingStructural, verses: out.books.TIT.verses, header: out.books.TIT.usfm.split('\n')[0] }));
  // three-deep chain: C on B on A — all pending until the ancestor resolves
  const C = E('text.skeleton.set', 'checker-b', t(3, 0, 'checker-b'), B.ts, { book: 'TIT', skeleton: `\\id TIT via C\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` });
  const deep = fold([add, A, B, C]);
  check('J22c: pending propagates through a three-deep chain — every descendant pends',
    deep.pendingStructural.length === 3 && deep.books.TIT.verses['1:1'] === 'uno\n' &&
    !deep.books.TIT.usfm.startsWith('\\id TIT via'),
    JSON.stringify(deep.pendingStructural));
  // when the missing ancestor arrives, the whole chain folds (event-SET determinism)
  const ghostEv = E('text.skeleton.set', 'ghost-gg', ghost, add.ts, { book: 'TIT', skeleton: `\\id TIT via ghost0\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}` });
  const resolved = fold([add, ghostEv, A, B, C]);
  check('J22c: when the missing ancestor arrives, the whole chain folds and verse bytes are untouched (byte invariant holds)',
    resolved.pendingStructural.length === 0 && resolved.books.TIT.usfm.startsWith('\\id TIT via C') &&
    resolved.books.TIT.verses['1:1'] === 'uno\n' && resolved.books.TIT.verses['1:2'] === 'dos\n',
    JSON.stringify({ pending: resolved.pendingStructural, header: resolved.books.TIT.usfm.split('\n')[0], verses: resolved.books.TIT.verses }));
}

// ---------- J22d (round 7): ONE accepted-structural-predecessors set — pending
//   propagates transitively ACROSS op types (book.add / text.skeleton.set /
//   text.structure.apply are one chain-link class, §8.4/§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-02T02:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel12 = (hdr) => `\\id TIT${hdr}\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel13 = (hdr) => `\\id TIT${hdr}\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  const add = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel12(''), initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n' } });

  // the reviewer's exact cross-op sequence: a text.structure.apply pending on a MISSING
  // source, then a text.skeleton.set based on that pending structural event — the child
  // must pend too, never be accepted, never win the skeleton fork, never project 1:3 as ___
  const ghostSrc = t(0, 7, 'ghost-gg'); // never arrives
  const structPending = E('text.structure.apply', 'drafter-a', t(1, 0, 'drafter-a'), add.ts, {
    book: 'TIT', skeleton: skel13(''),
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: ghostSrc }] },
    },
    dispositions: [],
  });
  const childSkel = E('text.skeleton.set', 'checker-b', t(2, 0, 'checker-b'), structPending.ts, { book: 'TIT', skeleton: skel13(' via child') });
  const out = fold([add, structPending, childSkel]);
  check('J22d: a skeleton edit based on a PENDING text.structure.apply pends too — pending crosses op types; the pre-op slots and bytes project unchanged',
    out.pendingStructural.length === 2 &&
    Object.keys(out.books.TIT.verses).sort().join(',') === '1:1,1:2' &&
    out.books.TIT.verses['1:2'] === 'dos\n' && !out.books.TIT.usfm.includes('via child'),
    JSON.stringify({ pending: out.pendingStructural, verses: out.books.TIT.verses }));

  // the inverse: a text.structure.apply based on a PENDING text.skeleton.set — the
  // structural child must pend, not apply off an unaccepted link
  const ghostBase = t(0, 8, 'ghost-gg'); // never arrives
  const skelPending = E('text.skeleton.set', 'ghost-gg', t(1, 1, 'ghost-gg'), ghostBase, { book: 'TIT', skeleton: skel12(' via ghost') });
  const structChild = E('text.structure.apply', 'checker-b', t(2, 1, 'checker-b'), skelPending.ts, {
    book: 'TIT', skeleton: skel13(' via structChild'),
    transitions: {
      '1:1': { text: 'uno\n', sources: [{ key: '1:1', ts: add.ts }] },
      '1:3': { text: 'dos\n', sources: [{ key: '1:2', ts: add.ts }] },
    },
    dispositions: [],
  });
  const inv = fold([add, skelPending, structChild]);
  check('J22d: a text.structure.apply based on a PENDING skeleton link pends too — the inverse direction holds (one accepted-predecessor rule, both op types)',
    inv.pendingStructural.length === 2 &&
    Object.keys(inv.books.TIT.verses).sort().join(',') === '1:1,1:2' &&
    inv.books.TIT.verses['1:2'] === 'dos\n' && !inv.books.TIT.usfm.includes('via structChild'),
    JSON.stringify({ pending: inv.pendingStructural, verses: inv.books.TIT.verses }));

  // mixed three-deep chain: pending skeleton.set → structure.apply → skeleton.set —
  // every descendant pends regardless of op type
  const tail = E('text.skeleton.set', 'checker-b', t(3, 1, 'checker-b'), structChild.ts, { book: 'TIT', skeleton: skel13(' via tail') });
  const deep = fold([add, skelPending, structChild, tail]);
  check('J22d: pending propagates through a MIXED three-deep chain (skeleton.set → structure.apply → skeleton.set) — all three pend',
    deep.pendingStructural.length === 3 &&
    Object.keys(deep.books.TIT.verses).sort().join(',') === '1:1,1:2' &&
    !deep.books.TIT.usfm.includes('via'),
    JSON.stringify(deep.pendingStructural));
  // when the missing ancestor arrives, the whole mixed chain folds (event-SET determinism)
  const ghostEv = E('text.skeleton.set', 'ghost-gg', ghostBase, add.ts, { book: 'TIT', skeleton: skel12(' via ghost0') });
  const resolved = fold([add, ghostEv, skelPending, structChild, tail]);
  check('J22d: when the missing ancestor arrives, the whole mixed chain folds — verse bytes untouched across the op-type boundary',
    resolved.pendingStructural.length === 0 && resolved.books.TIT.usfm.includes('via tail') &&
    resolved.books.TIT.verses['1:1'] === 'uno\n' && resolved.books.TIT.verses['1:3'] === 'dos\n',
    JSON.stringify({ pending: resolved.pendingStructural, header: resolved.books.TIT.usfm.split('\n')[0], verses: resolved.books.TIT.verses }));
}

// ---------- J23: sealed action segments — the §8.1 container contract ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j23-'));
  const actorDir = path.join(tmp, 'journal', 'actor-a');
  const t = (s) => `2026-08-03T00:00:${String(s).padStart(2, '0')}.000Z|0000|actor-a`;
  const ev = (s, verse, text) => mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: t(s), base: null, book: 'TIT', chapter: '1', verse, text });

  const f1 = writeActionSegment(actorDir, [ev(1, '1', 'uno\n')]);
  const f2 = writeActionSegment(actorDir, [ev(2, '2', 'dos\n')]);
  const got = readSegments(actorDir);
  check('J23: a valid segment round-trips; filenames are ts-encoded (: → _, | → ,) and sort in ts order',
    got.length === 2 && got[0].ts === t(1) && path.basename(f1) === segmentName(t(1)) &&
    !path.basename(f1).includes('|') && [path.basename(f1), path.basename(f2)].sort()[0] === path.basename(f1),
    path.basename(f1));

  // torn write: an unparseable or checksum-failing segment is invisible AS A WHOLE
  const seg3 = sealAction([ev(3, '3', 'tres\n'), ev(4, '4', 'cuatro\n')]);
  const f3 = path.join(actorDir, 'segments', segmentName(t(3)));
  fs.writeFileSync(f3, seg3.slice(0, Math.floor(seg3.length / 2)));
  const invalids = [];
  const gotTorn = readSegments(actorDir, (file, reason) => invalids.push(reason));
  check('J23: a torn segment is unpublished as a whole — no partial action ever folds',
    gotTorn.length === 2 && invalids.length === 1, JSON.stringify(invalids));
  fs.writeFileSync(f3, seg3.replace('tres', 'trXs')); // valid JSON, wrong checksum
  const invalids2 = [];
  const gotBad = readSegments(actorDir, (file, reason) => invalids2.push(reason));
  check('J23: a checksum-failing segment is invisible as a whole (parse/checksum validity IS the commit marker)',
    gotBad.length === 2 && invalids2[0] === 'checksum', JSON.stringify(invalids2));
  fs.rmSync(f3, { force: true });

  // 4 MiB limit
  let oversize = false;
  try { sealAction([ev(5, '5', 'x'.repeat(SEGMENT_LIMIT))]); } catch { oversize = true; }
  check('J23: the 4 MiB segment limit binds the writer, and an oversize file is invalid to readers',
    oversize && validateSegment('{"container":1,"body":"' + 'x'.repeat(80) + '","sha256":"00"}').ok === false);

  // multi-scope action: one segment carries _project-scope and book-scope events together
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const multi = [
    mkEvent({ op: 'book.add', actor: 'actor-m', ts: '2026-08-03T00:01:00.000Z|0000|actor-m', book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } }),
    mkEvent({ op: 'settings.set', actor: 'actor-m', ts: '2026-08-03T00:01:00.000Z|0001|actor-m', path: 'ui.pane', value: 1 }),
    mkEvent({ op: 'project.meta.set', actor: 'actor-m', ts: '2026-08-03T00:01:00.000Z|0002|actor-m', path: 'identification.name.en', value: 'Multi' }),
  ];
  const mDir = path.join(tmp, 'journal', 'actor-m');
  writeActionSegment(mDir, multi);
  const mOut = fold(readUnion(path.join(tmp, 'journal')));
  check('J23: multi-scope actions in ONE segment (book + settings + metadata) fold correctly',
    mOut.books.TIT?.verses['1:1'] === 'uno\n' && mOut.settings['ui.pane'] === 1 && mOut.projectMeta['identification.name.en'] === 'Multi');

  // actor binding at the directory: a segment whose events name a different actor is invalid
  const foreign = [mkEvent({ op: 'settings.set', actor: 'actor-z', ts: '2026-08-03T00:02:00.000Z|0000|actor-z', path: 'ui.z', value: 9 })];
  writeActionSegment(path.join(tmp, 'journal', 'actor-a2'), foreign);
  const invalids3 = [];
  readSegments(path.join(tmp, 'journal', 'actor-a2'), (file, reason) => invalids3.push(reason));
  check('J23: a segment whose events name another actor than its directory is refused (actor binding, §8.3)',
    invalids3.length === 1 && String(invalids3[0]).startsWith('actor-mismatch'), JSON.stringify(invalids3));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J23b: accepted segments are IMMUTABLE at the writer, and invalidity is never silently dropped (§8.1) ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j23b-'));
  const actorDir = path.join(tmp, 'journal', 'actor-a');
  const t = (s) => `2026-08-10T00:00:${String(s).padStart(2, '0')}.000Z|0000|actor-a`;
  const ev = (s, text) => mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: t(s), base: null, book: 'TIT', chapter: '1', verse: '1', text });

  const e1 = ev(1, 'uno\n');
  const f1 = writeActionSegment(actorDir, [e1]);
  const f1Bytes = fs.readFileSync(f1, 'utf8');
  // branch 1: byte-identical rewrite is an idempotent accept
  let idempotent = true;
  try { writeActionSegment(actorDir, [e1]); } catch { idempotent = false; }
  // branch 2: a DIFFERENT valid action at the same path is rejected — never overwritten
  let rejected = '';
  try { writeActionSegment(actorDir, [ev(1, 'otro\n')]); } catch (e) { rejected = e.message; }
  check('J23b: writeSegment branches — byte-identical rewrite accepts idempotently; a different valid action at the same path is REJECTED, bytes untouched',
    idempotent && rejected !== '' && fs.readFileSync(f1, 'utf8') === f1Bytes,
    `"${rejected.slice(0, 60)}"`);
  // branch 3: an INVALID existing segment is overwritten only via verified staged-intent recovery
  const e2 = ev(2, 'dos\n');
  const staged = sealAction([e2]);
  const f2 = path.join(actorDir, 'segments', segmentName(e2.ts));
  fs.writeFileSync(f2, staged.slice(0, 30)); // torn
  let plainWriteOnInvalid = '';
  try { writeActionSegment(actorDir, [e2]); } catch (e) { plainWriteOnInvalid = e.message; }
  let republished = false;
  try { republishSegment(actorDir, staged); republished = true; } catch {}
  let republishOverValid = '';
  try { republishSegment(actorDir, sealAction([ev(1, 'otro\n')])); } catch (e) { republishOverValid = e.message; }
  check('J23b: an invalid existing segment is recovered ONLY through verified staged-intent republication — a plain write refuses; republication over a VALID segment refuses',
    plainWriteOnInvalid !== '' && republished && fs.readFileSync(f2, 'utf8') === staged && republishOverValid !== '',
    JSON.stringify({ plainWriteOnInvalid: plainWriteOnInvalid.slice(0, 40), republishOverValid: republishOverValid.slice(0, 40) }));
  // silent drop is impossible: with no onInvalid handler, an invalid segment THROWS
  const f3 = path.join(actorDir, 'segments', segmentName(t(3)));
  fs.writeFileSync(f3, '{"container":1,"body":"broken');
  let surfaced = '';
  try { readSegments(actorDir); } catch (e) { surfaced = e.message; }
  let unionSurfaced = '';
  try { readUnion(path.join(tmp, 'journal')); } catch (e) { unionSurfaced = e.message; }
  const collected = [];
  const withHandler = readSegments(actorDir, (file, reason) => collected.push(reason));
  check('J23b: readSegments/readUnion NEVER silently drop an invalid segment — the default surfaces it (throws); an explicit handler collects and reads the valid remainder',
    surfaced.includes('invalid') && unionSurfaced.includes('invalid') && collected.length === 1 && withHandler.length === 2,
    JSON.stringify({ surfaced: surfaced.slice(0, 50), collected }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J23c (review round 3): segment filenames are legal on Windows AND under §2 (§8.1) ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j23c-'));
  const actorDir = path.join(tmp, 'journal', 'maria-x1');
  // the full §8.2 ts alphabet: digits, '-', 'T', ':', '.', 'Z', '|', hex, [a-z0-9-] —
  // ':' and '|' are the two Windows-reserved characters a ts always carries
  const tss = [
    '2026-07-07T14:03:22.113Z|0007|maria-x1',
    '2026-07-07T14:03:22.113Z|000a|maria-x1',
    '2026-07-07T14:03:23.000Z|0000|maria-x1',
    '2026-12-31T23:59:59.999Z|ffff|maria-x1',
  ];
  const names = tss.map(segmentName);
  const WINDOWS_RESERVED = /[<>:"/\\|?*]/;                 // Windows filename rules
  const WINDOWS_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i; // reserved device names
  const ING_FORBIDDEN = /\.\.|[~\\&*+| ?#%{}<>$!']/;       // §2 ingredient-path constraints
  check('J23c: segment filenames carry NO Windows-reserved character, no reserved device name, no leading dot, no trailing dot/space',
    names.every((n) => !WINDOWS_RESERVED.test(n) && !WINDOWS_DEVICE.test(n) && !n.startsWith('.') && !/[. ]$/.test(n)),
    JSON.stringify(names[0]));
  check('J23c: segment filenames satisfy the §2 ingredient-path constraints too',
    names.every((n) => !ING_FORBIDDEN.test(n)),
    JSON.stringify(names[0]));
  const segmentTs = filesAll.segmentTs;
  check('J23c: the encoding is INJECTIVE and reversible — every risky ts character round-trips through the filename',
    typeof segmentTs === 'function' && tss.every((ts) => segmentTs(segmentName(ts)) === ts),
    typeof segmentTs === 'function' ? JSON.stringify(names) : 'segmentTs not implemented');
  // fixed-position escapes preserve the total order: filename sort = ts sort
  check('J23c: filename sort equals ts sort within an actor directory (fixed-width escape positions)',
    deepEq([...names].sort(), tss.map(segmentName)) && tss.every((ts, i) => !i || tss[i - 1] < ts),
    JSON.stringify(names));
  // write → read round-trip through real files, in ts order
  for (const ts of tss) writeActionSegment(actorDir, [mkEvent({ op: 'settings.set', actor: 'maria-x1', ts, path: 'ui.x', value: ts })]);
  const got = readSegments(actorDir);
  const onDisk = fs.readdirSync(path.join(actorDir, 'segments')).sort();
  check('J23c: a ts round-trips write→read — events return in ts order and each file is named by its encoded ts',
    got.length === tss.length && got.every((e, i) => e.ts === tss[i]) && deepEq(onDisk, names),
    JSON.stringify(onDisk));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J23d (review round 4): the container contract binds the ACTION shape too (§8.1) ----------
// §8.1 MUST audit, one firing case each: outer parse + container:1 + body-string + sha256
// (J23 torn/checksum), 4 MiB (J23), directory actor binding (J23/readSegments), reserved
// reader field (J29e), and — added here — non-empty events, strict ts order, one actor.
{
  const sha = (x) => crypto.createHash('sha256').update(x, 'utf8').digest('hex');
  const craft = (events) => { const body = JSON.stringify({ events }); return JSON.stringify({ container: 1, body, sha256: sha(body) }); };
  const ev = (s, a, extra = {}) => mkEvent({ op: 'settings.set', actor: a, ts: `2026-08-11T00:00:0${s}.000Z|0000|${a}`, path: 'ui.x', value: s, ...extra });
  const rEmpty = validateSegment(craft([]));
  check('J23d: an EMPTY events array is invalid — an action is one store mutation, at least one event (no later crash on events[0])',
    rEmpty.ok === false, JSON.stringify(rEmpty));
  const rOrder = validateSegment(craft([ev(2, 'actor-a'), ev(1, 'actor-a')]));
  check('J23d: a mis-ordered events array is invalid — the contract requires ts order inside the action',
    rOrder.ok === false, JSON.stringify(rOrder.ok === false ? rOrder : '(validated ok)'));
  const rDup = validateSegment(craft([ev(1, 'actor-a'), ev(1, 'actor-a')]));
  check('J23d: a duplicated ts inside one action is invalid (strictly ascending — one actor cannot issue the same ts twice)',
    rDup.ok === false, JSON.stringify(rDup.ok === false ? rDup : '(validated ok)'));
  const rMixed = validateSegment(craft([ev(1, 'actor-a'), ev(2, 'actor-b')]));
  check('J23d: events naming more than one actor in one segment are invalid (one action, one actor, §8.1)',
    rMixed.ok === false, JSON.stringify(rMixed.ok === false ? rMixed : '(validated ok)'));
  // the writer refuses to seal what readers must reject
  let wEmpty = ''; let wOrder = '';
  try { sealAction([]); } catch (e) { wEmpty = e.message; }
  try { sealAction([ev(2, 'actor-a'), ev(1, 'actor-a')]); } catch (e) { wOrder = e.message; }
  check('J23d: sealAction refuses to seal an empty or mis-ordered action (writer side of the same contract)',
    wEmpty !== '' && wOrder !== '', JSON.stringify({ wEmpty: wEmpty.slice(0, 40), wOrder: wOrder.slice(0, 40) }));
  // a well-formed multi-event action still validates
  const rGood = validateSegment(craft([ev(1, 'actor-a'), ev(2, 'actor-a')]));
  check('J23d: a well-formed multi-event action still validates', rGood.ok === true && rGood.events.length === 2);
}

// ---------- J23e (round 6): no filesystem traversal via a ts-shaped field; writer touches
//   the filesystem LAST (§8.1/§8.2) ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j23e-'));
  const actorDir = path.join(tmp, 'journal', 'actor-a');
  // the reviewer's exact traversal: two pipes satisfy a naive shape check, and the
  // encoded filename walks out of the actor directory
  const evilTs = '../../escaped|0000|actor-a';
  const evil = mkEvent({ op: 'settings.set', actor: 'actor-a', ts: evilTs, path: 'ui.x', value: 1 });
  let sealRefused = '';
  try { sealAction([evil]); } catch (e) { sealRefused = e.message; }
  check('J23e: a traversal-shaped ts is refused by the SCHEMA at seal — the exact §8.2 grammar binds, actor-slug charset included',
    sealRefused.includes('HLC'), sealRefused ? `"${sealRefused.slice(0, 70)}"` : '(sealed fine)');
  let writeRefused = ''; let wrotePath = '';
  try { wrotePath = writeActionSegment(actorDir, [evil]); } catch (e) { writeRefused = e.message; }
  const escaped = fs.readdirSync(tmp).filter((f) => f.includes('escaped'));
  check('J23e: writeActionSegment refuses the traversal and writes NOTHING outside the actor segments directory',
    writeRefused !== '' && escaped.length === 0 && !fs.existsSync(path.join(tmp, 'escaped,0000,actor-a.action.json')),
    JSON.stringify({ writeRefused: writeRefused.slice(0, 50), wrotePath, tmpEntries: fs.readdirSync(tmp) }));
  // defense in depth, schema bypassed: the path derivation itself refuses containment escape
  const segmentPathFor = filesAll.segmentPathFor;
  let guardRefused = '';
  try { if (typeof segmentPathFor !== 'function') throw new Error('segmentPathFor not implemented'); segmentPathFor(actorDir, evilTs); }
  catch (e) { guardRefused = e.message; }
  check('J23e: the path derivation REFUSES containment escape independently of the schema (defense in depth)',
    guardRefused.includes('escape') || guardRefused.includes('refuse'), `"${guardRefused.slice(0, 70)}"`);
  // writer order-of-operations (round-6 finding 6): validate FIRST, filesystem LAST —
  // an empty action gets a clean schema error and creates NO directory
  const freshActor = path.join(tmp, 'journal', 'actor-b');
  let emptyRefused = '';
  try { writeActionSegment(freshActor, []); } catch (e) { emptyRefused = e.message; }
  check('J23e: writeActionSegment([]) is a clean schema refusal and touches the filesystem NOT AT ALL (no directory created)',
    emptyRefused.includes('empty-events') && !fs.existsSync(freshActor),
    JSON.stringify({ emptyRefused: emptyRefused.slice(0, 60), dirCreated: fs.existsSync(freshActor) }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J24: staged-intent (outbox) republication — exact bytes (§8.1 asymmetric rule, local side) ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j24-'));
  const actorDir = path.join(tmp, 'journal', 'actor-a');
  const events = [
    mkEvent({ op: 'settings.set', actor: 'actor-a', ts: '2026-08-04T00:00:01.000Z|0000|actor-a', path: 'ui.a', value: 1 }),
    mkEvent({ op: 'settings.set', actor: 'actor-a', ts: '2026-08-04T00:00:01.000Z|0001|actor-a', path: 'ui.b', value: 2 }),
  ];
  const staged = sealAction(events); // the durable staged intent (outbox record — installation-local)
  const segPath = path.join(actorDir, 'segments', segmentName(events[0].ts));
  fs.mkdirSync(path.dirname(segPath), { recursive: true });
  fs.writeFileSync(segPath, staged.slice(0, 25)); // crash mid-write: torn segment
  const invalidBefore = [];
  const before = readSegments(actorDir, (f, r) => invalidBefore.push(r));
  republishSegment(actorDir, staged); // recovery: the VERIFIED staged bytes, via the recovery path
  const after = readSegments(actorDir);
  check('J24: a torn local segment publishes nothing; republishing the staged bytes yields a byte-identical segment and the full action',
    before.length === 0 && after.length === 2 && fs.readFileSync(segPath, 'utf8') === staged &&
    deepEq(fold(after), fold(events)),
    `${before.length} → ${after.length} events`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J25: project.vrs.set — the immutable first-value register (§8.5) + byte-exact projection (§8.7) ----------
{
  const vrsBytes = fs.readFileSync(ING('vrs.json'), 'utf8');
  const t = (s, a) => `2026-08-05T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const v1 = mkEvent({ op: 'project.vrs.set', actor: 'actor-a', ts: t(1, 'actor-a'), name: 'eng', bytes: vrsBytes });
  const v1dup = mkEvent({ op: 'project.vrs.set', actor: 'actor-b', ts: t(2, 'actor-b'), name: 'eng', bytes: vrsBytes });
  const v2 = mkEvent({ op: 'project.vrs.set', actor: 'actor-b', ts: t(3, 'actor-b'), name: 'lxx', bytes: '{"maxVerses":{}}' });
  const first = fold([v1]);
  const deduped = fold([v1, v1dup]);
  const rejected = fold([v1, v1dup, v2]);
  check('J25: the first value binds; an identical repeat de-duplicates (no conflict surfaced)',
    first.vrs.bytes === vrsBytes && deduped.vrs.bytes === vrsBytes && deduped.vrsRejected.length === 0);
  check('J25: ANY different second value is surfaced and never applied — regardless of actor or base (not LWW)',
    rejected.vrs.name === 'eng' && rejected.vrs.bytes === vrsBytes && deepEq(rejected.vrsRejected, [v2.ts]),
    JSON.stringify(rejected.vrsRejected));
  check('J25: projection reproduces ingredients/vrs.json byte-exactly from the stored raw bytes (§8.7 derived list includes vrs.json)',
    derivedProjections(first, { baseMetadata: JSON.parse(fs.readFileSync(path.join(BURRITO, 'metadata.json'), 'utf8')) })['vrs.json'] === vrsBytes);
  // creation seeding carries vrs (seed source enum gains "creation")
  const seeded = seedFromSidecars({ actor: 'seed-actor', books: {}, vrs: { name: 'eng', bytes: vrsBytes }, source: 'creation' });
  const seededOut = fold(seeded);
  check('J25: the creation seed segment carries project.vrs.set with seed.source "creation"',
    seeded[0].op === 'project.vrs.set' && seeded[0].seed.source === 'creation' && seededOut.vrs.bytes === vrsBytes);
}

// ---------- J26: the pin golden projection — events → byte-equivalent §5.3 resources.json ----------
{
  const sample = JSON.parse(fs.readFileSync(ING('checking/resources.json'), 'utf8'));
  const LS = ['gatewayLanguage', 'translationNotes', 'translationWordsLinks', 'translationWords', 'translationAcademy'];
  const t = (s, c) => `2026-08-06T00:00:${String(s).padStart(2, '0')}.${String(c).padStart(3, '0')}Z|0000|pinner-a`;
  const events = [];
  let n = 0;
  const pin = (slot, entry) => events.push(mkEvent({ op: 'resource.pin.set', actor: 'pinner-a', ts: t(Math.floor(n / 60), (n++) % 60), slot, entry }));
  for (const set of ['primary', 'fallback']) for (const slot of LS) pin(`languageSets.${set}.${slot}`, sample.languageSets[set][slot]);
  for (const group of ['originalLanguage', 'lexicon']) for (const tk of ['nt', 'ot']) pin(`resources.${group}.${tk}`, sample.resources[group][tk]);
  for (const extra of sample.extraScripture) pin(`extraScripture.${extra.id}`, extra);
  const out = fold(events);
  const projected = projectResources(out.pins);
  // expected bytes constructed independently, in the §5.3 document's own key order
  // (the sample's informational top-level "note" is writer metadata, not journal state)
  const ordered = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
  const expected = JSON.stringify({
    schemaVersion: 2,
    languageSets: { primary: ordered(sample.languageSets.primary, LS), fallback: ordered(sample.languageSets.fallback, LS) },
    resources: { originalLanguage: ordered(sample.resources.originalLanguage, ['nt', 'ot']), lexicon: ordered(sample.resources.lexicon, ['nt', 'ot']) },
    extraScripture: sample.extraScripture,
  }, null, 2) + '\n';
  check('J26: pin events project to a byte-equivalent §5.3 resources.json (the golden projection, from the real sample\'s pins)',
    projected === expected, projected === expected ? `${projected.length} bytes` : 'byte mismatch');
  const rng = mulberry32(SEED + 26);
  check('J26: the pin projection is deterministic under event permutation',
    projectResources(fold(shuffled(events, rng)).pins) === expected);
  // removal within the pin grammar projects to absence
  const rm = mkEvent({ op: 'resource.pin.set', actor: 'pinner-a', ts: t(50, 0), base: out.headsTs['pin|extraScripture.ust'], slot: 'extraScripture.ust', removed: true });
  const removedOut = fold([...events, rm]);
  const removedProj = projectResources(removedOut.pins);
  check('J26: pin removal ({slot, removed: true}) projects to absence',
    !('extraScripture.ust' in removedOut.pins) && removedProj.includes('"ult"') && !removedProj.includes('"ust"'));
  // slot grammar: anything outside the §5.3 paths refuses
  let badSlot = '';
  try { fold([mkEvent({ op: 'resource.pin.set', actor: 'pinner-a', ts: t(51, 0), slot: 'slot0', entry: {} })]); }
  catch (e) { badSlot = e.message; }
  check('J26: an out-of-grammar pin slot refuses the fold (§5.3 slot grammar is the merge identity)',
    badSlot.includes('not a §5.3 slot'), `"${badSlot.slice(0, 60)}"`);
}

// ---------- J27: removal semantics per surface (§8.5 — JSON null is not absence) ----------
{
  const t = (s, a) => `2026-08-07T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const add = E('book.add', 'actor-a', t(0, 'actor-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } });

  // settings + project.meta: {path, removed: true} folds to absence; projection equals never-set
  const sSet = E('settings.set', 'actor-a', t(1, 'actor-a'), null, { path: 'ui.pane', value: 3 });
  const sRm = E('settings.set', 'actor-a', t(2, 'actor-a'), sSet.ts, { path: 'ui.pane', removed: true });
  const mSet = E('project.meta.set', 'actor-a', t(3, 'actor-a'), null, { path: 'identification.abbreviation.en', value: 'X' });
  const mRm = E('project.meta.set', 'actor-a', t(4, 'actor-a'), mSet.ts, { path: 'identification.abbreviation.en', removed: true });
  const withRm = fold([add, sSet, sRm, mSet, mRm]);
  const never = fold([add]);
  check('J27: settings/meta unset ({path, removed: true}) folds to absence',
    !('ui.pane' in withRm.settings) && !('identification.abbreviation.en' in withRm.projectMeta));
  check('J27: the projected settings document after a removal is byte-equal to one where the path was never set',
    projectSettings(withRm.settings) === projectSettings(never.settings));

  // alignment removal = explicit empty-state payload — a defined record, never absence
  const alignSet = E('align.verse.set', 'actor-b', t(5, 'actor-b'), null, { book: 'TIT', chapter: '1', verse: '1', generation: add.ts, alignments: [{ topWords: [{ word: 'x' }], bottomWords: [] }], wordBank: [], targetVerseMd5: md5('uno') });
  const alignEmpty = E('align.verse.set', 'actor-b', t(6, 'actor-b'), alignSet.ts, { book: 'TIT', chapter: '1', verse: '1', generation: add.ts, alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  const emptied = fold([add, alignSet, alignEmpty]);
  check('J27: alignment removal is the explicit empty-state payload — the record projects (empty), it does not vanish',
    !!emptied.alignments.TIT?.['1:1'] && emptied.alignments.TIT['1:1'].alignments.length === 0 && emptied.invalid.length === 0);

  // decisions are never deleted (D36): no removal op exists; invalidate-and-retain keeps the record
  const dec = { contextId: { checkId: 'c1', reference: { bookId: 'tit', chapter: 1, verse: 1 }, occurrence: 1 }, selections: [{ text: 'uno', occurrence: 1, occurrences: 1 }], invalidated: false, status: 'valid' };
  const dSet = E('check.decision.set', 'actor-a', t(7, 'actor-a'), null, { toolId: 'translationWords', generation: add.ts, decision: dec });
  const dInv = E('check.decision.set', 'actor-a', t(8, 'actor-a'), dSet.ts, { toolId: 'translationWords', generation: add.ts, decision: { ...dec, invalidated: true, status: 'invalid' } });
  const invalidated = fold([add, dSet, dInv]);
  let noRemovalOp = '';
  try { fold([mkEvent({ op: 'check.decision.remove', actor: 'actor-a', ts: t(9, 'actor-a') })]); } catch (e) { noRemovalOp = e.message; }
  check('J27: decisions are never deleted — the invalidated record is retained in full, and no removal op exists in the vocabulary',
    invalidated.decisions.translationWords.length === 1 && invalidated.decisions.translationWords[0].invalidated === true &&
    noRemovalOp.includes('unrecognized op'));
}

// ---------- J28: actor binding + the same-actor linear rule (§8.3) ----------
{
  const t = (s, a) => `2026-08-08T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  let bound = '';
  try { fold([E('settings.set', 'actor-b', t(1, 'actor-a'), null, { path: 'ui.x', value: 1 })]); }
  catch (e) { bound = e.message; }
  check('J28: the fold refuses an event whose actor differs from its ts actor (actor binding)',
    bound.includes('actor binding'), `"${bound.slice(0, 60)}"`);

  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const add = E('book.add', 'actor-a', t(0, 'actor-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } });
  const v1 = E('text.verse.set', 'actor-a', t(1, 'actor-a'), add.ts, { book: 'TIT', chapter: '1', verse: '1', text: 'uno v1\n' });
  const v2stale = E('text.verse.set', 'actor-a', t(2, 'actor-a'), add.ts, { book: 'TIT', chapter: '1', verse: '1', text: 'uno v2\n' }); // stale base
  const v3null = E('text.verse.set', 'actor-a', t(3, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', text: 'uno v3\n' }); // no base at all
  const linear = fold([add, v1, v2stale, v3null]);
  check('J28: same-actor events with a stale or missing base advance linearly — an actor never forks against itself (§8.3:334)',
    linear.forks.length === 0 && linear.books.TIT.verses['1:1'] === 'uno v3\n',
    JSON.stringify(linear.forks));
  // contrast: the SAME stale base from a DIFFERENT actor still forks
  const vB = E('text.verse.set', 'actor-b', t(4, 'actor-b'), add.ts, { book: 'TIT', chapter: '1', verse: '1', text: 'uno B\n' });
  const crossActor = fold([add, v1, vB]);
  check('J28: the same stale base from a different actor still forks (the rule is same-actor only)',
    crossActor.forks.length === 1, JSON.stringify(crossActor.forks));
}

// ---------- J29: self-contained book.add — multi-key head identity + scope reconstruction (§8.5/§8.7) ----------
{
  const t = (s, a) => `2026-08-09T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const skelT = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skelJ = `\\id JON\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const addT = E('book.add', 'actor-a', t(0, 'actor-a'), null, { book: 'TIT', scope: ['1:1-2:5'], skeleton: skelT, initialVerses: { '1:1': 'uno\n' } });
  const addJ = E('book.add', 'actor-a', t(1, 'actor-a'), null, { book: 'JON', scope: [], skeleton: skelJ, initialVerses: {} });
  const out = fold([addT, addJ]);
  check('J29: book.add is self-contained — one event creates the slot topology; an uncovered slot projects the ___ stub',
    out.books.TIT.verses['1:1'] === 'uno\n' && out.books.TIT.verses['1:2'] === '___\n' && out.books.JON.verses['1:1'] === '___\n');
  check('J29: every produced head carries the book.add ts (the multi-key head-identity rule)',
    out.headsTs['text|TIT|1:1'] === addT.ts && out.headsTs['text|TIT|1:2'] === addT.ts && out.headsTs['skel|TIT'] === addT.ts);
  const vB = E('text.verse.set', 'actor-b', t(2, 'actor-b'), addT.ts, { book: 'TIT', chapter: '1', verse: '2', text: 'dos B\n' });
  const advanced = fold([addT, addJ, vB]);
  check('J29: a subsequent event using the book.add ts as base advances linearly (no fork)',
    advanced.forks.length === 0 && advanced.books.TIT.verses['1:2'] === 'dos B\n');
  check('J29: a checkpoint reconstructs type.flavorType.currentScope from folded scope state (§3 rule 4 — [] and range arrays)',
    deepEq(advanced.scope, { TIT: ['1:1-2:5'], JON: [] }));
  let noSkel = ''; let noScope = '';
  try { fold([E('book.add', 'actor-a', t(3, 'actor-a'), null, { book: 'TIT', scope: [] })]); } catch (e) { noSkel = e.message; }
  try { fold([E('book.add', 'actor-a', t(3, 'actor-a'), null, { book: 'TIT', skeleton: skelT })]); } catch (e) { noScope = e.message; }
  check('J29: book.add without skeleton or scope refuses (self-contained is mandatory)',
    noSkel.includes('skeleton') && noScope.includes('scope'));
}

// ---------- J29c (review round 3): generations are CAUSAL — the generation field beats the HLC (§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-13T00:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  // the reviewer's exact five-step counter-sequence:
  // 1. A creates gen-1
  const add1 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } });
  // 2. offline B creates records in gen-1 (stamped with the projected generation root)
  const dec1 = E('check.decision.set', 'checker-b', t(1, 0, 'checker-b'), null, { toolId: 'translationWords', generation: add1.ts,
    decision: { contextId: { checkId: 'g1', reference: { bookId: 'tit', chapter: '1', verse: '1' }, occurrence: 1 }, selections: false, invalidated: false, status: 'todo' } });
  const align1 = E('align.verse.set', 'checker-b', t(1, 1, 'checker-b'), null, { book: 'TIT', chapter: '1', verse: '1', generation: add1.ts,
    alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  // 3. A removes + re-adds the book (gen-2)
  const remove = E('book.remove', 'drafter-a', t(2, 0, 'drafter-a'), add1.ts, { book: 'TIT' });
  const add2 = E('book.add', 'drafter-a', t(3, 0, 'drafter-a'), remove.ts, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'nuevo\n' } });
  // 4./5. still-offline B EDITS its gen-1 records — each carries a LATER ts than the re-add
  const dec2 = E('check.decision.set', 'checker-b', t(4, 0, 'checker-b'), dec1.ts, { toolId: 'translationWords', generation: add1.ts,
    decision: { contextId: { checkId: 'g1', reference: { bookId: 'tit', chapter: '1', verse: '1' }, occurrence: 1 }, selections: [{ text: 'uno', occurrence: 1 }], invalidated: false, status: 'valid' } });
  const align2 = E('align.verse.set', 'checker-b', t(4, 1, 'checker-b'), align1.ts, { book: 'TIT', chapter: '1', verse: '1', generation: add1.ts,
    alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  const out = fold([add1, dec1, align1, remove, add2, dec2, align2]);
  check('J29c: an offline later-ts EDIT of a prior-generation record never projects against gen-2 — generation mismatch quarantines REGARDLESS of ts',
    (out.decisions.translationWords || []).length === 0 && !out.alignments.TIT?.['1:1'],
    JSON.stringify({ decs: out.decisions, align: out.alignments.TIT }));
  check('J29c: the later-ts prior-generation edit lands in retained[] as prior-generation (quarantine, not resurrection, not deletion)',
    out.retained.some((r) => r.ts === dec2.ts && r.reason === 'prior-generation') &&
    out.retained.some((r) => r.ts === align2.ts && r.reason === 'prior-generation'),
    JSON.stringify(out.retained));
  // a record stamped with the CURRENT generation root projects normally
  const align3 = E('align.verse.set', 'checker-b', t(5, 0, 'checker-b'), null, { book: 'TIT', chapter: '1', verse: '1', generation: add2.ts,
    alignments: [], wordBank: [], targetVerseMd5: md5('nuevo') });
  const cur = fold([add1, dec1, align1, remove, add2, dec2, align2, align3]);
  check('J29c: a record stamped with the current generation root projects, and the generation field never leaks into the projected §5.1 record',
    !!cur.alignments.TIT?.['1:1'] && cur.alignments.TIT['1:1'].generation === undefined && cur.invalid.length === 0,
    JSON.stringify(cur.alignments.TIT));
  // seeding stamps the seed's own book.add ts — the seeded fold quarantines nothing
  const seeded = seedFromSidecars({ actor: 'seed-x', books: { TIT: recompose(skel, { '1:1': 'uno\n' }) },
    alignmentFiles: { TIT: { chapters: { 1: { 1: { alignments: [], wordBank: [], targetVerseMd5: md5('uno') } } } } },
    decisionFiles: { translationWords: { decisions: [dec1.decision] } } });
  const seedAdd = seeded.find((e) => e.op === 'book.add');
  check('J29c: universal seeding stamps generation from the seed\'s own book.add — every seeded record is current-generation',
    seeded.filter((e) => e.op === 'align.verse.set' || e.op === 'check.decision.set').every((e) => e.generation === seedAdd.ts) &&
    fold(seeded).retained.length === 0,
    JSON.stringify(seeded.map((e) => [e.op, e.generation])));
}

// ---------- J29d (review round 3): decisionKey-targeted notes quarantine with their book's generation (§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-13T01:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const add1 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } });
  // a gen-1 decisionKey-targeted note (the §5.2 identity-key string embeds the bookId):
  // the generation filter must parse the book out of the key to find its root
  const noteOld = E('note.add', 'checker-b', t(1, 0, 'checker-b'), null, { generation: add1.ts, target: { decisionKey: 'g1|tit|1|1|1' }, text: 'nota gen-1' });
  const remove = E('book.remove', 'drafter-a', t(2, 0, 'drafter-a'), add1.ts, { book: 'TIT' });
  const add2 = E('book.add', 'drafter-a', t(3, 0, 'drafter-a'), remove.ts, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'nuevo\n' } });
  // a STAMPED gen-1 decisionKey note written by still-offline B AFTER the re-add (later ts)
  const noteLate = E('note.add', 'checker-b', t(4, 0, 'checker-b'), null, { target: { decisionKey: 'g1|tit|1|1|1' }, generation: add1.ts, text: 'nota gen-1 tardía' });
  const out = fold([add1, noteOld, remove, add2, noteLate]);
  check('J29d: a prior-generation decisionKey-targeted note never projects — the generation filter reaches notes with no target.book',
    !out.notes.some((n) => n.ts === noteOld.ts) && !out.notes.some((n) => n.ts === noteLate.ts),
    JSON.stringify(out.notes.map((n) => n.text)));
  check('J29d: both notes are QUARANTINED as prior-generation — the parsed §5.2 bookId finds the root; the stamp beats the later ts',
    out.retained.some((r) => r.ts === noteOld.ts && r.reason === 'prior-generation') &&
    out.retained.some((r) => r.ts === noteLate.ts && r.reason === 'prior-generation'),
    JSON.stringify(out.retained));
  // a current-generation decisionKey note projects normally
  const noteCur = E('note.add', 'checker-b', t(5, 0, 'checker-b'), null, { target: { decisionKey: 'g1|tit|1|1|1' }, generation: add2.ts, text: 'nota gen-2' });
  const cur = fold([add1, noteOld, remove, add2, noteLate, noteCur]);
  check('J29d: a current-generation decisionKey-targeted note projects (the quarantine binds to the generation, not to the target shape)',
    cur.notes.some((n) => n.ts === noteCur.ts),
    JSON.stringify(cur.notes.map((n) => n.text)));
}

// ---------- J29e (review round 4): omitting `generation` is REFUSED, never a quarantine bypass (§8.5) ----------
{
  const E = (op, actor, ts, base, extra) => mkEvent({ op, actor, ts, base, ...extra });
  const t = (s, c, a) => `2026-08-13T02:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const skel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const add1 = E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'uno\n' } });
  const remove = E('book.remove', 'drafter-a', t(1, 0, 'drafter-a'), add1.ts, { book: 'TIT' });
  const add2 = E('book.add', 'drafter-a', t(2, 0, 'drafter-a'), remove.ts, { book: 'TIT', scope: [], skeleton: skel, initialVerses: { '1:1': 'nuevo\n' } });
  // the reviewer's bypass: a later decision with NO generation field (no seed, not legacy)
  const decNoGen = E('check.decision.set', 'checker-b', t(3, 0, 'checker-b'), null, { toolId: 'translationWords',
    decision: { contextId: { checkId: 'g1', reference: { bookId: 'tit', chapter: '1', verse: '1' }, occurrence: 1 }, selections: false, invalidated: false, status: 'todo' } });
  let refused = ''; let bypassed = null;
  try { bypassed = fold([add1, remove, add2, decNoGen]); } catch (e) { refused = e.message; }
  check('J29e: a v1 align/decision/note event with NO generation stamp is REFUSED as malformed — omission is not a quarantine bypass',
    refused.includes('generation'),
    refused ? `"${refused.slice(0, 80)}"` : `projected: ${JSON.stringify(bypassed?.decisions)}`);
  const alignNoGen = E('align.verse.set', 'checker-b', t(3, 1, 'checker-b'), null, { book: 'TIT', chapter: '1', verse: '1', alignments: [], wordBank: [], targetVerseMd5: md5('nuevo') });
  const noteNoGen = E('note.add', 'checker-b', t(3, 2, 'checker-b'), null, { target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'sin sello' });
  let refusedA = ''; let refusedN = '';
  try { fold([add2, alignNoGen]); } catch (e) { refusedA = e.message; }
  try { fold([add2, noteNoGen]); } catch (e) { refusedN = e.message; }
  check('J29e: the refusal covers all three stamped ops (align.verse.set, check.decision.set, note.add)',
    refusedA.includes('generation') && refusedN.includes('generation'),
    JSON.stringify({ refusedA: refusedA.slice(0, 50), refusedN: refusedN.slice(0, 50) }));
  // seed is NOT an exemption (round-5 simplification): the seeder stamps (§8.8), so a
  // seed-flagged event without generation is a self-declared bypass — refused
  const seededDec = { ...decNoGen, ts: t(5, 0, 'checker-b'), seed: { source: 'creation', batch: t(5, 0, 'checker-b') } };
  let seedRefused = ''; let seedOut = null;
  try { seedOut = fold([add1, remove, add2, seededDec]); } catch (e) { seedRefused = e.message; }
  check('J29e: a seed-flagged event without a generation stamp is REFUSED — seed is not a self-declared bypass (the seeder always stamps, §8.8)',
    seedRefused.includes('generation'),
    seedRefused ? `"${seedRefused.slice(0, 70)}"` : `projected: ${JSON.stringify(seedOut?.decisions)}`);
}

// ---------- J30: unjournaled-ingredient tolerance + whole-surface divergence detection (§8.5/§8.8) ----------
{
  const { events, decisionFiles } = buildSeed();
  const out = fold(events);
  const baseMetadata = JSON.parse(fs.readFileSync(path.join(BURRITO, 'metadata.json'), 'utf8'));
  const projections = derivedProjections(out, { baseMetadata, resolutions: {
    translationWords: { TIT: decisionFiles.translationWords.resource },
    translationNotes: { TIT: decisionFiles.translationNotes.resource },
  } });
  check('J30: the checkpoint regeneration set is EXHAUSTIVE per §8.7 — USFM, alignment + decision sidecars, resources, settings, metadata; no unjournaled class appears',
    Object.keys(projections).every((p) => !isUnjournaledIngredient(p)) &&
    'TIT.usfm' in projections && 'JON.usfm' in projections &&
    'checking/alignments/TIT.json' in projections &&
    'checking/translationWords/TIT.json' in projections && 'checking/translationNotes/TIT.json' in projections &&
    'checking/resources.json' in projections && 'checking/settings.json' in projections &&
    'metadata.json' in projections,
    JSON.stringify(Object.keys(projections)));
  check('J30: the projected metadata.json reconstructs type.flavorType.currentScope from folded scope state (§8.7)',
    deepEq(JSON.parse(projections['metadata.json'] || '{}')?.type?.flavorType?.currentScope, out.scope),
    JSON.stringify(out.scope));
  const disk = {
    // TIT.usfm deliberately ABSENT from disk — a deleted derived file is divergence
    'JON.usfm': projections['JON.usfm'],
    'checking/resources.json': projections['checking/resources.json'],
    'checking/alignments/TIT.json': projections['checking/alignments/TIT.json'].replace('"schemaVersion": 1', '"schemaVersion": 1, "outOfBand": true'),
    'audio/JON-1.mp3': 'RIFF-fake-audio-bytes',
  };
  const cls = classifyDivergence(disk, projections);
  check('J30: divergence detection covers every derived shared file — an out-of-band sidecar edit is detected, never silently overwritten',
    cls.diverged.includes('checking/alignments/TIT.json') && cls.clean.includes('JON.usfm') && cls.clean.includes('checking/resources.json'),
    JSON.stringify(cls.diverged));
  check('J30: a DELETED derived file is divergence — expected-from-fold files are enumerated, not only present-on-disk ones',
    cls.diverged.includes('TIT.usfm') && cls.diverged.includes('checking/translationWords/TIT.json') && cls.diverged.includes('metadata.json'),
    JSON.stringify(cls.diverged));
  check('J30: ingredients/audio/ files are tolerated — never divergence, never regenerated or deleted at checkpoint',
    cls.tolerated.includes('audio/JON-1.mp3') && !cls.diverged.includes('audio/JON-1.mp3'));
}

// ---------- J30b (review round 4): an exhaustive checkpoint REQUIRES its mandatory inputs (§8.7) ----------
{
  const { events, decisionFiles } = buildSeed();
  const out = fold(events);
  const baseMetadata = JSON.parse(fs.readFileSync(path.join(BURRITO, 'metadata.json'), 'utf8'));
  let noMeta = ''; let r1 = null;
  try { r1 = derivedProjections(out); } catch (e) { noMeta = e.message; }
  check('J30b: derivedProjections without baseMetadata THROWS — metadata.json is mandatory checkpoint state, never silently omitted',
    noMeta.includes('baseMetadata'),
    noMeta ? `"${noMeta.slice(0, 70)}"` : `returned incomplete checkpoint: metadata.json in set = ${!!r1?.['metadata.json']}`);
  let noRes = ''; let r2 = null;
  try { r2 = derivedProjections(out, { baseMetadata }); } catch (e) { noRes = e.message; }
  check('J30b: emitting a §5.2 decision file without its (tool, book) resolution record THROWS — `resource` is required derive-time state (D30)',
    noRes.includes('resolution'),
    noRes ? `"${noRes.slice(0, 70)}"` : `emitted without resource: ${!JSON.parse(r2?.['checking/translationWords/TIT.json'] || '{}').resource}`);
  // complete inputs still produce the full set, resource included in every decision file
  const resolutions = {
    translationWords: { TIT: decisionFiles.translationWords.resource },
    translationNotes: { TIT: decisionFiles.translationNotes.resource },
  };
  const full = derivedProjections(out, { baseMetadata, resolutions });
  check('J30b: with complete inputs, every emitted decision file carries its §5.2 resource record and metadata.json is present',
    deepEq(JSON.parse(full['checking/translationWords/TIT.json']).resource, decisionFiles.translationWords.resource) &&
    deepEq(JSON.parse(full['checking/translationNotes/TIT.json']).resource, decisionFiles.translationNotes.resource) &&
    'metadata.json' in full,
    JSON.stringify(Object.keys(full)));
}

console.log(`\nJournal suite: ${pass} passed, ${fail} failed (fast-check seed ${SEED})`);
process.exit(fail ? 1 : 0);
