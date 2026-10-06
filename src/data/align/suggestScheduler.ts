// SuggestScheduler — when the suggestion engine trains, and what answers
// meanwhile (#516, D93). It sits between the app state and the two workers:
// suggestWorker.ts holds the memory and answers, suggestTrainWorker.ts fits
// the booster. Everything the two need from the app is injected, so this
// module is pure and its sequencing is tested (test/align-suggest-scheduler.test.ts).
//
// The answering worker's memory only grows, and the booster attaches to it.
// No model is ever replaced, so nothing here tracks saves across a training.
//   - What a testament can answer from is what the answering worker last
//     REPORTED for it (`models`). The row is that report, for the testament a
//     training was last asked for: the Align tool asks again when the row is
//     not its testament's.
//   - The first time a testament is asked for, its project verses are read
//     and given to the answering worker as memory (`load`). Plain wordMAP
//     answers from them at once; no fit is waited for.
//   - A confirmed save is posted to the answering worker as an `append` once
//     its edits settle.
//   - One training runs at a time. It trains when the Align tool opens, when
//     the open testament changes, and when the open testament's memory first
//     reaches a step of the retrain budget (suggest.ts). A training asked for
//     while one runs is run once after it. Its booster is posted to the
//     answering worker, which attaches it to the memory it holds.
import type { Clock } from '../saveScheduler';
import { crossesRetrainBudget, type SessionInput, type Testament, type TrainingVerse } from './suggest';
import type { TrainReply, TrainRequest } from './suggestTrainWorker';
import type { WorkerReply, WorkerRequest } from './suggestWorker';

/** The Suggestions row of one testament. `ready` means a model answers:
 * `boosted` says whether a booster is attached or plain wordMAP memory
 * answers, and `verses` is the memory's count. `reading` is the read of the
 * project's verses, before the memory reports. */
export interface SuggestRow {
  status: 'reading' | 'ready' | 'none' | 'error';
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

/** How long a saved verse waits for further edits before it is posted. */
const SETTLE_MS = 3000;

const defaultClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),
};

const messageOf = (e: unknown) => String((e as Error)?.message ?? e);

export class SuggestScheduler {
  private readonly options: SuggestSchedulerOptions;
  private readonly clock: Clock;
  private seq = 0;
  private disposed = false;
  /** What the answering worker holds per testament, as it last reported. */
  private models: Partial<Record<Testament, { verses: number; boosted: boolean }>> = {};
  /** The testaments whose project verses were given to the answering worker. */
  private loaded = new Set<Testament>();
  /** The training in flight: its id guards the reply. */
  private training: { id: number; testament: Testament } | null = null;
  /** A training was asked for while one ran: run once more after it. */
  private again = false;
  /** The saved verse waiting for its edits to settle — one slot. */
  private waiting: { testament: Testament; ref: string; verse: TrainingVerse; timer: unknown } | null = null;
  /** A read or a request failed; cleared by the next good reply or training.
   * A dead answering worker takes the whole engine with it (state.jsx). */
  private fault: string | null = null;
  /** The testament a training was last asked for: the row is this one's. */
  private shownFor: Testament | null = null;
  private shown = '';

  constructor(options: SuggestSchedulerOptions) {
    this.options = options;
    this.clock = options.clock ?? defaultClock;
  }

  /** Train the open testament on the project's aligned verses. Its memory is
   * given first, if it was not; the booster joins it when the fit ends. */
  train(): void {
    const testament = this.options.testament();
    if (this.disposed || !testament) return;
    this.shownFor = testament;
    this.fault = null; // a fault of an earlier read or request: this training reads again
    if (this.training) {
      this.again = true;
      if (!this.loaded.has(testament)) this.read(testament).catch((e) => this.readFailed(testament, e));
      return this.show();
    }
    const training = { id: ++this.seq, testament };
    this.training = training;
    this.show();
    this.read(testament).then(
      (verses) => {
        if (this.training !== training) return;
        if (verses.length) this.options.postTrain({ type: 'train', id: training.id, testament, verses });
        else this.finish(); // no aligned verse: nothing to fit
      },
      (e) => {
        if (this.training !== training) return;
        this.readFailed(testament, e);
        this.finish();
      },
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

  /** A message from the answering worker. A save that first reaches a step
   * of the budget retrains the open testament; the other testament's booster
   * is retrained when its testament next opens. */
  onAnswerReply(reply: WorkerReply): void {
    if (this.disposed) return;
    if (reply.type === 'suggestions') return this.options.onSuggestions(reply);
    if (reply.type === 'error') return this.failed(reply.message);
    const before = this.models[reply.testament]?.verses ?? 0;
    this.models[reply.testament] = { verses: reply.verses, boosted: reply.boosted };
    this.fault = null;
    if (reply.saved && crossesRetrainBudget(before, reply.verses) && reply.testament === this.options.testament()) this.train();
    this.show();
  }

  /** A message from the training worker: the booster of the training in
   * flight goes to the answering worker. A failed fit leaves the memory
   * answering; the next training tries again. */
  onTrainReply(reply: TrainReply): void {
    const training = this.training;
    if (this.disposed || !training || reply.id !== training.id) return;
    if (reply.type === 'fitted') this.options.postAnswer({ type: 'booster', id: ++this.seq, testament: training.testament, model: reply.model });
    this.finish();
  }

  /** The training worker died: the training in flight is over. */
  trainWorkerFailed(): void {
    if (!this.disposed && this.training) this.finish();
  }

  /** The switch went off or the project is being left: nothing more is posted
   * or shown, whatever arrives later. */
  dispose(): void {
    this.disposed = true;
    this.training = null;
    this.again = false;
    this.forget();
  }

  /** Read a testament's verses; the first read of it gives them to the
   * answering worker as memory. A `load` skips verses already in memory, so
   * a second one would be harmless. */
  private async read(testament: Testament): Promise<TrainingVerse[]> {
    const first = !this.loaded.has(testament);
    this.loaded.add(testament);
    try {
      const verses = await this.options.collect(testament);
      if (first && !this.disposed) this.options.postAnswer({ type: 'load', id: ++this.seq, testament, verses });
      return verses;
    } catch (e) {
      if (first) this.loaded.delete(testament);
      throw e;
    }
  }

  private finish(): void {
    this.training = null;
    if (this.again) {
      this.again = false;
      this.train();
    }
    this.show();
  }

  /** A failed read shows as the row's error only when nothing answers for
   * that testament: memory from saves keeps answering. */
  private readFailed(testament: Testament, e: unknown): void {
    if (!this.disposed && !this.models[testament]?.verses) this.failed(messageOf(e));
  }

  private failed(message: string): void {
    this.fault = message;
    this.show();
  }

  private flush(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.forget();
    this.options.postAnswer({ type: 'append', id: ++this.seq, testament: waiting.testament, verse: waiting.verse });
  }

  private forget(): void {
    if (this.waiting) this.clock.clearTimeout(this.waiting.timer);
    this.waiting = null;
  }

  private rowOf(testament: Testament): SuggestRow {
    const row = { testament, verses: 0, boosted: false, error: null };
    if (this.fault) return { ...row, status: 'error', error: this.fault };
    const model = this.models[testament];
    if (!model) return { ...row, status: 'reading' };
    if (!model.verses) return { ...row, status: 'none' };
    return { ...row, status: 'ready', verses: model.verses, boosted: model.boosted };
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
