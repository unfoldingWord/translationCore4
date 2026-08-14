// Journal conformance suite — BURRITO-SPEC §8 / docs/JOURNAL-TEST-PLAN.md (J1–J20).
// Properties use fast-check with a FIXED seed for reproducibility.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { makeClock, parseTs } from './journal/hlc.mjs';
import { SLOT, decompose, recompose } from './journal/skeleton.mjs';
import { fold } from './journal/fold.mjs';
import { reconcileUsfm, seedFromSidecars } from './journal/reconcile.mjs';
import { appendEvent, readStream, readUnion } from './journal/files.mjs';

const require = createRequire(import.meta.url);
const fc = require('fast-check');
const usfmjs = require('usfm-js');

const SEED = 20260707;
const FC = { seed: SEED, numRuns: 200 };
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const canon = (o) => JSON.stringify(o, Object.keys(flatten(o)).sort());
const deepEq = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
const sort = (o) => Array.isArray(o) ? o.map(sort)
  : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])])) : o;
const flatten = (o) => o; // canon helper only used via deepEq/sort below
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
const verseTextMd5Usfm = (content) => {
  const parsed = usfmjs.toJSON(`\\v 1 ${content}`, { chunk: true });
  const vo = parsed.verses?.['1']?.verseObjects || [];
  return md5(vo.map((o) => o.text || '').join('').trim());
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
    const events = [mkEvent({ op: 'book.add', actor: 'actor-a', ts: '2026-01-01T00:00:00.000Z|0000|actor-a', book: 'TIT' }),
      mkEvent({ op: 'text.skeleton.set', actor: 'actor-a', ts: '2026-01-01T00:00:00.001Z|0000|actor-a', book: 'TIT', skeleton: `\\id TIT\n\\c 1\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}\\v 3 ${SLOT}1:3${SLOT}`, skeletonMd5: null })];
    for (const c of cmds) {
      now += c.advance; const actor = actors[c.actor]; const ts = clocks[c.actor].issue(); clocks[1 - c.actor].ratchet(ts);
      let e;
      if (c.kind === 'verse') e = { op: 'text.verse.set', book: 'TIT', chapter: '1', verse: String(c.key + 1), text: c.val + '\n', textMd5: null };
      else if (c.kind === 'pin') e = { op: 'resource.pin.set', slot: `slot${c.key}`, entry: { v: c.val } };
      else if (c.kind === 'meta') e = { op: 'project.meta.set', path: `p.${c.key}`, value: c.val };
      else if (c.kind === 'note') e = { op: 'note.add', target: `TIT 1:${c.key + 1}`, text: c.val };
      else e = { op: 'check.decision.set', toolId: 'translationWords', decision: { contextId: { checkId: `c${c.key}`, reference: { bookId: 'tit', chapter: 1, verse: c.key + 1 }, occurrence: 1 }, selections: false, note: c.val } };
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
    E('book.add', 'actor-a', t(0, 0, 'actor-a'), null, { book: 'TIT' }),
    E('text.skeleton.set', 'actor-a', t(0, 1, 'actor-a'), null, { book: 'TIT', skeleton: S, skeletonMd5: null }),
    E('text.verse.set', 'actor-a', t(1, 0, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', text: 'uno\n', textMd5: null }),
    E('text.verse.set', 'actor-a', t(1, 1, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '2', text: 'dos\n', textMd5: null }),
  ];
  const base11 = t(1, 0, 'actor-a');

  const lin = fold([...seedEvts, E('text.verse.set', 'actor-a', t(2, 0, 'actor-a'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'uno v2\n', textMd5: null })]);
  check('J4: LWW linear — later event with base=head replaces', lin.books.TIT.verses['1:1'] === 'uno v2\n' && lin.forks.length === 0);

  const forkA = E('text.verse.set', 'actor-a', t(3, 0, 'actor-a'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'versión A\n', textMd5: null });
  const forkB = E('text.verse.set', 'actor-b', t(3, 1, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'versión B\n', textMd5: null });
  const forked = fold([...seedEvts, forkA, forkB]);
  check('J5: fork detected — same base, different actors+payloads; provisional = max ts, surfaced',
    forked.forks.length === 1 && forked.forks[0].provisional === forkB.ts && forked.books.TIT.verses['1:1'] === 'versión B\n',
    JSON.stringify(forked.forks[0]?.heads));
  const twin = fold([...seedEvts, forkA, { ...forkB, text: 'versión A\n' }]);
  check('J5: identical-content fork auto-merges (distinct events by identity, no review item)', twin.forks.length === 0 && twin.books.TIT.verses['1:1'] === 'versión A\n');

  const resolve = E('text.verse.set', 'actor-c', t(4, 0, 'actor-c'), forkB.ts, { supersedes: [forkA.ts, forkB.ts], book: 'TIT', chapter: '1', verse: '1', text: 'resuelta\n', textMd5: null });
  const resolved = fold([...seedEvts, forkA, forkB, resolve]);
  check('J6: supersedes both heads resolves the fork', resolved.forks.length === 0 && resolved.books.TIT.verses['1:1'] === 'resuelta\n');
  const continueOnly = fold([...seedEvts, forkA, forkB, E('text.verse.set', 'actor-b', t(4, 1, 'actor-b'), t(1, 1, 'actor-a'), { book: 'TIT', chapter: '1', verse: '2', text: 'x\n', textMd5: null }), E('text.verse.set', 'actor-b', t(5, 0, 'actor-b'), forkB.ts, { book: 'TIT', chapter: '1', verse: '1', text: 'B sigue\n', textMd5: null })]);
  check('J6: a plain continuing edit advances its branch but does NOT resolve the fork',
    continueOnly.forks.length === 1 && continueOnly.forks[0].heads.length === 2 && continueOnly.books.TIT.verses['1:1'] === 'B sigue\n',
    JSON.stringify(continueOnly.forks[0]?.heads));

  const alignOk = E('align.verse.set', 'actor-a', t(6, 0, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', alignments: [], wordBank: [], targetVerseMd5: md5('uno') });
  const st1 = fold([...seedEvts, alignOk]);
  const st2 = fold([...seedEvts, alignOk, E('text.verse.set', 'actor-b', t(7, 0, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'cambiada\n', textMd5: null })]);
  const st3 = fold([...seedEvts, alignOk, E('text.verse.set', 'actor-b', t(7, 0, 'actor-b'), base11, { book: 'TIT', chapter: '1', verse: '1', text: 'cambiada\n', textMd5: null }), E('align.verse.set', 'actor-b', t(8, 0, 'actor-b'), alignOk.ts, { book: 'TIT', chapter: '1', verse: '1', alignments: [], wordBank: [], targetVerseMd5: md5('cambiada') })]);
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

// ---------- J8: out-of-band reconcile ----------
{
  const { events } = buildSeed();
  const out = fold(events, { verseTextMd5: verseTextMd5Usfm });
  const edited = out.books.TIT.usfm.replace('Pablo, siervo de Dios', 'Saulo, siervo de Dios');
  const clock = makeClock('reconciler', () => Date.parse('2026-07-07T12:00:00.000Z'));
  const recEvents = reconcileUsfm('TIT', edited, out, clock, 'reconciler');
  const after = fold([...events, ...recEvents], { verseTextMd5: verseTextMd5Usfm });
  check('J8: reconcile emits seeded supersede; fold equals the edited file', recEvents.length === 1 && recEvents[0].seed.source === 'out-of-band-usfm' && after.books.TIT.usfm === edited && after.forks.length === 0);
  const concurrent = mkEvent({ op: 'text.verse.set', actor: 'actor-z', ts: '2026-07-07T11:59:00.000Z|0000|actor-z', base: out.headsTs['text|TIT|1:1'], book: 'TIT', chapter: '1', verse: '1', text: 'edición concurrente\n', textMd5: null });
  const clash = fold([...events, ...recEvents, concurrent], { verseTextMd5: verseTextMd5Usfm });
  check('J8: concurrent journal edit on the same verse surfaces as a fork (never silent)', clash.forks.some((f) => f.key === 'text|TIT|1:1'));
  check('J8: alignment invalidation composes with reconcile (edited verse alignment goes stale)', after.invalid.some((i) => i.book === 'TIT' && i.verse === '1:1'));
}

// ---------- J9 + J10: convergence & sneakernet via real files ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-journal-'));
  const { events } = buildSeed();
  const out0 = fold(events, { verseTextMd5: verseTextMd5Usfm });
  const eA = mkEvent({ op: 'text.verse.set', actor: 'device-aa', ts: '2026-07-07T13:00:00.000Z|0000|device-aa', base: out0.headsTs['text|TIT|1:2'], book: 'TIT', chapter: '1', verse: '2', text: 'con la esperanza EDITADA A\n', textMd5: null });
  const eB = mkEvent({ op: 'text.verse.set', actor: 'device-bb', ts: '2026-07-07T13:00:01.000Z|0000|device-bb', base: out0.headsTs['text|TIT|1:3'], book: 'TIT', chapter: '1', verse: '3', text: 'EDITADA B\n', textMd5: null });
  const J = (d) => path.join(tmp, d, 'journal');
  for (const d of ['deviceA', 'deviceB', 'integrator']) fs.mkdirSync(J(d), { recursive: true });
  for (const ev of events) appendEvent(path.join(J('deviceA'), 'seed-actor'), 'TIT', ev);
  execSync(`cp -R "${path.join(J('deviceA'), 'seed-actor')}" "${path.join(J('deviceB'), 'seed-actor')}"`);
  appendEvent(path.join(J('deviceA'), 'device-aa'), 'TIT', eA);
  appendEvent(path.join(J('deviceB'), 'device-bb'), 'TIT', eB);
  // sneakernet: copy both actor dirs into integrator
  for (const [d, a] of [['deviceA', 'seed-actor'], ['deviceA', 'device-aa'], ['deviceB', 'device-bb']])
    execSync(`cp -R "${path.join(J(d), a)}" "${path.join(J('integrator'), a)}"`);
  const foldA = fold([...readUnion(J('deviceA')), ...readUnion(J('deviceB'))], { verseTextMd5: verseTextMd5Usfm });
  const foldI = fold(readUnion(J('integrator')), { verseTextMd5: verseTextMd5Usfm });
  const foldM = fold([...events, eA, eB], { verseTextMd5: verseTextMd5Usfm });
  check('J9: three-device disjoint edits converge — identical bytes, zero forks',
    foldI.books.TIT.usfm === foldM.books.TIT.usfm && foldI.forks.length === 0 && foldI.books.TIT.usfm.includes('EDITADA A') && foldI.books.TIT.usfm.includes('EDITADA B'));
  check('J10: sneakernet (file copy union) ≡ in-memory union ≡ cross-device read', deepEq(foldA, foldI) && deepEq(foldI, foldM));

  // J11 on the same tmp: rotation + torn tail
  const rotDir = path.join(tmp, 'rot', 'actor-rr');
  const bigText = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 20; i++)
    appendEvent(rotDir, 'TIT', mkEvent({ op: 'text.verse.set', actor: 'actor-rr', ts: `2026-07-07T13:10:${String(i).padStart(2, '0')}.000Z|0000|actor-rr`, base: null, book: 'TIT', chapter: '1', verse: '1', text: bigText, textMd5: null }));
  const rotFiles = fs.readdirSync(rotDir).sort();
  const rotEvents = readStream(rotDir, 'TIT');
  check('J11: rotation past 1 MB creates 00002+; reader spans seq files in order', rotFiles.length >= 2 && rotFiles[0].endsWith('.00001.jsonl') && rotEvents.length === 20);
  const lastFile = path.join(rotDir, rotFiles[rotFiles.length - 1]);
  fs.appendFileSync(lastFile, '{"v":1,"op":"text.verse.set","truncated');
  check('J11: torn final line is ignored', readStream(rotDir, 'TIT').length === 20);
  fs.appendFileSync(lastFile, '\n');
  let cThrew = false; try { readStream(rotDir, 'TIT'); } catch { cThrew = true; }
  check('J11: invalid JSON mid-stream (newline-terminated) refuses with clear message', cThrew);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- J12: end-to-end git — journals + fold + derived-file regeneration ----------
{
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-j12-'));
  const git = (args, cwd = T) => execSync(`git ${args}`, { cwd, stdio: 'pipe' }).toString();
  const { events } = buildSeed();
  const vOpts = { verseTextMd5: verseTextMd5Usfm };
  const writeCheckpoint = (dir, evts) => {
    const out = fold(evts, vOpts);
    fs.mkdirSync(path.join(dir, 'ingredients'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'ingredients/TIT.usfm'), out.books.TIT.usfm);
    return out;
  };
  git('init -q .'); git('config user.email t@t'); git('config user.name T');
  fs.writeFileSync(path.join(T, '.gitattributes'), 'ingredients/*.usfm merge=ours\nmetadata.json merge=ours\n');
  const jdir = (actor) => path.join(T, 'ingredients/checking/journal', actor);
  for (const ev of events) appendEvent(jdir('seed-actor'), 'TIT', ev);
  writeCheckpoint(T, readUnion(path.join(T, 'ingredients/checking/journal')));
  git('add -A'); git('commit -qm base');
  const out0 = fold(readUnion(path.join(T, 'ingredients/checking/journal')), vOpts);

  git('checkout -qb actor-a');
  appendEvent(jdir('device-aa'), 'TIT', mkEvent({ op: 'text.verse.set', actor: 'device-aa', ts: '2026-07-07T14:00:00.000Z|0000|device-aa', base: out0.headsTs['text|TIT|1:2'], book: 'TIT', chapter: '1', verse: '2', text: 'A cambió v2\n', textMd5: null }));
  writeCheckpoint(T, readUnion(path.join(T, 'ingredients/checking/journal')));
  git('add -A'); git('commit -qm "checkpoint A"');

  git('checkout -q main 2>/dev/null || git checkout -q master', T); git('checkout -qb actor-b HEAD~0');
  git('checkout -q actor-b');
  appendEvent(jdir('device-bb'), 'TIT', mkEvent({ op: 'text.verse.set', actor: 'device-bb', ts: '2026-07-07T14:00:01.000Z|0000|device-bb', base: out0.headsTs['text|TIT|1:3'], book: 'TIT', chapter: '1', verse: '3', text: 'B cambió v3\n', textMd5: null }));
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
  const out = fold(events, { verseTextMd5: verseTextMd5Usfm });
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
    E('book.add', 'drafter-a', t(0, 0, 'drafter-a'), null, { book: 'TIT' }),
    E('text.skeleton.set', 'drafter-a', t(0, 1, 'drafter-a'), null, { book: 'TIT', skeleton, skeletonMd5: null }),
    ...Object.entries(verses).map(([vkey, text], i) => {
      const [chapter, verse] = vkey.split(':');
      return E('text.verse.set', 'drafter-a', t(1, i, 'drafter-a'), null, { book: 'TIT', chapter, verse, text, textMd5: null });
    }),
  ];
  const base12 = t(1, 1, 'drafter-a'); // verse 1:2's seed event

  // milestone-only edit: move the section boundary out of 1:2 (re-chunking), words unchanged
  const align12 = E('align.verse.set', 'checker-c', t(2, 0, 'checker-c'), null, { book: 'TIT', chapter: '1', verse: '2', alignments: [], wordBank: [], targetVerseMd5: verseTextMd5Usfm(verses['1:2']) });
  const milestoneMove = E('text.verse.set', 'drafter-a', t(3, 0, 'drafter-a'), base12, { book: 'TIT', chapter: '1', verse: '2', text: 'con esperanza de vida eterna,\n', textMd5: null });
  const wordEdit = E('text.verse.set', 'drafter-a', t(4, 0, 'drafter-a'), milestoneMove.ts, { book: 'TIT', chapter: '1', verse: '2', text: 'con esperanza VIVA de vida eterna,\n\\ts\\*\n\\p\n', textMd5: null });
  const opts = { verseTextMd5: verseTextMd5Usfm };
  const afterMove = fold([...seedEvts, align12, milestoneMove], opts);
  const afterWords = fold([...seedEvts, align12, milestoneMove, wordEdit], opts);
  check('J16: structure-only edit (stripping an imported \\ts\\*) does NOT invalidate the verse\'s alignment (I-3 on plain text)',
    afterMove.invalid.length === 0 && !afterMove.books.TIT.verses['1:2'].includes('\\ts\\*'),
    `invalid=${afterMove.invalid.length}`);
  check('J16: a word edit on the same verse DOES invalidate', afterWords.invalid.length === 1);

  // section save = per-verse events sharing a batch; concurrent verse edit forks; batch groups the review
  const batchTs = t(5, 0, 'drafter-a');
  const sectionSave = [
    E('text.verse.set', 'drafter-a', t(5, 0, 'drafter-a'), t(1, 2, 'drafter-a'), { batch: batchTs, book: 'TIT', chapter: '1', verse: '3', text: 'a su tiempo REDRAFTED,\n', textMd5: null }),
    E('text.verse.set', 'drafter-a', t(5, 1, 'drafter-a'), t(1, 3, 'drafter-a'), { batch: batchTs, book: 'TIT', chapter: '1', verse: '4', text: 'a Tito REDRAFTED.\n\\ts\\*\n\\p\n', textMd5: null }),
  ];
  const concurrent = E('text.verse.set', 'checker-c', t(5, 2, 'checker-c'), t(1, 2, 'drafter-a'), { book: 'TIT', chapter: '1', verse: '3', text: 'a su debido tiempo (checked),\n', textMd5: null });
  const merged = fold([...seedEvts, ...sectionSave, concurrent], opts);
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
    E('book.add', 'actor-a', t(0, 0, 'actor-a'), null, { book: 'TIT' }),
    E('text.skeleton.set', 'actor-a', t(0, 1, 'actor-a'), null, { book: 'TIT', skeleton: S, skeletonMd5: null }),
    E('text.verse.set', 'actor-a', t(1, 0, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '1', text: 'uno\n', textMd5: null }),
    E('text.verse.set', 'actor-a', t(1, 1, 'actor-a'), null, { book: 'TIT', chapter: '1', verse: '2', text: 'dos\n', textMd5: null }),
  ];

  // settings.set: LWW per path, projected into fold output
  const s1 = E('settings.set', 'actor-a', t(2, 0, 'actor-a'), null, { path: 'checkCategories.translationWords', value: ['kt'] });
  const s2 = E('settings.set', 'actor-b', t(3, 0, 'actor-b'), s1.ts, { path: 'checkCategories.translationWords', value: ['kt', 'names'] });
  const s3 = E('settings.set', 'actor-a', t(3, 1, 'actor-a'), null, { path: 'ui.paneSettings', value: [{ bibleId: 'targetBible' }] });
  const withSettings = fold([...seedEvts, s1, s2, s3]);
  check('J17: settings.set — LWW per path; §5.4 state projects from the fold (no shared mutable settings.json)',
    deepEq(withSettings.settings['checkCategories.translationWords'], ['kt', 'names']) && 'ui.paneSettings' in withSettings.settings,
    JSON.stringify(withSettings.settings['checkCategories.translationWords']));

  // project.meta.set reserved roots refuse
  let refused = '';
  try { fold([...seedEvts, E('project.meta.set', 'actor-a', t(4, 0, 'actor-a'), null, { path: 'ingredients.evil', value: {} })]); }
  catch (e) { refused = e.message; }
  check('J17: project.meta.set targeting a reserved root (ingredients/format/type/meta) refuses with a clear message',
    refused.includes('reserved root'), `"${refused.slice(0, 60)}"`);
  const okMeta = fold([...seedEvts, E('project.meta.set', 'actor-a', t(4, 1, 'actor-a'), null, { path: 'identification.name.en', value: 'Renamed' })]);
  check('J17: project.meta.set on an allowed path still folds', okMeta.projectMeta['identification.name.en'] === 'Renamed');

  // orphaned alignment: skeleton edit removes the verse slot → alignment invalid regardless of hash
  const align2 = E('align.verse.set', 'actor-b', t(5, 0, 'actor-b'), null, { book: 'TIT', chapter: '1', verse: '2', alignments: [], wordBank: [], targetVerseMd5: md5('dos') });
  const dropV2 = E('text.skeleton.set', 'actor-a', t(6, 0, 'actor-a'), t(0, 1, 'actor-a'), { book: 'TIT', skeleton: `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}`, skeletonMd5: null });
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
  const n1 = E('note.add', 'actor-a', t(7, 0, 'actor-a'), null, { target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'nota de verso' });
  const n2 = E('note.add', 'actor-b', t(7, 1, 'actor-b'), null, { target: { decisionKey: 't1g7|tit|1|1|1' }, text: 'nota de decisión' });
  const withNotes = fold([...seedEvts, n1, n2]);
  check('J17: note.add — both target shapes accumulate grow-only (no LWW, no deletion)',
    withNotes.notes.length === 2 && withNotes.notes[0].target.verse === '1' && withNotes.notes[1].target.decisionKey.startsWith('t1g7'));
}

// ---------- J18: marries Pankosmia's transport to the journal. Mirrors their PullFromDownloaded
//   choreography (copy pristine → scratch; add editable remote → other actor; merge into scratch;
//   check has_conflicts) exactly. Over DISJOINT per-actor journals it converges with no conflict
//   (so their abort branch never fires); the SAME transport on a shared whole-file same-line edit
//   conflicts (which is what their model aborts on). Proves the journal is what makes concurrent
//   same-book editing work on top of their conflict-free transport. Evidence: docs/evidence/pankosmia-sync-model-2026-07-08.md ----------
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
  const j = (dir, actor, evs) => { const d = path.join(dir, 'ingredients/checking/journal', actor); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'TIT.00001.jsonl'), evs.map((e) => JSON.stringify(mkEvent(e)) + '\n').join('')); };
  const seedLines = [
    { op: 'book.add', actor: 'seed', ts: ts(0, 'seed'), book: 'TIT' },
    { op: 'text.skeleton.set', actor: 'seed', ts: ts(1, 'seed'), book: 'TIT', skeleton, skeletonMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(2, 'seed'), book: 'TIT', chapter: '1', verse: '1', text: 'uno\n', textMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(3, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos\n', textMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(4, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres\n', textMd5: null },
  ];
  const base = path.join(tmp, 'base'); init(base); j(base, 'seed', seedLines); commitAll(base, 'base');
  const downloaded = path.join(tmp, 'downloaded'); cp(base, downloaded);
  j(downloaded, 'actor-a', [{ op: 'text.verse.set', actor: 'actor-a', ts: ts(5, 'actor-a'), base: ts(3, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos (A)\n', textMd5: null }]);
  commitAll(downloaded, 'A-edits-1_2');
  const local = path.join(tmp, 'local'); cp(base, local);
  j(local, 'actor-b', [{ op: 'text.verse.set', actor: 'actor-b', ts: ts(5, 'actor-b'), base: ts(4, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres (B)\n', textMd5: null }]);
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

// ---------- J19: repeat publication without receiving main. A full working projection and a
//   journal-only actor publication history are deliberately separate. The actor publishes A1,
//   main accepts B1 and regenerates, then the actor publishes A2 while still offline from B1.
//   Receiving main rebuilds a replacement working projection instead of merging into the old one. ----------
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
  const journalPath = (dir, actor) => path.join(dir, 'ingredients/checking/journal', actor, 'TIT.00001.jsonl');
  const writeJournal = (dir, actor, events) => {
    const target = journalPath(dir, actor);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, events.map((event) => JSON.stringify(mkEvent(event)) + '\n').join(''));
  };
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
    { op: 'book.add', actor: 'seed', ts: ts(0, 'seed'), book: 'TIT' },
    { op: 'text.skeleton.set', actor: 'seed', ts: ts(1, 'seed'), book: 'TIT', skeleton, skeletonMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(2, 'seed'), book: 'TIT', chapter: '1', verse: '1', text: 'uno\n', textMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(3, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos\n', textMd5: null },
    { op: 'text.verse.set', actor: 'seed', ts: ts(4, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres\n', textMd5: null },
  ];
  const a1 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(5, 'actor-a'), base: ts(3, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A1\n', textMd5: null };
  const a2 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(7, 'actor-a'), base: ts(5, 'actor-a'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A2\n', textMd5: null };
  const b1 = { op: 'text.verse.set', actor: 'actor-b', ts: ts(6, 'actor-b'), base: ts(4, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres B1\n', textMd5: null };

  const base = path.join(tmp, 'base'); init(base); writeJournal(base, 'seed', seed); project(base); commitAll(base, 'base');
  const main = path.join(tmp, 'integration-main'); cp(base, main);
  const workingA = path.join(tmp, 'working-a'); cp(base, workingA);
  const pubA = path.join(tmp, 'publication-a'); cp(base, pubA); git('checkout -qb actor-a', pubA);
  const pubB = path.join(tmp, 'publication-b'); cp(base, pubB); git('checkout -qb actor-b', pubB);

  // A1 is a full local checkpoint, then mirrored into A's publication history as a journal-only delta.
  writeJournal(workingA, 'actor-a', [a1]); project(workingA); commitAll(workingA, 'A1 full working checkpoint');
  writeJournal(pubA, 'actor-a', [a1]); commitAll(pubA, 'publish A1');
  const pubA1 = git('rev-parse HEAD', pubA).trim();
  const a1Paths = git('diff --name-only HEAD^ HEAD', pubA).trim().split('\n').filter(Boolean);
  const iA1 = integrate(main, pubA, 'actor-a', 'a1');

  // B submits while A remains offline from main.
  writeJournal(pubB, 'actor-b', [b1]); commitAll(pubB, 'publish B1');
  const b1Paths = git('diff --name-only HEAD^ HEAD', pubB).trim().split('\n').filter(Boolean);
  const iB1 = integrate(main, pubB, 'actor-b', 'b1');

  // A continues from A1 without receiving B1. Its working projection diverges, but publication does not.
  writeJournal(workingA, 'actor-a', [a1, a2]); project(workingA); commitAll(workingA, 'A2 full working checkpoint while offline');
  writeJournal(pubA, 'actor-a', [a1, a2]); commitAll(pubA, 'publish A2 while offline');
  const a2Paths = git(`diff --name-only ${pubA1} HEAD`, pubA).trim().split('\n').filter(Boolean);

  check('J19: actor publication commits change only their owned journal paths',
    deepEq(a1Paths, ['ingredients/checking/journal/actor-a/TIT.00001.jsonl']) &&
    deepEq(a2Paths, ['ingredients/checking/journal/actor-a/TIT.00001.jsonl']) &&
    deepEq(b1Paths, ['ingredients/checking/journal/actor-b/TIT.00001.jsonl']));
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
//   non-journal changes, edits to another actor's stream, and truncation/rewrite of accepted bytes. ----------
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
      if (a && rel.endsWith('.jsonl') && !b.subarray(0, a.length).equals(a)) errors.push(`not-append-only:${rel}`);
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

  const base = path.join(tmp, 'base'); init(base);
  write(base, 'ingredients/checking/journal/seed/TIT.00001.jsonl', 'seed\n');
  write(base, 'ingredients/checking/journal/actor-a/TIT.00001.jsonl', 'A1\n');
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
  write(badHistory, 'ingredients/checking/journal/actor-a/TIT.00001.jsonl', 'A0-rewrite\n');
  write(badHistory, 'ingredients/checking/journal/seed/TIT.00001.jsonl', 'seed\nforged\n');
  commitAll(badHistory, 'rewrite accepted history');
  const historyScratch = mergeToScratch(base, badHistory, 'actor-a', 'history');
  const historyErrors = validateIntake(base, historyScratch, 'actor-a');
  check('J20: intake rejects truncation/rewrite and foreign-actor edits; accepted main remains byte-identical',
    historyErrors.some((e) => e.startsWith('not-append-only:')) &&
    historyErrors.some((e) => e.startsWith('foreign-actor:')) &&
    git('rev-parse HEAD', base).trim() === mainHead && fs.readFileSync(path.join(base, 'ingredients/TIT.usfm'), 'utf8') === mainProjection,
    JSON.stringify(historyErrors));

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nJournal suite: ${pass} passed, ${fail} failed (fast-check seed ${SEED})`);
process.exit(fail ? 1 : 0);
