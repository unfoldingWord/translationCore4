// #516 — the answering worker: a confirmed save joins the memory at once
// (`append`), a save before any model starts a memory-only model that answers
// from the first verse, a `load` adds the project's verses that the memory
// does not hold yet, and a `booster` joins the memory without changing it. That Suggest is answered while a real training runs is proven with
// two real threads in test/align-suggest-handover.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { sessionInputFor, trainingVerseOf, trainingVersesFor } from '../src/data/align/suggest';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';
import { versesOfBook } from './helpers/ult-corpus';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

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

describe('#516 answering worker — saves land at once; the memory only grows', () => {
  it('a save before any training starts a memory-only model that answers (append → suggest, no train between)', async () => {
    // A fresh worker: no model was trained or loaded for any testament.
    const v = trainingVerseOf('JON 1:1', aligned11(), V11.text)!;
    const appended = await handle({ type: 'append', id: 1, testament: 'ot', verse: v });
    expect(appended).toMatchObject({ type: 'memory', id: 1, testament: 'ot', verses: 1, boosted: false, saved: true });
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
    expect(first).toMatchObject({ type: 'memory', verses: 1 });
    const again = await handle({ type: 'append', id: 2, testament: 'ot', verse: v });
    expect(again).toMatchObject({ type: 'memory', verses: 1 }); // same ref: counted once
    const v2 = trainingVerseOf('JON 1:2', aligned14(), V14.text)!;
    const more = await handle({ type: 'append', id: 3, testament: 'ot', verse: v2 });
    expect(more).toMatchObject({ type: 'memory', verses: 2 });
  });

  it('a load keeps a save made before it, adds the verses the memory does not hold, and counts each verse once', async () => {
    // The project's copy of TIT 1:4 knows only Dios; the save of it knows Tito.
    const corpus = trainingVersesFor('TIT', file({ '1': aligned11(), '4': aligned11() }), { '1:1': V11.text, '1:4': V11.text });
    expect(corpus.map((v) => v.ref)).toEqual(['TIT 1:1', 'TIT 1:4']);
    const v14 = trainingVerseOf('TIT 1:4', aligned14(), V14.text)!;
    const knowsTito = async (id: number) => {
      const reply = await suggestOn('TIT 1:9', [V14.orig[0]], 'A Tito', id);
      return (reply as { links: Array<{ source: number[]; target: number[] }> }).links.some((l) => l.source.includes(0) && l.target.includes(1));
    };
    expect(await handle({ type: 'append', id: 1, testament: 'nt', verse: v14 })).toMatchObject({ type: 'memory', verses: 1, saved: true });
    const loaded = await handle({ type: 'load', id: 2, testament: 'nt', verses: corpus });
    expect(loaded).toMatchObject({ type: 'memory', id: 2, testament: 'nt', verses: 2, boosted: false, saved: false });
    expect(await knowsTito(3)).toBe(true); // the save survived the load
    expect(await handle({ type: 'load', id: 4, testament: 'nt', verses: corpus })).toMatchObject({ verses: 2 }); // a second load adds nothing
  });

  it('a booster joins the memory: the count stays, the model reports boosted, and a booster-less fit changes nothing', async () => {
    const titus = versesOfBook('TIT', fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/en_ult/TIT.usfm'), 'utf8'));
    await handle({ type: 'load', id: 1, testament: 'nt', verses: titus.slice(0, 20) });
    const none = await handleTrain({ type: 'train', id: 2, testament: 'nt', verses: titus.slice(0, 3) }); // below five: no booster
    if (none.type !== 'fitted') throw new Error(none.message);
    expect(await handle({ type: 'booster', id: 3, testament: 'nt', model: none.model })).toMatchObject({ type: 'memory', verses: 20, boosted: false });
    const fitted = await handleTrain({ type: 'train', id: 4, testament: 'nt', verses: titus.slice(0, 12) });
    if (fitted.type !== 'fitted') throw new Error(fitted.message);
    expect(await handle({ type: 'booster', id: 5, testament: 'nt', model: fitted.model })).toMatchObject({ type: 'memory', verses: 20, boosted: true, saved: false });
  }, 120_000);
});
