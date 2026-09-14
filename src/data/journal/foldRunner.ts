// foldRunner.ts — where the §8.6 fold executes (issue #94).
//
// `fold()` is a pure function of the event set, so it can run anywhere. On the
// browser's main thread it FREEZES the interface for its duration (issue #80:
// ~0.7 s for an aligned NT, 9.3 s for a checked whole Bible); the scoped fold
// (#93) shrank that, this module moves it off the thread. The store asks a
// FoldRunner for the fold and awaits it; in the browser that is a Web Worker,
// in Node (vitest, the conformance suite) it is the same function inline.
//
// The worker holds a MIRROR of the store's event set: the store's array only
// ever grows in place between folds (publish, reconcile) or is replaced whole
// (open, replay, seed), so a fold posts either the appended tail or the whole
// set — never the whole set on every save. Messages are answered in order,
// so the mirror is always the set the reply was folded from.
import type { JournalEvent } from './seal';
import { fold, type FoldOutput } from './runtime';

export interface FoldRunner {
  /** The fold of exactly `events`. Rejects with the fold's own refusal. */
  fold(events: JournalEvent[]): Promise<FoldOutput>;
  /** Release the thread this runner holds (a no-op inline). */
  dispose(): void;
}

/** The fold on the calling thread — Node, tests, and any host without Workers. */
export const inlineFoldRunner = (): FoldRunner => ({
  fold: async (events) => fold(events),
  dispose: () => {},
});

/** What the store posts. `events` replaces the mirror; `append` extends it. */
export type FoldRequest = { id: number; events: JournalEvent[] } | { id: number; append: JournalEvent[] };
export type FoldReply = { id: number; result: FoldOutput } | { id: number; error: string };

/** The subset of the Worker surface the runner uses — injectable for tests. */
export interface WorkerLike {
  postMessage(message: FoldRequest): void;
  terminate(): void;
  onmessage: ((event: { data: FoldReply }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

const newFoldWorker = (): WorkerLike =>
  new Worker(new URL('./foldWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;

/** The fold in a Web Worker, created on the first fold and kept for the
 * runner's life. The mirror protocol: when the store hands over the SAME array
 * it handed over last time (grown in place), only the tail travels. */
export const workerFoldRunner = (makeWorker: () => WorkerLike = newFoldWorker): FoldRunner => {
  let worker: WorkerLike | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (out: FoldOutput) => void; reject: (error: Error) => void }>();
  let mirrored: JournalEvent[] | null = null;
  let mirroredLength = 0;

  const failAll = (message: string) => {
    for (const [, p] of pending) p.reject(new Error(message));
    pending.clear();
  };
  const drop = () => {
    worker?.terminate();
    worker = null;
    mirrored = null;
    mirroredLength = 0;
  };
  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const w = makeWorker();
    w.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if ('error' in data) p.reject(new Error(data.error));
      else p.resolve(data.result);
    };
    w.onerror = (event) => {
      // The worker is dead: every pending fold fails with the reason, and the
      // next fold gets a fresh worker with a fresh mirror.
      failAll(`fold worker failed: ${event?.message ?? 'unknown error'}`);
      drop();
    };
    worker = w;
    return w;
  };

  return {
    fold(events) {
      const w = ensure();
      const id = ++seq;
      const incremental = mirrored === events && events.length >= mirroredLength;
      const request: FoldRequest = incremental
        ? { id, append: events.slice(mirroredLength) }
        : { id, events };
      mirrored = events;
      mirroredLength = events.length;
      return new Promise<FoldOutput>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage(request);
      });
    },
    dispose() {
      failAll('fold runner disposed');
      drop();
    },
  };
};

/** The production choice: a worker where the host has one, inline otherwise. */
export const defaultFoldRunner = (): FoldRunner =>
  typeof Worker === 'function' && typeof document !== 'undefined' ? workerFoldRunner() : inlineFoldRunner();
