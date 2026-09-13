// suggestWorker.ts — the suggestion engine's Web Worker (#1, D72 point 3).
//
// Training a wordMAP model over a whole testament's confirmed alignments takes
// seconds to minutes; the aligner's hands must never stop (the save-latency
// ruling behind #100). So the engine lives here, off the main thread, one
// trained model per testament. The main thread posts plain objects only
// (suggest.ts shapes); this file rebuilds the engine's Tokens from them.
//
// Protocol (main → worker):
//   { type: 'train',   id, testament, verses: TrainingVerse[] }
//   { type: 'suggest', id, testament, input: SessionInput }
// (worker → main):
//   { type: 'trained',     id, testament, verses }      — verses = trained after the cap
//   { type: 'suggestions', id, testament, links: RawLink[] }
//   { type: 'error',       id, message }
// A 'suggest' for a testament with no trained model answers with no links;
// the main thread never renders a proposal from an untrained model.
import { predictLinks, trainModel, type TrainedModel } from './suggestEngine';
import type { SessionInput, Testament, TrainingVerse } from './suggest';

export type WorkerRequest =
  | { type: 'train'; id: number; testament: Testament; verses: TrainingVerse[] }
  | { type: 'suggest'; id: number; testament: Testament; input: SessionInput };

export type WorkerReply =
  | { type: 'trained'; id: number; testament: Testament; verses: number; tooFew?: boolean }
  | { type: 'suggestions'; id: number; testament: Testament; links: ReturnType<typeof predictLinks> }
  | { type: 'error'; id: number; message: string };

const models: Partial<Record<Testament, TrainedModel>> = {};

/** The worker's one step, exported so the unit tests drive it without a Worker. */
export const handle = async (req: WorkerRequest): Promise<WorkerReply> => {
  try {
    if (req.type === 'train') {
      const trained = await trainModel(req.testament, req.verses);
      models[req.testament] = trained;
      return { type: 'trained', id: req.id, testament: req.testament, verses: trained.verses, ...(trained.tooFew ? { tooFew: true } : {}) };
    }
    const trained = models[req.testament];
    const links = trained ? predictLinks(trained, req.input) : [];
    return { type: 'suggestions', id: req.id, testament: req.testament, links };
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
