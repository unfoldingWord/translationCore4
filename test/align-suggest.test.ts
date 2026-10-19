// #1 — alignment suggestions: the bridge and the engine.
//
// The bridge (suggest.ts) derives the engine's positional view from §5.1
// records plus verse text with the #255 tokenizer, and maps the engine's
// positional answer back to bank words on cards. The engine (suggestEngine.ts,
// wordMAP + uw-wordmapbooster as gatewayEdit uses them) trains on confirmed
// alignments and proposes links for the words still in the bank. Nothing in
// either touches a record: a suggestion is a proposal until linkWord makes it
// a manual link through the same save path.
//
// #796 slice 2: the bridge reads the verse's WORDS (`verseWords` of the stored slot,
// the list the bank is made of), not the display text. The last two blocks of this
// file are that change: a nested marker and NFD text, where the two lists differ.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decompose } from '../journal/skeleton.mjs';
import { toNfc } from '../journal/grammar.mjs';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { wordTokens } from '../src/data/align/tokenize';
import { verseWords } from '../src/data/align/verseWords.mjs';
import { md5Hex } from '../src/data/httpStore';
import { RETRAIN_BUDGET, crossesRetrainBudget, linksFor, rebindSuggestions, sessionInputFor, targetSeeds, trainingVerseOf, trainingVersesFor } from '../src/data/align/suggest';
import { MIN_BOOST_VERSES, appendVerse, boundCorpus, predictLinks, trainModel } from '../src/data/align/suggestEngine';
import { handle } from '../src/data/align/suggestWorker';
import { __buildAlignmentSessionForTests as buildAlignmentSession } from '../src/state.jsx';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const fs = process.getBuiltinModule('node:fs');

const G = (text: string, strong: string, lemma: string, morph: string) => ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence: 1, occurrences: 1 });
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const bankWord = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;

// Two Titus verses with real Greek words and Spanish drafts; links by hand.
const V11 = { text: 'Pablo, siervo de Dios', orig: [G('Παῦλος', 'G39720', 'Παῦλος', 'Gr,N,,,,,NMS,'), G('δοῦλος', 'G14010', 'δοῦλος', 'Gr,N,,,,,NMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,')] };
const V14 = { text: 'A Tito, de Dios Padre', orig: [G('Τίτῳ', 'G51030', 'Τίτος', 'Gr,N,,,,,DMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,'), G('Πατρὸς', 'G39620', 'πατήρ', 'Gr,N,,,,,GMS,')] };

const aligned11 = () => {
  let r = bootstrapVerse(verseWords(V11.text), V11.orig, SOURCE, md5Hex(V11.text));
  r = linkWord(r, 0, bankWord(r, 'Pablo'));
  r = linkWord(r, 1, bankWord(r, 'siervo'));
  r = linkWord(r, 2, bankWord(r, 'Dios'));
  return stampTargetVerse(r, md5Hex(V11.text));
};
const aligned14 = () => {
  let r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
  r = linkWord(r, 0, bankWord(r, 'Tito'));
  r = linkWord(r, 1, bankWord(r, 'Dios'));
  return stampTargetVerse(r, md5Hex(V14.text));
};
const file = (records: Record<string, AlignmentVerseRecord>): AlignmentFile => ({
  schemaVersion: 1,
  book: 'TIT',
  chapters: { '1': records },
});

describe('#1 bridge — the engine sees positions, the editor sees words', () => {
  it('trainingVersesFor takes only verses with a placed word, tokens in verse order, links in positions', () => {
    const f = file({ '1': aligned11(), '2': bootstrapVerse(verseWords('Sin alinear'), V11.orig, SOURCE, md5Hex('Sin alinear')), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:2': 'Sin alinear', '1:4': V14.text });
    expect(verses.map((v) => v.ref)).toEqual(['TIT 1:1', 'TIT 1:4']);
    const v11 = verses[0];
    expect(v11.source.map((s) => `${s.text}@${s.position}`)).toEqual(['Παῦλος@0', 'δοῦλος@1', 'Θεοῦ@2']);
    expect(v11.source[0].strong).toBe('G39720');
    expect(v11.target.map((t) => `${t.text}@${t.position}`)).toEqual(['Pablo@0', 'siervo@1', 'de@2', 'Dios@3']);
    expect(v11.links).toEqual([{ source: [0], target: [0] }, { source: [1], target: [1] }, { source: [2], target: [3] }]);
  });

  it('a placed word the text no longer holds does not become a training link', () => {
    const f = file({ '1': aligned11() });
    const verses = trainingVersesFor('TIT', f, { '1:1': 'Pablo, esclavo de Dios' }); // "siervo" gone
    expect(verses[0].links).toEqual([{ source: [0], target: [0] }, { source: [2], target: [3] }]);
  });

  it('sessionInputFor carries the placed links as manual context', () => {
    let r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    r = linkWord(r, 2, bankWord(r, 'Padre'));
    const input = sessionInputFor(r, verseWords(V14.text));
    expect(input.manual).toEqual([{ source: [2], target: [4] }]);
    expect(input.target.map((t) => t.text)).toEqual(['A', 'Tito', 'de', 'Dios', 'Padre']);
  });

  it('linksFor proposes only bank words, each once, on the card of the source position; a placed word is never proposed', () => {
    let r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    r = linkWord(r, 2, bankWord(r, 'Padre'));
    const raw = [
      { source: [1], target: [3], confidence: 0.9 }, // Θεοῦ → Dios (bank)
      { source: [2], target: [4], confidence: 0.8 }, // Πατρὸς → Padre (already placed — dropped)
      { source: [0], target: [1], confidence: 0.7 }, // Τίτῳ → Tito (bank)
      { source: [0], target: [1], confidence: 0.1 }, // duplicate target — dropped
    ];
    const links = linksFor(r, verseWords(V14.text), raw);
    expect(links.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['1:Dios', '0:Tito']);
    expect(typeof links[0].word.occurrence).toBe('number');
  });

  it('a prediction whose source words sit on two cards is omitted, never truncated to the first card', () => {
    const r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    const raw = [
      { source: [0, 1], target: [1], confidence: 0.9 }, // Τίτῳ+Θεοῦ → Tito: two cards — omitted
      { source: [2], target: [4], confidence: 0.8 }, // Πατρὸς → Padre: one card — kept
    ];
    const links = linksFor(r, verseWords(V14.text), raw);
    expect(links.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['2:Padre']);
    expect(links[0].source).toEqual({ word: 'Πατρὸς', occurrence: 1 });
  });

  it('rebindSuggestions follows the predicted ORIGINAL word through a split (Codex round 2)', () => {
    // Τίτῳ and Θεοῦ merged into one card; the engine proposes Dios for Θεοῦ.
    const r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    const merged = { ...r, alignments: [{ topWords: [...r.alignments[0].topWords, ...r.alignments[1].topWords], bottomWords: [] }, r.alignments[2]] };
    const links = linksFor(merged, verseWords(V14.text), [{ source: [1], target: [3], confidence: 0.9 }]); // position 1 = Θεοῦ
    expect(links.map((l) => `${l.cardIndex}:${l.source.word}→${l.word.word}`)).toEqual(['0:Θεοῦ→Dios']);
    // Split the merged card back into Τίτῳ | Θεοῦ: the proposal must sit on Θεοῦ's card (index 1), not Τίτῳ's.
    const rebound = rebindSuggestions(r, links)!;
    expect(rebound.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['1:Dios']);
  });

  it('rebindSuggestions follows a card through a merge and drops a placed word', () => {
    const r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    const links = linksFor(r, verseWords(V14.text), [
      { source: [1], target: [3], confidence: 0.9 }, // Θεοῦ → Dios on card 1
      { source: [2], target: [4], confidence: 0.8 }, // Πατρὸς → Padre on card 2
    ]);
    // Merge cards 0 and 1: Θεοῦ is now inside card 0, so its proposal follows it there; Πατρὸς moves to index 1.
    const merged = { ...r, alignments: [{ topWords: [...r.alignments[0].topWords, ...r.alignments[1].topWords], bottomWords: [] }, r.alignments[2]] };
    const rebound = rebindSuggestions(merged, links)!;
    expect(rebound.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['0:Dios', '1:Padre']);
    // Placing Padre by hand spends its proposal; Dios's stands; placing Dios too leaves none → null.
    const placedPadre = linkWord(merged, 1, bankWord(merged, 'Padre'));
    expect(rebindSuggestions(placedPadre, rebound)!.map((l) => l.word.word)).toEqual(['Dios']);
    const placedBoth = linkWord(placedPadre, 0, bankWord(placedPadre, 'Dios'));
    expect(rebindSuggestions(placedBoth, rebound)).toBeNull();
  });

});

describe('#1 engine — trains on confirmed alignments, proposes for the bank, never for an untrained model', () => {
  // The booster is stochastic by design: JLBoost grows each tree on a
  // Math.random feature and split, and training keeps a Math.random sample of
  // the incorrect predictions. Unseeded, about 1 run in 400 proposes Dios
  // inside a phrase that holds the placed Padre, and linksFor drops it (#337).
  // A fixed seed makes every engine case one reproducible run.
  const seedRandom = (seed: number) => {
    let a = seed; // mulberry32, the generator uw-wordmapbooster's JLBoost.js ships (unused there)
    vi.spyOn(Math, 'random').mockImplementation(() => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });
  };
  beforeEach(() => seedRandom(0));
  afterEach(() => vi.restoreAllMocks());

  it('a project with no aligned verses trains nothing and suggests nothing', async () => {
    const trained = await trainModel('nt', []);
    expect(trained.verses).toBe(0);
    const r = bootstrapVerse(verseWords(V14.text), V14.orig, SOURCE, md5Hex(V14.text));
    expect(predictLinks(trained, sessionInputFor(r, verseWords(V14.text)))).toEqual([]);
  });

  it('trained on 1:1 and 1:4, it proposes Θεοῦ → Dios for a verse with Dios in the bank', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    const trained = await trainModel('nt', verses);
    expect(trained.verses).toBe(2);
    // A third verse: Θεοῦ Πατρὸς, draft "de Dios Padre", Padre already placed by hand.
    const orig = [V14.orig[1], V14.orig[2]];
    let r = bootstrapVerse(verseWords('de Dios Padre'), orig, SOURCE, md5Hex('de Dios Padre'));
    r = linkWord(r, 1, bankWord(r, 'Padre'));
    const raw = predictLinks(trained, sessionInputFor(r, verseWords('de Dios Padre')));
    const links = linksFor(r, verseWords('de Dios Padre'), raw);
    const dios = links.find((l) => l.word.word === 'Dios');
    expect(dios).toBeDefined();
    expect(dios!.cardIndex).toBe(0); // the Θεοῦ card
    expect(links.some((l) => l.word.word === 'Padre')).toBe(false); // placed — never proposed
    // The record is untouched by any of this.
    expect(r.wordBank.map((w) => w.word)).toEqual(['de', 'Dios']);
  });

  it('boundCorpus drops verses until the summed complexity fits, keeping at least one', () => {
    const big = { ref: 'x', source: new Array(300).fill({ text: 'a', position: 0, occurrence: 1, occurrences: 1 }), target: new Array(300).fill({ text: 'b', position: 0, occurrence: 1, occurrences: 1 }), links: [] };
    expect(boundCorpus([big, big], 100_000)).toHaveLength(1);
    expect(boundCorpus([big], 10)).toHaveLength(1);
  });

  it('every confirmed verse is in the memory; the booster fits the capped share', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    // Five verses, so the booster is fitted. The cap keeps the three small
    // ones for it; the two oversize ones still join the memory.
    const small = [...verses, { ...verses[0], ref: 'TIT 1:1c' }];
    const trained = await trainModel('nt', [...small, ...verses.map((v) => ({ ...v, ref: `${v.ref}b`, source: new Array(400).fill(v.source[0]).map((s, i) => ({ ...s, position: i })), target: new Array(300).fill(v.target[0]).map((t, i) => ({ ...t, position: i })) }))]);
    expect(trained.verses).toBe(5);
    expect(trained.boosted).toBe(3);
  });

  it('the worker steps: load, then suggest per testament; a testament with no model answers with no links', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    const loaded = await handle({ type: 'load', id: 1, testament: 'nt', verses });
    expect(loaded).toMatchObject({ type: 'memory', id: 1, testament: 'nt', verses: 2 });
    const r = bootstrapVerse(verseWords('de Dios Padre'), [V14.orig[1], V14.orig[2]], SOURCE, md5Hex('de Dios Padre'));
    const nt = await handle({ type: 'suggest', id: 2, testament: 'nt', input: sessionInputFor(r, verseWords('de Dios Padre')), ref: '1:4', session: 7 });
    expect(nt).toMatchObject({ type: 'suggestions', ref: '1:4', session: 7 }); // echoed: the reply binds to its verse and session
    expect((nt as { links: unknown[] }).links.length).toBeGreaterThan(0);
    const ot = await handle({ type: 'suggest', id: 3, testament: 'ot', input: sessionInputFor(r, verseWords('de Dios Padre')), ref: '1:4', session: 7 });
    expect(ot).toMatchObject({ type: 'suggestions', id: 3, links: [] });
  });
});

describe('#516 engine — the memory answers from the first verse; the booster is budgeted, never waited for', () => {
  it('below MIN_BOOST_VERSES the model is memory-only and two aligned verses give at least one proposal', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    expect(verses.length).toBeLessThan(MIN_BOOST_VERSES);
    const trained = await trainModel('nt', verses);
    expect(trained.verses).toBe(2);
    expect(trained.boosted).toBe(0); // no booster fit was attempted
    const r = bootstrapVerse(verseWords('de Dios Padre'), [V14.orig[1], V14.orig[2]], SOURCE, md5Hex('de Dios Padre'));
    const raw = predictLinks(trained, sessionInputFor(r, verseWords('de Dios Padre')));
    const links = linksFor(r, verseWords('de Dios Padre'), raw);
    expect(links.length).toBeGreaterThan(0);
  });

  it('appendVerse puts a confirmed save into the memory at once; a re-save keeps the count', async () => {
    const f = file({ '1': aligned11() });
    const [v11] = trainingVersesFor('TIT', f, { '1:1': V11.text });
    let trained = await trainModel('nt', [v11]);
    expect(trained.verses).toBe(1);
    const v14 = trainingVerseOf('TIT 1:4', aligned14(), verseWords(V14.text))!;
    trained = appendVerse(trained, v14);
    expect(trained.verses).toBe(2);
    // The appended verse answers on the NEXT predict, no training in between:
    // Τίτῳ → Tito exists only in the appended verse's links.
    const r = bootstrapVerse(verseWords('A Tito'), [V14.orig[0]], SOURCE, md5Hex('A Tito'));
    const links = linksFor(r, verseWords('A Tito'), predictLinks(trained, sessionInputFor(r, verseWords('A Tito'))));
    expect(links.some((l) => l.word.word === 'Tito')).toBe(true);
    // A re-save of the same verse appends its current links, counted once.
    trained = appendVerse(trained, v14, false);
    expect(trained.verses).toBe(2);
  });

  it('trainingVerseOf derives one verse, and nothing from a verse with no links', () => {
    expect(trainingVerseOf('TIT 1:1', aligned11(), verseWords(V11.text))).toMatchObject({ ref: 'TIT 1:1' });
    expect(trainingVerseOf('TIT 1:2', bootstrapVerse(verseWords('Sin alinear'), V11.orig, SOURCE, md5Hex('Sin alinear')), verseWords('Sin alinear'))).toBeNull();
    expect(trainingVerseOf('TIT 1:1', aligned11(), verseWords(''))).toBeNull();
    expect(trainingVerseOf('TIT 1:1', aligned11(), null)).toBeNull();
    expect(trainingVerseOf('TIT 1:1', aligned11(), undefined)).toBeNull();
  });

  it('crossesRetrainBudget is true only when a count first reaches a step of the budget', () => {
    // The predicate alone. That the scheduler follows it — eight trainings
    // for 1 100 saves — is test/align-suggest-scheduler.test.ts.
    expect(RETRAIN_BUDGET).toEqual([10, 25, 50, 100, 250, 500, 1000]);
    expect(crossesRetrainBudget(9, 10)).toBe(true);
    expect(crossesRetrainBudget(10, 11)).toBe(false);
    expect(crossesRetrainBudget(8, 12)).toBe(true); // a count that jumps over a step reached it
    expect(crossesRetrainBudget(600, 601)).toBe(false);
    expect(crossesRetrainBudget(999, 1000)).toBe(true);
    expect(crossesRetrainBudget(1000, 1001)).toBe(false); // above the last step: never again
  });
});

// #796 S2 — the engine reads the words the bank holds.
//
// The bank is made of `verseWords(slot)`. The bridge used to split the DISPLAY text
// (`wordTokens`), so on a verse where the two lists differ the engine named a word
// the bank does not hold: `linksFor` found no bank word and "Accept all" did nothing.
// A nested marker (`\add` over `\+nd`) drops words from the display text, and NFD text
// splits one word into two spellings with the wrong counts. The tests here open a real
// session over such a verse and hold the engine's view to the bank's keys.
describe('#796 S2 the suggestions read the verse words, as the bank does', () => {
  const PIN = { testament: 'nt', pin: { repoPath: 'unfoldingWord/el-x-koine_ugnt', version: 'v0.34' }, usfmText: '' };
  const store = () => ({ writeAlignments: vi.fn(), readAlignmentsWithMd5: async () => ({ value: null, md5: 'm1' }) });
  /** A session opened as the app opens it: drafted verse 1:1, no stored record. */
  const open = async (verse: string, orig: unknown[] = V11.orig) => {
    const s = await buildAlignmentSession(store(), null, { book: 'TIT', bookRaw: `\\id TIT test\n\\c 1\n\\p\n\\v 1 ${verse}\n`, project: { scriptDirection: 'ltr' } }, '1:1', PIN, orig);
    expect(s.unavailable).toBeUndefined();
    return s;
  };
  const key = (w: { word?: string; text?: string; occurrence: number | string; occurrences: number | string }) =>
    `${w.word ?? w.text} ${Number(w.occurrence)}/${Number(w.occurrences)}`;

  const NESTED = 'Y \\add el \\+nd Señor\\+nd* dijo\\add* así.';
  const NFD = 'café y café';

  it('a nested marker: the engine target words are the bank keys, in verse order', async () => {
    const s = await open(NESTED);
    expect(s.record.wordBank.map(key)).toEqual(['Y 1/1', 'el 1/1', 'Señor 1/1', 'dijo 1/1', 'así 1/1']);
    const seeds = targetSeeds(s.words);
    expect(seeds.map(key)).toEqual(s.record.wordBank.map(key));
    expect(seeds.map((t) => t.position)).toEqual([0, 1, 2, 3, 4]);
    expect(sessionInputFor(s.record, s.words).target).toEqual(seeds);
  });

  it('a nested marker: an engine link at the position of Señor is the bank word Señor/1', async () => {
    const s = await open(NESTED);
    // The engine says: the first original word goes with target position 2 (Señor).
    const links = linksFor(s.record, s.words, [{ source: [0], target: [2], confidence: 0.9 }]);
    expect(links).toHaveLength(1);
    expect(links[0].cardIndex).toBe(0);
    expect(links[0].word).toBe(s.record.wordBank.find((w: AlignedWord) => w.word === 'Señor'));
    expect(Number(links[0].word.occurrence)).toBe(1);
  });

  it('NFD text: the engine target words are the bank keys, with the counts the export gives', async () => {
    const s = await open(NFD);
    expect(s.record.wordBank.map(key)).toEqual(['café 1/2', 'y 1/1', 'café 2/2']);
    expect(targetSeeds(s.words).map(key)).toEqual(s.record.wordBank.map(key));
    const links = linksFor(s.record, s.words, [{ source: [0], target: [2], confidence: 0.9 }]);
    expect(links.map((l) => key(l.word))).toEqual(['café 2/2']);
  });

  it('end to end: a model trained on a nested verse proposes the nested word in another, and Accept all places it', async () => {
    // Training verse: Θεοῦ is linked to Señor, which sits inside \+nd inside \add.
    const slotA = 'Y \\add el \\+nd Señor\\+nd* dijo\\add*';
    let a = bootstrapVerse(verseWords(slotA), [V14.orig[1]], SOURCE, md5Hex(slotA));
    a = linkWord(a, 0, bankWord(a, 'Señor'));
    const training = trainingVersesFor('TIT', file({ '1': stampTargetVerse(a, md5Hex(slotA)) }), { '1:1': slotA });
    expect(training.map((v) => v.ref)).toEqual(['TIT 1:1']);
    expect(training[0].target.map((t) => t.text)).toEqual(['Y', 'el', 'Señor', 'dijo']);
    expect(training[0].links).toEqual([{ source: [0], target: [2] }]);
    const model = await trainModel('nt', training);
    expect(model.verses).toBe(1);
    // The verse the translator opens: the same Greek word, the name inside the markers again.
    const s = await open('Y \\add el \\+nd Señor\\+nd* habló\\add*', [V14.orig[1]]);
    const links = linksFor(s.record, s.words, predictLinks(model, sessionInputFor(s.record, s.words)));
    const proposed = links.find((l) => l.word.word === 'Señor');
    expect(proposed).toBeDefined();
    // The proposal is a bank word, so the same edit "Accept all" makes places it.
    expect(s.record.wordBank).toContain(proposed!.word);
    const placed = links.reduce((r, l) => linkWord(r, l.cardIndex, l.word), s.record);
    expect(placed.alignments[0].bottomWords.map((w: AlignedWord) => w.word)).toContain('Señor');
  });

  it('the training verse of a stored slot reads the same words: nested marker and NFD', () => {
    const slotNfd = toNfc(NFD) as string;
    const f = file({
      '1': (() => {
        const r = bootstrapVerse(verseWords(NESTED), [V14.orig[1]], SOURCE, md5Hex(NESTED));
        return linkWord(r, 0, bankWord(r, 'Señor'));
      })(),
      '2': (() => {
        const r = bootstrapVerse(verseWords(slotNfd), [V14.orig[1]], SOURCE, md5Hex(slotNfd));
        return linkWord(r, 0, bankWord(r, 'café', 2));
      })(),
    });
    const verses = trainingVersesFor('TIT', f, { '1:1': NESTED, '1:2': slotNfd });
    expect(verses.map((v) => v.target.map(key))).toEqual([
      ['Y 1/1', 'el 1/1', 'Señor 1/1', 'dijo 1/1', 'así 1/1'],
      ['café 1/2', 'y 1/1', 'café 2/2'],
    ]);
    expect(verses.map((v) => v.links)).toEqual([[{ source: [0], target: [2] }], [{ source: [0], target: [2] }]]);
  });

  it('a verse with no slot, or a slot with no words, gives no training verse', () => {
    const r = aligned11();
    expect(trainingVersesFor('TIT', file({ '1': r }), {})).toEqual([]);
    expect(trainingVersesFor('TIT', file({ '1': r }), { '1:1': '' })).toEqual([]);
    expect(trainingVersesFor('TIT', file({ '1': r }), { '1:1': '___' })).toEqual([]);
  });
});

describe('#796 S2 plain verses are unchanged', () => {
  // The drafted verses of the six fixtures that hold no marker: the old seeds (the #255
  // tokenizer over the text) and the new seeds (the verse words) are the same objects.
  const FIXTURES = [
    'conformance/sample-burrito/ingredients/TIT.usfm',
    'conformance/sample-burrito/ingredients/JON.usfm',
    'test/fixtures/usfm-corpus/sample-TIT-draft.usfm',
    'test/fixtures/usfm-corpus/sample-JON-span.usfm',
    'test/fixtures/usfm-corpus/exotic-partial-book.usfm',
    'test/fixtures/usfm-corpus/exotic-poetry-footnotes.usfm',
  ];
  const oldSeeds = (text: string) =>
    wordTokens(text).map((t, i) => ({ text: t.text, position: i, occurrence: t.occurrence, occurrences: t.occurrences }));

  it('targetSeeds(verseWords(text)) deep-equals the seeds the tokenizer made, for every plain drafted verse', () => {
    let plain = 0;
    for (const rel of FIXTURES) {
      const raw: string = fs.readFileSync(`${process.cwd()}/${rel}`, 'utf8');
      for (const [ref, slot] of Object.entries(decompose(toNfc(raw) as string).verses as Record<string, string>)) {
        const text = slot.trim();
        if (text === '' || text === '___' || text.includes('\\')) continue;
        expect(targetSeeds(verseWords(slot)), `${rel} ${ref}`).toEqual(oldSeeds(slot));
        plain++;
      }
    }
    expect(plain).toBe(15); // the 15 marker-free verses of the 23 drafted verses of the six fixtures
  });
});
