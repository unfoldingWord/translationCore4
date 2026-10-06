// #516 — the hand-over of a fitted booster between the two suggestion workers.
//
// Training runs in its own worker (suggestTrainWorker.ts), so the worker that
// answers Suggest (suggestWorker.ts) is never busy with it. The booster
// crosses as plain data (packModel → postMessage) and joins the memory the
// answering worker already holds (attachBooster); the memory never travels.
//
// The ways this can fail, written before the code:
//   1. A booster attached to a memory that grew by appends predicts
//      differently from the model that was trained on the same verses.
//   2. The packed booster does not survive the structured clone of postMessage.
//   3. A fit with no booster changes the standing model.
//   4. Suggest waits for a training that runs at the same time.
// Cases 1-3 are checked in-process. Case 4 runs the two real worker files in
// two real threads with the unmocked engine.
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { appendVerse, attachBooster, emptyModel, packModel, predictLinks, trainModel, type TrainedModel } from '../src/data/align/suggestEngine';
import { versesOfBook } from './helpers/ult-corpus';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { Worker } = process.getBuiltinModule('node:worker_threads');

const TITUS = versesOfBook('TIT', fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/en_ult/TIT.usfm'), 'utf8'));
const ask = (v: (typeof TITUS)[number]) => ({ source: v.source, target: v.target, manual: [] });

/** A memory-only model that grew one append at a time, as the answering worker's does. */
const grown = (verses: typeof TITUS): TrainedModel => verses.reduce((m, v) => appendVerse(m, v), emptyModel('nt'));

describe('#516 hand-over — a booster attached to the standing memory answers like the model that was trained', () => {
  it('boosted: same predictions as the trained model, after pack, structured clone and attach; without it they differ', async () => {
    const corpus = TITUS.slice(0, 12);
    const trained = await trainModel('nt', corpus);
    expect(trained.boosted).toBeGreaterThan(0);
    const attached = attachBooster(grown(corpus), structuredClone(packModel(trained)));
    expect(attached).toMatchObject({ verses: trained.verses, boosted: trained.boosted });
    const probes = TITUS.slice(20, 30);
    for (const probe of probes) {
      const expected = predictLinks(trained, ask(probe));
      expect(predictLinks(attached, ask(probe))).toEqual(expected);
    }
    expect(probes.some((p) => predictLinks(trained, ask(p)).length > 0)).toBe(true);
    // Control: the same memory with no booster answers differently on some probe.
    const plain = grown(corpus);
    expect(probes.some((p) => JSON.stringify(predictLinks(plain, ask(p))) !== JSON.stringify(predictLinks(trained, ask(p))))).toBe(true);
  }, 120_000);

  it('a fit with no booster leaves the standing model as it is', async () => {
    const trained = await trainModel('nt', TITUS.slice(0, 3));
    expect(trained.boosted).toBe(0);
    const standing = grown(TITUS.slice(0, 8));
    expect(attachBooster(standing, structuredClone(packModel(trained)))).toBe(standing);
  });
});

/** One of the two worker files, bundled and started in a real thread. The
 * banner gives the file the `postMessage` a Web Worker has; the footer feeds
 * it the thread's messages. */
async function startWorker(entry: string, dir: string) {
  const outfile = path.join(dir, `${path.basename(entry, '.ts')}.cjs`);
  await build({
    entryPoints: [path.resolve(process.cwd(), entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    banner: { js: "const { parentPort } = require('node:worker_threads'); globalThis.postMessage = (m) => parentPort.postMessage(m);" },
    footer: { js: 'parentPort.on("message", (data) => globalThis.onmessage({ data }));' },
  });
  return new Worker(outfile);
}

describe('#516 two workers — Suggest is answered while a real training runs', () => {
  it('the answering worker replies before the training worker finishes its fit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-suggest-workers-'));
    const answering = await startWorker('src/data/align/suggestWorker.ts', dir);
    const training = await startWorker('src/data/align/suggestTrainWorker.ts', dir);
    try {
      const order: string[] = [];
      const next = (w: InstanceType<typeof Worker>, type: string) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const on = (m: Record<string, unknown>) => {
            if (m.type === 'error') reject(new Error(String(m.message)));
            if (m.type !== type) return;
            w.off('message', on);
            order.push(type);
            resolve(m);
          };
          w.on('message', on);
        });

      // The standing model: the project's verses as memory.
      const corpus = TITUS.slice(0, 14);
      const loaded = next(answering, 'memory');
      answering.postMessage({ type: 'load', id: 1, testament: 'nt', verses: corpus });
      expect(await loaded).toMatchObject({ verses: 14, boosted: false });
      order.length = 0;

      // A real, unmocked training starts in its own thread…
      const fitted = next(training, 'fitted');
      training.postMessage({ type: 'train', id: 10, testament: 'nt', verses: corpus });
      // …and Suggest is asked while it runs.
      const suggestions = next(answering, 'suggestions');
      answering.postMessage({ type: 'suggest', id: 11, testament: 'nt', input: ask(TITUS[1]), ref: '1:2', session: 1 });
      expect(((await suggestions).links as unknown[]).length).toBeGreaterThan(0);
      const model = (await fitted).model;
      expect(order).toEqual(['suggestions', 'fitted']); // answered by the standing model, before the fit ended

      // The fitted booster then joins the standing memory and answers.
      const attached = next(answering, 'memory');
      answering.postMessage({ type: 'booster', id: 13, testament: 'nt', model });
      expect(await attached).toMatchObject({ verses: 14, boosted: true });
      const after = next(answering, 'suggestions');
      answering.postMessage({ type: 'suggest', id: 12, testament: 'nt', input: ask(TITUS[35]), ref: '3:5', session: 1 });
      expect(((await after).links as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await answering.terminate();
      await training.terminate();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
