// SuggestScheduler — when the suggestion engine trains, and what answers
// meanwhile (#516, D93). It sits between the app state and the two workers:
// suggestWorker.ts holds the models and answers, suggestTrainWorker.ts fits
// the booster. Everything the two need from the app is injected, so this
// module is pure and its sequencing is tested (test/align-suggest-scheduler.test.ts).
//
// The rules, one place each:
//   - What a testament can answer from is what the answering worker last
//     REPORTED for it (`models`). The Suggestions row is derived from that,
//     for the testament a training was last asked for. It is kept current
//     whatever book is open meanwhile, and it changes testament only when a
//     training is asked for the other one — which is what makes the Align
//     tool ask (it asks when the row is not its testament's).
//   - The first training of a testament gives the answering worker the
//     project's memory before the fit starts: plain wordMAP answers from the
//     whole corpus while the booster is fitted (D93 point 4), so the
//     translator waits for the read of the corpus. A testament opened while
//     the other one's booster is fitted also waits for that fit (one training
//     at a time); until then it counts only the verses saved since.
//   - Every request takes its own id. A reply is matched to the training in
//     flight by that training's id and by nothing else.
//   - A confirmed save is posted to the answering worker as an `append` once
//     its edits settle; no training is waited for.
//   - One training runs at a time. It trains when the Align tool opens, when
//     the open testament changes, and when the open testament's memory first
//     reaches a step of the retrain budget (suggest.ts). A training asked for
//     while one runs is run once after it.
//   - The corpus is read before the fit, and saves keep arriving during both.
//     Every save posted since the read started is merged into the corpus for
//     the fit and again for the `load` that replaces the answering model, so
//     the new model knows all of them.
import type { Clock } from '../saveScheduler';
import { crossesRetrainBudget, type SessionInput, type Testament, type TrainingVerse } from './suggest';
import type { TrainReply, TrainRequest } from './suggestTrainWorker';
import type { WorkerReply, WorkerRequest } from './suggestWorker';

/** The Suggestions row of one testament. `ready` means a model answers:
 * `boosted` says whether the booster is fitted or plain wordMAP memory
 * answers, and `verses` is the memory's count. `training` is a testament
 * with nothing to answer from yet: its corpus is being read, or its training
 * waits for another one. */
export interface SuggestRow {
  status: 'training' | 'ready' | 'none' | 'error';
  testament: Testament;
  verses: number;
  boosted: boolean;
  error: string | null;
}

export interface SuggestSchedulerOptions {
  /** The testament of the open book, or null when no book is open. */
  testament: () => Testament | null;
  /** Every aligned verse of one testament across the project's books. */
  collect: (testament: Testament) => Promise<TrainingVerse[]>;
  /** Post to the answering worker (suggestWorker.ts). */
  postAnswer: (request: WorkerRequest) => void;
  /** Post to the training worker (suggestTrainWorker.ts). */
  postTrain: (request: TrainRequest) => void;
  /** The row changed. */
  onRow: (row: SuggestRow) => void;
  /** The answering worker's proposals; `ref` and `session` name who asked. */
  onSuggestions: (reply: Extract<WorkerReply, { type: 'suggestions' }>) => void;
  /** Injectable for tests; defaults to the global timers. */
  clock?: Clock;
}

/** One training, from the read of its corpus to the `load` of its model. */
interface Training {
  id: number;
  testament: Testament;
  /** The verses read from the project; null while they are being read. */
  corpus: TrainingVerse[] | null;
  /** Every verse posted to the answering worker since the read started. */
  saves: Map<string, TrainingVerse>;
}

/** How the last training of a testament ended when it left no model. */
type Ended = 'none' | { error: string };

/** How long a saved verse waits for further edits before it is posted. */
const SETTLE_MS = 3000;

const defaultClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),
};

export class SuggestScheduler {
  private readonly options: SuggestSchedulerOptions;
  private readonly clock: Clock;
  private seq = 0;
  private disposed = false;
  /** What the answering worker holds per testament, as it last reported. */
  private models: Partial<Record<Testament, { verses: number; boosted: boolean }>> = {};
  /** The testaments whose project memory the answering worker was given. */
  private given = new Set<Testament>();
  private ended: Partial<Record<Testament, Ended>> = {};
  private training: Training | null = null;
  /** A training was asked for while one ran: run once more after it. */
  private again = false;
  /** The saved verse waiting for its edits to settle — one slot. */
  private waiting: { testament: Testament; ref: string; verse: TrainingVerse; timer: unknown } | null = null;
  /** The answering worker failed outside a training; cleared by its next good reply. */
  private fault: string | null = null;
  /** The testament a training was last asked for: the row is this one's. */
  private shownFor: Testament | null = null;
  private shown = '';

  constructor(options: SuggestSchedulerOptions) {
    this.options = options;
    this.clock = options.clock ?? defaultClock;
  }

  /** Train the open testament on the project's aligned verses. While a model
   * already answers for it the row stays `ready`: the retrain is invisible
   * until its model replaces the old one. */
  train(): void {
    const testament = this.options.testament();
    if (this.disposed || !testament) return;
    this.shownFor = testament;
    if (this.training) {
      this.again = true;
      this.show();
      return;
    }
    const training: Training = { id: ++this.seq, testament, corpus: null, saves: new Map() };
    this.training = training;
    this.fault = null;
    delete this.ended[testament];
    this.show();
    this.options.collect(testament).then(
      (corpus) => this.fit(training, corpus),
      (e) => this.settle(training, { error: String((e as Error)?.message ?? e) }),
    );
  }

  /** A confirmed save of one verse: its current links, or null when the save
   * left it with none. It waits for further edits of the same verse (each one
   * replaces the waiting links) and is posted when they settle, when another
   * verse is saved, or when Suggest asks. */
  save(testament: Testament, ref: string, verse: TrainingVerse | null): void {
    if (this.disposed) return;
    if (this.waiting && this.waiting.ref !== ref) this.flush();
    if (this.waiting) this.clock.clearTimeout(this.waiting.timer);
    this.waiting = verse && { testament, ref, verse, timer: this.clock.setTimeout(() => this.flush(), SETTLE_MS) };
  }

  /** Ask for a verse's proposals. A save still waiting joins the memory
   * first — the worker takes messages in order, so the answer sees it.
   * False when nothing can answer for that testament. */
  suggest(testament: Testament, input: SessionInput, ref: string, session: number): boolean {
    this.flush();
    if (this.disposed || this.fault || !this.models[testament]?.verses) return false;
    this.options.postAnswer({ type: 'suggest', id: ++this.seq, testament, input, ref, session });
    return true;
  }

  /** A message from the answering worker. */
  onAnswerReply(reply: WorkerReply): void {
    if (this.disposed) return;
    if (reply.type === 'suggestions') this.options.onSuggestions(reply);
    else if (reply.type === 'error') this.answerFailed(reply.id, reply.message);
    else if (reply.type === 'appended') this.holds(reply.testament, reply.verses, reply.boosted, true);
    else {
      // A `load` was taken: the project's memory, or the fitted model of the
      // training in flight, which is then over.
      this.holds(reply.testament, reply.verses, reply.boosted, false);
      if (this.training?.id === reply.id) this.settle(this.training);
    }
  }

  /** A message from the training worker. Its fitted model replaces the
   * answering worker's, with every save made since the corpus was read in its
   * memory; the answering worker's `trained` reply then ends the training. */
  onTrainReply(reply: TrainReply): void {
    const training = this.training;
    if (!training || reply.id !== training.id) return;
    if (reply.type === 'error') return this.settle(training, { error: reply.message });
    this.options.postAnswer({ type: 'load', id: training.id, testament: training.testament, model: reply.model, verses: this.corpusOf(training) });
  }

  /** The answering worker died, and its models with it. The training in
   * flight is dropped too: its `load` would never be answered. */
  answerWorkerFailed(message: string): void {
    if (this.disposed) return;
    this.models = {};
    this.given.clear();
    this.training = null;
    this.again = false;
    this.forget();
    this.fault = message;
    this.show();
  }

  /** The training worker died: the training in flight failed. */
  trainWorkerFailed(message: string): void {
    if (this.training) this.settle(this.training, { error: message });
  }

  /** The switch went off or the project is being left: nothing more is posted
   * or shown, whatever arrives later. */
  dispose(): void {
    this.disposed = true;
    this.training = null;
    this.again = false;
    this.forget();
  }

  /** The corpus is read: fit it, unless the project has no aligned verse —
   * an empty model is never trained. A testament's first training gives the
   * answering worker the corpus as its memory first, so it answers while the
   * booster is fitted. */
  private fit(training: Training, corpus: TrainingVerse[]): void {
    if (this.training !== training) return;
    training.corpus = corpus;
    const { id, testament } = training;
    const verses = this.corpusOf(training);
    if (!verses.length) return this.settle(training, 'none');
    if (!this.given.has(testament)) {
      this.given.add(testament);
      this.options.postAnswer({ type: 'load', id: ++this.seq, testament, model: { testament, boosted: 0, booster: null }, verses });
    }
    this.options.postTrain({ type: 'train', id, testament, verses });
  }

  /** The corpus plus every save posted since its read started; the latest
   * save of a verse wins. */
  private corpusOf(training: Training): TrainingVerse[] {
    const read = training.corpus ?? [];
    return [...read.filter((v) => !training.saves.has(v.ref)), ...training.saves.values()];
  }

  /** The training ended, with its model loaded or without one. How it ended
   * matters only to a testament with nothing to answer from: a model that
   * still answers keeps answering. */
  private settle(training: Training, ended?: Ended): void {
    if (this.training !== training) return;
    this.training = null;
    if (ended && !this.models[training.testament]?.verses) this.ended[training.testament] = ended;
    if (this.again) {
      this.again = false;
      this.train();
    }
    this.show();
  }

  /** The answering worker reported what it holds for a testament. A save
   * that first reaches a step of the budget retrains the open testament; the
   * other testament's model is retrained when its testament next opens. */
  private holds(testament: Testament, verses: number, boosted: boolean, saved: boolean): void {
    const before = this.models[testament]?.verses ?? 0;
    this.models[testament] = { verses, boosted };
    this.fault = null;
    if (saved && crossesRetrainBudget(before, verses) && testament === this.options.testament()) this.train();
    this.show();
  }

  /** An `error` reply: a failed `load` ends its training and the model before
   * it still stands (the worker replaces a model only on success). Any other
   * failed request shows as the row's error. */
  private answerFailed(id: number, message: string): void {
    if (this.training?.id === id) return this.settle(this.training, { error: message });
    this.fault = message;
    this.show();
  }

  private flush(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.forget();
    if (this.training?.testament === waiting.testament) this.training.saves.set(waiting.ref, waiting.verse);
    this.options.postAnswer({ type: 'append', id: ++this.seq, testament: waiting.testament, verse: waiting.verse });
  }

  private forget(): void {
    if (this.waiting) this.clock.clearTimeout(this.waiting.timer);
    this.waiting = null;
  }

  /** The row of a testament that a training was asked for. */
  private rowOf(testament: Testament): SuggestRow {
    const row = { testament, verses: 0, boosted: false, error: null };
    if (this.fault) return { ...row, status: 'error', error: this.fault };
    const model = this.models[testament];
    if (model?.verses) return { ...row, status: 'ready', verses: model.verses, boosted: model.boosted };
    const ended = this.ended[testament];
    if (ended === 'none') return { ...row, status: 'none' };
    if (ended) return { ...row, status: 'error', error: ended.error };
    return { ...row, status: 'training' }; // its training runs, or waits for the one that does
  }

  private show(): void {
    if (this.disposed || !this.shownFor) return;
    const row = this.rowOf(this.shownFor);
    const key = JSON.stringify(row);
    if (key === this.shown) return;
    this.shown = key;
    this.options.onRow(row);
  }
}
