// Journal conformance suite — BURRITO-SPEC §8 / Appendix A (J1–J30), spec 1.8 (the D48
// flip change set). Properties use fast-check with a FIXED seed for reproducibility.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { makeClock, parseTs, compareTs } from './journal/hlc.mjs';
import { SLOT, decompose, recompose } from './journal/skeleton.mjs';
import { fold, verseTextMd5, slotKeysOf } from './journal/fold.mjs';
import { validateAction } from './journal/schema.mjs';
import { BOOK_CODES, identityKeyOf, identityKeyError, ipathError, pinEntryError, noteRekeyError } from './journal/grammar.mjs';
import { reconcileUsfm, seedFromSidecars } from './journal/reconcile.mjs';
import {
  sealAction, writeActionSegment, validateSegment, validateActorDoc, segmentName,
  readSegments, readUnion, actorDirFor, SEGMENT_LIMIT,
} from './journal/files.mjs';
import * as filesAll from './journal/files.mjs';
const republishSegment = filesAll.republishSegment
  || (() => { throw new Error('republishSegment not implemented'); });
import {
  projectResources, projectSettings, projectAlignments, projectMetadata, derivedProjections,
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
      else if (c.kind === 'pin') e = { op: 'resource.pin.set', slot: `extraScripture.s${c.key}`,
        entry: { id: `s${c.key}`, repoPath: 'git.door43.org/unfoldingWord/en_ult', version: `v${c.val || '0'}`, flavor: 'scripture/textTranslation' } };
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

// ---------- J14d (round 7 internal pre-pass): the §5.2 identity-key STRING grammar —
//   one five-part form (checkId|bookId|chapter|verse|occurrence), one shared
//   serializer/validator pair, everywhere an identity-key string appears ----------
{
  const okTs = (s, a = 'actor-a') => `2026-08-14T02:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const skel1 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const note = (decisionKey, s = 1) => ({ v: 1, op: 'note.add', actor: 'actor-a', ts: okTs(s), base: null,
    generation: okTs(0), target: { decisionKey }, text: 'n' });
  const struct = (dispositions) => ({ v: 1, op: 'text.structure.apply', actor: 'actor-a', ts: okTs(3), base: okTs(0),
    book: 'TIT', skeleton: skel1, transitions: { '1:1': { text: 'uno\n', sources: [] } }, dispositions });
  const CRASHY = /Cannot read|is not iterable|is not a function|undefined is not|toUpperCase/i;
  const rows = [
    ['note.add decisionKey with two parts (the probe\'s "x|TIT")', note('x|TIT')],
    ['note.add decisionKey with no pipe ("garbage" — bookId would parse as undefined)', note('garbage')],
    ['note.add decisionKey with six parts', note('a|b|c|d|e|f')],
    ['note.add decisionKey with an empty part', note('c1||1|2|1')],
    ['note re-key destination that is neither a slot nor a five-part identity key ("x|TIT")',
      struct([{ surface: 'note', ts: okTs(1), action: 're-key', to: 'x|TIT' }])],
    ['decision disposition key without the toolId|five-part form ("garbage")',
      struct([{ surface: 'decision', key: 'garbage', ts: okTs(1), action: 'orphan-review' }])],
  ];
  let allClean = true; const details = [];
  for (const [label, ev] of rows) {
    let sealMsg = ''; let foldMsg = '';
    try { sealAction([ev]); } catch (e) { sealMsg = e.message; }
    try { fold([ev]); } catch (e) { foldMsg = e.message; }
    const clean = sealMsg !== '' && foldMsg !== '' && !CRASHY.test(sealMsg) && !CRASHY.test(foldMsg);
    if (!clean) { allClean = false; details.push(`${label}: seal="${sealMsg.slice(0, 40)}" fold="${foldMsg.slice(0, 40)}"`); }
  }
  check('J14d: every malformed §5.2 identity-key STRING is refused CLEANLY at seal AND at fold — one five-part grammar, shared with the serializer',
    allClean, details.join(' · '));
  // fold-level probe: pre-fix, a pipe-less decisionKey yielded bookId = undefined in the
  // generation filter — the note SILENTLY BYPASSED quarantine (no crash) and projected
  // past a book re-add with a gen-1 stamp; post-fix the schema refuses the event
  const t = (s, c, a) => `2026-08-14T03:00:${String(s).padStart(2, '0')}.000Z|000${c}|${a}`;
  const add1 = mkEvent({ op: 'book.add', actor: 'drafter-a', ts: t(0, 0, 'drafter-a'), book: 'TIT', scope: [], skeleton: skel1, initialVerses: { '1:1': 'uno\n' } });
  const badNote = mkEvent({ op: 'note.add', actor: 'checker-c', ts: t(1, 0, 'checker-c'), generation: add1.ts, target: { decisionKey: 'garbage' }, text: 'stale' });
  const rm = mkEvent({ op: 'book.remove', actor: 'drafter-a', ts: t(2, 0, 'drafter-a'), base: add1.ts, book: 'TIT' });
  const add2 = mkEvent({ op: 'book.add', actor: 'drafter-a', ts: t(3, 0, 'drafter-a'), base: rm.ts, book: 'TIT', scope: [], skeleton: skel1, initialVerses: { '1:1': 'uno v2\n' } });
  let probeRefused = ''; let probeOut = null;
  try { probeOut = fold([add1, badNote, rm, add2]); } catch (e) { probeRefused = e.message; }
  check('J14d: a pipe-less decisionKey never enters the fold — pre-fix it silently bypassed the generation quarantine (projected past a re-add); post-fix it is refused, never mis-filed',
    probeRefused !== '' && !CRASHY.test(probeRefused),
    probeRefused ? `"${probeRefused.slice(0, 60)}"` : `BYPASSED: notes=${JSON.stringify(probeOut?.notes.map((n) => n.text))} retained=${JSON.stringify(probeOut?.retained)}`);
}

// ---------- J14e (round 7 internal pre-pass): supersedes cannot self-reference ----------
{
  const ts1 = '2026-08-14T04:00:01.000Z|0000|actor-a';
  const ev = { v: 1, op: 'settings.set', actor: 'actor-a', ts: ts1, base: null, supersedes: [ts1], path: 'ui.x', value: 1 };
  let sealMsg = ''; let foldMsg = '';
  try { sealAction([ev]); } catch (e) { sealMsg = e.message; }
  try { fold([ev]); } catch (e) { foldMsg = e.message; }
  check('J14e: an event listing its OWN ts in supersedes is malformed — refused at seal AND at fold (dangling supersedes refs stay harmless-by-construction: they filter no live head)',
    sealMsg !== '' && foldMsg !== '', `seal="${sealMsg.slice(0, 50)}" fold="${foldMsg.slice(0, 50)}"`);
}

// ---------- J14f (round 9): INVARIANT I-4 has an implementation. §8.5 said "writers MUST
//   normalize all text they journal … to NFC before they hash or write" and NO writer
//   did — `grep -rn normalize journal/` returned nothing. The rule now lives at the ONE
//   write chokepoint (sealAction), and it splits by kind: content text is NORMALIZED,
//   identity-bearing values and object KEYS are REFUSED. ----------
{
  const t = (s, a = 'actor-a') => `2026-08-16T02:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const bodyOf = (e) => JSON.parse(JSON.parse(sealAction([e])).body).events[0];
  const NFD = 'Pabló sieŕvo\n';            // combining acutes
  const NFC = NFD.normalize('NFC');
  const skel1 = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;

  // (a) the transform — every text a writer journals is NFC in the sealed bytes
  const normalized = [
    ['text.verse.set text', mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: t(1), book: 'TIT', chapter: '1', verse: '1', text: NFD }), (b) => b.text],
    ['note.add text', mkEvent({ op: 'note.add', actor: 'actor-a', ts: t(2), generation: t(0), target: { book: 'TIT', chapter: '1', verse: '1' }, text: NFD }), (b) => b.text],
    ['book.add initialVerses content', mkEvent({ op: 'book.add', actor: 'actor-a', ts: t(3), book: 'TIT', scope: [], skeleton: skel1, initialVerses: { '1:1': NFD } }), (b) => b.initialVerses['1:1']],
    ['settings.set string value', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(4), path: 'ui.label', value: NFD }), (b) => b.value],
    ['project.meta.set string value', mkEvent({ op: 'project.meta.set', actor: 'actor-a', ts: t(5), path: 'identification.name.es', value: NFD }), (b) => b.value],
    ['structure transition text', mkEvent({ op: 'text.structure.apply', actor: 'actor-a', ts: t(6), base: t(0), book: 'TIT', skeleton: skel1, transitions: { '1:1': { text: NFD, sources: [] } }, dispositions: [] }), (b) => b.transitions['1:1'].text],
  ];
  const misses = normalized.filter(([, e, get]) => get(bodyOf(e)) !== NFC);
  check('J14f (I-4): sealAction NORMALIZES every text a writer journals — verse content, note text, initial verse content, structural destination text, and settings/metadata string values are NFC in the sealed bytes',
    misses.length === 0, `${normalized.length - misses.length}/${normalized.length} normalized${misses.length ? ` · missed: ${misses.map(([l]) => l).join(', ')}` : ''}`);

  // (b) the refusal — an IDENTITY is never silently rewritten. Pre-fix, the two decision
  // records below sealed as DIFFERENT records whose identity keys PRINT IDENTICALLY: a
  // silent identity split with no fork, no retained entry, and no way to see it.
  const dec = (cid) => mkEvent({ op: 'check.decision.set', actor: 'actor-a', ts: t(7), generation: t(0), toolId: 'translationWords',
    decision: { contextId: { checkId: cid, occurrence: 1, reference: { bookId: 'tit', chapter: '1', verse: '1' } }, selections: false } });
  const NFD_ID = 'chék', NFC_ID = 'chék';
  let splitSeal = ''; try { sealAction([dec(NFD_ID)]); } catch (e) { splitSeal = e.message; }
  let splitFold = ''; try { fold([dec(NFD_ID)]); } catch (e) { splitFold = e.message; }
  check('J14f (I-4): an NFD identity component is REFUSED at seal AND at fold — pre-fix it produced a SILENT IDENTITY SPLIT (two records, identity keys that print identically, no fork, no retained entry)',
    splitSeal.includes('I-4') && splitFold.includes('I-4') &&
    identityKeyOf(dec(NFD_ID).decision.contextId) !== identityKeyOf(dec(NFC_ID).decision.contextId),
    `seal="${splitSeal.slice(splitSeal.indexOf('I-4'), splitSeal.indexOf('I-4') + 60)}"`);
  check('J14f (I-4): the NFC form of the same identity still seals and folds — the refusal adds no false rejection',
    sealAction([dec(NFC_ID)]).length > 0 && fold([dec(NFC_ID)]).decisions.translationWords.length === 1);

  // every identity-bearing surface refuses, not just checkId — one rule, whole class
  const identityRows = [
    ['decision quoteString (the D17 re-attach verification field)', mkEvent({ op: 'check.decision.set', actor: 'actor-a', ts: t(8), generation: t(0), toolId: 'translationWords', decision: { contextId: { checkId: 'c1', occurrence: 1, quoteString: 'Θεού', reference: { bookId: 'tit', chapter: '1', verse: '1' } }, selections: false } })],
    ['note decisionKey', mkEvent({ op: 'note.add', actor: 'actor-a', ts: t(9), generation: t(0), target: { decisionKey: 'chék|tit|1|1|1' }, text: 'n' })],
    ['settings.set path', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(10), path: 'ui.étiquette', value: 1 })],
    ['project.vrs.set name (bytes are projected VERBATIM — never normalized)', mkEvent({ op: 'project.vrs.set', actor: 'actor-a', ts: t(11), seed: { source: 'creation' }, name: 'eńg', bytes: '{}' })],
    ['an object KEY at any depth', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(12), path: 'ui.x', value: { 'étiquette': 1 } })],
  ];
  const notRefused = identityRows.filter(([, e]) => { try { sealAction([e]); return true; } catch { return false; } });
  check('J14f (I-4): the refusal is CLASS-level — quoteString, decisionKey, dotted paths, the vrs frame name, and every object KEY at every depth refuse a non-NFC value; only CONTENT is transformed',
    notRefused.length === 0, `${identityRows.length}/${identityRows.length} refused${notRefused.length ? ` · missed: ${notRefused.map(([l]) => l).join(', ')}` : ''}`);

  // (c) the writer stays symmetric with its own reader across the transform
  const sealedNfd = sealAction([normalized[0][1]]);
  const reread = validateSegment(sealedNfd);
  check('J14f (I-4): what the writer seals is exactly what its own reader validates — the normalized action round-trips through validateSegment carrying the NFC text',
    reread.ok === true && reread.events[0].text === NFC && reread.events[0].text !== NFD,
    `re-read text is NFC: ${reread.ok && reread.events[0].text === NFC}`);
}

// ---------- J14g (round 9): the schema is TOTAL over HOSTILE input too — a verdict is
//   returned, never a crash. Bounded depth, bounded dotted paths, plain-JSON object kinds
//   only, and a `base` that actually precedes its own event (§8.1/§8.3). ----------
{
  const t = (s) => `2026-08-16T03:00:${String(s).padStart(2, '0')}.000Z|0000|actor-a`;
  const deepJson = (d) => '{"a":'.repeat(d) + '1' + '}'.repeat(d);
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

  // (a) the reachable P1: a hostile segment far below the 4 MiB cap. Pre-fix
  // `jsonRoundTripError` recursed unguarded, so validateSegment THREW instead of
  // returning a verdict — `onInvalid` never fired and the honest actor's OWN segments
  // became unreadable behind it.
  const body = `{"events":[{"v":1,"op":"settings.set","actor":"actor-a","ts":"${t(1)}","base":null,"path":"ui.x","value":${deepJson(20000)}}]}`;
  const hostile = JSON.stringify({ container: 1, body, sha256: sha(body) });
  let verdict = null, threw = '';
  try { verdict = validateSegment(hostile); } catch (e) { threw = e.constructor.name; }
  check('J14g: a hostile deeply-nested segment — a small fraction of the 4 MiB cap — gets a VERDICT, not a RangeError: validateSegment returns {ok:false} so onInvalid fires and the rest of the stream still reads',
    threw === '' && verdict && verdict.ok === false && /deeper than/.test(String(verdict.reason)),
    `${(Buffer.byteLength(hostile) / 1024).toFixed(1)} KB = ${(100 * Buffer.byteLength(hostile) / SEGMENT_LIMIT).toFixed(1)}% of the cap · ${threw || String(verdict && verdict.reason).slice(0, 50)}`);
  // and the honest neighbour in the same directory still reads
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j14g-'));
    const dir = path.join(tmp, 'actor-a');
    const good = mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(2), path: 'ui.ok', value: 1 });
    writeActionSegment(dir, [good]);
    fs.writeFileSync(path.join(dir, 'segments', 'zzzz-hostile.action.json'), hostile);
    const seen = [];
    const got = readSegments(dir, (f, r) => seen.push(r));
    check('J14g: one hostile segment no longer bricks the actor stream — it is reported and skipped, and the honest segments beside it still read',
      got.length === 1 && got[0].path === 'ui.ok' && seen.length === 1, `read ${got.length} event(s), reported ${JSON.stringify(seen).slice(0, 70)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // (b) the poisoned-history P1: a 20,000-segment dotted path folded, then crashed every
  // future checkpoint forever. The bound belongs in the grammar, at intake.
  const longPath = Array(20000).fill('a').join('.');
  const rows = [
    ['a 20,000-segment dotted path (folds, then crashes every future checkpoint forever)', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(3), path: longPath, value: 1 })],
    ['a value nested past the §8.1 depth bound', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(4), path: 'ui.x', value: JSON.parse(deepJson(200)) })],
    ['a Date value', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(5), path: 'ui.x', value: new Date(0) })],
    ['a Map value', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(6), path: 'ui.x', value: new Map([['a', 1]]) })],
    ['a Set value (JSON.stringify → {} — TOTAL data loss)', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(7), path: 'ui.x', value: new Set([1, 2]) })],
    ['a RegExp value', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(8), path: 'ui.x', value: /x/ })],
    ['a typed-array value', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(9), path: 'ui.x', value: new Uint8Array([1, 2]) })],
    ['an own `__proto__` payload key (fork detection goes blind: two different heads auto-merge)', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(10), path: 'ui.x', value: JSON.parse('{"__proto__":{"polluted":true}}') })],
    ['an own `__proto__` key inside a §5.2 record (the checkpoint would write the pollution gadget into a sidecar the product client parses)',
      mkEvent({ op: 'check.decision.set', actor: 'actor-a', ts: t(11), generation: t(0), toolId: 'translationWords',
        decision: JSON.parse('{"contextId":{"checkId":"c1","occurrence":1,"reference":{"bookId":"tit","chapter":"1","verse":"1"}},"selections":false,"__proto__":{"polluted":true}}') })],
    ['a forward-pointing base (base > ts — causally impossible; it also defeats the ancestry cache)', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(12), base: t(59), path: 'ui.x', value: 1 })],
    ['a self-referencing base (base === ts)', mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(13), base: t(13), path: 'ui.x', value: 1 })],
  ];
  const CRASHY9 = /Cannot read|is not iterable|is not a function|undefined is not|Maximum call stack/i;
  let allClean = true; const details = [];
  for (const [label, e] of rows) {
    let sealMsg = '', foldMsg = '';
    try { sealAction([e]); } catch (err) { sealMsg = err.message; }
    try { fold([e]); } catch (err) { foldMsg = err.message; }
    if (!sealMsg || !foldMsg || CRASHY9.test(sealMsg) || CRASHY9.test(foldMsg)) { allClean = false; details.push(label); }
  }
  check('J14g: every hostile-but-schema-shaped payload is refused CLEANLY at seal AND at fold — depth bound, path-segment bound, plain-JSON object kinds only, no own `__proto__` key, and a `base` that precedes its own ts',
    allClean, details.length ? `missed: ${details.join(' · ')}` : `${rows.length} firing cases`);
  check('J14g: the legitimate shapes are untouched — a 3-segment path, a 4-deep value and an ordinary earlier base all still seal and fold',
    (() => {
      const ok = mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t(20), base: t(19), path: 'a.b.c', value: { a: { b: { c: [1, 2] } } } });
      try { sealAction([ok]); fold([ok]); return true; } catch { return false; }
    })());
  Object.prototype.polluted === undefined || delete Object.prototype.polluted;
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
  // A contribution is UNTRUSTED input, so the walk must CLASSIFY what it finds, never
  // crash on it. A symlink is not a file: reading one that dangles throws ENOENT and one
  // that points at a directory throws EISDIR, so a single symlinked path used to take
  // the intake validator down instead of producing a violation (round 9).
  const NOT_A_FILE = Symbol('not-a-regular-file');
  const snapshot = (dir) => {
    const out = new Map();
    const walk = (abs, rel = '') => {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const child = path.join(abs, entry.name);
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) { out.set(childRel, NOT_A_FILE); continue; }
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
      if (a === NOT_A_FILE || b === NOT_A_FILE) { errors.push(`not-a-regular-file:${rel}`); continue; }
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
  // the `segment-misnamed` branch was DEAD CODE until round 9: every J20 case fed either
  // an invalid segment or a well-named one, so the ONE rule that binds a segment's
  // filename to its own first event ts was never exercised. A VALID segment under the
  // WRONG name is exactly the shape that publishes a second body at an accepted ts.
  const badName = path.join(tmp, 'bad-name'); cp(base, badName); git('checkout -qb actor-a', badName);
  write(badName, 'ingredients/checking/journal/actor-a/segments/2026-06-02T00_00_09.000Z,0000,actor-a.action.json',
    sealAction([mkEvent({ op: 'settings.set', actor: 'actor-a', ts: '2026-06-02T00:00:04.000Z|0000|actor-a', path: 'ui.w', value: 4 })]));
  commitAll(badName, 'a VALID segment under a filename that is not its ts');
  const nameScratch = mergeToScratch(base, badName, 'actor-a', 'name');
  const nameErrors = validateIntake(base, nameScratch, 'actor-a');
  check('J20: whitelist-only intake — a VALID segment whose filename is not its own first event ts is rejected (§8.1); the misnamed branch now has a firing case',
    nameErrors.length === 1 && nameErrors[0].startsWith('segment-misnamed:'), JSON.stringify(nameErrors));

  // a symlinked contribution must CLASSIFY, not crash: reading a dangling link throws
  // ENOENT and reading a link to a directory throws EISDIR, so one symlinked path used
  // to take the intake validator down instead of producing a violation.
  const badLink = path.join(tmp, 'bad-link'); cp(base, badLink); git('checkout -qb actor-a', badLink);
  fs.mkdirSync(path.join(badLink, 'ingredients/checking/journal/actor-a/segments'), { recursive: true });
  fs.symlinkSync('/nonexistent/target', path.join(badLink, 'ingredients/checking/journal/actor-a/segments/2026-06-02T00_00_05.000Z,0000,actor-a.action.json'));
  fs.symlinkSync('/etc', path.join(badLink, 'ingredients/checking/journal/actor-a/adir'));
  commitAll(badLink, 'symlinked contribution');
  const linkScratch = mergeToScratch(base, badLink, 'actor-a', 'link');
  let linkErrors = [], linkThrew = '';
  try { linkErrors = validateIntake(base, linkScratch, 'actor-a'); } catch (e) { linkThrew = `${e.code || e.constructor.name}: ${e.message}`; }
  check('J20: a symlinked contribution is CLASSIFIED as a violation, never a crash — the §8.7 intake validator returns a verdict on untrusted input (pre-fix: ENOENT on a dangling link, EISDIR on a link to a directory)',
    linkThrew === '' && linkErrors.filter((e) => e.startsWith('not-a-regular-file:')).length === 2,
    linkThrew || JSON.stringify(linkErrors));

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

  // actor binding at the directory: a segment whose events name a different actor is
  // invalid — and (round 9) the WRITER refuses to create it in the first place. Both
  // intakes already applied this rule; the writer did not, so the check ran only after
  // the bytes existed. The segment now has to be planted by hand to test the reader.
  const foreign = [mkEvent({ op: 'settings.set', actor: 'actor-z', ts: '2026-08-03T00:02:00.000Z|0000|actor-z', path: 'ui.z', value: 9 })];
  const a2Dir = path.join(tmp, 'journal', 'actor-a2');
  let writerRefused = '';
  try { writeActionSegment(a2Dir, foreign); } catch (e) { writerRefused = e.message; }
  check('J23: the WRITER refuses to publish another actor\'s events into this actor\'s directory (§8.1/§8.3 actor binding, writer side — the rule both intakes already applied)',
    writerRefused.includes('actor binding') && !fs.existsSync(path.join(a2Dir, 'segments')), `"${writerRefused.slice(0, 70)}"`);
  fs.mkdirSync(path.join(a2Dir, 'segments'), { recursive: true });
  fs.writeFileSync(path.join(a2Dir, 'segments', segmentName(foreign[0].ts)), sealAction(foreign));
  const invalids3 = [];
  readSegments(a2Dir, (file, reason) => invalids3.push(reason));
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

// ---------- J23f (round 9): the §8.1 containment guarantee is a FILESYSTEM guarantee.
//   Round 6 made it lexical, and a lexical check cannot see a symlink: a DANGLING one
//   reads as "path free" (so the immutability branch is skipped and the write lands
//   outside the project), a symlinked `segments` directory relocates the whole stream,
//   and the reader follows both. Plus the two trust holes beside it: the filename↔ts
//   binding both intakes apply and the local reader did not, and an actor directory the
//   reader trusted absolutely. ----------
{
  const t = (s, a = 'actor-a') => `2026-08-16T06:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const set = (s, a = 'actor-a', v = 1) => mkEvent({ op: 'settings.set', actor: a, ts: t(s, a), path: `ui.k${s}`, value: v });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j23f-'));
  const journal = path.join(tmp, 'journal');

  // (1) THE THREE-LINE FIX FIRST — filename ↔ ts. One stray `.action.json` used to let a
  // SECOND body publish at the same ts; the union then refused to fold AT ALL ("two
  // different events share ts — corrupt union"), so the project was PERMANENTLY
  // unfoldable from one stray file. Both intakes already checked this; the reader now does.
  {
    const dir = path.join(journal, 'actor-a');
    writeActionSegment(dir, [set(1)]);
    fs.writeFileSync(path.join(dir, 'segments', 'stray.action.json'), sealAction([set(1, 'actor-a', 2)]));
    const seen = [];
    const events = readSegments(dir, (f, r) => seen.push(r));
    let foldMsg = ''; try { fold(events); } catch (e) { foldMsg = e.message; }
    check('J23f: a MISNAMED segment is invisible — the filename IS the first event\'s ts (§8.1). Pre-fix a stray file published a second body at the same ts and made the project permanently unfoldable',
      events.length === 1 && seen.length === 1 && String(seen[0]).startsWith('segment-misnamed:') && foldMsg === '',
      `${events.length} event(s), reported ${JSON.stringify(seen)}`);
  }

  // (2) a DANGLING SYMLINK at a segment path
  {
    const dir = path.join(journal, 'actor-b');
    fs.mkdirSync(path.join(dir, 'segments'), { recursive: true });
    const outside = path.join(tmp, 'ESCAPED.json');
    fs.symlinkSync(outside, path.join(dir, 'segments', segmentName(t(1, 'actor-b'))));
    let refused = ''; try { writeActionSegment(dir, [set(1, 'actor-b')]); } catch (e) { refused = e.message; }
    check('J23f (SECURITY): a DANGLING SYMLINK at a segment path no longer reads as "path free" — the writer REFUSES and creates nothing outside the project (pre-fix it wrote through the link)',
      refused.includes('containment') && !fs.existsSync(outside), `"${refused.slice(0, 70)}" · outside file exists = ${fs.existsSync(outside)}`);
    const seen = [];
    readSegments(dir, (f, r) => seen.push(r));
    check('J23f (SECURITY): the READER refuses the same link rather than following it — containment is enforced on both sides of the file',
      seen.length === 1 && String(seen[0]).startsWith('containment:'), JSON.stringify(seen));
  }

  // (3) a SYMLINKED `segments` directory relocates the whole stream
  {
    const dir = path.join(journal, 'actor-c');
    fs.mkdirSync(dir, { recursive: true });
    const elsewhere = path.join(tmp, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(dir, 'segments'));
    let wErr = '', rErr = '';
    try { writeActionSegment(dir, [set(1, 'actor-c')]); } catch (e) { wErr = e.message; }
    try { readSegments(dir, () => {}); } catch (e) { rErr = e.message; }
    check('J23f (SECURITY): a SYMLINKED `segments` directory relocates the entire stream — writer and reader both refuse it, and nothing is written outside',
      wErr.includes('containment') && rErr.includes('containment') && fs.readdirSync(elsewhere).length === 0,
      `${fs.readdirSync(elsewhere).length} file(s) outside · "${wErr.slice(0, 50)}"`);
  }

  // (4) the actor directory is a NAME, resolved through ONE constructor
  {
    const dirB = actorDirFor(journal, 'actor-d');
    writeActionSegment(dirB, [set(1, 'actor-d')]);
    let travErr = '';
    try { readSegments(`${journal}/actor-a/../actor-d`, () => {}); } catch (e) { travErr = e.message; }
    check('J23f (SECURITY): a traversal-shaped actor directory is REFUSED — pre-fix `readSegments(journal + "actor-a/../actor-d")` returned actor-d\'s stream while the caller believed it held actor-a\'s (basename saw only the normalized path)',
      travErr.includes('traversal'), `"${travErr.slice(0, 80)}"`);
    const badSlugs = ['Actor_A', '../etc', 'ab', ''];
    const refusedSlugs = badSlugs.filter((s) => { try { actorDirFor(journal, s); return false; } catch { return true; } });
    check('J23f: actorDirFor is the ONE actor-directory constructor — it applies the §8.1 slug grammar and refuses anything that escapes the journal root',
      refusedSlugs.length === badSlugs.length && actorDirFor(journal, 'actor-d') === path.resolve(journal, 'actor-d'),
      `${refusedSlugs.length}/${badSlugs.length} refused`);
  }

  // (5) the cap applies BEFORE the read (stat guard), and segmentName is injective by grammar
  {
    const dir = path.join(journal, 'actor-e');
    writeActionSegment(dir, [set(1, 'actor-e')]);
    const big = path.join(dir, 'segments', segmentName(t(2, 'actor-e')));
    fs.writeFileSync(big, 'x'.repeat(SEGMENT_LIMIT + 1024));
    const seen = [];
    const got = readSegments(dir, (f, r) => seen.push(r));
    check('J23f: an oversize segment is reported from its STAT — the 4 MiB cap applies before the read, not after it (reading first costs ~3x the file in RSS to reach the same verdict)',
      got.length === 1 && seen.length === 1 && seen[0] === 'oversize', JSON.stringify(seen));
    const collide = ['a:b', 'a_b', '2026-08-16T06:00:01.000Z|0000|actor a'];
    const refusedNames = collide.filter((s) => { try { segmentName(s); return false; } catch { return true; } });
    check('J23f: the filename encoding is injective BY GRAMMAR — segmentName refuses a non-ts outright, so `a:b` and `a_b` can never encode to one name (layer-2 independence, §8.1)',
      refusedNames.length === collide.length && segmentName(t(1)) === '2026-08-16T06_00_01.000Z,0000,actor-a.action.json',
      `${refusedNames.length}/${collide.length} refused`);
  }

  // (6) the §2 ipath grammar covers the characters that are not printable at all
  {
    const gaps = [
      ['NUL', 'a b'], ['newline', 'a\nb'], ['DEL', 'ab'],
      ['right-to-left override', 'a‮b'], ['Windows device CON', 'CON'], ['Windows device COM1.json', 'COM1.json'],
      ['trailing dot', 'name.'],
    ];
    const accepted = gaps.filter(([, v]) => ipathError(v) === null);
    check('J23f: the §2 ipath grammar refuses control characters, NUL, bidi overrides, Windows reserved device names and trailing dots — a §2 list of PUNCTUATION said nothing about names that stop meaning what they look like',
      accepted.length === 0, accepted.length ? `still accepted: ${accepted.map(([l]) => l).join(', ')}` : `${gaps.length} firing cases`);
    check('J23f: the legitimate §2 paths are untouched by the hardening',
      ['TIT.usfm', 'checking/alignments/TIT.json', 'checking/translationWords/1CO.json', 'vrs.json', 'metadata.json']
        .every((p) => ipathError(p) === null));
  }

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
  // §8.5: "`v: 1` writers emit it only within the creation/seed segment" — the seed
  // marker IS that rule's enforceable form (round 9), so every legitimate vrs event
  // carries one.
  const seedOf = (source = 'creation') => ({ source });
  const v1 = mkEvent({ op: 'project.vrs.set', actor: 'actor-a', ts: t(1, 'actor-a'), seed: seedOf(), name: 'eng', bytes: vrsBytes });
  const v1dup = mkEvent({ op: 'project.vrs.set', actor: 'actor-b', ts: t(2, 'actor-b'), seed: seedOf(), name: 'eng', bytes: vrsBytes });
  const v2 = mkEvent({ op: 'project.vrs.set', actor: 'actor-b', ts: t(3, 'actor-b'), seed: seedOf('tc3-import'), name: 'lxx', bytes: '{"maxVerses":{}}' });
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

// ---------- J31 (round 8): ONE value-grammar module. Every constrained primitive that
//   flows into a STRUCTURAL POSITION — a filesystem path, an identity key, a
//   prototype-chain traversal, or Burrito metadata — is refused by its named grammar at
//   the schema (layer 1) AND, independently, by its consumer (layer 2). ----------
{
  const okTs = (s, a = 'actor-a') => `2026-08-16T00:00:${String(s).padStart(2, '0')}.000Z|0000|${a}`;
  const skel = (b) => `\\id ${b}\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`;
  const skel1 = (b) => `\\id ${b}\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`;
  const CRASHY = /Cannot read|is not iterable|is not a function|undefined is not|toUpperCase/i;
  // refused at seal AND at fold, cleanly — the shape every layer-1 case must have
  const refusedBothWays = (ev) => {
    let sealMsg = '', foldMsg = '';
    try { sealAction([ev]); } catch (e) { sealMsg = e.message; }
    try { fold([ev]); } catch (e) { foldMsg = e.message; }
    return { ok: sealMsg !== '' && foldMsg !== '' && !CRASHY.test(sealMsg) && !CRASHY.test(foldMsg), sealMsg, foldMsg };
  };

  // --- the canonical book set does not drift from the product's own table ---
  {
    const src = path.resolve('../src/data/bookNames.ts');
    if (!fs.existsSync(src)) {
      check('J31: SKIP — canonical book-code drift guard needs the product tree (../src/data/bookNames.ts)', true, 'prerequisite absent');
    } else {
      const text = fs.readFileSync(src, 'utf8');
      const body = text.slice(text.indexOf('BOOK_NAMES: Record<string, string> = {'));
      const productCodes = [...body.slice(0, body.indexOf('\n};')).matchAll(/^\s*'?([A-Z0-9]{3})'?:/gm)].map((m) => m[1]);
      check('J31: the grammar\'s §2 canonical book set equals the product\'s BOOK_NAMES keys, in canon order (no drift between harness and client)',
        JSON.stringify(productCodes) === JSON.stringify(BOOK_CODES),
        `${productCodes.length} product codes vs ${BOOK_CODES.length} grammar codes`);
    }
  }

  // --- FINDING 1: the structural base rule, one rule for every non-root structural op ---
  {
    const add = mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(0), book: 'TIT', scope: [], skeleton: skel('TIT'), initialVerses: {} });
    const addJ = mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(1), book: 'JON', scope: [], skeleton: skel('JON'), initialVerses: {} });
    const vs = mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: okTs(2), base: add.ts, book: 'TIT', chapter: '1', verse: '1', text: 'uno\n' });
    const apply = (base) => mkEvent({ op: 'text.structure.apply', actor: 'actor-a', ts: okTs(5), base,
      book: 'TIT', skeleton: skel1('TIT'), transitions: { '1:1': { text: 'merged\n', sources: [] } }, dispositions: [] });
    // (a) an UNKNOWN base PENDS — the event may still arrive; the pre-operation state projects
    const unknown = fold([add, apply('2026-01-01T00:00:00.000Z|0000|ghost-actor')]);
    check('J31 finding 1: text.structure.apply on an UNKNOWN base PENDS (incomplete) and never applies — the pre-operation slot set projects unchanged',
      unknown.pendingStructural.length === 1 && unknown.pendingStructural[0].detail[0].startsWith('unknown-base:') &&
      JSON.stringify(Object.keys(unknown.books.TIT.verses)) === JSON.stringify(['1:1', '1:2']),
      JSON.stringify(unknown.pendingStructural));
    // (b) a base naming a NON-STRUCTURAL event REFUSES — it has no lineage to inherit
    let vsErr = ''; try { fold([add, vs, apply(vs.ts)]); } catch (e) { vsErr = e.message; }
    check('J31 finding 1: a base naming a text.verse.set is REFUSED — a structural op may only chain to a structural predecessor (§8.5)',
      vsErr !== '' && !CRASHY.test(vsErr), `"${vsErr.slice(0, 80)}"`);
    // (c) a base naming another BOOK's structural event REFUSES
    let xErr = ''; try { fold([add, addJ, apply(addJ.ts)]); } catch (e) { xErr = e.message; }
    check('J31 finding 1: a CROSS-BOOK structural base is REFUSED — the base must be a structural event of the SAME book',
      xErr !== '' && !CRASHY.test(xErr), `"${xErr.slice(0, 80)}"`);
    // the same rule, same messages, for the whole class — book.add (non-root) and text.skeleton.set
    let addErr = '', skelErr = '';
    try { fold([add, vs, mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(6), base: vs.ts, book: 'TIT', scope: [], skeleton: skel('TIT'), initialVerses: {} })]); } catch (e) { addErr = e.message; }
    try { fold([add, vs, mkEvent({ op: 'text.skeleton.set', actor: 'actor-a', ts: okTs(6), base: vs.ts, book: 'TIT', skeleton: skel('TIT') })]); } catch (e) { skelErr = e.message; }
    check('J31 finding 1: the rule is CLASS-level — book.add (non-root) and text.skeleton.set refuse a non-structural base identically',
      addErr !== '' && skelErr !== '' && !CRASHY.test(addErr) && !CRASHY.test(skelErr),
      `book.add="${addErr.slice(0, 40)}" skeleton.set="${skelErr.slice(0, 40)}"`);
    // and a legitimate re-add still chains to its book.remove (no special case lost)
    const rm = mkEvent({ op: 'book.remove', actor: 'actor-a', ts: okTs(7), base: add.ts, book: 'TIT' });
    const re = mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(8), base: rm.ts, book: 'TIT', scope: [], skeleton: skel1('TIT'), initialVerses: { '1:1': 'v2\n' } });
    const readd = fold([add, rm, re]);
    check('J31 finding 1: a legitimate re-add still chains to its book.remove — the unified rule adds no false refusal',
      readd.pendingStructural.length === 0 && readd.books.TIT.verses['1:1'] === 'v2\n',
      JSON.stringify(readd.books.TIT.verses));

    // --- the class sibling: book.remove is structural too, and it DELETES the book ---
    // Pre-fix it was the ONLY structural op reaching the fold with an unvalidated base
    // kind: an unknown, non-structural or cross-book base each removed TIT outright.
    const rmBad = (base) => mkEvent({ op: 'book.remove', actor: 'actor-a', ts: okTs(9), base, book: 'TIT' });
    const rmUnknown = fold([add, rmBad('2026-01-01T00:00:00.000Z|0000|ghost-actor')]);
    check('J31 finding 1 (sibling): book.remove on an UNKNOWN base PENDS and the book STAYS PROJECTED — a removal never lands off an absent ancestor',
      rmUnknown.pendingStructural.length === 1 && rmUnknown.pendingStructural[0].detail[0].startsWith('unknown-base:') &&
      'TIT' in rmUnknown.books,
      JSON.stringify(rmUnknown.pendingStructural));
    let rmVsErr = '', rmXErr = '';
    try { fold([add, vs, rmBad(vs.ts)]); } catch (e) { rmVsErr = e.message; }
    try { fold([add, addJ, rmBad(addJ.ts)]); } catch (e) { rmXErr = e.message; }
    check('J31 finding 1 (sibling): book.remove REFUSES a non-structural base and a CROSS-BOOK structural base — the most destructive op in the class is held to the same rule',
      rmVsErr !== '' && rmXErr !== '' && !CRASHY.test(rmVsErr) && !CRASHY.test(rmXErr),
      `verse-base="${rmVsErr.slice(0, 45)}" cross-book="${rmXErr.slice(0, 45)}"`);
    // regression guard: the generation quarantine still fires across a well-formed chain
    const dec = mkEvent({ op: 'check.decision.set', actor: 'actor-a', ts: okTs(3), generation: add.ts, toolId: 'translationWords',
      decision: { contextId: { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: 1, verse: 1 } }, selections: false } });
    const gen = fold([add, dec, rm, re]);
    check('J31 finding 1 (sibling): a well-formed book.remove chain still works — re-add projects generation 2 and the prior-generation decision is still quarantined (no regression)',
      gen.pendingStructural.length === 0 && gen.books.TIT.verses['1:1'] === 'v2\n' &&
      Object.keys(gen.decisions).length === 0 &&
      gen.retained.some((r) => r.reason === 'prior-generation'),
      JSON.stringify(gen.retained));

    // --- ASSERTED, NOT ASSUMED: the WHOLE structural class shares ONE rule ---
    // Every structural op, every base-kind scenario, one outcome table. A new structural
    // op that forgets the rule fails here, not in review.
    const structuralEvent = (op, base) => {
      const common = { actor: 'actor-a', ts: okTs(9), base, book: 'TIT' };
      if (op === 'book.add') return mkEvent({ ...common, op, scope: [], skeleton: skel('TIT'), initialVerses: {} });
      if (op === 'book.remove') return mkEvent({ ...common, op });
      if (op === 'text.skeleton.set') return mkEvent({ ...common, op, skeleton: skel('TIT') });
      return mkEvent({ ...common, op, skeleton: skel1('TIT'), transitions: { '1:1': { text: 'x\n', sources: [] } }, dispositions: [] });
    };
    const STRUCTURAL = ['book.add', 'book.remove', 'text.skeleton.set', 'text.structure.apply'];
    const outcomeOf = (op, base, prelude) => {
      try {
        const o = fold([...prelude, structuralEvent(op, base)]);
        return o.pendingStructural.some((p) => p.ts === okTs(9)) ? 'PEND' : 'APPLIED';
      } catch { return 'REFUSED'; }
    };
    const matrix = {};
    for (const op of STRUCTURAL) {
      matrix[op] = [
        outcomeOf(op, '2026-01-01T00:00:00.000Z|0000|ghost-actor', [add]),  // unknown  → PEND
        outcomeOf(op, vs.ts, [add, vs]),                                     // verse.set → REFUSED
        outcomeOf(op, addJ.ts, [add, addJ]),                                 // cross-book→ REFUSED
      ].join('/');
    }
    const expected = 'PEND/REFUSED/REFUSED';
    check('J31: ASSERTED, not assumed — EVERY structural op (book.add, book.remove, text.skeleton.set, text.structure.apply) shares ONE base rule: unknown PENDS, non-structural REFUSES, cross-book REFUSES. No op is exempt, and a fifth would have to opt in here',
      STRUCTURAL.every((op) => matrix[op] === expected), JSON.stringify(matrix));

    // --- and the audit's other half: CONTENT ops fail CLOSED, never leak across books ---
    // A content op's `base` is a §8.3 register reference, not a structural claim, so it
    // carries no chain-link rule. Measured consequence: a cross-book base excludes the
    // head from the projection and REPORTS it — it never projects into the wrong book.
    const leaky = mkEvent({ op: 'text.verse.set', actor: 'actor-b', ts: okTs(9, 'actor-b'), base: addJ.ts,
      book: 'TIT', chapter: '1', verse: '1', text: 'LEAKED\n' });
    const audit = fold([add, addJ, leaky]);
    check('J31: audit — a CONTENT op with a cross-book base fails CLOSED: the head is excluded by ancestry and reported in retained[] as unselected-structural-branch; no text ever crosses books',
      audit.books.TIT.verses['1:1'] !== 'LEAKED\n' && audit.books.JON.verses['1:1'] !== 'LEAKED\n' &&
      audit.retained.some((r) => r.key === 'text|TIT|1:1' && r.reason === 'unselected-structural-branch'),
      `TIT=${JSON.stringify(audit.books.TIT.verses['1:1'])} retained=${JSON.stringify(audit.retained)}`);
  }

  // --- FINDING 2: serializer/validator symmetry (see also the property test below) ---
  {
    const dec = (over) => mkEvent({ op: 'check.decision.set', actor: 'actor-a', ts: okTs(1), generation: okTs(0),
      toolId: 'translationWords',
      decision: { contextId: { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: 1, verse: 1 }, ...over }, selections: false } });
    const rows = [
      ['checkId carrying the identity delimiter ("bad|id" → a SIX-part identity key)', dec({ checkId: 'bad|id' })],
      ['an EMPTY identity component (checkId "")', dec({ checkId: '' })],
      ['chapter carrying the register delimiter ("1:2" → an ambiguous register key)', dec({ reference: { bookId: 'tit', chapter: '1:2', verse: 1 } })],
      ['occurrence NaN (seals, then JSON-serializes to null — the writer\'s own reader rejects it)', dec({ occurrence: NaN })],
      ['occurrence Infinity', dec({ occurrence: Infinity })],
      ['occurrence -0 (serializes to 0)', dec({ occurrence: -0 })],
      ['occurrence 1.5 (I-2 requires integers)', dec({ occurrence: 1.5 })],
    ];
    let allClean = true; const details = [];
    for (const [label, ev] of rows) {
      const r = refusedBothWays(ev);
      if (!r.ok) { allClean = false; details.push(`${label}: seal="${r.sealMsg.slice(0, 40)}" fold="${r.foldMsg.slice(0, 40)}"`); }
    }
    check('J31 finding 2: every §5.2 identity component that would break serializer/validator symmetry is refused CLEANLY at seal AND at fold (delimiter-free, non-empty, JSON-safe, I-2 integer)',
      allClean, details.join(' · ') || `${rows.length} firing cases`);
  }

  // --- FINDING 3 (SECURITY): a book code is a filesystem path — grammar + containment ---
  {
    const traversal = mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(0), book: '../../escaped', scope: [], skeleton: skel1('X'), initialVerses: {} });
    const r = refusedBothWays(traversal);
    check('J31 finding 3 (layer 1): a traversal-shaped book code is refused at seal AND at fold — every `book` field carries the §2 canonical grammar',
      r.ok, `seal="${r.sealMsg.slice(0, 70)}"`);
    const nonCanonical = refusedBothWays(mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(0), book: 'tit', scope: [], skeleton: skel1('X'), initialVerses: {} }));
    check('J31 finding 3 (layer 1): a non-canonical or wrong-case book code is refused too — §2 says UPPERCASE eng-canon codes (D26)',
      nonCanonical.ok, `seal="${nonCanonical.sealMsg.slice(0, 70)}"`);
    // layer 2: the SCHEMA IS BYPASSED — a hand-built fold output whose keys escape
    const evil = { books: { '../../escaped': { usfm: 'x', verses: {} } }, alignments: {}, decisions: {},
      pins: {}, settings: {}, projectMeta: {}, projectMetaRemoved: [], vrs: null, scope: {} };
    let projErr = ''; try { derivedProjections(evil, { baseMetadata: { type: { flavorType: {} } }, resolutions: {} }); } catch (e) { projErr = e.message; }
    const evilTool = { ...evil, books: {}, decisions: { '../../evil': [{ contextId: { reference: { bookId: 'tit' } } }] } };
    let toolErr = ''; try { derivedProjections(evilTool, { baseMetadata: { type: { flavorType: {} } }, resolutions: { '../../evil': { TIT: {} } } }); } catch (e) { toolErr = e.message; }
    check('J31 finding 3 (layer 2, defense in depth): WITH THE SCHEMA BYPASSED the checkpoint still refuses an escaping projection key — books AND decision sidecars; the fold\'s keys are never trusted (§2/§8.7)',
      projErr !== '' && toolErr !== '' && !CRASHY.test(projErr) && !CRASHY.test(toolErr),
      `book="${projErr.slice(0, 60)}" tool="${toolErr.slice(0, 60)}"`);
  }

  // --- FINDING 4 (SECURITY): a dotted path is a write target — grammar + null prototypes ---
  {
    let allClean = true; const details = [];
    for (const op of ['settings.set', 'project.meta.set'])
      for (const seg of ['__proto__', 'prototype', 'constructor'])
        for (const p of [`${seg}.tc4Polluted`, `a.${seg}.b`, 'a..b']) {
          const r = refusedBothWays(mkEvent({ op, actor: 'actor-a', ts: okTs(1), path: p, value: 'yes' }));
          if (!r.ok) { allClean = false; details.push(`${op} "${p}"`); }
        }
    check('J31 finding 4 (layer 1): every prototype-chain or empty-segment dotted path is refused at seal AND at fold, for settings.set AND project.meta.set (ONE dotted-path grammar)',
      allClean, details.join(' · ') || '18 firing cases');
    // layer 2: the SCHEMA IS BYPASSED — the malformed path handed straight to the projection
    let sErr = '', mErr = '';
    try { projectSettings({ '__proto__.tc4Polluted': 'yes' }); } catch (e) { sErr = e.message; }
    try { projectMetadata({ scope: {}, projectMeta: { '__proto__.tc4Polluted': 'yes' }, projectMetaRemoved: [] }, { type: { flavorType: {} } }); } catch (e) { mErr = e.message; }
    const clean = ({}).tc4Polluted === undefined;
    check('J31 finding 4 (layer 2, defense in depth): WITH THE SCHEMA BYPASSED the projection setters still cannot pollute — own-property traversal into null-prototype containers; ({}).tc4Polluted stays undefined',
      sErr !== '' && mErr !== '' && clean, `settings="${sErr.slice(0, 50)}" meta="${mErr.slice(0, 50)}" polluted=${JSON.stringify(({}).tc4Polluted)}`);
    delete Object.prototype.tc4Polluted; // belt and braces: never leak into later checks
    // the legitimate overlay still works, and the projected document has no prototype
    const proj = JSON.parse(projectSettings({ 'ui.paneSettings': [1], 'checkCategories.translationWords': ['kt'] }));
    check('J31 finding 4: the legitimate dotted-path overlay is unchanged by the hardening',
      proj.ui.paneSettings[0] === 1 && proj.checkCategories.translationWords[0] === 'kt' && proj.schemaVersion === 1,
      JSON.stringify(proj));
  }

  // --- FINDING 5: scope ranges and initialVerses keys are grammars, not free strings ---
  {
    const add = (over) => mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(0), book: 'TIT', scope: [], skeleton: skel('TIT'), initialVerses: {}, ...over });
    const rows = [
      ['scope ["banana"]', add({ scope: ['banana'] })],
      ['scope with an en-dash range ["1:1–2:5"]', add({ scope: ['1:1–2:5'] })],
      ['scope that is not an array', add({ scope: '1:1' })],
      ['scope entry that is not a string', add({ scope: [1] })],
      ['scope "1-2:5" (C-C:V is outside the §3 rule 4 grammar)', add({ scope: ['1-2:5'] })],
      ['initialVerses key that is not a slot of the supplied skeleton', add({ initialVerses: { '9:9': 'ghost\n' } })],
      ['initialVerses key that is not a slot FORM at all', add({ initialVerses: { 'banana': 'ghost\n' } })],
    ];
    let allClean = true; const details = [];
    for (const [label, ev] of rows) {
      const r = refusedBothWays(ev);
      if (!r.ok) { allClean = false; details.push(`${label}: seal="${r.sealMsg.slice(0, 40)}"`); }
    }
    check('J31 finding 5: every §3 rule 4 scope violation and every non-slot initialVerses key is refused CLEANLY at seal AND at fold',
      allClean, details.join(' · ') || `${rows.length} firing cases`);
    // every legal §3 rule 4 form still seals and folds
    const legal = [[], ['3'], ['1-2'], ['1:1'], ['1:2-16'], ['1:1-2:5'], ['1:2-16', '3:1-15']];
    let allLegal = true;
    for (const scope of legal) {
      try { fold([add({ scope })]); } catch { allLegal = false; }
    }
    check('J31 finding 5: every legal §3 rule 4 form (C, C-C, C:V, C:V-V, C:V-C:V, [] and multi-range) still seals and folds',
      allLegal, JSON.stringify(legal));
  }

  // --- the CLASS-level guarantee: anything the writer seals survives JSON and its own reader ---
  {
    // Adversarial component generator: the values that broke symmetry are IN the space
    // (delimiters, empties, NaN/Infinity/-0, non-integers, prototype segments, bad book
    // codes, junk ranges), alongside the legal ones. Events the schema REFUSES are the
    // property's precondition; everything it ACCEPTS must satisfy both conjuncts.
    const ident = fc.oneof(
      fc.constantFrom('c1', 't1g7', 'x', '1', 'bad|id', '', 'a:b', 'a|b|c'),
      fc.integer({ min: -3, max: 5 }), fc.constantFrom(NaN, Infinity, -Infinity, -0, 1.5),
    );
    const bookish = fc.constantFrom('TIT', 'JON', '1CO', 'tit', '../../escaped', 'XYZ', '', 'TIT/../..');
    const pathish = fc.constantFrom('ui.x', 'a.b.c', '__proto__.p', 'a.constructor.b', 'a..b', '', 'prototype', 'identification.name.en', 'type.x');
    const scopeish = fc.array(fc.constantFrom('1', '1-2', '1:1', '1:2-16', '1:1-2:5', 'banana', '1-2:5', '1:1–2:5'), { maxLength: 3 });
    const slotish = fc.constantFrom('1:1', '1:2', '9:9', 'banana', '1:4-5');
    const okTsP = (s) => `2026-08-16T05:00:${String(s).padStart(2, '0')}.000Z|0000|actor-p`;
    const genEvent = fc.oneof(
      fc.record({ kind: fc.constant('decision'), checkId: ident, bookId: fc.constantFrom('tit', 'jon', 'TIT', '', 'ti|t'),
        chapter: ident, verse: ident, occurrence: ident, toolId: fc.constantFrom('translationWords', 'translationNotes', 'evilTool', '../x') }),
      fc.record({ kind: fc.constant('note'), decisionKey: fc.constantFrom('c1|tit|1|1|1', 'garbage', 'a|b|c|d|e|f', 'c1||1|1|1', 'c1|tit|1|1|') }),
      fc.record({ kind: fc.constant('verse'), book: bookish, chapter: ident, verse: ident }),
      fc.record({ kind: fc.constant('align'), book: bookish, chapter: ident, verse: ident, md5: fc.constantFrom('deadbeef', '') }),
      fc.record({ kind: fc.constant('settings'), path: pathish, value: fc.oneof(fc.string(), fc.integer(), fc.constantFrom(NaN, -0, Infinity)) }),
      fc.record({ kind: fc.constant('meta'), path: pathish, value: fc.oneof(fc.string(), fc.integer()) }),
      fc.record({ kind: fc.constant('book'), book: bookish, scope: scopeish, slot: slotish }),
    ).map((c) => {
      const base = { v: 1, actor: 'actor-p', ts: okTsP(1), base: null };
      const gen = okTsP(0);
      if (c.kind === 'decision') return { ...base, op: 'check.decision.set', generation: gen, toolId: c.toolId,
        decision: { contextId: { checkId: c.checkId, occurrence: c.occurrence, reference: { bookId: c.bookId, chapter: c.chapter, verse: c.verse } }, selections: false } };
      if (c.kind === 'note') return { ...base, op: 'note.add', generation: gen, target: { decisionKey: c.decisionKey }, text: 'n' };
      if (c.kind === 'verse') return { ...base, op: 'text.verse.set', book: c.book, chapter: c.chapter, verse: c.verse, text: 'x\n' };
      if (c.kind === 'align') return { ...base, op: 'align.verse.set', generation: gen, book: c.book, chapter: c.chapter, verse: c.verse, alignments: [], wordBank: [], targetVerseMd5: c.md5 };
      if (c.kind === 'settings') return { ...base, op: 'settings.set', path: c.path, value: c.value };
      if (c.kind === 'meta') return { ...base, op: 'project.meta.set', path: c.path, value: c.value };
      return { ...base, op: 'book.add', book: c.book, scope: c.scope,
        skeleton: `\\id X\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}`, initialVerses: { [c.slot]: 'v\n' } };
    });
    let accepted = 0;
    prop('J31 PROPERTY (the class-level guarantee, permanent): for every SCHEMA-VALID event — (a) its serialized §5.2 identity key validates, and (b) validateSegment(sealAction([e])) accepts. Anything the writer seals survives the JSON round trip and its own reader.',
      genEvent, (e) => {
        if (validateAction([e]) !== null) return true; // precondition: the schema refused it
        accepted++;
        if (e.op === 'check.decision.set' && identityKeyError(identityKeyOf(e.decision.contextId)) !== null) return false;
        return validateSegment(sealAction([e])).ok === true;
      });
    check('J31 PROPERTY: the generator actually reaches the accepting branch (the property is not vacuous)',
      accepted > 0, `${accepted} schema-valid events exercised both conjuncts`);
  }

  // --- FINDING 6 (round 9): a DERIVED value is a value. `skeleton` was type-checked and
  //     the slot keys `slotKeysOf()` derives from it never were — so a `__proto__` slot
  //     recomposed to `[object Object]` and PERMANENTLY destroyed the verse in committed
  //     USFM (unrepairable: `text.verse.set` correctly refuses that key, so no later
  //     event can address the slot). The keys now carry the same §8.4 slot grammar every
  //     other verse key carries, at every op that accepts a skeleton. ---
  {
    const skelWith = (key) => `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}${key}${SLOT}`;
    const hostileKeys = ['__proto__', 'constructor', '../../etc/passwd', '1:1|x', 'banana', '1:1:2', '1', '1:1 '];
    const ops = ['book.add', 'text.skeleton.set', 'text.structure.apply'];
    const evFor = (op, skeleton) => {
      const common = { actor: 'actor-a', ts: okTs(9), base: op === 'book.add' ? null : okTs(0), book: 'TIT' };
      if (op === 'book.add') return mkEvent({ ...common, op, scope: [], skeleton, initialVerses: {} });
      if (op === 'text.skeleton.set') return mkEvent({ ...common, op, skeleton });
      return mkEvent({ ...common, op, skeleton, transitions: Object.fromEntries(slotKeysOf(skeleton).map((k) => [k, { text: 'x\n', sources: [] }])), dispositions: [] });
    };
    let allClean = true; const details = [];
    for (const op of ops)
      for (const key of hostileKeys) {
        const r = refusedBothWays(evFor(op, skelWith(key)));
        if (!r.ok) { allClean = false; details.push(`${op} "${key}"`); }
      }
    check('J31 finding 6: every SLOT KEY a skeleton derives carries the §8.4 slot grammar — at book.add, text.skeleton.set AND text.structure.apply. A `__proto__` slot used to seal, recompose to "[object Object]" and destroy the verse permanently',
      allClean, details.length ? `missed: ${details.join(' · ')}` : `${ops.length * hostileKeys.length} firing cases`);
    // pre-fix the consequence was in COMMITTED USFM, not in a message — assert its absence
    let usfm = '';
    try { usfm = fold([evFor('book.add', skelWith('__proto__'))]).books.TIT.usfm; } catch { usfm = 'REFUSED'; }
    check('J31 finding 6: the measured consequence is gone — the fold no longer produces `\\v 1 [object Object]` for a __proto__ slot; it refuses the event',
      usfm === 'REFUSED', usfm.slice(0, 40));
    const dupSkel = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 1 ${SLOT}1:1${SLOT}`;
    let allDup = true;
    for (const op of ops) if (!refusedBothWays(evFor(op, dupSkel)).ok) allDup = false;
    check('J31 finding 6: DUPLICATE slot keys are refused too — two slots that name one verse head collapse silently at recompose',
      allDup);
    check('J31 finding 6: a well-formed skeleton (single and span keys) still seals and folds — the hardening adds no false refusal',
      (() => { try { fold([evFor('book.add', `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 4-5 ${SLOT}1:4-5${SLOT}`)]); return true; } catch { return false; } })());
  }

  // --- FINDING 7: journaled verse content is ONE content slot. A `\c ` or `\v ` inside
  //     `text.verse.set.text` SILENTLY RE-PARTITIONED the committed book on the next
  //     decompose, and the §5.1 extraction stopped at the embedded marker, so the
  //     smuggled bytes lived OUTSIDE the I-3 validity hash. ---
  {
    const bad = [
      ['an embedded \\c 2 (re-partitions the book into different slots)', 'uno\n\\c 2\n\\v 1 smuggled\n'],
      ['an embedded \\v 9 (the bytes after it fall outside the I-3 hash)', 'uno\n\\v 9 outside\n'],
      ['the reserved §8.4 slot delimiter U+0001', `uno${SLOT}\n`],
    ];
    let allClean = true; const details = [];
    for (const [label, text] of bad) {
      const rows = [
        mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: okTs(9), book: 'TIT', chapter: '1', verse: '1', text }),
        mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(9), book: 'TIT', scope: [], skeleton: skel1('TIT'), initialVerses: { '1:1': text } }),
        mkEvent({ op: 'text.structure.apply', actor: 'actor-a', ts: okTs(9), base: okTs(0), book: 'TIT', skeleton: skel1('TIT'), transitions: { '1:1': { text, sources: [] } }, dispositions: [] }),
      ];
      for (const ev of rows) if (!refusedBothWays(ev).ok) { allClean = false; details.push(`${ev.op}: ${label}`); }
    }
    check('J31 finding 7: journaled verse content carrying a §8.4 region marker (\\v /\\c ) or the reserved U+0001 is refused at seal AND at fold — at every op that carries verse content, so the committed book can never silently re-partition',
      allClean, details.length ? `missed: ${details.join(' · ')}` : `${bad.length * 3} firing cases`);
    check('J31 finding 7: the codec and the grammar share ONE boundary definition — the schema refuses exactly the marker `decompose` splits on, so a slot the schema accepts always survives a decompose/recompose round trip',
      (() => {
        const add = mkEvent({ op: 'book.add', actor: 'actor-a', ts: okTs(0), book: 'TIT', scope: [], skeleton: skel('TIT'), initialVerses: {} });
        const ok = mkEvent({ op: 'text.verse.set', actor: 'actor-a', ts: okTs(1), base: okTs(0), book: 'TIT', chapter: '1', verse: '1', text: 'uno \\f + \\ft nota\\f*\n\\p\n' });
        const usfm = fold([add, ok]).books.TIT.usfm;
        return JSON.stringify(Object.keys(decompose(usfm).verses)) === JSON.stringify(['1:1', '1:2']);
      })());
  }

  // --- FINDING 8: `resource.pin.set.entry` was unvalidated — the SLOT carried a grammar
  //     and the value it stores carried none, so garbage reached the projected §5.3
  //     resources.json verbatim. ---
  {
    const pin = (slot, entry) => mkEvent({ op: 'resource.pin.set', actor: 'actor-a', ts: okTs(9), slot, entry });
    const rows = [
      ['translationNotes: "not-an-object"', pin('languageSets.primary.translationNotes', 'not-an-object')],
      ['resources.originalLanguage.nt: 42', pin('resources.originalLanguage.nt', 42)],
      ['a pin entry with no repoPath', pin('languageSets.primary.translationWords', { version: 'v1', flavor: 'x' })],
      ['a pin entry with an empty version', pin('languageSets.primary.translationWords', { repoPath: 'r', version: '', flavor: 'x' })],
      ['a gatewayLanguage entry with no languageId', pin('languageSets.primary.gatewayLanguage', { owner: 'uW' })],
      ['an extraScripture entry whose id does not match its slot', pin('extraScripture.ult', { id: 'ust', repoPath: 'r', version: 'v1', flavor: 'scripture/textTranslation' })],
      ['a sha that is not 40 lowercase hex', pin('extraScripture.ult', { id: 'ult', repoPath: 'r', version: 'v1', flavor: 'f', sha: 'DEADBEEF' })],
    ];
    let allClean = true; const details = [];
    for (const [label, ev] of rows) { if (!refusedBothWays(ev).ok) { allClean = false; details.push(label); } }
    check('J31 finding 8: every §5.3 pin ENTRY is validated by the §5.3 entry shape — the slot grammar alone let `"not-an-object"` and `42` reach the projected resources.json',
      allClean, details.length ? `missed: ${details.join(' · ')}` : `${rows.length} firing cases`);
    check('J31 finding 8: ONE validator, shared — the same pinEntryError accepts every entry of the sample burrito\'s own §5.3 document',
      (() => {
        const doc = JSON.parse(fs.readFileSync(ING('checking/resources.json'), 'utf8'));
        const pairs = [];
        for (const set of Object.keys(doc.languageSets || {}))
          for (const slot of Object.keys(doc.languageSets[set])) pairs.push([`languageSets.${set}.${slot}`, doc.languageSets[set][slot]]);
        for (const group of Object.keys(doc.resources || {}))
          for (const t of Object.keys(doc.resources[group])) pairs.push([`resources.${group}.${t}`, doc.resources[group][t]]);
        for (const e of doc.extraScripture || []) pairs.push([`extraScripture.${e.id}`, e]);
        const bad = pairs.filter(([s, e]) => pinEntryError(s, e) !== null);
        return bad.length === 0 && pairs.length > 0;
      })());
  }

  // --- FINDING 9: the identity SERIALIZER checks its own precondition. A bare join
  //     laundered `-0`, arrays, objects and booleans into well-formed-LOOKING keys that
  //     its own validator then accepted. ---
  {
    const rows = [
      ['-0 (joins as "0")', { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: -0, verse: 1 } }],
      ['an array (joins as its comma form)', { checkId: ['a'], occurrence: 1, reference: { bookId: 'tit', chapter: 1, verse: 1 } }],
      ['an object (joins as "[object Object]")', { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: { a: 1 }, verse: 1 } }],
      ['a boolean (joins as "true")', { checkId: 'c1', occurrence: 1, reference: { bookId: 'tit', chapter: true, verse: 1 } }],
      ['a missing reference object', { checkId: 'c1', occurrence: 1 }],
    ];
    const laundered = rows.filter(([, cid]) => { try { return identityKeyError(identityKeyOf(cid)) === null; } catch { return false; } });
    check('J31 finding 9: identityKeyOf validates its own components and THROWS — the serializer can no longer emit a string its own validator would accept from input the schema rejects (-0, arrays, objects, booleans, a missing reference)',
      laundered.length === 0, laundered.length ? `still laundered: ${laundered.map(([l]) => l).join(', ')}` : `${rows.length} firing cases`);
    check('J31 finding 9: a well-formed contextId still serializes — the precondition adds no false refusal',
      identityKeyOf({ checkId: 't1g7', occurrence: 1, reference: { bookId: 'tit', chapter: 1, verse: 1 } }) === 't1g7|tit|1|1|1');
  }

  // --- FINDING 10: a CHARSET is not a CALENDAR. `2026-13-45T25:70:99.999Z` matched the
  //     ISO regex, sealed, and parsed to NaN — so the §8.2 clock ratchet compared against
  //     NaN, silently no-opped, and left the local clock PERMANENTLY behind. ---
  {
    const rows = [
      ['2026-13-45T25:70:99.999Z (parseTs → NaN; the clock ratchet silently no-ops forever)', '2026-13-45T25:70:99.999Z|0000|actor-a'],
      ['2026-02-30 (parses two days late — string order and instant order disagree)', '2026-02-30T00:00:00.000Z|0000|actor-a'],
      ['2025-02-29 (not a leap year)', '2025-02-29T00:00:00.000Z|0000|actor-a'],
      ['2026-00-10 (month zero)', '2026-00-10T00:00:00.000Z|0000|actor-a'],
    ];
    let allClean = true; const details = [];
    for (const [label, ts] of rows) {
      const r = refusedBothWays(mkEvent({ op: 'settings.set', actor: 'actor-a', ts, path: 'ui.x', value: 1 }));
      if (!r.ok) { allClean = false; details.push(label); }
    }
    check('J31 finding 10: an §8.2 ts MUST carry a real calendar instant, not merely the ISO charset — every non-calendar ts is refused at seal AND at fold',
      allClean, details.length ? `missed: ${details.join(' · ')}` : `${rows.length} firing cases`);
    // the property the fix buys: string order IS instant order over the accepted set
    prop('J31 finding 10 PROPERTY: over every ts the grammar accepts, compareTs (string order) AGREES with parseTs (instant order) — the two orders can no longer disagree',
      fc.record({
        y: fc.integer({ min: 1970, max: 2999 }), mo: fc.integer({ min: 1, max: 13 }), d: fc.integer({ min: 1, max: 32 }),
        h: fc.integer({ min: 0, max: 24 }), mi: fc.integer({ min: 0, max: 60 }), s: fc.integer({ min: 0, max: 60 }),
        ms: fc.integer({ min: 0, max: 999 }), c: fc.integer({ min: 0, max: 0xffff }),
        y2: fc.integer({ min: 1970, max: 2999 }), mo2: fc.integer({ min: 1, max: 13 }), d2: fc.integer({ min: 1, max: 32 }),
      }),
      (r) => {
        const p2 = (n) => String(n).padStart(2, '0');
        const mk = (y, mo, d, h, mi, s, ms, c) => `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}.${String(ms).padStart(3, '0')}Z|${c.toString(16).padStart(4, '0')}|actor-a`;
        const a = mk(r.y, r.mo, r.d, r.h, r.mi, r.s, r.ms, r.c);
        const b = mk(r.y2, r.mo2, r.d2, r.h, r.mi, r.s, r.ms, r.c);
        const seals = (t) => validateAction([mkEvent({ op: 'settings.set', actor: 'actor-a', ts: t, path: 'ui.x', value: 1 })]) === null;
        if (!seals(a) || !seals(b)) return true; // precondition: the grammar refused it
        const inst = Math.sign(parseTs(a).physical - parseTs(b).physical);
        return compareTs(a, b) === inst;
      });
    check('J31 finding 10: real instants — including a genuine leap day — still seal and fold',
      ['2024-02-29T12:00:00.000Z|0000|actor-a', '2026-08-16T23:59:59.999Z|ffff|actor-a']
        .every((ts) => { try { fold([mkEvent({ op: 'settings.set', actor: 'actor-a', ts, path: 'ui.x', value: 1 })]); return true; } catch { return false; } }));
  }

  // --- FINDING 11: §8.5 says `v: 1` writers emit `project.vrs.set` "only within the
  //     creation/seed segment". The sentence was normative and unenforced. ---
  {
    const vrs = (over) => mkEvent({ op: 'project.vrs.set', actor: 'actor-a', ts: okTs(9), name: 'eng', bytes: '{"maxVerses":{}}', ...over });
    const rows = [
      ['no seed marker at all (an ordinary later event)', vrs({})],
      ['seed.source "out-of-band-usfm" (a TEXT reconcile source, never a frame)', vrs({ seed: { source: 'out-of-band-usfm' } })],
      ['a seed field that is not a seed object', vrs({ seed: 'creation' })],
    ];
    let allClean = true; const details = [];
    for (const [label, ev] of rows) if (!refusedBothWays(ev).ok) { allClean = false; details.push(label); }
    check('J31 finding 11: project.vrs.set outside a creation/seed segment is refused at seal AND at fold — the §8.5 "creation/seed only" sentence now has an implementation',
      allClean, details.length ? `missed: ${details.join(' · ')}` : `${rows.length} firing cases`);
    check('J31 finding 11: each legitimate seeding source still seals — creation, sidecar-migration and tc3-import',
      ['creation', 'sidecar-migration', 'tc3-import'].every((source) => {
        try { sealAction([vrs({ seed: { source } })]); return true; } catch { return false; }
      }));
  }

  // --- FINDING 12 (DEFERRED HALF, asserted here): the note re-key destination grammar is
  //     bound to the note's target KIND, and the ONE predicate that binds them lives in
  //     grammar.mjs so the schema and the fold apply the same rule. The fold call-site
  //     (rewriteNote) is the semantics half and is tracked separately. ---
  {
    const verseTarget = { book: 'TIT', chapter: '1', verse: '2' };
    const decTarget = { decisionKey: 'x1|tit|1|2|1' };
    const rows = [
      ['a VERSE-targeted note re-keyed to a §5.2 identity key', verseTarget, 'x1|tit|1|2|1', ['1:1']],
      ['a decisionKey-targeted note re-keyed to a verse slot', decTarget, '1:1', ['1:1']],
      ['a verse-targeted note re-keyed to a slot outside the mapping', verseTarget, '9:9', ['1:1']],
    ];
    const missed = rows.filter(([, target, to, slots]) => noteRekeyError(target, to, slots) === null);
    check('J31 finding 12: ONE predicate binds a note re-key destination to the note\'s target KIND — a verse target re-keys to a verse slot, a decisionKey target to a §5.2 identity key. Pre-fix a verse-targeted note re-keyed to an identity key produced `{book, chapter: "x1|tit|1|2|1", verse: ""}` — a target the schema itself rejects',
      missed.length === 0, missed.length ? `missed: ${missed.map(([l]) => l).join(', ')}` : `${rows.length} firing cases`);
    check('J31 finding 12: the two legitimate re-keys still pass the predicate',
      noteRekeyError(verseTarget, '1:1', ['1:1']) === null && noteRekeyError(decTarget, 'x1|tit|1|1|1', []) === null);
  }

  // --- FINDING 13: own-property hygiene at the checkpoint. §8.7 calls the regeneration
  //     set EXHAUSTIVE, and it was assembled in a plain `{}` — where assigning a
  //     `__proto__` key runs the prototype setter and DROPS the entry. An exhaustive set
  //     that silently loses a member is the one thing it may not be. ---
  {
    const foldOut = { books: {}, alignments: {}, decisions: {}, pins: {}, settings: {},
      projectMeta: {}, projectMetaRemoved: [], vrs: null, scope: {} };
    const set = derivedProjections(foldOut, { baseMetadata: { type: { flavorType: {} } }, resolutions: {} });
    const plain = {}; plain['__proto__'] = 'bytes';
    check('J31 finding 13: the §8.7 regeneration set is a NULL-PROTOTYPE container — a plain `{}` silently drops a `__proto__` key, so an "exhaustive" set could lose a member with no error anywhere',
      Object.getPrototypeOf(set) === null && Object.keys(plain).length === 0,
      `projection set prototype = ${Object.getPrototypeOf(set)} · plain {} kept ${Object.keys(plain).length} of 1`);
    const withProto = derivedProjections(foldOut, { baseMetadata: { type: { flavorType: {} } }, resolutions: {} });
    withProto['__proto__'] = 'bytes';
    check('J31 finding 13: a `__proto__` projection key is RETAINED in the set and reported by the divergence classifier — pre-fix it vanished between emit and classification',
      Object.keys(withProto).includes('__proto__') &&
      classifyDivergence({}, withProto).diverged.includes('__proto__'),
      JSON.stringify(classifyDivergence({}, withProto).diverged));
    check('J31 finding 13: classifyDivergence tests OWN membership, never `in` — `in` walks the prototype chain, so the "absent on disk is divergence too" rule would be read off a set that does not contain the key',
      classifyDivergence({}, Object.assign(Object.create(null), { 'toString': 'x' })).diverged.includes('toString') &&
      classifyDivergence(Object.assign(Object.create(null), { 'valueOf': 'x' }), {}).diverged.includes('valueOf'),
      JSON.stringify(classifyDivergence({}, Object.assign(Object.create(null), { 'toString': 'x' }))));
  }

  // --- §8.1 actor.json: the slug is a directory name, createdAt is required ---
  {
    const doc = (o) => JSON.stringify({ schemaVersion: 1, actorId: 'actor-a', createdAt: '2026-06-01T00:00:00.000Z', ...o });
    const rows = [
      ['actorId outside the §8.1 slug charset', doc({ actorId: 'Actor_A' }), 'Actor_A'],
      ['actorId that is a path', doc({ actorId: '../../etc' }), '../../etc'],
      ['actorId too short', doc({ actorId: 'ab' }), 'ab'],
      ['createdAt absent', doc({ createdAt: undefined }), 'actor-a'],
      ['createdAt not an ISO instant', doc({ createdAt: 'yesterday' }), 'actor-a'],
      ['displayName wrong type', doc({ displayName: 42 }), 'actor-a'],
      ['device wrong type', doc({ device: {} }), 'actor-a'],
    ];
    const rejected = rows.filter(([, raw, id]) => !validateActorDoc(raw, id).ok);
    check('J31: validateActorDoc enforces the §8.1 actor-slug grammar (the actorId IS a directory name), a REQUIRED createdAt, and the types of the optional metadata fields',
      rejected.length === rows.length, `${rejected.length}/${rows.length} rejected: ${rows.filter(([, r, i]) => validateActorDoc(r, i).ok).map(([l]) => l).join(', ') || 'none missed'}`);
    check('J31: a complete, well-formed actor.json still validates (the hardening adds no false rejection)',
      validateActorDoc(doc({ displayName: 'A', device: 'laptop' }), 'actor-a').ok);
  }
}

console.log(`\nJournal suite: ${pass} passed, ${fail} failed (fast-check seed ${SEED})`);
process.exit(fail ? 1 : 0);
