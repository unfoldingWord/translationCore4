// #516 — the answering worker: a confirmed save joins the memory at once
// (`append`), a save before any model starts a memory-only model that answers
// from the first verse, and a `load` replaces the model with the verses it
// carries. That Suggest is answered while a real training runs is proven with
// two real threads in test/align-suggest-handover.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { sessionInputFor, trainingVerseOf, trainingVersesFor } from '../src/data/align/suggest';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

// The answering worker keeps its models and its seen refs in module state.
// Each test loads a fresh copy of the module, so no test reads what another
// test saved and every test passes alone or in any order.
let handle: typeof import('../src/data/align/suggestWorker').handle;
let handleTrain: typeof import('../src/data/align/suggestTrainWorker').handleTrain;
beforeEach(async () => {
  vi.resetModules();
  ({ handle } = await import('../src/data/align/suggestWorker'));
  ({ handleTrain } = await import('../src/data/align/suggestTrainWorker'));
});

const G = (text: string, strong: string, lemma: string, morph: string) => ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence: 1, occurrences: 1 });
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const bankWord = (r: AlignmentVerseRecord, word: string, occ = 1) =>
  r.wordBank.find((w) => w.word === word && Number(w.occurrence) === occ) as AlignedWord;

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
const suggestOn = (ref: string, orig: typeof V11.orig, text: string, id: number, testament: 'ot' | 'nt' = 'nt') =>
  handle({ type: 'suggest', id, testament, input: sessionInputFor(bootstrapVerse(text, orig, SOURCE), text), ref, session: 1 });

describe('#516 answering worker — saves land at once; a load replaces the model', () => {
  it('a save before any training starts a memory-only model that answers (append → suggest, no train between)', async () => {
    // A fresh worker: no model was trained or loaded for any testament.
    const v = trainingVerseOf('JON 1:1', aligned11(), V11.text)!;
    const appended = await handle({ type: 'append', id: 1, testament: 'ot', verse: v });
    expect(appended).toMatchObject({ type: 'appended', id: 1, testament: 'ot', verses: 1, boosted: false });
    // A second verse that shares the source word Θεοῦ: its target word is
    // proposed from the one saved verse, with no `train` message in between.
    const reply = await suggestOn('JON 1:2', [V14.orig[1], V14.orig[2]], 'de Dios Padre', 2, 'ot');
    expect(reply.type).toBe('suggestions');
    const links = (reply as { links: Array<{ source: number[]; target: number[] }> }).links;
    expect(links.length).toBeGreaterThan(0);
    // Position 0 in this verse's source is Θεοῦ, the shared word; position 1
    // in its target is "Dios", the word the saved verse links it to.
    expect(links.some((l) => l.source.includes(0) && l.target.includes(1))).toBe(true);
  });

  it('a re-saved verse appends its links but is counted once; a new verse counts', async () => {
    const v = trainingVerseOf('JON 1:1', aligned11(), V11.text)!;
    const first = await handle({ type: 'append', id: 1, testament: 'ot', verse: v });
    expect(first).toMatchObject({ type: 'appended', verses: 1 });
    const again = await handle({ type: 'append', id: 2, testament: 'ot', verse: v });
    expect(again).toMatchObject({ type: 'appended', verses: 1 }); // same ref: counted once
    const v2 = trainingVerseOf('JON 1:2', aligned14(), V14.text)!;
    const more = await handle({ type: 'append', id: 3, testament: 'ot', verse: v2 });
    expect(more).toMatchObject({ type: 'appended', verses: 2 });
  });

  it('a load replaces the standing model and the verses it counts; a later save adds to them', async () => {
    const corpus = trainingVersesFor('TIT', file({ '1': aligned11() }), { '1:1': V11.text });
    const v14 = trainingVerseOf('TIT 1:4', aligned14(), V14.text)!;
    // Τίτῳ → Tito (word 1 of "A Tito") is known only from TIT 1:4.
    const knowsTito = async (id: number) => {
      const reply = await suggestOn('TIT 1:9', [V14.orig[0]], 'A Tito', id);
      return (reply as { links: Array<{ source: number[]; target: number[] }> }).links.some((l) => l.source.includes(0) && l.target.includes(1));
    };
    // A model stands: one saved verse, TIT 1:4.
    expect(await handle({ type: 'append', id: 1, testament: 'nt', verse: v14 })).toMatchObject({ type: 'appended', verses: 1 });
    expect(await knowsTito(2)).toBe(true);
    // A load whose verses do not hold TIT 1:4 replaces it; it does not merge into it.
    const fitted = await handleTrain({ type: 'train', id: 10, testament: 'nt', verses: corpus });
    if (fitted.type !== 'fitted') throw new Error(fitted.message);
    const loaded = await handle({ type: 'load', id: 10, testament: 'nt', model: fitted.model, verses: corpus });
    expect(loaded).toMatchObject({ type: 'trained', id: 10, testament: 'nt', verses: 1 });
    expect(await knowsTito(11)).toBe(false);
    // TIT 1:4 is a new verse for the loaded model, then a re-saved one.
    expect(await handle({ type: 'append', id: 12, testament: 'nt', verse: v14 })).toMatchObject({ type: 'appended', verses: 2 });
    expect(await knowsTito(13)).toBe(true);
    expect(await handle({ type: 'append', id: 14, testament: 'nt', verse: v14 })).toMatchObject({ type: 'appended', verses: 2 });
  });
});
