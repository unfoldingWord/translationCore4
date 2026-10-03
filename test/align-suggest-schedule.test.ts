// #516 — the worker's scheduling: a confirmed save joins the memory at once
// (`append`), Suggest is answered while a training is in flight (by the model
// trained before), the new model replaces the old one atomically WITH the
// saves made meanwhile, and a save before any training starts a memory-only
// model that answers from the first verse.
//
// `trainModel` is wrapped with a gate so a test can hold a training open and
// prove the answers that arrive while it is pending — the engine itself is
// real (vi.mock is file-wide, which is why these cases live apart from
// test/align-suggest.test.ts).
import { describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { sessionInputFor, trainingVerseOf, trainingVersesFor } from '../src/data/align/suggest';
import { handle } from '../src/data/align/suggestWorker';
import type { AlignedWord, AlignmentFile, AlignmentVerseRecord } from '../src/data/align/zaln';

const gate = vi.hoisted(() => ({ hold: false, release: () => {}, open: Promise.resolve() }));
vi.mock('../src/data/align/suggestEngine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/align/suggestEngine')>();
  return {
    ...real,
    trainModel: async (...args: Parameters<typeof real.trainModel>) => {
      if (gate.hold) {
        gate.hold = false;
        await gate.open;
      }
      return real.trainModel(...args);
    },
  };
});
/** Arm the gate: the NEXT trainModel call blocks until the returned release. */
const holdNextTraining = () => {
  gate.hold = true;
  gate.open = new Promise<void>((res) => {
    gate.release = res;
  });
  return () => gate.release();
};

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

describe('#516 worker — saves land at once, training never blocks an answer', () => {
  it('a save before any training starts a memory-only model that answers (append → suggest, no train between)', async () => {
    // The OT model: nothing was ever trained for it in this file.
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
    const again = await handle({ type: 'append', id: 3, testament: 'ot', verse: v });
    expect(again).toMatchObject({ type: 'appended', verses: 1 }); // same ref as the test above
    const v2 = trainingVerseOf('JON 1:2', aligned14(), V14.text)!;
    const more = await handle({ type: 'append', id: 4, testament: 'ot', verse: v2 });
    expect(more).toMatchObject({ type: 'appended', verses: 2 });
  });

  it('suggest is answered while a train is in flight, and the new model lands with the saves made meanwhile', async () => {
    // Model A: one verse (Παῦλος→Pablo, δοῦλος→siervo, Θεοῦ→Dios).
    const f = file({ '1': aligned11() });
    const corpus = trainingVersesFor('TIT', f, { '1:1': V11.text });
    await handle({ type: 'train', id: 10, testament: 'nt', verses: corpus });

    // Hold the next training open and start it.
    const release = holdNextTraining();
    let settled = false;
    const training = handle({ type: 'train', id: 11, testament: 'nt', verses: corpus }).then((r) => {
      settled = true;
      return r;
    });

    // While it is pending: Suggest answers from model A.
    const reply = await suggestOn('TIT 1:9', [V14.orig[1], V14.orig[2]], 'de Dios Padre', 12);
    expect(settled).toBe(false); // the answer arrived while the training promise was still pending
    expect(reply.type).toBe('suggestions');
    expect((reply as { links: unknown[] }).links.length).toBeGreaterThan(0);

    // A save lands while the training is still running…
    const v14 = trainingVerseOf('TIT 1:4', aligned14(), V14.text)!;
    const appended = await handle({ type: 'append', id: 13, testament: 'nt', verse: v14 });
    expect(appended).toMatchObject({ type: 'appended', verses: 2 });
    expect(settled).toBe(false);

    // …and the finished training's model knows it: the replacement is atomic
    // and loses no save to the race.
    release();
    const trained = await training;
    expect(trained).toMatchObject({ type: 'trained', id: 11, testament: 'nt', verses: 2 });
    const after = await suggestOn('TIT 1:9', [V14.orig[0]], 'A Tito', 14);
    expect((after as { links: Array<{ target: number[] }> }).links.some((l) => l.target.includes(1))).toBe(true); // Τίτῳ → Tito, from the in-flight save
  });
});
