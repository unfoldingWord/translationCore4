// suggestTrainWorker.ts — the training half of the suggestion engine (#516, D93).
//
// The booster's fit is one uninterruptible computation [VERIFIED —
// uw-wordmapbooster 1.0.5 dist/boostwordmap_tools.js: add_alignments_2 and
// do_boost_training run JLBoost.train to the end before their promise
// resolves; 2026-10-05]. A worker that trains cannot answer anything else
// until the fit ends. So training has this worker to itself, and
// suggestWorker.ts, which answers Suggest, never trains. This is gatewayEdit's
// arrangement (a training worker beside the model that answers).
//
// Protocol (main → worker):
//   { type: 'train', id, testament, verses: TrainingVerse[] }
// (worker → main):
//   { type: 'fitted', id, testament, model: PackedModel }
//   { type: 'error',  id, message }
// The main thread passes `model` on to suggestWorker.ts as a `booster`; it joins
// the memory that worker already holds.
import { packModel, trainModel, type PackedModel } from './suggestEngine';
import type { Testament, TrainingVerse } from './suggest';

export type TrainRequest = { type: 'train'; id: number; testament: Testament; verses: TrainingVerse[] };

export type TrainReply =
  | { type: 'fitted'; id: number; testament: Testament; model: PackedModel }
  | { type: 'error'; id: number; message: string };

/** The worker's one step, exported so the unit tests drive it without a Worker. */
export const handleTrain = async (req: TrainRequest): Promise<TrainReply> => {
  try {
    return { type: 'fitted', id: req.id, testament: req.testament, model: packModel(await trainModel(req.testament, req.verses)) };
  } catch (e) {
    return { type: 'error', id: req.id, message: String((e as Error)?.message ?? e) };
  }
};

// Inside the worker only — the test import above has no `self.onmessage`.
const scope = globalThis as unknown as { onmessage?: unknown; postMessage?: (m: TrainReply) => void; importScripts?: unknown };
if (typeof scope.importScripts === 'function' || (typeof scope.postMessage === 'function' && typeof (globalThis as { document?: unknown }).document === 'undefined')) {
  scope.onmessage = async (event: MessageEvent<TrainRequest>) => {
    scope.postMessage?.(await handleTrain(event.data));
  };
}
