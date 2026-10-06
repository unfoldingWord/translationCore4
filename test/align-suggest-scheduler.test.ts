// #516 — the suggestion scheduler: when the engine trains, and what answers
// meanwhile (src/data/align/suggestScheduler.ts).
//
// The answering worker's memory only grows and a fitted booster attaches to
// it (D93), so no model is ever replaced. The ways the scheduler can still
// fail, written before the cases:
//    1. Nothing answers until a fit ends: the project's verses are not given
//       to the answering worker as memory at once.
//    2. A save made while the project's verses are read is lost when they
//       load, or counted twice.
//    3. The retrain budget is not followed: 1 100 saves do not give exactly
//       eight trainings (at open and at 10, 25, 50, 100, 250, 500 and 1 000);
//       a step of the testament that is not open retrains; reopening the tool
//       does not retrain.
//    4. A Suggest asked with a waiting save that reaches a budget step loses
//       its answer.
//    5. The row leaves `ready` while a retrain runs, or when a fit fails.
//    6. A training asked for while one runs is lost or run twice, or the
//       reply of another training is taken as its own.
//    7. A testament opened while the other testament's booster is fitted has
//       nothing to answer from until that fit ends; or a booster joins the
//       testament that is open when its fit ends, not the one it was fitted for.
//    8. A testament that was asked for is shown from its saves before it was
//       given its memory, so the Align tool asks for nothing.
//    9. The row's count is not the memory's count; a re-saved verse counts twice.
//   10. After the switch goes off, or the project is left, a late read or a
//       late reply still posts or shows something.
//   11. A dead training worker leaves the scheduler waiting forever. (A dead
//       answering worker drops the whole engine: failSuggestEngine, state.jsx.)
//   12. The debounce posts every edit, or posts links the translator removed.
//   13. A failed read of one testament blocks the other testament.
//
// The answering worker here is the real one (`handle` of suggestWorker.ts, a
// fresh module per rig, with the real engine's memory). The training worker
// is a stand-in that answers every `train` with no booster, because a fit is
// minutes; the real fit in a real thread, and a booster attached to the
// memory, are test/align-suggest-handover.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { bootstrapVerse, linkWord, stampTargetVerse } from '../src/data/align/edit';
import { RETRAIN_BUDGET, sessionInputFor, trainingVerseOf, type Testament, type TrainingVerse } from '../src/data/align/suggest';
import { SuggestScheduler, type SuggestRow } from '../src/data/align/suggestScheduler';
import type { TrainRequest } from '../src/data/align/suggestTrainWorker';
import type { WorkerReply, WorkerRequest } from '../src/data/align/suggestWorker';
import type { AlignedWord, AlignmentVerseRecord } from '../src/data/align/zaln';

const G = (text: string, strong: string, lemma: string, morph: string) => ({ tag: 'w', type: 'word', text, strong, lemma, morph, occurrence: 1, occurrences: 1 });
const SOURCE = 'dcs::unfoldingWord/el-x-koine_ugnt@v0.34';
const bankWord = (r: AlignmentVerseRecord, word: string) => r.wordBank.find((w) => w.word === word) as AlignedWord;
const PAUL = { text: 'Pablo, siervo de Dios', orig: [G('Παῦλος', 'G39720', 'Παῦλος', 'Gr,N,,,,,NMS,'), G('δοῦλος', 'G14010', 'δοῦλος', 'Gr,N,,,,,NMS,'), G('Θεοῦ', 'G23160', 'θεός', 'Gr,N,,,,,GMS,')] };
const TITUS = { text: 'A Tito', orig: [G('Τίτῳ', 'G51030', 'Τίτος', 'Gr,N,,,,,DMS,')] };

/** A saved verse as the app's bridge makes it: Paul's verse, or the one verse
 * that knows Τίτῳ → Tito. */
const verse = (ref: string, titus = false): TrainingVerse => {
  const v = titus ? TITUS : PAUL;
  let r = bootstrapVerse(v.text, v.orig, SOURCE);
  for (const [card, word] of titus ? [[0, 'Tito']] : [[0, 'Pablo'], [1, 'siervo'], [2, 'Dios']]) r = linkWord(r, card as number, bankWord(r, word as string));
  return trainingVerseOf(ref, stampTargetVerse(r, v.text), v.text)!;
};
const verses = (n: number, from = 1) => Array.from({ length: n }, (_, i) => verse(`TIT 1:${from + i}`));
/** A Suggest for a verse whose only original word is Τίτῳ, drafted "A Tito". */
const askTitus = sessionInputFor(bootstrapVerse(TITUS.text, TITUS.orig, SOURCE), TITUS.text);
/** True when the answer links Τίτῳ to "Tito" (word 1). Only a model whose
 * memory holds the Titus verse does; any other model links it to word 0. */
const knowsTito = (reply: { links: Array<{ source: number[]; target: number[] }> }) =>
  reply.links.some((l) => l.source.includes(0) && l.target.includes(1));

/** One scheduler wired to a project (`corpus`: what a read of the aligned
 * verses returns), a real answering worker and a stand-in training worker. */
async function rig(corpus: Partial<Record<Testament, TrainingVerse[]>> = {}) {
  vi.resetModules();
  const { handle } = await import('../src/data/align/suggestWorker');
  let events = 0;
  let answering = Promise.resolve();
  let timers: Array<() => void> = [];
  const r = {
    open: 'nt' as Testament | null,
    corpus: { nt: [], ot: [], ...corpus } as Record<Testament, TrainingVerse[]>,
    rows: [] as SuggestRow[],
    posted: [] as WorkerRequest[],
    trains: [] as TrainRequest[],
    answers: [] as Extract<WorkerReply, { type: 'suggestions' }>[],
    /** Replace to hold a read of the corpus open, or to fail it. */
    read: (t: Testament): Promise<TrainingVerse[]> => Promise.resolve(r.corpus[t].slice()),
    /** True: a fit waits in `fits` until the test ends it. */
    holdFits: false,
    fits: [] as Array<(failed?: boolean) => void>,
    sched: null as unknown as SuggestScheduler,
    /** No message is in flight and nothing new happened. */
    idle: async () => {
      for (let quiet = 0; quiet < 3; ) {
        const before = events;
        await answering;
        await new Promise((done) => setImmediate(done));
        quiet = before === events ? quiet + 1 : 0;
      }
    },
    /** The debounce elapsed. */
    elapse: () => {
      const due = timers;
      timers = [];
      due.forEach((fn) => fn());
    },
    /** A confirmed save, as the app makes it: the project holds the verse (a
     * later read of the corpus returns it) and the scheduler is told. */
    save: async (v: TrainingVerse, testament: Testament = 'nt') => {
      r.corpus[testament] = [...r.corpus[testament].filter((c) => c.ref !== v.ref), v];
      r.sched.save(testament, v.ref, v);
      r.elapse();
      await r.idle();
    },
    /** Timers of the debounce still waiting. */
    pending: () => timers.length,
    row: () => r.rows[r.rows.length - 1],
    statuses: () => r.rows.map((row) => `${row.status}/${row.testament}`),
    kinds: () => r.posted.map((p) => p.type),
  };
  r.sched = new SuggestScheduler({
    testament: () => r.open,
    collect: (t) => r.read(t),
    postAnswer: (request) => {
      r.posted.push(request);
      events++;
      const worker = handle;
      answering = answering.then(async () => {
        r.sched.onAnswerReply(await worker(request));
        events++;
      });
    },
    postTrain: (request) => {
      r.trains.push(request);
      events++;
      const fit = (failed?: boolean) => {
        events++;
        r.sched.onTrainReply(
          failed
            ? { type: 'error', id: request.id, message: 'the fit failed' }
            : { type: 'fitted', id: request.id, testament: request.testament, model: { testament: request.testament, boosted: 0, booster: null } },
        );
      };
      if (r.holdFits) r.fits.push(fit);
      else setImmediate(fit);
    },
    onRow: (row) => r.rows.push(row),
    onSuggestions: (reply) => r.answers.push(reply),
    clock: {
      setTimeout: (fn) => {
        timers.push(fn);
        return fn;
      },
      clearTimeout: (id) => {
        timers = timers.filter((fn) => fn !== id);
      },
    },
  });
  return r;
}

const appended = (r: Awaited<ReturnType<typeof rig>>) => r.kinds().filter((k) => k === 'append').length;

describe('#516 scheduler — the memory answers at once; the row is what it holds', () => {
  it('the first training reads `reading` while the verses are read, then `ready` with their count; no fit is waited for (1)', async () => {
    const r = await rig({ nt: [...verses(3), verse('TIT 1:4', true)] });
    r.holdFits = true;
    r.sched.train();
    expect(r.row()).toMatchObject({ status: 'reading', testament: 'nt' });
    await r.idle();
    expect(r.fits).toHaveLength(1); // the fit runs
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']);
    expect(r.row()).toMatchObject({ verses: 4, boosted: false, error: null });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
    await r.idle();
    expect(knowsTito(r.answers[0])).toBe(true); // from the project's verses, before any fit ended
    r.fits.shift()!();
    await r.idle();
    expect(r.kinds()).toEqual(['load', 'suggest', 'booster']); // the memory once; the booster joins it
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']);
  });

  it('a save made while the verses are read is kept by the load, with its latest links, and counted once (2, 9)', async () => {
    const r = await rig({ nt: verses(3) });
    let finish: (read: TrainingVerse[]) => void = () => {};
    r.read = () => new Promise((done) => (finish = done));
    r.sched.train();
    // TIT 1:2 is re-saved as the Titus verse; the read below still holds the old one.
    r.sched.save('nt', 'TIT 1:2', { ...verse('TIT 1:2', true), ref: 'TIT 1:2' });
    r.elapse();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1 });
    finish(verses(3));
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 });
    r.sched.suggest('nt', askTitus, '1:9', 1);
    await r.idle();
    expect(knowsTito(r.answers[0])).toBe(true); // the save's links, not the stale copy's
  });

  it('a project with no aligned verse reads `none` and posts no training; its first saved verse reads `ready`, 1 verse', async () => {
    const r = await rig();
    r.sched.train();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'none', verses: 0 });
    expect(r.trains).toHaveLength(0);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false); // nothing answers yet
    await r.save(verse('TIT 1:4', true));
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1 });
    expect(r.trains).toHaveLength(0); // an append is not a training
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
    await r.idle();
    expect(knowsTito(r.answers[0])).toBe(true);
  });

  it('the count is the memory count: a new verse adds one, a re-saved verse adds none (9)', async () => {
    const r = await rig({ nt: verses(2) });
    r.sched.train();
    await r.idle();
    await r.save(verse('TIT 1:3'));
    expect(r.row().verses).toBe(3);
    await r.save(verse('TIT 1:3'));
    await r.save(verse('TIT 1:1'));
    expect(r.row().verses).toBe(3);
    await r.save(verse('TIT 1:4', true));
    expect(r.row().verses).toBe(4);
  });

  it('a failed read reads `error` only when nothing answers; the next training reads again', async () => {
    const r = await rig();
    let fail: (error: Error) => void = () => {};
    r.read = () => new Promise((_, reject) => (fail = reject));
    r.sched.train();
    await r.save(verse('TIT 1:4', true));
    fail(new Error('the read failed'));
    await r.idle();
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']); // the save answers
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);

    const bare = await rig();
    bare.read = () => Promise.reject(new Error('the read failed'));
    bare.sched.train();
    await bare.idle();
    expect(bare.row()).toMatchObject({ status: 'error', error: 'the read failed' });
    bare.read = () => Promise.resolve(verses(1));
    bare.sched.train();
    await bare.idle();
    expect(bare.row()).toMatchObject({ status: 'ready', verses: 1, error: null });
    expect(bare.kinds().filter((k) => k === 'load')).toHaveLength(1);
  });
});

describe('#516 scheduler — the booster retrains on the budget, never after every save', () => {
  it('1 100 saves after the tool opens post exactly eight trainings: at open, then at 10, 25, 50, 100, 250, 500 and 1 000 verses (3, 5)', async () => {
    expect(RETRAIN_BUDGET).toEqual([10, 25, 50, 100, 250, 500, 1000]);
    const r = await rig({ nt: verses(1) });
    r.sched.train(); // the Align tool opens
    await r.idle();
    for (const v of verses(1100, 2)) await r.save(v);
    expect(r.trains.map((t) => t.verses.length)).toEqual([1, 10, 25, 50, 100, 250, 500, 1000]);
    expect(appended(r)).toBe(1100);
    expect(r.kinds().filter((k) => k === 'load')).toHaveLength(1); // the memory is given once
    expect(r.kinds().filter((k) => k === 'booster')).toHaveLength(8);
    // Once ready the row never left it, and it counted every save once.
    expect(r.statuses().slice(1).every((s) => s === 'ready/nt')).toBe(true);
    expect(r.rows.slice(1).map((row) => row.verses)).toEqual(Array.from({ length: 1101 }, (_, i) => i + 1));
  });

  it('a budget step reached by the testament that is not open trains nothing; that testament trains when it opens (3)', async () => {
    const r = await rig({ nt: verses(2), ot: verses(9).map((v) => ({ ...v, ref: v.ref.replace('TIT', 'JON') })) });
    r.sched.train();
    await r.idle();
    r.open = 'ot';
    r.sched.train(); // the testament changed: the Old Testament model
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 9 });
    r.open = 'nt';
    r.sched.train();
    await r.idle();
    const before = r.trains.length;
    await r.save(verse('JON 1:10'), 'ot'); // the Old Testament memory reaches 10 while Titus is open
    expect(r.trains).toHaveLength(before);
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 2 });
    r.open = 'ot';
    r.sched.train();
    await r.idle();
    expect(r.trains[r.trains.length - 1]).toMatchObject({ testament: 'ot' });
    expect(r.trains[r.trains.length - 1].verses).toHaveLength(10);
  });

  it('opening the tool again trains once more; the row stays `ready` and Suggest answers through it (3, 5)', async () => {
    const r = await rig({ nt: verses(1200) });
    r.sched.train(); // the tool opens
    await r.idle();
    await r.save(verse('TIT 1:1201')); // above the last step: no training
    expect(r.trains).toHaveLength(1);
    r.holdFits = true;
    r.sched.train(); // the tool opens again
    await r.idle();
    expect(r.trains).toHaveLength(2);
    expect(r.trains[1].verses).toHaveLength(1201);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true); // answered while the retrain runs
    await r.idle();
    expect(r.answers).toHaveLength(1);
    r.fits.shift()!();
    await r.idle();
    expect(r.statuses()).toEqual(['reading/nt', ...Array(2).fill('ready/nt')]);
    expect(r.row().verses).toBe(1201);
  });

  it('a failed fit leaves the row `ready` and posts no booster; the next training runs (5)', async () => {
    const r = await rig({ nt: verses(3) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.fits.shift()!(true);
    await r.idle();
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']);
    expect(r.kinds()).not.toContain('booster');
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
    r.sched.train();
    await r.idle();
    expect(r.trains).toHaveLength(2);
  });
});

describe('#516 scheduler — saves, answers and trainings that cross', () => {
  it('a Suggest asked with a waiting save that reaches a budget step gets its answer, and sees that save (4)', async () => {
    const r = await rig({ nt: verses(9) });
    r.sched.train();
    await r.idle();
    const tenth = verse('TIT 1:10', true);
    r.corpus.nt.push(tenth);
    r.sched.save('nt', tenth.ref, tenth); // waits for the debounce
    expect(r.sched.suggest('nt', askTitus, '1:11', 7)).toBe(true); // posts the save first, then asks
    await r.idle();
    expect(r.trains).toHaveLength(2); // the tenth verse reached the first step
    expect(r.answers).toHaveLength(1);
    expect(r.answers[0]).toMatchObject({ ref: '1:11', session: 7 });
    expect(knowsTito(r.answers[0])).toBe(true); // known only from the tenth verse, posted just before the question
  });

  it('a training asked for while one runs runs once after it; a reply that is not its own is ignored (6)', async () => {
    const r = await rig({ nt: verses(3) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.onTrainReply({ type: 'fitted', id: 9999, testament: 'nt', model: { testament: 'nt', boosted: 0, booster: null } });
    r.sched.train(); // asked for while the first fit runs
    r.sched.train();
    await r.idle();
    expect(r.trains).toHaveLength(1); // the stray reply did not end the training
    expect(r.kinds()).not.toContain('booster');
    r.fits.shift()!();
    await r.idle();
    expect(r.trains).toHaveLength(2); // asked twice, run once
    r.fits.shift()!();
    await r.idle();
    expect(r.trains).toHaveLength(2);
    expect(r.kinds().filter((k) => k === 'booster')).toHaveLength(2);
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']);
  });

  it('a testament opened while the other testament is fitted answers from its memory at once; its training follows (7)', async () => {
    const jonah = verses(4).map((v) => ({ ...v, ref: v.ref.replace('TIT', 'JON') }));
    const r = await rig({ nt: verses(3), ot: jonah });
    r.holdFits = true;
    r.sched.train(); // the New Testament fit runs
    await r.idle();
    r.open = 'ot';
    r.sched.train(); // the book changed to Jonah: its training waits for the fit, its memory does not
    expect(r.row()).toMatchObject({ status: 'reading', testament: 'ot' });
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 4 });
    expect(r.sched.suggest('ot', askTitus, '1:2', 1)).toBe(true);
    expect(r.trains.map((t) => t.testament)).toEqual(['nt']);
    r.fits.shift()!();
    await r.idle();
    expect(r.trains.map((t) => `${t.testament}:${t.verses.length}`)).toEqual(['nt:3', 'ot:4']);
    expect(r.kinds().filter((k) => k === 'load')).toHaveLength(2); // each testament's memory once
    r.fits.shift()!();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 4 });
    // Each booster joins the testament it was fitted for: the first fit ended while Jonah was open.
    const boosters = r.posted.filter((p): p is Extract<WorkerRequest, { type: 'booster' }> => p.type === 'booster');
    expect(boosters.map((p) => p.testament)).toEqual(['nt', 'ot']);
  });

  it('a testament is not shown from saves until it is asked for: the tool asks when it opens there (8)', async () => {
    const r = await rig({ nt: verses(30), ot: verses(20).map((v) => ({ ...v, ref: v.ref.replace('TIT', 'JON') })) });
    // The Align tool when it comes on screen: it asks when the row is not its testament's.
    const tool = () => {
      if (r.row()?.testament !== r.open) r.sched.train();
    };
    r.sched.train(); // the tool opens on Titus
    await r.idle();
    r.open = 'ot';
    await r.save(verse('JON 1:21', true), 'ot'); // one verse of Jonah is saved before the tool asks
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 30 }); // no Old Testament row from one save
    tool();
    await r.idle();
    expect(r.trains.map((t) => `${t.testament}:${t.verses.length}`)).toEqual(['nt:30', 'ot:21']); // the save is in the project too
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 21 });
  });

  it('a failed read of one testament does not block the other: going back to it reads `ready` and answers (13)', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.open = 'ot';
    r.read = (t) => (t === 'ot' ? Promise.reject(new Error('the read failed')) : Promise.resolve(r.corpus[t].slice()));
    r.sched.train();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'error', testament: 'ot' });
    r.open = 'nt';
    r.sched.train(); // the Align tool asks again on Titus
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 3 });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
  });

  it('a failed request shows as the error of the row until the next good reply', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.sched.onAnswerReply({ type: 'error', id: 9999, message: 'the append failed' });
    expect(r.row()).toMatchObject({ status: 'error', error: 'the append failed' });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false);
    await r.save(verse('TIT 1:4')); // the next good reply
    expect(r.row()).toMatchObject({ status: 'ready', verses: 4, error: null });
  });
});

describe('#516 scheduler — the engine is dropped, or a worker dies', () => {
  it('after dispose nothing is posted or shown, whatever arrives later (10)', async () => {
    const r = await rig({ nt: verses(3) });
    let finish: (read: TrainingVerse[]) => void = () => {};
    r.read = () => new Promise((done) => (finish = done));
    r.sched.train();
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4'));
    const shown = r.rows.length;
    r.sched.dispose(); // the switch went off, or the project was left
    r.elapse();
    finish(verses(3));
    await r.idle();
    r.sched.train();
    r.sched.save('nt', 'TIT 1:5', verse('TIT 1:5'));
    r.elapse();
    r.sched.onAnswerReply({ type: 'memory', id: 1, testament: 'nt', verses: 5, boosted: false, saved: true });
    r.sched.onTrainReply({ type: 'fitted', id: 1, testament: 'nt', model: { testament: 'nt', boosted: 0, booster: null } });
    await r.idle();
    expect(r.posted).toHaveLength(0);
    expect(r.trains).toHaveLength(0);
    expect(r.rows).toHaveLength(shown);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false);
  });

  it('the training worker died: the memory keeps answering, and the next training runs (11)', async () => {
    const r = await rig({ nt: verses(3) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.trainWorkerFailed();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 });
    r.holdFits = false;
    r.sched.train();
    await r.idle();
    expect(r.trains).toHaveLength(2);
    expect(r.statuses()).toEqual(['reading/nt', 'ready/nt']);
  });
});

describe('#516 scheduler — a saved verse waits for its edits to settle (12)', () => {
  it('edits of one verse post one append with the latest links; a save of another verse posts the first at once', async () => {
    const r = await rig({ nt: verses(2) });
    r.sched.train();
    await r.idle();
    const first = verse('TIT 1:3');
    const latest = { ...verse('TIT 1:3', true), ref: 'TIT 1:3' };
    r.sched.save('nt', 'TIT 1:3', first);
    r.sched.save('nt', 'TIT 1:3', latest);
    expect(r.pending()).toBe(1); // the first edit's timer was cleared
    await r.idle();
    expect(appended(r)).toBe(0); // still waiting
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4')); // another verse: TIT 1:3 is posted now
    await r.idle();
    const appends = r.posted.filter((p): p is Extract<WorkerRequest, { type: 'append' }> => p.type === 'append');
    expect(appends.map((p) => p.verse)).toEqual([latest]);
    r.elapse();
    await r.idle();
    expect(appended(r)).toBe(2);
    expect(r.row().verses).toBe(4);
  });

  it('a save that leaves the verse with no links posts nothing, and drops what was waiting for that verse', async () => {
    const r = await rig({ nt: verses(2) });
    r.sched.train();
    await r.idle();
    r.sched.save('nt', 'TIT 1:3', verse('TIT 1:3'));
    r.sched.save('nt', 'TIT 1:3', null); // every link of TIT 1:3 was removed again
    expect(r.pending()).toBe(0); // its timer went with it
    r.sched.suggest('nt', askTitus, '1:9', 1); // a Suggest flushes what waits: nothing does
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4')); // nor does a save of another verse post it
    r.elapse();
    await r.idle();
    expect(r.posted.filter((p): p is Extract<WorkerRequest, { type: 'append' }> => p.type === 'append').map((p) => p.verse.ref)).toEqual(['TIT 1:4']);
    expect(r.row().verses).toBe(3);
  });
});
