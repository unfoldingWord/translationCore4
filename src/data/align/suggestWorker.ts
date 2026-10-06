// suggestWorker.ts — the answering half of the suggestion engine (#1, D72
// point 3; #516, D93).
//
// The aligner's hands must never stop (the save-latency ruling behind #100),
// so the engine lives off the main thread, one model per testament. This
// worker holds the models and answers; it never trains. Training is minutes of
// uninterruptible work and has its own worker (suggestTrainWorker.ts), so a
// Suggest is answered at once by the model this worker holds while a retrain
// runs there. The main thread posts plain objects only (suggest.ts shapes).
//
// #516: a confirmed save arrives as an `append` — the verse joins the model's
// alignment memory at once (~0.14 ms) and the next `suggest` sees it. A save
// that arrives before any model was loaded starts a memory-only model that
// answers from the first verse. A `load` replaces what stands for a testament:
// first the project's verses as a memory-only model, which answers while the
// booster is fitted, then the fitted booster with the verses for its memory.
// The main thread adds to those verses every save it posted since it read the
// corpus, so the model that replaces the old one knows all of them.
//
// Protocol (main → worker):
//   { type: 'load',    id, testament, model: PackedModel, verses: TrainingVerse[] }
//   { type: 'append',  id, testament, verse: TrainingVerse }
//   { type: 'suggest', id, testament, input: SessionInput }
// (worker → main):
//   { type: 'trained',     id, testament, verses, boosted }  — verses = in memory
//   { type: 'appended',    id, testament, verses, boosted }
//   { type: 'suggestions', id, testament, links: RawLink[] }
//   { type: 'error',       id, message }
// A 'suggest' for a testament with no model answers with no links; the main
// thread never renders a proposal from a model that knows nothing.
import { appendVerse, emptyModel, predictLinks, unpackModel, type PackedModel, type TrainedModel } from './suggestEngine';
import type { SessionInput, Testament, TrainingVerse } from './suggest';

export type WorkerRequest =
  | { type: 'load'; id: number; testament: Testament; model: PackedModel; verses: TrainingVerse[] }
  | { type: 'append'; id: number; testament: Testament; verse: TrainingVerse }
  | { type: 'suggest'; id: number; testament: Testament; input: SessionInput; ref: string; session: number };

export type WorkerReply =
  | { type: 'trained'; id: number; testament: Testament; verses: number; boosted: boolean; tooFew?: boolean }
  | { type: 'appended'; id: number; testament: Testament; verses: number; boosted: boolean }
  /** `ref` and `session` echo the request, so the main thread applies the
   * answer only to the verse and session that asked (Codex round 1). */
  | { type: 'suggestions'; id: number; testament: Testament; links: ReturnType<typeof predictLinks>; ref: string; session: number }
  | { type: 'error'; id: number; message: string };

const models: Partial<Record<Testament, TrainedModel>> = {};
/** The refs the model's memory holds — a re-saved verse appends its current
 * links but is counted once (#516). A `load` rebuilds the set from its verses. */
const seenRefs: Partial<Record<Testament, Set<string>>> = {};

/** The worker's one step, exported so the unit tests drive it without a Worker. */
export const handle = async (req: WorkerRequest): Promise<WorkerReply> => {
  try {
    if (req.type === 'load') {
      const model = unpackModel(req.model, req.verses);
      models[req.testament] = model;
      seenRefs[req.testament] = new Set(req.verses.map((v) => v.ref));
      return { type: 'trained', id: req.id, testament: req.testament, verses: model.verses, boosted: !!model.boosted, ...(model.tooFew ? { tooFew: true } : {}) };
    }
    if (req.type === 'append') {
      const refs = (seenRefs[req.testament] ??= new Set());
      const isNew = !refs.has(req.verse.ref);
      refs.add(req.verse.ref);
      const model = appendVerse(models[req.testament] ?? emptyModel(req.testament), req.verse, isNew);
      models[req.testament] = model;
      return { type: 'appended', id: req.id, testament: req.testament, verses: model.verses, boosted: !!model.boosted };
    }
    const trained = models[req.testament];
    const links = trained ? predictLinks(trained, req.input) : [];
    return { type: 'suggestions', id: req.id, testament: req.testament, links, ref: req.ref, session: req.session };
  } catch (e) {
    return { type: 'error', id: req.id, message: String((e as Error)?.message ?? e) };
  }
};

// Inside the worker only — the test import above has no `self.onmessage`.
const scope = globalThis as unknown as { onmessage?: unknown; postMessage?: (m: WorkerReply) => void; importScripts?: unknown };
if (typeof scope.importScripts === 'function' || (typeof scope.postMessage === 'function' && typeof (globalThis as { document?: unknown }).document === 'undefined')) {
  scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    scope.postMessage?.(await handle(event.data));
  };
}
