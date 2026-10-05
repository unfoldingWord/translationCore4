// suggestWorker.ts — the suggestion engine's Web Worker (#1, D72 point 3;
// #516, D93).
//
// Training a wordMAP model over a whole testament's confirmed alignments takes
// seconds to minutes; the aligner's hands must never stop (the save-latency
// ruling behind #100). So the engine lives here, off the main thread, one
// trained model per testament. The main thread posts plain objects only
// (suggest.ts shapes); this file rebuilds the engine's Tokens from them.
//
// #516: a confirmed save arrives as an `append` — the verse joins the model's
// alignment memory at once (~0.14 ms) and the next `suggest` sees it; the
// booster retrains only when the main thread posts a budgeted `train`. While
// a `train` runs, the standing model keeps answering, and every verse appended
// meanwhile is re-applied to the new model before it replaces the old one, so
// no save is lost to the race. A save that arrives before any training ran
// starts a memory-only model that answers from the first verse.
//
// Protocol (main → worker):
//   { type: 'train',   id, testament, verses: TrainingVerse[] }
//   { type: 'append',  id, testament, verse: TrainingVerse }
//   { type: 'suggest', id, testament, input: SessionInput }
// (worker → main):
//   { type: 'trained',     id, testament, verses, boosted }  — verses = in memory
//   { type: 'appended',    id, testament, verses, boosted }
//   { type: 'suggestions', id, testament, links: RawLink[] }
//   { type: 'error',       id, message }
// A 'suggest' for a testament with no model answers with no links; the main
// thread never renders a proposal from a model that knows nothing.
import { appendVerse, emptyModel, predictLinks, trainModel, type TrainedModel } from './suggestEngine';
import type { SessionInput, Testament, TrainingVerse } from './suggest';

export type WorkerRequest =
  | { type: 'train'; id: number; testament: Testament; verses: TrainingVerse[] }
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
 * links but is counted once (#516). A `train` rebuilds the set from its corpus. */
const seenRefs: Partial<Record<Testament, Set<string>>> = {};
/** Verses appended while a `train` is in flight, re-applied to its result. */
const inFlight: Partial<Record<Testament, TrainingVerse[]>> = {};

/** The worker's one step, exported so the unit tests drive it without a Worker. */
export const handle = async (req: WorkerRequest): Promise<WorkerReply> => {
  try {
    if (req.type === 'train') {
      const pending: TrainingVerse[] = [];
      inFlight[req.testament] = pending;
      const trained = await trainModel(req.testament, req.verses);
      if (inFlight[req.testament] === pending) delete inFlight[req.testament];
      const refs = new Set(req.verses.map((v) => v.ref));
      let model = trained;
      // Saves made while this training ran are not in its corpus — the new
      // model must know them before it replaces the one that does (#516).
      for (const v of pending) {
        model = appendVerse(model, v, !refs.has(v.ref));
        refs.add(v.ref);
      }
      models[req.testament] = model;
      seenRefs[req.testament] = refs;
      return { type: 'trained', id: req.id, testament: req.testament, verses: model.verses, boosted: !!model.boosted, ...(model.tooFew ? { tooFew: true } : {}) };
    }
    if (req.type === 'append') {
      const refs = (seenRefs[req.testament] ??= new Set());
      const isNew = !refs.has(req.verse.ref);
      refs.add(req.verse.ref);
      const model = appendVerse(models[req.testament] ?? emptyModel(req.testament), req.verse, isNew);
      models[req.testament] = model;
      inFlight[req.testament]?.push(req.verse);
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
