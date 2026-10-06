// #516 — the suggestion scheduler: when the engine trains, and what answers
// meanwhile (src/data/align/suggestScheduler.ts).
//
// The ways it can fail. Items 1 to 14 were found in review of pull request
// #538 by reading the code, when this sequencing lived inside state.jsx and no
// test could run it; items 15 to 17 in the review of this module. The list
// came first; the cases below follow it.
//    1. A Suggest asked with a waiting save that reaches a budget step loses
//       its answer (the retrain made the reply look stale).
//    2. A save during the first read of the corpus is overwritten: the read
//       comes back empty or fails, and the row says `none` or `error` while a
//       memory-only model answers.
//    3. A budget step that the other testament's memory reached retrains the
//       open testament.
//    4. An append's reply is dropped because a training started, so the count
//       stays behind; or a failed append ends a training it does not belong to.
//    5. A save made while the corpus is read, or while the fit runs, is
//       missing from the model that replaces the old one.
//    6. An empty corpus trains an empty model over one that answers; a failed
//       background retrain turns a `ready` row into `error`.
//    7. A training asked for while one runs hides the model that just loaded:
//       the row stays `training`, or keeps an old count.
//    8. A training queued for the other testament hides a testament that
//       already answers.
//    9. Opening the Align tool again does not retrain.
//   10. The retrain budget is not followed: 1 100 saves do not give exactly
//       eight trainings, at open and at 10, 25, 50, 100, 250, 500 and 1 000.
//   11. The row's count is not the memory's count; a re-saved verse counts twice.
//   12. After the switch goes off, or the project is left, a late read or a
//       late reply still posts or shows something.
//   13. A dead worker leaves the scheduler waiting forever.
//   14. The debounce posts every edit, or posts a verse left with no links.
//   15. While the first booster of a session is fitted nothing answers; or a
//       save in that time makes the row count only the verses saved since the
//       tool opened, and the budget is counted on that count.
//   16. A training ends while a book of the other testament is open, and the
//       row is stale when the translator comes back.
//   17. A testament that was asked for but never trained is shown from the
//       verses saved in the session, so the Align tool sees its own row and
//       asks for nothing: it is never given its memory and never trained.
//
// The answering worker here is the real one (`handle` of suggestWorker.ts, a
// fresh module per rig, with the real engine's memory). The training worker
// is a stand-in that answers every `train` with a memory-only model, because
// a booster fit is minutes; the real fit in a real thread is
// test/align-suggest-handover.test.ts.
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
  let { handle } = await import('../src/data/align/suggestWorker');
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
    /** A fresh answering worker, as after the old one died. */
    restartAnswering: async () => {
      vi.resetModules();
      ({ handle } = await import('../src/data/align/suggestWorker'));
    },
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

describe('#516 scheduler — the row is what the answering worker holds for the open testament', () => {
  it('the first training reads `training` while the corpus is read, then `ready` with the count of the corpus', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    expect(r.row()).toMatchObject({ status: 'training', testament: 'nt' });
    await r.idle();
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
    expect(r.row()).toMatchObject({ verses: 3, boosted: false, error: null });
    expect(r.trains.map((t) => t.verses.length)).toEqual([3]);
  });

  it('while the first booster of a testament is fitted, plain wordMAP memory answers from the whole corpus', async () => {
    const r = await rig({ nt: [...verses(3), verse('TIT 1:4', true)] });
    r.holdFits = true;
    r.sched.train(); // the Align tool opens
    await r.idle();
    expect(r.fits).toHaveLength(1); // the fit runs
    expect(r.row()).toMatchObject({ status: 'ready', verses: 4, boosted: false });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
    await r.idle();
    expect(knowsTito(r.answers[0])).toBe(true); // from the corpus, with no save and no fitted model
    r.sched.train(); // the memory's load did not end the training: this one waits for the fit
    await r.idle();
    expect(r.trains).toHaveLength(1);
    r.fits.shift()!();
    await r.idle();
    expect(r.kinds()).toEqual(['load', 'suggest', 'load']); // the memory, then the fitted model in its place
    expect(r.trains).toHaveLength(2);
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
  });

  it('saves during the first fit count on the whole memory: the row never reads 1 verse, and no training is posted for them', async () => {
    const r = await rig({ nt: verses(1200) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    for (const v of verses(10, 1201)) await r.save(v); // ten saves while the first fit runs
    expect(r.rows.map((row) => row.verses)).toEqual([0, ...Array.from({ length: 11 }, (_, i) => 1200 + i)]);
    r.fits.shift()!();
    await r.idle();
    expect(r.trains.map((t) => t.verses.length)).toEqual([1200]); // above the last step: none
    expect(r.fits).toHaveLength(0);
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1210 });
  });

  it('a budget step reached while the first booster is fitted is trained after it', async () => {
    const r = await rig({ nt: verses(9) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    await r.save(verse('TIT 1:10')); // the memory reaches 10 during the first fit
    expect(r.row()).toMatchObject({ status: 'ready', verses: 10 });
    r.fits.shift()!();
    await r.idle();
    expect(r.trains.map((t) => t.verses.length)).toEqual([9, 10]);
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

  it('the count is the memory count: a new verse adds one, a re-saved verse adds none', async () => {
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

  it('a save while the first read of the corpus runs keeps the row `ready` when that read comes back empty', async () => {
    const r = await rig();
    let finish: (read: TrainingVerse[]) => void = () => {};
    r.read = () => new Promise((done) => (finish = done));
    r.sched.train();
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4', true)); // not through r.save: the read below misses it
    r.elapse();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1 });
    finish([]);
    await r.idle();
    // The save rode in the training corpus, and the row never left `ready`.
    expect(r.trains.map((t) => t.verses.map((v) => v.ref))).toEqual([['TIT 1:4']]);
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
    expect(r.row().verses).toBe(1);
  });

  it('a save while the first read runs keeps the row `ready` when that read fails; with no save, a failed read reads `error`', async () => {
    const r = await rig();
    let fail: (error: Error) => void = () => {};
    r.read = () => new Promise((_, reject) => (fail = reject));
    r.sched.train();
    await r.save(verse('TIT 1:4', true));
    fail(new Error('the read failed'));
    await r.idle();
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);

    const bare = await rig();
    bare.read = () => Promise.reject(new Error('the read failed'));
    bare.sched.train();
    await bare.idle();
    expect(bare.row()).toMatchObject({ status: 'error', error: 'the read failed' });
    // A later training starts clean.
    bare.read = () => Promise.resolve(verses(1));
    bare.sched.train();
    await bare.idle();
    expect(bare.row()).toMatchObject({ status: 'ready', verses: 1, error: null });
  });
});

describe('#516 scheduler — the booster retrains on the budget, never after every save', () => {
  it('1 100 saves after the tool opens post exactly eight trainings: at open, then at 10, 25, 50, 100, 250, 500 and 1 000 verses', async () => {
    expect(RETRAIN_BUDGET).toEqual([10, 25, 50, 100, 250, 500, 1000]);
    const r = await rig({ nt: verses(1) });
    r.sched.train(); // the Align tool opens
    await r.idle();
    for (const v of verses(1100, 2)) await r.save(v);
    expect(r.trains.map((t) => t.verses.length)).toEqual([1, 10, 25, 50, 100, 250, 500, 1000]);
    expect(r.kinds().filter((k) => k === 'append')).toHaveLength(1100);
    expect(r.kinds().filter((k) => k === 'load')).toHaveLength(9); // the memory at open, then eight fitted models
    // Once ready the row never left it, and it counted every save once.
    expect(r.statuses().slice(1).every((s) => s === 'ready/nt')).toBe(true);
    expect(r.rows.slice(1).map((row) => row.verses)).toEqual(Array.from({ length: 1101 }, (_, i) => i + 1));
  });

  it('a budget step reached by the testament that is not open trains nothing; that testament trains when it opens', async () => {
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
    await r.save({ ...verse('JON 1:10') }, 'ot'); // the Old Testament memory reaches 10 while Titus is open
    expect(r.trains).toHaveLength(before);
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 2 });
    r.open = 'ot';
    r.sched.train();
    await r.idle();
    expect(r.trains[r.trains.length - 1]).toMatchObject({ testament: 'ot' });
    expect(r.trains[r.trains.length - 1].verses).toHaveLength(10);
  });

  it('opening the tool again trains once more, and the row stays `ready` through it', async () => {
    const r = await rig({ nt: verses(1200) });
    r.sched.train(); // the tool opens
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1200 });
    await r.save(verse('TIT 1:1201')); // above the last step: no training
    expect(r.trains).toHaveLength(1);
    r.holdFits = true;
    r.sched.train(); // the tool opens again
    await r.idle();
    expect(r.trains).toHaveLength(2);
    expect(r.trains[1].verses).toHaveLength(1201);
    expect(r.row()).toMatchObject({ status: 'ready', verses: 1201 });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true); // answered while the retrain runs
    r.fits.shift()!();
    await r.idle();
    expect(r.statuses()).toEqual(['training/nt', ...Array(2).fill('ready/nt')]);
  });
});

describe('#516 scheduler — saves, answers and trainings that cross', () => {
  it('a Suggest asked with a waiting save that reaches a budget step gets its answer, and sees that save', async () => {
    const r = await rig({ nt: verses(9) });
    r.sched.train();
    await r.idle();
    const tenth = verse('TIT 1:10', true);
    r.corpus.nt.push(tenth);
    r.sched.save('nt', tenth.ref, tenth); // waits for the debounce
    expect(r.sched.suggest('nt', askTitus, '1:11', 7)).toBe(true); // posts the save first, then asks
    await r.idle();
    expect(r.kinds().slice(-3)).toEqual(['append', 'suggest', 'load']);
    expect(r.trains).toHaveLength(2); // the tenth verse reached the first step
    expect(r.answers).toHaveLength(1);
    expect(r.answers[0]).toMatchObject({ ref: '1:11', session: 7 });
    expect(knowsTito(r.answers[0])).toBe(true); // known only from the tenth verse, posted just before the question
  });

  it('a save made while the fit runs is in the model that replaces the old one', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.sched.suggest('nt', askTitus, '1:9', 1);
    await r.idle();
    expect(knowsTito(r.answers[0])).toBe(false); // control: no model knows Tito yet
    r.holdFits = true;
    r.sched.train();
    await r.idle(); // the corpus is read; the fit runs
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4', true)); // not through r.save: the corpus was read before it
    r.elapse();
    await r.idle();
    expect(r.row().verses).toBe(4);
    r.fits.shift()!();
    await r.idle();
    const load = r.posted.filter((p) => p.type === 'load').pop() as Extract<WorkerRequest, { type: 'load' }>;
    expect(load.verses.map((v) => v.ref)).toEqual(['TIT 1:1', 'TIT 1:2', 'TIT 1:3', 'TIT 1:4']);
    expect(r.row()).toMatchObject({ status: 'ready', verses: 4 });
    r.sched.suggest('nt', askTitus, '1:9', 2);
    await r.idle();
    expect(knowsTito(r.answers[1])).toBe(true); // the model that replaced the old one holds the save
  });

  it('a save made while the corpus is read is in the training corpus, with its latest links', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    let finish: (read: TrainingVerse[]) => void = () => {};
    const stale = r.corpus.nt.slice();
    r.read = () => new Promise((done) => (finish = done));
    r.sched.train();
    const resaved = { ...verse('TIT 1:2', true), ref: 'TIT 1:2' };
    r.sched.save('nt', 'TIT 1:2', resaved);
    r.elapse();
    await r.idle();
    finish(stale); // the read holds TIT 1:2 as it was before the save
    await r.idle();
    const trained = r.trains[1].verses;
    expect(trained.map((v) => v.ref).sort()).toEqual(['TIT 1:1', 'TIT 1:2', 'TIT 1:3']);
    expect(trained.find((v) => v.ref === 'TIT 1:2')).toEqual(resaved);
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 });
  });

  it('a training asked for while one runs runs once after it, and the model that just loaded stays shown', async () => {
    const r = await rig({ nt: verses(3) });
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.train(); // asked for while the first fit runs
    r.sched.train();
    r.corpus.nt.push(verse('TIT 1:4'));
    r.fits.shift()!();
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 }); // the loaded model, not `training`
    expect(r.trains).toHaveLength(2); // asked twice, run once
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);
    r.fits.shift()!();
    await r.idle();
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt', 'ready/nt']);
    expect(r.row().verses).toBe(4);
    expect(r.trains).toHaveLength(2);
  });

  it('a training that ends while a book of the other testament is open still updates the row it showed', async () => {
    const r = await rig({ nt: verses(30) });
    let finish: (read: TrainingVerse[]) => void = () => {};
    r.read = () => new Promise((done) => (finish = done));
    r.sched.train(); // the Align tool opens on Titus: the corpus is being read
    expect(r.statuses()).toEqual(['training/nt']);
    r.open = 'ot'; // the translator opens Jonah meanwhile; nothing asked to train the Old Testament
    finish(verses(30));
    await r.idle();
    // No row is invented for the Old Testament, and the New Testament row is
    // kept current: back on Titus the Align tool sees its own testament's row
    // and asks for nothing, so this row is what the translator reads.
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 30 });
    r.sched.train(); // the Align tool opens on Jonah: now the Old Testament is asked for
    expect(r.row()).toMatchObject({ status: 'training', testament: 'ot' });
  });

  it('a testament that was asked for but never trained is not shown from its saves: the tool asks again when it opens there', async () => {
    const jonah = verses(20).map((v) => ({ ...v, ref: v.ref.replace('TIT', 'JON') }));
    const r = await rig({ nt: verses(30), ot: jonah });
    // The Align tool when it comes on screen: it asks when the row is not its testament's.
    const tool = () => {
      if (r.row()?.testament !== r.open) r.sched.train();
    };
    r.holdFits = true;
    r.sched.train(); // the tool opens on Titus: the New Testament fit runs
    await r.idle();
    r.open = 'ot';
    tool(); // Jonah, and back to the tool: its training waits for the fit
    await r.save(verse('JON 1:21', true), 'ot'); // one verse of Jonah is aligned
    r.open = 'nt';
    tool(); // back on Titus before the fit ends
    r.fits.shift()!(); // the fit ends: the waiting training trains the open testament, Titus's
    await r.idle();
    r.open = 'ot'; // Jonah is opened in Translate; the tool is not on screen
    r.fits.shift()!(); // the second New Testament fit ends meanwhile
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'nt', verses: 30 }); // no Old Testament row from one save
    tool(); // the tool comes back on Jonah, and asks
    await r.idle();
    expect(r.trains.map((t) => `${t.testament}:${t.verses.length}`)).toEqual(['nt:30', 'nt:30', 'ot:21']);
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 21 });
  });

  it('a training queued for the other testament does not hide a testament that already answers', async () => {
    const r = await rig({ nt: verses(3) });
    r.holdFits = true;
    r.sched.train(); // the New Testament fit runs
    await r.idle();
    r.open = 'ot';
    r.sched.train(); // the book changed to Jonah: queued behind the fit
    expect(r.row()).toMatchObject({ status: 'training', testament: 'ot' });
    await r.save(verse('JON 1:1', true), 'ot'); // a memory-only Old Testament model answers
    expect(r.row()).toMatchObject({ status: 'ready', testament: 'ot', verses: 1 });
    const shown = r.rows.length;
    r.fits.shift()!(); // the New Testament model loads; the queued training starts
    await r.idle();
    expect(r.trains.map((t) => t.testament)).toEqual(['nt', 'ot']);
    expect(r.sched.suggest('ot', askTitus, '1:2', 1)).toBe(true);
    r.fits.shift()!();
    await r.idle();
    expect(r.statuses().slice(shown - 1).every((s) => s === 'ready/ot')).toBe(true);
    expect(r.row().verses).toBe(1);
  });

  it('a failed fit leaves the row `ready`, whether a fitted model or only the memory answers, and the next training runs', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.fits.shift()!(true);
    await r.idle();
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(true);

    const first = await rig({ nt: verses(3) });
    first.holdFits = true;
    first.sched.train();
    await first.idle();
    first.fits.shift()!(true); // the first fit of the session fails
    await first.idle();
    expect(first.row()).toMatchObject({ status: 'ready', verses: 3, boosted: false, error: null });
    first.sched.train(); // the lock was released: a new training runs
    await first.idle();
    expect(first.trains).toHaveLength(2);
  });

  it('a failed request shows as the error of the row until the next good reply, and ends no training', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.sched.onAnswerReply({ type: 'error', id: 9999, message: 'the append failed' });
    expect(r.row()).toMatchObject({ status: 'error', error: 'the append failed' });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false);
    await r.save(verse('TIT 1:4')); // the next good reply
    expect(r.row()).toMatchObject({ status: 'ready', verses: 4, error: null });

    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.onAnswerReply({ type: 'error', id: 9999, message: 'the append failed' });
    // Nor is the training ended by a `trained` reply that is not its own.
    r.sched.onAnswerReply({ type: 'trained', id: 9999, testament: 'nt', verses: 77, boosted: false });
    r.sched.train(); // had either reply ended it, this would start a second fit now
    await r.idle();
    expect(r.trains).toHaveLength(2);
    r.fits.shift()!(); // its own model loads; the training asked for meanwhile follows
    await r.idle();
    expect(r.posted.filter((p) => p.type === 'load')).toHaveLength(3); // the memory, then two fitted models
    expect(r.trains).toHaveLength(3);
    expect(r.row()).toMatchObject({ status: 'ready', verses: 4, error: null });
  });
});

describe('#516 scheduler — the engine is dropped, or a worker dies', () => {
  it('after dispose nothing is posted or shown, whatever arrives later', async () => {
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
    r.sched.onAnswerReply({ type: 'appended', id: 1, testament: 'nt', verses: 5, boosted: false });
    r.sched.onTrainReply({ type: 'fitted', id: 1, testament: 'nt', model: { testament: 'nt', boosted: 0, booster: null } });
    await r.idle();
    expect(r.posted).toHaveLength(0);
    expect(r.trains).toHaveLength(0);
    expect(r.rows).toHaveLength(shown);
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false);
  });

  it('the answering worker died: the row reads `error`, and opening the tool again trains a fresh worker from the project', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4'));
    r.sched.answerWorkerFailed('out of memory');
    await r.restartAnswering();
    expect(r.row()).toMatchObject({ status: 'error', error: 'out of memory', verses: 0 });
    expect(r.sched.suggest('nt', askTitus, '1:9', 1)).toBe(false);
    r.elapse(); // the waiting save died with the worker
    r.fits.shift()!(); // the fit of the dropped training ends: nothing to load into
    await r.idle();
    expect(r.posted.filter((p) => p.type === 'load')).toHaveLength(2);
    r.holdFits = false;
    r.sched.train();
    expect(r.row()).toMatchObject({ status: 'training' });
    await r.idle();
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 });
    expect(r.posted.filter((p) => p.type === 'load')).toHaveLength(4); // the fresh worker got the memory again
  });

  it('the training worker died: a model that answers keeps answering, and the next training runs', async () => {
    const r = await rig({ nt: verses(3) });
    r.sched.train();
    await r.idle();
    r.holdFits = true;
    r.sched.train();
    await r.idle();
    r.sched.trainWorkerFailed('the worker died');
    expect(r.row()).toMatchObject({ status: 'ready', verses: 3 });
    r.holdFits = false;
    r.sched.train();
    await r.idle();
    expect(r.trains).toHaveLength(3);
    expect(r.statuses()).toEqual(['training/nt', 'ready/nt']);
  });
});

describe('#516 scheduler — a saved verse waits for its edits to settle', () => {
  it('edits of one verse post one append with the latest links; a save of another verse posts the first at once', async () => {
    const r = await rig({ nt: verses(2) });
    r.sched.train();
    await r.idle();
    const first = verse('TIT 1:3');
    const latest = { ...verse('TIT 1:3', true), ref: 'TIT 1:3' };
    r.sched.save('nt', 'TIT 1:3', first);
    r.sched.save('nt', 'TIT 1:3', latest);
    await r.idle();
    expect(r.kinds()).toEqual(['load', 'load']); // still waiting
    r.sched.save('nt', 'TIT 1:4', verse('TIT 1:4')); // another verse: TIT 1:3 is posted now
    await r.idle();
    const appends = r.posted.filter((p): p is Extract<WorkerRequest, { type: 'append' }> => p.type === 'append');
    expect(appends.map((p) => p.verse)).toEqual([latest]);
    r.elapse();
    await r.idle();
    expect(r.kinds().filter((k) => k === 'append')).toHaveLength(2);
    expect(r.row().verses).toBe(4);
  });

  it('a save that leaves the verse with no links posts nothing, and drops what was waiting for that verse', async () => {
    const r = await rig({ nt: verses(2) });
    r.sched.train();
    await r.idle();
    r.sched.save('nt', 'TIT 1:3', verse('TIT 1:3'));
    r.sched.save('nt', 'TIT 1:3', null); // every link of TIT 1:3 was removed again
    r.elapse();
    await r.idle();
    expect(r.kinds()).toEqual(['load', 'load']);
    expect(r.row().verses).toBe(2);
  });
});
