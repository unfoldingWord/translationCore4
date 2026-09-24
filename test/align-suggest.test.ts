// #1 — alignment suggestions: the bridge and the engine.
//
// The bridge (suggest.ts) derives the engine's positional view from §5.1
// records plus verse text with the #255 tokenizer, and maps the engine's
// positional answer back to bank words on cards. The engine (suggestEngine.ts,
// wordMAP + uw-wordmapbooster as gatewayEdit uses them) trains on confirmed
// alignments and proposes links for the words still in the bank. Nothing in
// either touches a record: a suggestion is a proposal until linkWord makes it
// a manual link through the same save path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { linksFor, rebindSuggestions, sessionInputFor, trainingVersesFor, targetSeeds } from '../src/data/align/suggest';
import { boundCorpus, predictLinks, trainModel } from '../src/data/align/suggestEngine';
import { handle } from '../src/data/align/suggestWorker';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const G = (text: string, strong: string, lemma: string, morph: string) => ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence: 1, occurrences: 1 });
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const bankWord = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;

// Two Titus verses with real Greek words and Spanish drafts; links by hand.
const V11 = { text: 'Pablo, siervo de Dios', orig: [G('Παῦλος', 'G39720', 'Παῦλος', 'Gr,N,,,,,NMS,'), G('δοῦλος', 'G14010', 'δοῦλος', 'Gr,N,,,,,NMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,')] };
const V14 = { text: 'A Tito, de Dios Padre', orig: [G('Τίτῳ', 'G51030', 'Τίτος', 'Gr,N,,,,,DMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,'), G('Πατρὸς', 'G39620', 'πατήρ', 'Gr,N,,,,,GMS,')] };

const aligned11 = () => {
  let r = bootstrapVerse(V11.text, V11.orig, SOURCE);
  r = linkWord(r, 0, bankWord(r, 'Pablo'));
  r = linkWord(r, 1, bankWord(r, 'siervo'));
  r = linkWord(r, 2, bankWord(r, 'Dios'));
  return stampTargetVerse(r, V11.text);
};
const aligned14 = () => {
  let r = bootstrapVerse(V14.text, V14.orig, SOURCE);
  r = linkWord(r, 0, bankWord(r, 'Tito'));
  r = linkWord(r, 1, bankWord(r, 'Dios'));
  return stampTargetVerse(r, V14.text);
};
const file = (records: Record<string, AlignmentVerseRecord>): AlignmentFile => ({
  schemaVersion: 1,
  book: 'TIT',
  chapters: { '1': records },
});

describe('#1 bridge — the engine sees positions, the editor sees words', () => {
  it('trainingVersesFor takes only verses with a placed word, tokens in verse order, links in positions', () => {
    const f = file({ '1': aligned11(), '2': bootstrapVerse('Sin alinear', V11.orig, SOURCE), '4': aligned14() });
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
    let r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    r = linkWord(r, 2, bankWord(r, 'Padre'));
    const input = sessionInputFor(r, V14.text);
    expect(input.manual).toEqual([{ source: [2], target: [4] }]);
    expect(input.target.map((t) => t.text)).toEqual(['A', 'Tito', 'de', 'Dios', 'Padre']);
  });

  it('linksFor proposes only bank words, each once, on the card of the source position; a placed word is never proposed', () => {
    let r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    r = linkWord(r, 2, bankWord(r, 'Padre'));
    const raw = [
      { source: [1], target: [3], confidence: 0.9 }, // Θεοῦ → Dios (bank)
      { source: [2], target: [4], confidence: 0.8 }, // Πατρὸς → Padre (already placed — dropped)
      { source: [0], target: [1], confidence: 0.7 }, // Τίτῳ → Tito (bank)
      { source: [0], target: [1], confidence: 0.1 }, // duplicate target — dropped
    ];
    const links = linksFor(r, V14.text, raw);
    expect(links.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['1:Dios', '0:Tito']);
    expect(typeof links[0].word.occurrence).toBe('number');
  });

  it('a prediction whose source words sit on two cards is omitted, never truncated to the first card', () => {
    const r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    const raw = [
      { source: [0, 1], target: [1], confidence: 0.9 }, // Τίτῳ+Θεοῦ → Tito: two cards — omitted
      { source: [2], target: [4], confidence: 0.8 }, // Πατρὸς → Padre: one card — kept
    ];
    const links = linksFor(r, V14.text, raw);
    expect(links.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['2:Padre']);
    expect(links[0].source).toEqual({ word: 'Πατρὸς', occurrence: 1 });
  });

  it('rebindSuggestions follows the predicted ORIGINAL word through a split (Codex round 2)', () => {
    // Τίτῳ and Θεοῦ merged into one card; the engine proposes Dios for Θεοῦ.
    const r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    const merged = { ...r, alignments: [{ topWords: [...r.alignments[0].topWords, ...r.alignments[1].topWords], bottomWords: [] }, r.alignments[2]] };
    const links = linksFor(merged, V14.text, [{ source: [1], target: [3], confidence: 0.9 }]); // position 1 = Θεοῦ
    expect(links.map((l) => `${l.cardIndex}:${l.source.word}→${l.word.word}`)).toEqual(['0:Θεοῦ→Dios']);
    // Split the merged card back into Τίτῳ | Θεοῦ: the proposal must sit on Θεοῦ's card (index 1), not Τίτῳ's.
    const rebound = rebindSuggestions(r, links)!;
    expect(rebound.map((l) => `${l.cardIndex}:${l.word.word}`)).toEqual(['1:Dios']);
  });

  it('rebindSuggestions follows a card through a merge and drops a placed word', () => {
    const r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    const links = linksFor(r, V14.text, [
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

  it('targetSeeds is the #255 tokenizer with positions', () => {
    expect(targetSeeds('Pablo, siervo de Dios y de Dios').map((t) => `${t.text}/${t.occurrence}/${t.occurrences}@${t.position}`)).toEqual([
      'Pablo/1/1@0', 'siervo/1/1@1', 'de/1/2@2', 'Dios/1/2@3', 'y/1/1@4', 'de/2/2@5', 'Dios/2/2@6',
    ]);
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

  it('Math.random is the only thing that varies: the same seed trains the same proposals', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    const r = bootstrapVerse('de Dios Padre', [V14.orig[1], V14.orig[2]], SOURCE);
    const once = async () => {
      seedRandom(1);
      return predictLinks(await trainModel('nt', verses), sessionInputFor(r, 'de Dios Padre'));
    };
    expect(await once()).toEqual(await once());
  });

  it('a project with no aligned verses trains nothing and suggests nothing', async () => {
    const trained = await trainModel('nt', []);
    expect(trained.verses).toBe(0);
    const r = bootstrapVerse(V14.text, V14.orig, SOURCE);
    expect(predictLinks(trained, sessionInputFor(r, V14.text))).toEqual([]);
  });

  it('trained on 1:1 and 1:4, it proposes Θεοῦ → Dios for a verse with Dios in the bank', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    const trained = await trainModel('nt', verses);
    expect(trained.verses).toBe(2);
    // A third verse: Θεοῦ Πατρὸς, draft "de Dios Padre", Padre already placed by hand.
    const orig = [V14.orig[1], V14.orig[2]];
    let r = bootstrapVerse('de Dios Padre', orig, SOURCE);
    r = linkWord(r, 1, bankWord(r, 'Padre'));
    const raw = predictLinks(trained, sessionInputFor(r, 'de Dios Padre'));
    const links = linksFor(r, 'de Dios Padre', raw);
    const dios = links.find((l) => l.word.word === 'Dios');
    expect(dios).toBeDefined();
    expect(dios!.cardIndex).toBe(0); // the Θεοῦ card
    expect(links.some((l) => l.word.word === 'Padre')).toBe(false); // placed — never proposed
    // The record is untouched by any of this.
    expect(r.wordBank.map((w) => w.word)).toEqual(['de', 'Dios']);
  });

  it('one aligned verse trains (boost over the whole memory) or says too few — never throws', async () => {
    const f = file({ '1': aligned11() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text });
    const trained = await trainModel('nt', verses);
    expect(trained.verses === 1 || trained.tooFew === true).toBe(true);
    if (trained.verses) {
      const r = bootstrapVerse('de Dios Padre', [V14.orig[1], V14.orig[2]], SOURCE);
      expect(() => predictLinks(trained, sessionInputFor(r, 'de Dios Padre'))).not.toThrow();
    } else {
      expect(predictLinks(trained, sessionInputFor(bootstrapVerse(V14.text, V14.orig, SOURCE), V14.text))).toEqual([]);
    }
  });

  it('boundCorpus drops verses until the summed complexity fits, keeping at least one', () => {
    const big = { ref: 'x', source: new Array(300).fill({ text: 'a', position: 0, occurrence: 1, occurrences: 1 }), target: new Array(300).fill({ text: 'b', position: 0, occurrence: 1, occurrences: 1 }), links: [] };
    expect(boundCorpus([big, big], 100_000)).toHaveLength(1);
    expect(boundCorpus([big], 10)).toHaveLength(1);
  });

  it('every confirmed verse is in the memory; the booster fits the capped share', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    // Force the cap to keep one verse for boosting; the other still joins memory.
    const trained = await trainModel('nt', [...verses, ...verses.map((v) => ({ ...v, ref: `${v.ref}b`, source: new Array(400).fill(v.source[0]).map((s, i) => ({ ...s, position: i })), target: new Array(300).fill(v.target[0]).map((t, i) => ({ ...t, position: i })) }))]);
    expect(trained.verses).toBe(4);
    expect(trained.boosted).toBeLessThan(4);
  });

  it('the worker step: train then suggest per testament; an untrained testament answers with no links', async () => {
    const f = file({ '1': aligned11(), '4': aligned14() });
    const verses = trainingVersesFor('TIT', f, { '1:1': V11.text, '1:4': V14.text });
    const trained = await handle({ type: 'train', id: 1, testament: 'nt', verses });
    expect(trained).toMatchObject({ type: 'trained', id: 1, testament: 'nt', verses: 2 });
    const r = bootstrapVerse('de Dios Padre', [V14.orig[1], V14.orig[2]], SOURCE);
    const nt = await handle({ type: 'suggest', id: 2, testament: 'nt', input: sessionInputFor(r, 'de Dios Padre'), ref: '1:4', session: 7 });
    expect(nt).toMatchObject({ type: 'suggestions', ref: '1:4', session: 7 }); // echoed: the reply binds to its verse and session
    expect((nt as { links: unknown[] }).links.length).toBeGreaterThan(0);
    const ot = await handle({ type: 'suggest', id: 3, testament: 'ot', input: sessionInputFor(r, 'de Dios Padre'), ref: '1:4', session: 7 });
    expect(ot).toMatchObject({ type: 'suggestions', id: 3, links: [] });
  });
});
