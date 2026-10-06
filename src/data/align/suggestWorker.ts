// suggestWorker.ts — the answering half of the suggestion engine (#1, D72
// point 3; #516, D93).
//
// The aligner's hands must never stop (the save-latency ruling behind #100),
// so the engine lives off the main thread, one model per testament. This
// worker holds the models and answers; it never trains. Training is minutes of
// uninterruptible work and has its own worker (suggestTrainWorker.ts), so a
// Suggest is answered at once by the model this worker holds while a retrain
// runs there.
//
// The memory belongs to this worker and only grows. A `load` gives it the
// project's aligned verses; an `append` gives it one confirmed save (~0.14 ms)
// and the next `suggest` sees it. A verse already in the memory is skipped by
// a `load` — the save that put it there is newer than the project's copy — so
// a save can never be lost to a load. A `booster` attaches a fitted booster to
// the standing memory (attachBooster); it never replaces the memory.
//
// Protocol (main → worker):
//   { type: 'load',    id, testament, verses: TrainingVerse[] }
//   { type: 'append',  id, testament, verse: TrainingVerse }
//   { type: 'booster', id, testament, model: PackedModel }
//   { type: 'suggest', id, testament, input: SessionInput, ref, session }
// (worker → main):
//   { type: 'memory',      id, testament, verses, boosted, saved }  — verses = in memory; saved = the reply to an `append`
//   { type: 'suggestions', id, testament, links: RawLink[], ref, session }
//   { type: 'error',       id, message }
// A 'suggest' for a testament with no model answers with no links.
import { appendVerse, attachBooster, emptyModel, predictLinks, type PackedModel, type TrainedModel } from './suggestEngine';
import type { SessionInput, Testament, TrainingVerse } from './suggest';

export type WorkerRequest =
  | { type: 'load'; id: number; testament: Testament; verses: TrainingVerse[] }
  | { type: 'append'; id: number; testament: Testament; verse: TrainingVerse }
  | { type: 'booster'; id: number; testament: Testament; model: PackedModel }
  | { type: 'suggest'; id: number; testament: Testament; input: SessionInput; ref: string; session: number };

export type WorkerReply =
  | { type: 'memory'; id: number; testament: Testament; verses: number; boosted: boolean; saved: boolean }
  /** `ref` and `session` echo the request, so the main thread applies the
   * answer only to the verse and session that asked (Codex round 1). */
  | { type: 'suggestions'; id: number; testament: Testament; links: ReturnType<typeof predictLinks>; ref: string; session: number }
  | { type: 'error'; id: number; message: string };

const models: Partial<Record<Testament, TrainedModel>> = {};
/** The refs each memory holds: a re-saved verse appends its current links
 * but is counted once, and a `load` skips them. */
const seenRefs: Partial<Record<Testament, Set<string>>> = {};

const add = (testament: Testament, verse: TrainingVerse) => {
  const refs = (seenRefs[testament] ??= new Set());
  const isNew = !refs.has(verse.ref);
  refs.add(verse.ref);
  models[testament] = appendVerse(models[testament] ?? emptyModel(testament), verse, isNew);
};

/** The worker's one step, exported so the unit tests drive it without a Worker. */
export const handle = async (req: WorkerRequest): Promise<WorkerReply> => {
  try {
    if (req.type === 'suggest') {
      const trained = models[req.testament];
      const links = trained ? predictLinks(trained, req.input) : [];
      return { type: 'suggestions', id: req.id, testament: req.testament, links, ref: req.ref, session: req.session };
    }
    if (req.type === 'append') add(req.testament, req.verse);
    else if (req.type === 'load') {
      const refs = seenRefs[req.testament];
      for (const verse of req.verses) if (!refs?.has(verse.ref)) add(req.testament, verse);
    } else models[req.testament] = attachBooster(models[req.testament] ?? emptyModel(req.testament), req.model);
    const model = models[req.testament] ?? emptyModel(req.testament);
    return { type: 'memory', id: req.id, testament: req.testament, verses: model.verses, boosted: !!model.boosted, saved: req.type === 'append' };
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
